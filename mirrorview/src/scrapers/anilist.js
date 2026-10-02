const { browserFetch, makeCache } = require("../lib/scraper-utils");
const API = "https://graphql.anilist.co";
const JIKAN_API = "https://api.jikan.moe/v4";
const cache = makeCache(200, 30 * 60 * 1000);

const QUERY = `query ($id: Int, $search: String, $sort: [MediaSort]) {
  Page(page: 1, perPage: 30) {
    media(id: $id, search: $search, type: ANIME, sort: $sort) {
      id title { romaji english native userPreferred } type episodes season duration
      genres coverImage { large medium }
    }
  }
}`;

function titleOf(media) {
  return media?.title?.userPreferred || media?.title?.english || media?.title?.romaji || media?.title?.native || media?.title?.name || "Anime";
}
function toMeta(media) {
  if (!media) return null;
  const title = titleOf(media);
  const aliases = [media.title?.english, media.title?.romaji, media.title?.native].filter(Boolean).filter(v => v !== title);
  return {
    id: `mirror:${media.id}`, type: "series", name: title, description: aliases.length ? `${title}\n${aliases.join(" • ")}` : title,
    poster: media.coverImage?.large || media.coverImage?.medium || media.images?.jpg?.large_image_url, background: media.bannerImage || media.coverImage?.large,
    genre: media.genres || [], releaseInfo: media.seasonYear ? String(media.seasonYear) : undefined, episodes: media.episodes || 0,
    runtime: media.duration, videos: media.episodes ? [{ id: `mirror:${media.id}:1`, title: "Episódio 1", season: 1, episode: 1 }] : undefined
  };
}
function jikanToMeta(item) {
  if (!item) return null;
  return {
    id: `mirror:${item.mal_id}`,
    type: "series",
    name: item.title,
    description: item.title !== item.title_english ? `${item.title}\n${item.title_english || ""}` : item.title,
    poster: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url,
    background: item.images?.jpg?.large_image_url,
    genre: (item.genres || []).map(g => g.name),
    releaseInfo: item.year ? String(item.year) : undefined,
    episodes: item.episodes || 0,
    runtime: item.duration?.includes("hr") ? 24 : undefined,
    videos: item.episodes ? [{ id: `mirror:${item.mal_id}:1`, title: "Episódio 1", season: 1, episode: 1 }] : undefined
  };
}
async function query(variables) {
  const key = JSON.stringify(variables);
  const cached = cache.get(key);
  if (cached) return cached;
  const response = await browserFetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: QUERY, variables }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`AniList HTTP ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message || "AniList query failed");
  const value = body.data?.Page?.media || [];
  cache.set(key, value);
  return value;
}
async function jikanFetch(path) {
  const url = `${JIKAN_API}${path}`;
  const cached = cache.get(url);
  if (cached) return cached;
  const response = await browserFetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Jikan HTTP ${response.status}`);
  const body = await response.json();
  cache.set(url, body);
  return body;
}
async function searchAnime(search) {
  try {
    return (await query({ search: String(search || "").trim(), sort: ["SEARCH_MATCH"] })).map(toMeta).filter(Boolean);
  } catch (e) {
    console.error(`[anilist] falling back to jikan: ${e.message}`);
    try {
      const body = await jikanFetch(`/anime?q=${encodeURIComponent(search)}&limit=25&sfw=true`);
      return (body.data || []).map(jikanToMeta).filter(Boolean);
    } catch (e2) { console.error(`[jikan] ${e2.message}`); return []; }
  }
}
async function getAnime(id) { const numeric = Number(String(id).replace(/^mirror:/, "").split(":")[0]); return toMeta((await query({ id: numeric }))[0]); }
async function getTitles(id) {
  const numeric = Number(String(id).replace(/^mirror:/, "").split(":")[0]);
  const media = (await query({ id: numeric }))[0];
  if (!media) return null;
  return { id: numeric, title: titleOf(media), titles: [...new Set([titleOf(media), media.title?.english, media.title?.romaji, media.title?.native].filter(Boolean))], episodes: media.episodes || 0 };
}
module.exports = { searchAnime, getAnime, getTitles };
