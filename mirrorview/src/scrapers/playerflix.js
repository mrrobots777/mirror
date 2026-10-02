const { workerDe } = require("../core/nomes");
const https = require("https");
const http = require("http");
const { getRelayAgents, extractQuality, makeCache } = require("../lib/scraper-utils");
const { vodTitle } = require("../lib/stream");
const { coletar, resolver } = require("../lib/extrator");

const PLAYERFLIX_BASE = "https://playerflix.ink";
const WORKER = workerDe("spt");
const navCache = makeCache(60, 15 * 60 * 1000);
const m3u8Cache = makeCache(80, 3 * 60 * 1000);

// A mascara de URL saiu do servidor na decisao 155 (o `lib/proxy.js` foi apagado): o player
// agora sai do APARELHO, direto para a origem, do IP residencial de quem assiste. Esta funcao
// virou o que o nome sempre devia ter dito no servidor — nada. A versao que mascara (e que o
// `relay/m/` do worker) esta no plugin, `nuvio/src/scrapers/playerflix.js`.
function proxyIfNeeded(url) {
  return url;
}

function fetchPage(url, extraHeaders, _redirects = 0) {
  if (_redirects > 5) return Promise.reject(new Error("too many redirects"));
  const { httpAgent, httpsAgent } = getRelayAgents();
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const agent = url.startsWith("https") ? httpsAgent : httpAgent;
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/json",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      ...extraHeaders,
    };
    const req = mod.get(url, { agent, headers, timeout: 12000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchPage(res.headers.location, extraHeaders, _redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const code = res.statusCode;
        res.resume();
        reject(new Error(`playerflix HTTP ${code}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => { chunks.push(chunk); });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
  });
}

async function fetchJson(url, extraHeaders) {
  const raw = await fetchPage(url, extraHeaders);
  try { return JSON.parse(raw); } catch { throw new Error("playerflix invalid json"); }
}

// Descobre a playlist com o MOTOR (`src/lib/extrator.js`) em vez das 3 regex que estavam aqui.
//
// O QUE MUDOU (29/09/2026): a regex era `/url\s*:\s*["']([^"']+\.m3u8…)/` e o SPT escreve o
// endereco com a BARRA ESCAPADA — `url:"https:\/\/vid7…\/playlist.m3u8?md5=…"`. As tres regex
// pecavam por/ca. O motor desfaz a barra e a entity `&amp;` na entrada, o que alem disso passa a
// enxergar playlist em `.txt`, objeto de configuracao e video dentro de parametro.
function pickM3u8(html, base) {
  const achados = coletar(html, { base });
  return achados.length ? achados[0].url : null;
}

async function extractM3u8(embedUrl) {
  const cached = m3u8Cache.get(embedUrl);
  if (cached) return cached;
  const html = await fetchPage(embedUrl, {
    "Referer": `${PLAYERFLIX_BASE}/`,
    "X-Requested-With": "XMLHttpRequest",
  });
  let found = pickM3u8(html, embedUrl);
  if (!found) {
    // A pagina do embed nao tinha video: deixa o motor seguir a cadeia (iframe -> player).
    const achado = await resolver(embedUrl, {
      ms: 5000,
      maxPaginas: 3,
      referer: `${PLAYERFLIX_BASE}/`,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    found = achado.url;
  }
  if (found) m3u8Cache.set(embedUrl, found);
  return found;
}

async function streamsFor(title, episode, type, tmdbId, season, year) {
  if (!tmdbId) return [];
  const sn = Number(season) || 1;
  const ep = Number(episode) || 1;
  try {
    const apiType = type === "movie" ? "movie" : "tv";
    const params = new URLSearchParams({ type: apiType, id: String(tmdbId) });
    if (type !== "movie") {
      params.set("season", String(sn));
      params.set("episode", String(ep));
    }
    const apiUrl = `${PLAYERFLIX_BASE}/inc/Ajax.php?${params.toString()}`;
    let data = navCache.get(apiUrl);
    if (data === null) {
      data = await fetchJson(apiUrl, {
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `${PLAYERFLIX_BASE}/`,
      });
      if (data && data.status) navCache.set(apiUrl, data);
    }
    if (!data) throw new Error("playerflix fetch failed");
    if (!data.status) return [];
    if (!data.data || !Array.isArray(data.data.options)) throw new Error("playerflix payload inesperado");

    const validOpts = data.data.options.filter(opt => opt.embed && /watchplay/i.test(opt.label + opt.embed));
    const embedResults = await Promise.allSettled(validOpts.map((opt, i) => extractM3u8(opt.embed).then(m3u8 => {
      if (!m3u8) return null;
      const proxiedUrl = proxyIfNeeded(m3u8);
      const quality = extractQuality(m3u8) || "1080p";
      return {
        id: `playerflix:${tmdbId}:${episode || 0}:${i}`,
        type,
        name: `Mirror ${quality}`,
        title: vodTitle({ name: title || "Filme", year, type, season: Number(season) || 1, episode: Number(episode) || 1, quality, source: "spt" }),
        url: proxiedUrl,
        episode: Number(episode) || 0,
        dubbed: true,
        portuguese: true,
        subtitle: false,
        subtitles: [],
        quality,
        size: 0,
        sources: ["spt"],
        behaviorHints: { notWebReady: false, bingeGroup: "mirror-playerflix" },
      };
    })));
    if (embedResults.length && embedResults.every(r => r.status === "rejected")) throw embedResults[0].reason;
    return embedResults.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);
  } catch (e) {
    console.error(`[playerflix] ${e.message}`);
    throw e;
  }
}

module.exports = { streamsFor };
