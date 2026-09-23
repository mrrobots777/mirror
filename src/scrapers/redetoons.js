const { workerDe } = require("../core/nomes");
const { browserFetch, makeCache } = require("../lib/scraper-utils");
const { extractQuality } = require("../lib/quality");
const { makeHttpStream, vodTitle } = require("../lib/stream");
const { UA } = require("../lib/ua");

// A API do RTD so responde pelo `redetoonstv.win`: o alias `redetoons.win` tem TLS
// quebrado em todo caminho (medido 30/09/2026: direto EPROTO, via worker 525, http 409),
// entao ele e o ultimo recurso so. `SITE` fica sendo o alias porque e o Referer que o CDN
// do video aceita (medido 206 com ele e com o primario).
const SITE = "https://redetoons.win";
const SITES = [
  "https://redetoonstv.win",
  "https://redetoons.win",
];
const INDEX_URL = `${SITES[0]}/api/catalog-index`;
const WORKER = workerDe("rtd");
const CONTRACT = 3;
const TIMEOUT = 4000;
const cache = makeCache(200, 10 * 60 * 1000);
const idxCache = makeCache(2, 30 * 60 * 1000);

function isLegendado(quality, fallback) {
  const s = String(quality || "").toLowerCase().trim();
  if (!s) return fallback === true;
  return /leg|sub|orig|vose/.test(s);
}

function parseCatalogIndex(json) {
  const p = json && json.payload;
  const movies = Array.isArray(p && p.movies) ? p.movies : p && p.movie;
  if (!p || !Array.isArray(movies) || !Array.isArray(p.tv)) return null;
  return { movie: new Set(movies.map(Number)), tv: new Set(p.tv.map(Number)) };
}

function rtdHeaders() {
  return { "Referer": `${SITE}/`, "User-Agent": UA };
}

function parsePlayLink(json, tmdbId, type, season, episode, name, year) {
  if (!json || json.missing || Number(json.contract) !== CONTRACT || !Array.isArray(json.variants)) return [];
  const isSeries = type === "series";
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  const out = [];
  const seen = new Set();
  for (const v of json.variants) {
    const url = v && typeof v.url === "string" ? v.url : "";
    if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const leg = isLegendado(v.quality, json.is_legendado);
    const quality = extractQuality(url) || "unknown";
    out.push(makeHttpStream({
      id: `rtd:${tmdbId}:${isSeries ? `${s}x${e}` : "m"}:${out.length}`,
      type: isSeries ? "series" : "movie",
      title: vodTitle({ name, year, type: isSeries ? "series" : "movie", season: s, episode: e, quality, source: "rtd" }),
      url,
      episode: e,
      season: s,
      quality,
      source: "rtd",
      dubbed: !leg,
      portuguese: !leg,
      subtitle: leg,
      headers: rtdHeaders(),
    }));
  }
  return out;
}

async function fetchIndex() {
  const cached = idxCache.get("idx");
  if (cached) return cached;
  const negativo = idxCache.get("idx:erro");
  if (negativo && Date.now() - negativo < 10 * 60 * 1000) throw new Error(negativo);
  let res = null;
  // O erro que vira log e o da PRIMEIRA tentativa (a que explica o problema), nao o da ultima.
  // Medido 30/09/2026: com o alias de TLS quebrado em ultimo, o log dizia `rtd HTTP 525` e
  // escondia o motivo real, que e `403` de geografia no host que responde.
  let erro = "";
  for (const t of tentativas) {
    try {
      const r = await browserFetch(t.url, { timeout: t.timeout });
      if (r && r.status !== 403 && r.status < 500) { res = r; break; }
      if (r && !erro) {
        const corpo = await r.text().catch(() => "");
        erro = r.status === 403
          ? `rtd bloqueado (${/turnstile/i.test(corpo) ? "turnstile" : corpo.slice(0, 40) || r.status})`
          : `rtd HTTP ${r.status}`;
        if (r.status !== 403 && r.status < 500) break;
      }
    } catch (err) {
      if (!erro) erro = `rtd fetch falhou (${err.message})`;
    }
  }
  if (!res) throw new Error(erro || "rtd fetch falhou");
  if (res.status === 403) {
    // 403 com corpo JSON = o item nao esta la (o play-link responde `{"error":...}` sem o
    // Referer); 403 com HTML = bloqueio de verdade (geografia) e tem que aparecer no log.
    const j = await res.json().catch(() => null);
    if (j && typeof j === "object") return [];
    throw new Error(erro || `rtd bloqueado: HTTP ${res.status}`);
  }
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(erro || `rtd HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  const idx = parseCatalogIndex(json);
  if (!idx) {
    idxCache.set("idx:erro", "rtd index invalido");
    throw new Error("rtd index invalido");
  }
  idxCache.set("idx", idx);
  return idx;
}

async function streamsFor(tmdbId, episode, type, season, name, year) {
  const id = Number(tmdbId);
  if (!id || id <= 0) return [];
  const isSeries = type === "series";
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  let idx = null;
  try {
    idx = await fetchIndex();
  } catch (err) {
    idx = null;
  }
  if (idx && !(isSeries ? idx.tv : idx.movie).has(id)) return [];
  const params = new URLSearchParams();
  params.set("contract", String(CONTRACT));
  params.set("tmdbId", String(id));
  params.set("type", isSeries ? "tv" : "movie");
  if (isSeries) {
    params.set("season", String(s));
    params.set("episode", String(e));
  }
  const key = params.toString();
  const cached = cache.get(key);
  if (cached) return parsePlayLink(cached, id, isSeries ? "series" : "movie", s, e, name, year);
  const tentativas = [];
  for (const site of SITES) {
    const alvo = `${site}/api/play-link?${key}`;
    tentativas.push({ url: `${WORKER}/rde/seg?ref=${encodeURIComponent(`${site}/`)}&url=${encodeURIComponent(alvo)}`, timeout: TIMEOUT + 3000 });
    tentativas.push({ url: alvo, timeout: TIMEOUT });
  }
  let res = null;
  let ultimoCorpo = "";
  // O erro que vira log e o da PRIMEIRA tentativa (a que explica o problema), nao o da ultima.
  // Medido 30/09/2026: com o alias em ultimo, o log dizia `rtd HTTP 525` (TLS do alias) e
  // escondia o motivo real, que e `403` de geografia no host que responde.
  let primeiroErro = null;
  for (const t of tentativas) {
    try {
      const r = await browserFetch(t.url, { timeout: t.timeout });
      if (r && r.status !== 403 && r.status < 500) { res = r; break; }
      if (r) {
        if (!primeiroErro) { primeiroErro = r; ultimoCorpo = await r.text().catch(() => ""); }
        if (r.status !== 403 && r.status < 500) break;
      }
    } catch (err) {
      if (!primeiroErro) primeiroErro = { status: 0, statusCode: 0 };
    }
  }
  if (!res && primeiroErro) res = primeiroErro;
  if (!res) throw new Error("rtd fetch falhou");
  if (res.status === 403) {
    throw new Error(`rtd bloqueado (${/turnstile/i.test(ultimoCorpo) ? "turnstile" : ultimoCorpo.slice(0, 40) || res.status})`);
  }
  if (res.status === 403 || res.status === 404) {
    const j = await res.json().catch(() => null);
    if (j && typeof j === "object") return [];
    if (res.status === 404) return [];
    throw new Error(`rtd bloqueado: HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`rtd HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  if (!json) throw new Error("rtd json invalido");
  cache.set(key, json);
  return parsePlayLink(json, id, isSeries ? "series" : "movie", s, e, name, year);
}

module.exports = { streamsFor, parsePlayLink, parseCatalogIndex, SITES, SITE, INDEX_URL };
