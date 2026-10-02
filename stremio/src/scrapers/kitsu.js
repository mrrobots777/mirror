const { browserFetch, makeCache } = require("../lib/scraper-utils");

const cache = makeCache(200, 60 * 60 * 1000);

async function getKitsu(id, type) {
  const match = String(id || "").match(/^kitsu[:.]?(\d+)$/i);
  if (!match) return null;
  const kitsuId = match[1];
  const cached = cache.get(kitsuId);
  if (cached) return cached;
  try {
    const res = await browserFetch(`https://kitsu.io/api/edge/anime/${kitsuId}`, {
      timeout: 8000,
      headers: { Accept: "application/vnd.api+json, application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`kitsu HTTP ${res.status}`);
    const body = await res.json();
    const attrs = body && body.data && body.data.attributes;
    if (!attrs) return null;
    const titles = attrs.titles || {};
    const info = {
      id: `kitsu:${kitsuId}`,
      title: attrs.canonicalTitle || titles.en_jp || titles.en || titles.ja_jp,
      titles: [...new Set([attrs.canonicalTitle, titles.en_jp, titles.en, titles.en_us, titles.ja_jp].filter(Boolean))],
      episodes: Number(attrs.episodeCount) || 0,
      type: attrs.subtype === "Movie" || type === "movie" ? "movie" : "series",
      poster: (attrs.posterImage && (attrs.posterImage.original || attrs.posterImage.large || attrs.posterImage.small)) || "",
      background: (attrs.coverImage && (attrs.coverImage.original || attrs.coverImage.large)) || "",
      description: attrs.synopsis || "",
      year: String(attrs.startDate || "").substring(0, 4),
    };
    if (!info.title) return null;
    cache.set(kitsuId, info);
    return info;
  } catch (e) {
    console.error(`[kitsu] ${e.message}`);
    throw e;
  }
}

module.exports = { getKitsu };
