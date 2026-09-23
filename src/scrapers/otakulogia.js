const { browserFetch, makeCache } = require("../lib/scraper-utils");
const { vodTitle } = require("../lib/stream");
const { melhorCorrespondencia } = require("../lib/portao-correspondencia");
const cache = makeCache(150, 30 * 60 * 1000);
const API = "https://api.otakulogia.com/graphql";

async function gql(query, variables = {}) {
  const response = await browserFetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`Otakulogia HTTP ${response.status}`);
  const body = await response.json();
  if (body.errors) throw new Error(`Otakulogia GraphQL: ${body.errors[0]?.message}`);
  return body.data;
}

async function searchAnime(query) {
  if (!query) return [];
  const key = `otaku-search:${query}`;
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const data = await gql(`query($input: SearchAnimesInput!) { searchAnimes(input: $input) { total items { name slug posterUrl upstreamCid } } }`, { input: { query } });
    const items = data?.searchAnimes?.items || [];
    cache.set(key, items);
    return items;
  } catch (e) {
    console.error(`[otakulogia] searchAnime error: ${e.message}`);
    throw e;
  }
}

async function getAnimeDetail(slug, upstreamCid) {
  const key = `otaku-detail:${slug || upstreamCid}`;
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    let cid = upstreamCid;
    if (!cid) {
      if (!slug) return null;
      const searchItems = await searchAnime(slug);
      // PORTAO DE CORRESPONDENCIA (decisao 135): sem casamento exato, o codigo aceitava o
      // PRIMEIRO resultado da busca e devolvia o episodio 1 daquele anime. MEDIDO 01/10/2026 em
      // producao: "Matrix" (tmdb:603) respondeu com `futari-wa-precure` e "Batman: O Cavaleiro
      // das Trevas" (tmdb:155) respondeu com "Boruto" — a pessoa pede Matrix e da de cara com
      // anime. Sem correspondencia, aqui nao ha anime: `null` e a resposta certa.
      const match = melhorCorrespondencia(slug, searchItems);
      if (!match) return null;
      cid = match.upstreamCid;
    }

    const data = await gql(`query($cid: Int!) { animeCatalogDetail(upstreamCid: $cid) { anime { name slug posterUrl synopsis } episodes { id title episodeNumber videoUrl videoUrlFhd videoUrlSd audioType thumbnailLarge } } }`, { cid });
    const detail = data?.animeCatalogDetail;
    if (!detail) return null;

    const result = {
      name: detail.anime?.name || slug,
      slug: detail.anime?.slug || slug,
      posterUrl: detail.anime?.posterUrl || "",
      synopsis: detail.anime?.synopsis || "",
      episodes: (detail.episodes || []).map(ep => {
        const titleMatch = (ep.title || "").match(/T(\d+)\s+EP\.\s*(\d+)/);
        const season = titleMatch ? parseInt(titleMatch[1]) : ep.episodeNumber;
        const number = titleMatch ? parseInt(titleMatch[2]) : 1;
        return {
          id: ep.id,
          title: ep.title,
          season,
          number,
          videoUrl: ep.videoUrlFhd || ep.videoUrl || ep.videoUrlSd,
          audioType: ep.audioType,
          thumbnail: ep.thumbnailLarge
        };
      })
    };
    cache.set(key, result);
    return result;
  } catch (e) {
    console.error(`[otakulogia] getAnimeDetail error: ${e.message}`);
    throw e;
  }
}

async function streamsFor(query, episode, season) {
  if (!query) return [];
  const key = `otaku-streams:${query}:${episode || "all"}`;
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const searchItems = await searchAnime(query);
    if (!searchItems.length) { cache.set(key, []); return []; }

    // MESMO PORTAO (decisao 135). O motor chama as fontes com VARIANTES de titulo, entao quase
    // toda variante chega aqui sem casamento exato — e era justamente por isso que o primeiro
    // resultado (qualquer um) virava resposta.
    const bestMatch = melhorCorrespondencia(query, searchItems);
    if (!bestMatch) return [];
    const detail = await getAnimeDetail(bestMatch.slug, bestMatch.upstreamCid);
    if (!detail) return [];
    // E o detalhe tem que ser do mesmo item: um slug que casou no nome mas aponta para outro
    // anime continua sendo conteudo errado.
    if (!melhorCorrespondencia(query, [{ slug: bestMatch.slug, name: detail.name }])) return [];

    const ep = episode || 1;
    const sn = Number(season) > 0 ? Number(season) : 1;
    const epData = detail.episodes.find(e => e.season === sn && e.number === ep)
      || (sn === 1 ? detail.episodes.find(e => e.number === ep) : null);
    if (!epData || !epData.videoUrl) { cache.set(key, [], 60 * 1000); return []; }

    const audioType = (epData.audioType || "").toLowerCase();
    const isDubbed = audioType.includes("dub") || audioType.includes("dublado");
    const isSubbed = audioType.includes("leg") || audioType.includes("legendado") || audioType.includes("sub");

    const stream = {
      id: `otakulogia:${bestMatch.slug}:${sn}x${ep}`,
      type: "series",
      name: "Mirror 1080p",
      title: vodTitle({ name: detail.name, type: "series", season: sn, episode: ep, quality: "1080p", source: "shg" }),
      url: epData.videoUrl,
      infoHash: null,
      seeders: 0,
      dubbed: isDubbed,
      portuguese: isDubbed || isSubbed,
      japanese: !isDubbed,
      subtitle: true,
      quality: "1080p",
      size: 0,
      sources: ["shg"],
      trackers: [],
      season: sn,
      episode: ep,
      poster: detail.posterUrl,
      fileName: `${detail.name} - Ep ${ep}.mp4`
    };

    cache.set(key, [stream]);
    return [stream];
  } catch (e) {
    console.error(`[otakulogia] streamsFor error: ${e.message}`);
    throw e;
  }
}

module.exports = { streamsFor };
