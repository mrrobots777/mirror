const { browserFetch, makeCache } = require('../lib/scraper-utils');
const { vodTitle, makeHttpStream } = require('../lib/stream');
const { normalizeQuality } = require('../lib/quality');
const { UA } = require('../lib/ua');
const { slugify, decodeEntities } = require('../lib/text');

const BASE = 'https://animesonline.io';
const TOKEN_REFERER = 'https://anidrive.click/';
const FETCH_TIMEOUT = 7000;

const STOP_WORDS = new Set(['dublado', 'dublada', 'legendado', 'legendada', 'legenda', 'leg', 'com', 'audio', 'dual', 'pt', 'br', 'online', 'assistir', 'episodio', 'episodios', 'temporada', 'temporadas', 'todos', 'completo', 'completa', 'ova', 'filmes', 'filme', 'serie', 'series', 'animes', 'anime']);

const indexCache = makeCache(1, 30 * 60 * 1000);
const pageCache = makeCache(40, 10 * 60 * 1000);
const missCache = makeCache(80, 30 * 60 * 1000);
let indexFlight = null;

function normWords(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function parseSeriesIndex(html) {
  const out = [];
  const re = /<a class="series tip"[^>]*href="(https:\/\/animesonline\.io\/anime\/[^"]+\/)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const titulo = decodeEntities(m[2]);
    if (titulo) out.push({ titulo, url: m[1] });
  }
  return out;
}

function scoreSerie(query, titulo) {
  const q = normWords(query);
  const t = normWords(titulo);
  if (!q.length || !t.length) return 0;
  if (q.join(' ') === t.join(' ')) return 100;
  const qSet = new Set(q);
  if (!q.every(w => t.includes(w))) return 0;
  const extra = t.filter(w => !qSet.has(w) && !STOP_WORDS.has(w) && !/^\d{2,4}$/.test(w));
  return Math.max(0, 80 - extra.length * 40);
}

function pickSeries(query, itens) {
  const scored = [];
  for (const it of itens) {
    const raw = scoreSerie(query, it.titulo);
    if (raw < 50) continue;
    const dub = /dublad/i.test(it.titulo) ? 25 : 0;
    scored.push({ ...it, raw, score: raw + dub });
  }
  scored.sort((a, b) => b.score - a.score || a.titulo.length - b.titulo.length);
  return scored.slice(0, 3);
}

function parseEpisodes(html) {
  const map = new Map();
  const re = /<li[^>]*data-index[^>]*>\s*<a\s+href=["']([^"']+)["'][^>]*>\s*<div class=["']epl-num["']>\s*(\d+)\s*<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const ep = Number(m[2]);
    if (ep > 0 && !map.has(ep)) map.set(ep, m[1]);
  }
  return map;
}

function extractTokenUrl(html) {
  const m = /<iframe[^>]+src=["'](https:\/\/anidrive\.click\/token\/[^"']+)["']/i.exec(html);
  return m ? m[1] : null;
}

function decodeCall(arrJson, idxJson, key) {
  let arr, idx;
  try {
    arr = JSON.parse(arrJson);
    idx = JSON.parse(idxJson);
  } catch (_) {
    return null;
  }
  if (!Array.isArray(arr) || !Array.isArray(idx)) return null;
  const joined = idx.map(i => arr[i]).join('');
  if (!joined) return null;
  let data, keyBuf;
  try {
    data = Buffer.from(joined, 'base64');
    keyBuf = Buffer.from(key, 'base64');
  } catch (_) {
    return null;
  }
  if (!data.length || !keyBuf.length) return null;
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ keyBuf[i % keyBuf.length];
  return out.toString('utf8');
}

function extractConfigJson(src) {
  const marker = src.search(/window\.AniDrivePlayerConfig\s*=\s*\{/);
  if (marker < 0) return null;
  const start = src.indexOf('{', marker);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(src.slice(start, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

function decodePlayerConfig(html) {
  const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  const callRe = /\w+\((\[[^\[\]]*\])\s*,\s*(\[[^\[\]]*\])\s*,\s*["']([A-Za-z0-9+/=]+)["']\)/g;
  for (const b of blocks) {
    const code = b[2];
    if (!code || code.length < 200) continue;
    const direto = extractConfigJson(code);
    if (direto) return direto;
    let m;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(code))) {
      const decoded = decodeCall(m[1], m[2], m[3]);
      if (!decoded) continue;
      const cfg = extractConfigJson(decoded);
      if (cfg) return cfg;
    }
  }
  return null;
}

function chooseSource(cfg) {
  const sources = (cfg && Array.isArray(cfg.sources) ? cfg.sources : []).filter(s => s && s.file && /mp4/i.test(s.type || s.file));
  if (!sources.length) return null;
  const scored = sources.map(s => {
    const label = String(s.label || '');
    const h = Number((label.match(/(\d{3,4})/) || [])[1] || 0);
    return { url: s.file, quality: normalizeQuality(label) || (h ? normalizeQuality(`${h}p`) : 'unknown'), h };
  });
  scored.sort((a, b) => b.h - a.h);
  return scored[0];
}

async function loadIndex() {
  const cached = indexCache.get('index');
  if (cached) return cached;
  if (indexFlight) return indexFlight;
  indexFlight = (async () => {
    try {
      const res = await browserFetch(`${BASE}/anime/list-mode/`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (!res.ok) throw new Error(`aon index HTTP ${res.status}`);
      const itens = parseSeriesIndex(await res.text());
      if (!itens.length) throw new Error('aon index vazio');
      indexCache.set('index', itens);
      return itens;
    } finally {
      indexFlight = null;
    }
  })();
  return indexFlight;
}

async function resolveCandidates(query) {
  let itens = [];
  let indexErr = null;
  try {
    itens = await loadIndex();
  } catch (e) {
    indexErr = e;
  }
  const found = itens.length ? pickSeries(query, itens) : [];
  if (found.length) return found;
  const slug = slugify(query);
  if (slug) {
    return [
      { titulo: query, url: `${BASE}/anime/${slug}-dublado/` },
      { titulo: query, url: `${BASE}/anime/${slug}/` },
    ];
  }
  if (indexErr) throw indexErr;
  return [];
}

async function fetchText(url, opts = {}, label = 'aon') {
  const res = await browserFetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT), ...opts });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return res.text();
}

async function fetchCachedText(url, opts = {}, label = 'aon') {
  const cached = pageCache.get(url);
  if (cached !== null) return cached;
  if (missCache.get(url)) throw new Error(`${label} HTTP 404`);
  let html;
  try {
    html = await fetchText(url, opts, label);
  } catch (e) {
    if (/\b(?:404|410)\b/.test(e.message)) missCache.set(url, 'miss', 30 * 60 * 1000);
    throw e;
  }
  if (html) pageCache.set(url, html);
  return html;
}

async function streamsFor(query, episode, season) {
  const ep = Number(episode) || 1;
  const seasonNum = Number(season) || 1;
  const candidates = await resolveCandidates(query);
  if (!candidates.length) return [];

  for (const cand of candidates) {
    let animeHtml;
    try {
      animeHtml = await fetchCachedText(cand.url, {}, 'aon anime');
    } catch (e) {
      if (/\b(?:404|410)\b/.test(e.message)) continue;
      throw e;
    }
    const mapa = parseEpisodes(animeHtml);
    const epUrl = mapa.get(ep);
    if (!epUrl) continue;
    const epHtml = await fetchCachedText(epUrl, {}, 'aon ep');
    const tokenUrl = extractTokenUrl(epHtml);
    if (!tokenUrl) throw new Error('aon: pagina sem player anidrive');
    const tokenHtml = await fetchText(tokenUrl, { headers: { 'User-Agent': UA, Referer: TOKEN_REFERER } }, 'aon token');
    const cfg = decodePlayerConfig(tokenHtml);
    if (!cfg) throw new Error('aon: config do player ilegivel');
    const fonte = chooseSource(cfg);
    if (!fonte) throw new Error('aon: fonte de video ausente');

    const slug = cand.url.split('/').filter(Boolean).pop() || slugify(cand.titulo);
    const dublado = /dublad/i.test(`${cand.titulo} ${slug}`);
    const qualidade = fonte.quality;
    return [
      makeHttpStream({
        id: `aon:${slug}:${ep}`,
        type: 'series',
        title: vodTitle({ name: cand.titulo, type: 'series', season: seasonNum, episode: ep, quality: qualidade, source: 'aon' }),
        url: fonte.url,
        episode: ep,
        season: seasonNum,
        quality: qualidade,
        source: 'aon',
        dubbed: dublado,
        portuguese: dublado,
        subtitle: !dublado,
        headers: { 'User-Agent': UA },
      }),
    ];
  }
  return [];
}

module.exports = {
  streamsFor,
  parseSeriesIndex,
  parseEpisodes,
  scoreSerie,
  pickSeries,
  extractTokenUrl,
  decodePlayerConfig,
  chooseSource,
  slugify,
};
