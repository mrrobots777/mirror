const { browserFetch, makeCache } = require("../lib/scraper-utils");
const { vodTitle, makeHttpStream } = require("../lib/stream");
const { ascii, words, slugify, decodeEntities, looseCoverage, extraWords } = require("../lib/text");
const { penalidadeQuandoAusenteNaConsulta, penalidadeSempre, bonusTemporada, bonusNumeroFinal, PEN_SHIPPUDEN_PADRAO, PEN_BORUTO, PEN_FINAL_SEASON, PEN_CLASSICO } = require("../lib/match");
const { UA } = require("../lib/ua");

const BASE = "https://www.anitube.biz";
const PAGE_SIZE = 100;
const MIN_SCORE = 5;

const catCache = makeCache(40, 15 * 60 * 1000);
const postsCache = makeCache(60, 15 * 60 * 1000);
const searchCache = makeCache(40, 15 * 60 * 1000);

const REJECT = /\bfilmes?\b|\bmovies?\b|\bcinema\b|\bespeciais?s?\b|\bovas?\b|\boavs?\b|\brecap\b|\bresumos?\b|\btrailers?\b|\bheroines\b|\bamostras?\b|\bcreditos\b|\bextras\b/i;
const CAT_REJECT = /\bfilmes?\b|\bovas?\b|\boavs?\b|\bespeciais?s?\b|\bspecials?\b|\bpt-pt\b|\btrailers?\b|\bextras\b|\bamostras?\b|\bcreditos\b/i;
const CAT_STOP = new Set(["dublado", "dublada", "dublagem", "legendado", "legendada", "legenda", "pt", "br", "hd", "full", "online", "assistir", "assistindo", "hdremastered", "remaster", "remasterizado", "completo", "completa", "todos", "todas", "novo", "nova", "a", "o", "e"]);

function plain(s) {
  return ascii(decodeEntities(s));
}

function stripEpisode(titulo) {
  return decodeEntities(titulo)
    .replace(/\s*[-–—|]\s*Epis[óo]dio\s*\d+.*$/i, "")
    .replace(/\s*\((?:dublado|dublada|legendado|legendada|dublagem)\)/gi, "")
    .replace(/\s*\b(?:dublado|dublada|legendado|legendada|dublagem)\b\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractEpisode(titulo) {
  const m = decodeEntities(titulo).match(/Epis[óo]dio\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function scoreSeries(titulo, query, season) {
  const t = plain(stripEpisode(titulo));
  const q = plain(query).trim();
  if (!t || !q) return -100;
  const cov = looseCoverage(t, q);
  let score = 0;
  if (t.includes(q)) score += 10;
  else if (cov >= 0.99) score += 8;
  else if (cov >= 0.5) score += 4;
  else return -100;
  if (REJECT.test(t)) score -= 25;
  score += penalidadeQuandoAusenteNaConsulta(t, q, [PEN_SHIPPUDEN_PADRAO, PEN_BORUTO, PEN_FINAL_SEASON]);
  score += penalidadeSempre(t, [PEN_CLASSICO]);
  score += bonusTemporada(t, season);
  // aqui o numero final NAO e removido: no ATB o numero do post e sinal de temporada (comportamento original)
  score += bonusNumeroFinal(t, q, season, { removeEpisodio: false });
  return score;
}

function scoreCategory(nome, query) {
  const t = plain(nome);
  const q = plain(query).trim();
  if (!q) return -100;
  const cov = looseCoverage(t, q);
  if (!t.includes(q) && cov < 0.99) return -100;
  if (CAT_REJECT.test(t)) return -100;
  let score = 10;
  score -= 8 * extraWords(t, q, CAT_STOP);
  if (/\bdublad/i.test(t)) score += 5;
  if (/\blegendad/i.test(t)) score -= 2;
  if (/\bfinal season\b|\bthe last season\b|\bboruto\b/i.test(t)) score -= 12;
  return score;
}

function pickVideoUrl(content) {
  const srcs = [...String(content || "").matchAll(/<video[^>]+src\s*=\s*["']([^"']+)["']/gi)].map(m => m[1].replace(/&amp;/g, "&"));
  const out = [];
  for (const src of srcs) {
    const m = src.match(/videohls\.php\?d=([^"'&]+)/i);
    if (m) {
      let real = m[1];
      if (!/^https?:\/\//i.test(real)) {
        try { real = decodeURIComponent(real); } catch (_) { continue; }
      }
      if (/^https?:\/\//i.test(real)) { out.push(real); continue; }
    }
    if (/\.m3u8(\?|$)/i.test(src) && /^https?:\/\//i.test(src)) out.push(src);
  }
  return [...new Set(out)];
}

async function api(url) {
  const res = await browserFetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, timeout: 9000 });
  if (!res.ok) throw new Error(`atb HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

async function fetchCategories(search) {
  const data = await api(`${BASE}/wp-json/wp/v2/categories?search=${encodeURIComponent(search)}&per_page=20&_fields=id,name,count,slug`);
  return Array.isArray(data) ? data.filter(c => c && c.name && c.count > 0) : [];
}

async function searchCategories(query) {
  const key = plain(query).trim();
  if (!key) return [];
  const cached = catCache.get(key);
  if (cached !== null) return cached;
  const terms = [key, ...words(key).filter(w => w.length >= 3).slice(0, 2)];
  const merged = new Map();
  for (const term of [...new Set(terms)]) {
    let list = [];
    try {
      list = await fetchCategories(term);
    } catch (e) {
      if (merged.size) continue;
      throw e;
    }
    for (const c of list) if (!merged.has(c.id)) merged.set(c.id, c);
    const already = [...merged.values()].some(c => scoreCategory(c.name, key) >= 2);
    if (already) break;
  }
  const scored = [...merged.values()]
    .map(c => ({ ...c, score: scoreCategory(c.name, key) }))
    .filter(c => c.score >= 2)
    .sort((a, b) => (b.score - a.score) || (plain(a.name).length - plain(b.name).length) || (b.count - a.count));
  catCache.set(key, scored);
  return scored;
}

async function fetchCategoryPage(catId, page) {
  if (page < 1) return [];
  const key = `${catId}:${page}`;
  const cached = postsCache.get(key);
  if (cached !== null) return cached;
  const data = await api(`${BASE}/wp-json/wp/v2/posts?categories=${catId}&per_page=${PAGE_SIZE}&page=${page}&_fields=id,title,slug,date`);
  const out = Array.isArray(data) ? data.filter(p => p && p.title && p.title.rendered) : [];
  postsCache.set(key, out);
  return out;
}

async function fetchCategoryEpisode(cat, ep, query, season) {
  const base = Math.max(1, Math.ceil((Math.max(cat.count, ep) - ep + 1) / PAGE_SIZE));
  const pages = [...new Set([base, base + 1, base - 1])];
  for (const page of pages) {
    let posts = [];
    try {
      posts = await fetchCategoryPage(cat.id, page);
    } catch (e) {
      if (/\bHTTP 4\d\d\b/.test(e.message)) continue;
      throw e;
    }
    if (!posts.length) continue;
    const post = pickPost(posts, query, ep, season);
    if (post) return post;
  }
  return null;
}

async function searchPosts(query) {
  const key = plain(query).trim();
  if (!key) return [];
  const cached = searchCache.get(key);
  if (cached !== null) return cached;
  const data = await api(`${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(key)}&per_page=20&_fields=id,title,slug,date`);
  const out = Array.isArray(data) ? data.filter(p => p && p.title && p.title.rendered) : [];
  searchCache.set(key, out);
  return out;
}

function pickPost(posts, query, ep, season) {
  let best = null;
  for (const post of posts) {
    const raw = post.title.rendered;
    if (extractEpisode(raw) !== ep) continue;
    const score = scoreSeries(raw, query, season);
    if (score < MIN_SCORE) continue;
    if (!best || score > best.score) best = { post, score };
  }
  return best ? best.post : null;
}

async function comConteudo(post) {
  if (!post || post.content) return post;
  const id = Number(post.id) || 0;
  if (!id) return post;
  try {
    const um = await api(`${BASE}/wp-json/wp/v2/posts/${id}?_fields=id,title,slug,date,content`);
    if (um && um.content) return { ...post, content: um.content };
  } catch (_) {}
  return post;
}

async function buildStream(post, query, ep, season) {
  const cheio = await comConteudo(post);
  const urls = pickVideoUrl(cheio.content && cheio.content.rendered);
  if (!urls.length) throw new Error("atb: post sem video direto");
  const raw = post.title.rendered;
  const nome = stripEpisode(raw) || String(query);
  const dublado = /\bdublad/i.test(decodeEntities(raw));
  return makeHttpStream({
    id: `atb:${post.slug || `${slugify(nome)}-${ep}`}:${ep}`,
    type: "series",
    title: vodTitle({ name: nome, type: "series", season: Number(season) || 1, episode: ep, quality: "unknown", source: "atb" }),
    url: urls[0],
    episode: ep,
    season: Number(season) || 1,
    quality: "unknown",
    source: "atb",
    dubbed: dublado,
    portuguese: dublado,
    subtitle: !dublado,
  });
}

async function streamsFor(query, episode, season) {
  const ep = Number(episode) || 1;
  const seasonNum = Number(season) || 1;

  const cats = await searchCategories(query);
  for (const cat of cats.slice(0, 2)) {
    if (cat.count < ep) continue;
    const post = await fetchCategoryEpisode(cat, ep, query, seasonNum);
    if (post) return [await buildStream(post, query, ep, seasonNum)];
  }

  const post = pickPost(await searchPosts(query), query, ep, seasonNum);
  if (post) return [await buildStream(post, query, ep, seasonNum)];
  return [];
}

module.exports = { streamsFor, scoreSeries, scoreCategory, stripEpisode, extractEpisode, pickVideoUrl };
