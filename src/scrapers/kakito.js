const { ENV, workerDe } = require("../core/nomes");
const { extractQuality } = require("../lib/scraper-utils");
const { matchVodTitle } = require("../lib/match");
const { makeHttpStream, vodTitle } = require("../lib/stream");

let db;
let dbFile = null;

function playlistStale(mtimeMs, now = Date.now()) {
  if (!Number.isFinite(mtimeMs)) return false;
  return now - mtimeMs > REFRESH_INTERVAL;
}

function getDb() {
  if (db) return db;
  const Database = require("better-sqlite3");
  const fs = require("fs");
  const candidates = [
    ENV.DATA_DIR,
    process.cwd(),
    "/tmp",
  ].filter(Boolean);
  let dbPath;
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const test = require("node:path").join(dir, ".write-test");
      fs.writeFileSync(test, "ok");
      fs.unlinkSync(test);
      dbPath = require("node:path").join(dir, "iptv.db");
      break;
    } catch (_) {}
  }
  if (!dbPath) dbPath = require("node:path").join("/tmp", "iptv.db");
  const createTables = (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        logo TEXT DEFAULT '',
        group_raw TEXT DEFAULT '',
        group_main TEXT DEFAULT '',
        group_sub TEXT DEFAULT '',
        url TEXT NOT NULL,
        content_type TEXT DEFAULT 'live',
        is_ptbr INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_name ON channels(name);
      CREATE INDEX IF NOT EXISTS idx_group_main ON channels(group_main);
      CREATE INDEX IF NOT EXISTS idx_group_sub ON channels(group_sub);
      CREATE INDEX IF NOT EXISTS idx_content_type ON channels(content_type);
    `);
  };

  try {
    db = new Database(dbPath);
    dbFile = dbPath;
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -1000");
    createTables(db);
    console.log(`[iptv] sqlite db opened: ${dbPath}`);
  } catch (e) {
    console.error(`[iptv] disk db failed (${e.message}), using in-memory`);
    try { if (db) db.close(); } catch (_) {}
    db = null;
    dbFile = null;
    try {
      db = new Database(":memory:");
      createTables(db);
      console.log("[iptv] sqlite in-memory opened");
    } catch (e2) {
      console.error("[iptv] in-memory also failed:", e2.message);
      db = null;
    }
  }
  return db;
}

let playlistLoaded = false;
let lastRefresh = 0;
let playlistLoading = null;
const REFRESH_INTERVAL = 6 * 60 * 60 * 1000;

function dbStale() {
  if (!dbFile) return false;
  try {
    return playlistStale(require("fs").statSync(dbFile).mtimeMs);
  } catch (_) {
    return false;
  }
}

const KAKITO_SERVER = ENV.IPTV_SERVER || "kakito.xyz";
const KAKITO_USER = ENV.IPTV_USERNAME || "MirrorPrincipal";
const KAKITO_PASS = ENV.IPTV_PASSWORD || "ditj7j1h";

function getKakitoM3uUrl() {
  if (!KAKITO_SERVER || !KAKITO_USER || !KAKITO_PASS) return null;
  return `https://${KAKITO_SERVER}/get.php?username=${encodeURIComponent(KAKITO_USER)}&password=${encodeURIComponent(KAKITO_PASS)}&type=m3u_plus&output=ts`;
}

function getIptvSources() {
  const sources = [];

  if (ENV.IPTV_SOURCES) {
    const urls = ENV.IPTV_SOURCES.split("|").map(s => s.trim()).filter(Boolean);
    for (const url of urls) {
      if (url.startsWith("http")) sources.push({ url, name: "custom", priority: 0 });
    }
  }

  const kakitoUrl = getKakitoM3uUrl();
  if (kakitoUrl) {
    sources.push({ url: kakitoUrl, name: "kakito", priority: 0, filterGroups: false });
  }

  return sources;
}

async function streamM3uInsert(url, d, seenSet, filterVod, filterGroups, table = "channels") {
  // A cadeia de relé BR -> worker -> direto (decisao 54) usava o `/proxy` do worker como
  // primeiro CANDIDATO, com o `IPTV_PROXY` na frente quando ele estava no ambiente. O
  // `getCdnProxy` veio do `lib/proxy.js` (apagado na decisao 155); `workerDe` vem do registro
  // unico e devolve a MESMA URL. A cadeia em si continua: o M3U do painel so responde com o
  // cabecalho certo em parte das tentativas.
  const proxyUrl = ENV.IPTV_PROXY || `${workerDe("kkt")}/proxy`;
  const fetchCandidates = [];
  if (proxyUrl) fetchCandidates.push(`${proxyUrl}?url=${encodeURIComponent(url)}`);
  fetchCandidates.push(url);
  const headers = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  };
  let res = null;
  let lastError = null;
  for (const fetchUrl of fetchCandidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    if (timeout.unref) timeout.unref();
    try {
      const attempt = await fetch(fetchUrl, { headers, signal: controller.signal });
      if (attempt.ok) { res = attempt; break; }
      lastError = new Error(`HTTP ${attempt.status}`);
      // NAO cancelar o corpo (mesmo motivo do `vizer.js`): `await attempt.body?.cancel()` aqui
      // nasce uma excecao ASSINCRONA dentro do undici (`ERR_INVALID_STATE: Controller is already
      // closed`) que mata o processo — e isto roda no BOOT, quando o painel responde 5xx: o
      // container entraria em loop de reinicio. O socket e solto pelo `controller.abort()` do
      // timeout proprio.
    } catch (e) {
      lastError = new Error(e && e.name === "AbortError" ? "timeout" : (e && e.message) || "fetch failed");
    }
  }
  if (!res) throw lastError || new Error("fetch failed");

  const insert = d.prepare(`INSERT OR IGNORE INTO ${table} (name, group_raw, group_main, group_sub, url, content_type, logo) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const BATCH = 500;
  let batch = [];
  let current = null;
  let count = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const nlIdx = buffer.lastIndexOf("\n");
    if (nlIdx === -1) continue;
    const chunk = buffer.substring(0, nlIdx);
    buffer = buffer.substring(nlIdx + 1);
    const lines = chunk.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#EXTINF:")) {
        const nameMatch = trimmed.match(/,\s*(.+)$/);
        const tvgLogo = trimmed.match(/tvg-logo="([^"]+)"/i);
        const group = trimmed.match(/group-title="([^"]+)"/i);
        const rawGroup = group ? group[1] : "";
        const groupParts = rawGroup.split(/\s*[•·]\s*/).map(s => s.trim()).filter(Boolean);
        current = {
          n: nameMatch ? nameMatch[1].trim() : "",
          l: tvgLogo ? tvgLogo[1] : "",
          g: rawGroup,
          gMain: groupParts[0] || "Outros",
          gSub: groupParts.length > 1 ? groupParts.slice(1).join(" > ") : "",
        };
      } else if (trimmed && !trimmed.startsWith("#") && current) {
        current.u = trimmed;
        if (filterVod && !current.u.includes("/movie/") && !current.u.includes("/series/")) {
          current = null;
          continue;
        }
        if (!seenSet.has(current.u)) {
          seenSet.add(current.u);
          const ct = detectContentType(current);
          batch.push([current.n, current.g || "", current.gMain || "", current.gSub || "", current.u, ct || "live", current.l || ""]);
        }
        current = null;

        if (batch.length >= BATCH) {
          const tx = d.transaction((rows) => { for (const r of rows) insert.run(...r); });
          tx(batch);
          count += batch.length;
          batch = [];
        }
      }
    }
  }

  if (buffer.trim()) {
    const lines = buffer.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#EXTINF:")) {
        const nameMatch = trimmed.match(/,\s*(.+)$/);
        const tvgLogo = trimmed.match(/tvg-logo="([^"]+)"/i);
        const group = trimmed.match(/group-title="([^"]+)"/i);
        const rawGroup = group ? group[1] : "";
        const groupParts = rawGroup.split(/\s*[•·]\s*/).map(s => s.trim()).filter(Boolean);
        current = {
          n: nameMatch ? nameMatch[1].trim() : "",
          l: tvgLogo ? tvgLogo[1] : "",
          g: rawGroup,
          gMain: groupParts[0] || "Outros",
          gSub: groupParts.length > 1 ? groupParts.slice(1).join(" > ") : "",
        };
      } else if (trimmed && !trimmed.startsWith("#") && current) {
        current.u = trimmed;
        if (filterVod && !current.u.includes("/movie/") && !current.u.includes("/series/")) {
          current = null;
          continue;
        }
        if (!seenSet.has(current.u)) {
          seenSet.add(current.u);
          const ct = detectContentType(current);
          batch.push([current.n, current.g || "", current.gMain || "", current.gSub || "", current.u, ct || "live", current.l || ""]);
        }
        current = null;
      }
    }
  }

  if (batch.length) {
    const tx = d.transaction((rows) => { for (const r of rows) insert.run(...r); });
    tx(batch);
    count += batch.length;
  }

  return count;
}

const CONTENT_KEYWORDS = {
  anime: [
    /\banime\b/i, /\bcartoon\b/i, /\bdesenho\b/i,
    /\bcartoon network\b/i, /\bdisney xd\b/i, /\bjetix\b/i,
    /\banimax\b/i, /\bcrunchyroll\b/i, /\botaku\b/i,
    /\bcartoonito\b/i, /\bnicktoons\b/i, /\bboomerang\b/i,
    /\bchild\b/i, /\bkids\b/i, /\binfantil\b/i,
  ],
  movie: [
    /\bfilme\b/i, /\bfilmes\b/i, /\bmovie\b/i, /\bmovies\b/i,
    /\bcinema\b/i, /\bpremiere\b/i, /\btelecine\b/i,
    /\baction\b/i, /\bcomedy\b/i, /\bhorror\b/i, /\bthriller\b/i,
    /\bhd movies\b/i, /\bmovie channel\b/i,
  ],
  series: [
    /\bserie\b/i, /\bseries\b/i, /\bepisodes\b/i, /\bseason\b/i,
    /\bHBO\b/i, /\bshowtime\b/i, /\bstarz\b/i,
    /\bfox\b/i, /\buniversal\b/i, /\bamc\b/i,
  ],
  live: [
    /\blive\b/i, /\breal time\b/i, /\bnews\b/i, /\bnovidades\b/i,
    /\besportes\b/i, /\bsports\b/i, /\bfootball\b/i, /\bfutebol\b/i,
    /\bUFC\b/i, /\bESPN\b/i, /\bband\b/i, /\bglobo\b/i,
    /\bSBT\b/i, /\brecord\b/i, /\bmanchete\b/i,
    /\bCazé TV\b/i, /\bPremiere\b/i, /\bge\b/i,
  ],
};

const PT_BR_KEYWORDS = [
  "brasil", "brazil", "pt-br", "portugu",
  "globoplay", "rede", "band", "sbt", "record", "globo",
  "manchete", "octo", "tv cultura", "tv brasil",
  "caze", "premiere", "vix",
];

function detectContentType(channel) {
  const name = (channel.n || "").toLowerCase();
  const group = (channel.g || "").toLowerCase();
  const gMain = (channel.gMain || "").toLowerCase();
  const combined = `${name} ${group}`;

  if (gMain === "canais") return "live";
  if (gMain === "filmes") return "movie";
  if (gMain === "series") return "series";

  let bestType = "live";
  let bestScore = 0;
  for (const [type, patterns] of Object.entries(CONTENT_KEYWORDS)) {
    let score = 0;
    for (const pattern of patterns) { if (pattern.test(combined)) score++; }
    if (score > bestScore) { bestScore = score; bestType = type; }
  }
  return bestType;
}

function isPtBrChannel(channel) {
  const name = (channel.n || "").toLowerCase();
  const group = (channel.g || "").toLowerCase();
  const combined = `${name} ${group}`;
  for (const kw of PT_BR_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) return true;
  }
  return false;
}

// A mascara de stream saiu do servidor na decisao 155 (o `applyStreamProxy` vivia no
// `lib/proxy.js`, apagado). O servidor nao rebaixa mais link nenhum: o player sai do
// APARELHO, direto para a origem. A versao que mascara esta no plugin,
// `nuvio/src/scrapers/kakito.js`. Aqui a URL segue crua.
function applyProxy(url) {
  return url;
}

function parseEpisodeFromName(name) {
  const s = String(name || "");
  let m = s.match(/\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = s.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,3})\b/);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = s.match(/\b(?:ep|eps|episode)[\s._-]*(\d{1,3})\b/i);
  if (m) return { season: 1, episode: Number(m[1]) };
  return null;
}

function formatNiceName(originalName) {
  let niceName = originalName.replace(/^(brasil|br|pt|portugal|canais|tv)\s*\|\s*/i, '');
  niceName = niceName.replace(/\b(4k|fhd|hd|sd|uhd|1080p|720p)\b/gi, '').trim();
  niceName = niceName.replace(/[-\s|]+$/, '').trim();
  return niceName;
}

async function ensurePlaylist() {
  const now = Date.now();
  if (playlistLoaded && (now - lastRefresh) < REFRESH_INTERVAL) return;
  if (playlistLoading) return playlistLoading;
  const refresh = playlistLoaded;
  playlistLoading = loadPlaylist(refresh).finally(() => { playlistLoading = null; });
  return playlistLoading;
}

async function loadPlaylist(refresh = false) {
  const d = getDb();
  if (!d) throw new Error("iptv: db indisponivel");
  const count = d.prepare("SELECT COUNT(*) as c FROM channels").get().c;
  if (count > 0 && !refresh && !dbStale()) {
    playlistLoaded = true;
    lastRefresh = Date.now();
    return;
  }
  if (count > 0 && dbStale()) console.log(`[iptv] db obsoleto (${count} canais), recarregando playlist...`);

  const sources = getIptvSources();
  if (!sources.length) {
    console.error("[iptv] nenhuma fonte IPTV configurada");
    if (count > 0) {
      lastRefresh = Date.now();
      return;
    }
    throw new Error("iptv: nenhuma fonte configurada");
  }

  console.log(`[iptv] carregando ${sources.length} fonte(s)...`);
  d.exec("DROP TABLE IF EXISTS channels_new");
  d.exec(`CREATE TABLE channels_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    logo TEXT DEFAULT '',
    group_raw TEXT DEFAULT '',
    group_main TEXT DEFAULT '',
    group_sub TEXT DEFAULT '',
    url TEXT NOT NULL,
    content_type TEXT DEFAULT 'live',
    is_ptbr INTEGER DEFAULT 0
  )`);
  const seenSet = new Set();
  let totalCount = 0;

  try {
    for (const source of sources) {
      const url = source.url || source;
      const name = source.name || "unknown";
      const hostname = new URL(url).hostname;
      try {
        const filterVod = false;
        const filterGroups = source.filterGroups || false;
        const c = await streamM3uInsert(url, d, seenSet, filterVod, filterGroups, "channels_new");
        totalCount += c;
        console.log(`[iptv] ${name} (${hostname}): +${c} canais (total: ${totalCount})`);
      } catch (e) {
        console.error(`[iptv] erro ao buscar ${name} (${hostname}): ${e.message}`);
      }
    }
    if (!totalCount) throw new Error("iptv: nenhuma fonte carregada");
    d.exec("DROP TABLE channels");
    d.exec("ALTER TABLE channels_new RENAME TO channels");
    d.exec(`
      CREATE INDEX IF NOT EXISTS idx_name ON channels(name);
      CREATE INDEX IF NOT EXISTS idx_group_main ON channels(group_main);
      CREATE INDEX IF NOT EXISTS idx_group_sub ON channels(group_sub);
      CREATE INDEX IF NOT EXISTS idx_content_type ON channels(content_type);
    `);
    playlistLoaded = true;
    lastRefresh = Date.now();
    console.log(`[iptv] total: ${totalCount} canais carregados de ${sources.length} fonte(s)`);
  } catch (e) {
    d.exec("DROP TABLE IF EXISTS channels_new");
    lastRefresh = Date.now() - REFRESH_INTERVAL + 60000;
    if (count > 0) {
      console.error(`[iptv] recarga falhou (${e.message}); mantendo ${count} canais ja carregados`);
      playlistLoaded = true;
      return;
    }
    throw e;
  }
}

function preloadPlaylist() {
  ensurePlaylist().catch((e) => console.error(`[iptv] preload: ${e.message}`));
}

function streamsForType(rows, query, episode, mediaType, season, year) {
  const streams = [];
  const seen = new Set();
  const wantEp = Number(episode) || 1;
  const wantSeason = season == null ? null : Number(season);
  const wantMovie = mediaType === "movie";
  for (const row of rows) {
    if (!row.url || seen.has(row.url)) continue;
    const isVodUrl = /\/(movie|series)\//i.test(row.url);
    const ct = row.content_type || "";
    if (!isVodUrl && (ct === "live" || ct === "anime")) continue;
    if (!isVodUrl && ct !== "movie" && ct !== "series") continue;
    const isSeriesEntry = /\/series\//i.test(row.url) || ct === "series";
    if (wantMovie && isSeriesEntry) continue;
    const nameMatch = matchVodTitle(row.name, query, isSeriesEntry, isSeriesEntry ? undefined : year);
    if (!nameMatch) continue;

    let epNum = 1;
    let seas = 1;
    if (isSeriesEntry) {
      const parsed = parseEpisodeFromName(row.name);
      if (!parsed) continue;
      seas = parsed.season;
      epNum = parsed.episode;
      if (epNum !== wantEp) continue;
      if (wantSeason != null && wantSeason > 0 && seas !== wantSeason) continue;
    } else if (wantMovie === false) {
      continue;
    }

    seen.add(row.url);
    const isPtBr = isPtBrChannel({ n: row.name, g: row.group_raw });
    const niceName = formatNiceName(row.name);
    const quality = extractQuality(row.name) || "720p";
    const streamEp = isSeriesEntry ? epNum : 1;
    const streamSeason = isSeriesEntry ? seas : 1;
    const streamUrl = applyProxy(row.url);
  streams.push(makeHttpStream({
      id: `iptv:${row.name.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50)}:${streamSeason}:${streamEp}`,
      type: isSeriesEntry ? "series" : "movie",
      title: vodTitle({ name: niceName, year: isSeriesEntry ? null : year, type: isSeriesEntry ? "series" : "movie", season: streamSeason, episode: streamEp, quality, source: "kkt" }),
      url: streamUrl,
      episode: streamEp,
      season: streamSeason,
      quality,
      source: "kkt",
      dubbed: isPtBr,
      portuguese: isPtBr,
      notWebReady: streamUrl.startsWith("http://"),
      bingeGroup: "mirror-iptv",
    }));
    if (streams.length >= 8) break;
  }
  return streams;
}

async function streamsFor(query, episode, mediaType, season, year) {
  if (!query) return [];
  try {
    await ensurePlaylist();
    const d = getDb();
    if (!d) return [];
    const q = `%${query}%`;
    const rows = d.prepare("SELECT name, group_raw, group_main, group_sub, url, content_type, logo FROM channels WHERE (url LIKE '%/movie/%' OR url LIKE '%/series/%') AND (name LIKE ? ESCAPE '\\' OR group_raw LIKE ? ESCAPE '\\' OR group_main LIKE ? ESCAPE '\\') LIMIT 1000").all(q, q, q);
    const out = streamsForType(rows, query, episode, mediaType, season, year).slice(0, 12);
    console.log(`[iptv] kkt busca "${query}" ${mediaType}: rows=${rows.length} streams=${out.length}`);
    return out;
  } catch (e) {
    console.error(`[iptv] streamsFor: ${e.message}`);
    throw e;
  }
}


module.exports = { streamsFor, parseEpisodeFromName, preloadPlaylist, ensurePlaylist, isPtBrChannel, playlistStale, detectContentType, getDb };
