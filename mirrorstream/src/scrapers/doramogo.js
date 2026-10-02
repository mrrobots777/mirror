const { browserFetch, makeCache } = require("../lib/scraper-utils");
const { vodTitle, makeHttpStream } = require("../lib/stream");
const { ascii, looseCoverage, extraWords } = require("../lib/text");
const { UA } = require("../lib/ua");
const { literal } = require("../lib/extrator");

const BASE = "https://www.doramogo.net";
const FALLBACK_SITE = "https://www.mydoramas.net";
const SITES = [BASE, FALLBACK_SITE];
const REFERER = `${BASE}/`;
const PRIMARY_URL = "https://ondemand.madfirebox.shop";
const FETCH_TIMEOUT = 9000;
const MIN_SCORE = 5;

const searchCache = makeCache(60, 15 * 60 * 1000);
const seriesCache = makeCache(40, 15 * 60 * 1000);
const episodeCache = makeCache(60, 10 * 60 * 1000);

const REJECT = /\btrailer\b|\bprevista\b|\bostra\b|\bexclu[ií]d|\bfilmes?\b|\bespecial\b/i;
const STOP = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "com", "sem", "os", "as", "um", "uma"]);

function cleanTitle(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s*[([][^)\]]{0,30}(?:legendado|dublado|legendada|dublada)[^)\]]{0,10}[)\]]\s*/gi, " ")
    .replace(/\s*[-–—]\s*(?:legendado|dublado|legendada|dublada)\s*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function scoreSeries(titulo, query) {
  const t = ascii(cleanTitle(titulo));
  const q = ascii(query).trim();
  if (!t || !q) return -100;
  if (REJECT.test(t)) return -100;
  const cov = looseCoverage(t, q, STOP);
  let score = 0;
  if (t.includes(q)) score = 10;
  else if (cov >= 0.99) score = 8 - 6 * extraWords(t, q, STOP);
  else if (cov >= 0.6) score = 4;
  else return -100;
  return score;
}

function pickYear(titulo) {
  const m = String(titulo || "").match(/\(((?:19|20)\d{2})\)/);
  return m ? Number(m[1]) : 0;
}

async function fetchText(url) {
  const res = await browserFetch(url, { headers: { "User-Agent": UA, Referer: REFERER }, timeout: FETCH_TIMEOUT });
  if (!res.ok) throw new Error(`dgo HTTP ${res.status} ${url.slice(0, 80)}`);
  return res.text();
}

function parseSearch(html, site) {
  const out = [];
  const seen = new Set();
  const host = (site || BASE).replace(/^https?:\/\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<a\\s+href="https?://${host}/series/([a-z0-9-]+)"[^>]*>\\s*<img[^>]*alt="([^"]*)"`, "gi");
  for (const m of html.matchAll(re)) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, title: cleanTitle(m[2]) || slug, host: site || BASE });
  }
  if (!out.length) {
    for (const m of html.matchAll(new RegExp(`https?://${host}/series/([a-z0-9-]+)`, "g"))) {
      const slug = m[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push({ slug, title: cleanTitle(slug.replace(/-/g, " ")), host: site || BASE });
    }
  }
  return out;
}

function parseEpisodes(html) {
  const out = new Map();
  for (const m of html.matchAll(/\/series\/([a-z0-9-]+)\/temporada-(\d+)\/episodio-(\d+)/g)) {
    const key = `${Number(m[2])}x${Number(m[3])}`;
    if (!out.has(key)) out.set(key, { season: Number(m[2]), episode: Number(m[3]) });
  }
  return out;
}

// Le `var urlConfig = {…}` com o SCANNER do motor (`src/lib/extrator.js`), que fecha o objeto
// certo mesmo com `{`/`}` dentro de string, e sabe ler objeto que o site escreveu sem aspas
// (`{slug:x, base:y}`) — que e javascript valido e JSON invalido, e por isso a regex antiga
// falhava em qualquer mudanca de layout.
//
// A regex antiga continua como RESGATE (`parseUrlConfigAntigo`): o site esta fora do ar na
// medicao de 29/09/2026 (erro 1016 do Cloudflare deles na raiz, na busca e na lista), entao nao
// da para medir o caminho novo ao vivo. Com o resgate, um layout novo nao derruba a fonte: o
// motor tenta, a regex tenta, e o que vier primeiro serve.
function parseUrlConfig(html) {
  const obj = literal(html, "var urlConfig =");
  if (obj && typeof obj === "object") {
    const slug = obj.slug;
    if (slug) {
      return {
        base: obj.base || "https://forks-doramas.madfirebox.shop",
        slug: String(slug),
        tipo: String(obj.tipo || "doramas").toLowerCase(),
        temporada: Number(obj.temporada) || 1,
        episodio: Number(obj.episodio) || 1,
      };
    }
  }
  return parseUrlConfigAntigo(html);
}

function parseUrlConfigAntigo(html) {
  const m = html.match(/var\s+urlConfig\s*=\s*\{([\s\S]{0,500}?)\}/);
  if (!m) return null;
  const body = m[1];
  const pick = (k) => {
    const mm = body.match(new RegExp(`${k}\\s*:\\s*["']([^"']+)["']`, "i"));
    if (mm) return mm[1];
    const mn = body.match(new RegExp(`${k}\\s*:\\s*(\\d+)`));
    return mn ? Number(mn[1]) : null;
  };
  const slug = pick("slug");
  if (!slug) return null;
  return {
    base: pick("base") || "https://forks-doramas.madfirebox.shop",
    slug,
    tipo: (pick("tipo") || "doramas").toLowerCase(),
    temporada: Number(pick("temporada")) || 1,
    episodio: Number(pick("episodio")) || 1,
  };
}

function buildStreamUrl(cfg, host) {
  const inicial = String(cfg.slug || "").charAt(0).toUpperCase();
  const path = cfg.tipo === "filmes"
    ? `${inicial}/${cfg.slug}/stream/stream.m3u8`
    : `${inicial}/${cfg.slug}/${String(cfg.temporada).padStart(2, "0")}-temporada/${String(cfg.episodio).padStart(2, "0")}/stream.m3u8`;
  return `${host}/${path}`;
}

async function searchSeries(query) {
  const key = ascii(query).trim();
  if (!key) return [];
  const cached = searchCache.get(key);
  if (cached !== null) return cached;
  let scored = [];
  let lastError = null;
  for (const site of SITES) {
    let html = "";
    try {
      html = await fetchText(`${site}/search/?q=${encodeURIComponent(key)}`);
    } catch (e) {
      if (!lastError) lastError = e;
      if (site === SITES[0]) continue;
      break;
    }
    scored = parseSearch(html, site)
      .map(s => ({ ...s, score: scoreSeries(s.title, key) }))
      .filter(s => s.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score);
    if (scored.length) break;
  }
  if (!scored.length && lastError && SITES.length === 1) throw lastError;
  searchCache.set(key, scored);
  return scored;
}

async function fetchSeries(slug, host) {
  const site = host || BASE;
  const key = `${site}:${slug}`;
  const cached = seriesCache.get(key);
  if (cached !== null) return cached;
  const html = await fetchText(`${site}/series/${slug}`);
  const titleMatch = html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i);
  const info = {
    title: cleanTitle(titleMatch ? titleMatch[1] : slug.replace(/-/g, " ")),
    episodes: parseEpisodes(html),
  };
  seriesCache.set(key, info);
  return info;
}

async function fetchUrlConfig(epUrl) {
  const cached = episodeCache.get(epUrl);
  if (cached !== null) return cached;
  const html = await fetchText(epUrl);
  const cfg = parseUrlConfig(html);
  if (cfg) episodeCache.set(epUrl, cfg);
  return cfg;
}

async function streamsFor(query, episode, type, season, year) {
  const isMovie = type === "movie";
  const ep = Number(episode) || 1;
  const seasonNum = Number(season) || (isMovie ? 1 : 1);
  const found = await searchSeries(query);
  if (!found.length) return [];

  for (const cand of found.slice(0, 3)) {
    if (isMovie) return [];
    const info = await fetchSeries(cand.slug, cand.host);
    const epInfo = info.episodes.get(`${seasonNum}x${ep}`);
    if (!epInfo) continue;
    const epUrl = `${cand.host || BASE}/series/${cand.slug}/temporada-${epInfo.season}/episodio-${String(epInfo.episode).padStart(2, "0")}`;
    const cfg = await fetchUrlConfig(epUrl);
    if (!cfg) continue;
    const nome = cleanTitle(info.title) || cleanTitle(cand.title) || String(query);
    const dublado = /dublad/i.test(`${info.title} ${cand.slug}`);
    const streams = [];
    for (const host of [PRIMARY_URL, cfg.base]) {
      const url = buildStreamUrl({ ...cfg, temporada: epInfo.season, episodio: epInfo.episode }, host);
      streams.push(makeHttpStream({
        id: `dgo:${cand.slug}:${epInfo.season}x${epInfo.episode}`,
        type: "series",
        title: vodTitle({ name: nome, year: pickYear(info.title) || Number(year) || undefined, type: "series", season: epInfo.season, episode: epInfo.episode, quality: "unknown", source: "dgo" }),
        url,
        episode: epInfo.episode,
        season: epInfo.season,
        quality: "unknown",
        source: "dgo",
        dubbed: dublado,
        portuguese: dublado,
        subtitle: !dublado,
        headers: { "User-Agent": UA, Referer: REFERER },
      }));
    }
    return streams;
  }
  return [];
}

module.exports = { streamsFor, scoreSeries, parseEpisodes, parseUrlConfig, buildStreamUrl, cleanTitle };
