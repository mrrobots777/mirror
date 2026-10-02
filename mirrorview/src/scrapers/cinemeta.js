const { makeCache } = require("../lib/scraper-utils");
const cache = makeCache(40, 10 * 60 * 1000);
const missCache = makeCache(100, 60 * 1000);

async function resolveExternal(id) {
  const key = String(id || "");
  if (!key) return null;
  if (missCache.get(key)) return null;
  const cached = cache.get(key);
  if (cached) return cached;
  if (/[^a-zA-Z0-9\-]/.test(key.replace(/[:_ ]/g, "")) && !/^\d+$/.test(key)) { return null; }

  const probe = async (type) => {
    const res = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(key)}.json`, { signal: AbortSignal.timeout(6000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`cinemeta HTTP ${res.status}`);
    const body = await res.json();
    const meta = body.meta;
    if (!meta) return null;
    const y = String(meta.releaseInfo || "").match(/\b(?:19|20)\d{2}\b/);
    if (y) meta.year = y[0];
    return { id: key, title: meta.name || meta.title || "", titles: [...new Set([meta.name, meta.title, ...(meta.aliases || [])].filter(Boolean))], videos: type === "series" ? meta.videos || [] : [], type, year: meta.year };
  };

  const [series, movie] = await Promise.all([probe("series"), probe("movie")]);
  const value = series || movie;
  if (value && value.title) {
    cache.set(key, value);
    return value;
  }
  missCache.set(key, true);
  return null;
}

async function getMeta(id) {
  const key = String(id || "");
  if (!key) return null;
  for (const type of ["series", "movie"]) {
    try {
      const res = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(key)}.json`, { signal: AbortSignal.timeout(6000) });
      if (res.status === 404) return null;
      if (!res.ok) {
        console.error(`[cinemeta] getMeta HTTP ${res.status}`);
        continue;
      }
      const body = await res.json();
      if (body && body.meta && (body.meta.name || body.meta.title)) return body.meta;
    } catch (e) { console.error(`[cinemeta] getMeta: ${e.message}`); }
  }
  return null;
}

module.exports = { resolveExternal, getMeta };
