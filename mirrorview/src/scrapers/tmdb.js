const { ENV } = require("../core/nomes");
const { browserFetch, makeCache } = require("../lib/scraper-utils");

const cache = makeCache(80, 30 * 60 * 1000);
// Separado do cache de detalhe: busca tem vida curta (titulo novo entra em catalogo rapido) e
// não pode ser ejetada pelas consultas de detalhe, que sao bem mais frequentes.
const cacheBusca = makeCache(150, 10 * 60 * 1000);
const TMDB_KEY = ENV.TMDB_API_KEY || "5fcddff5c20144ce3c8e376968a8807d";
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

function tmdbFetch(path, params = {}) {
  if (!TMDB_KEY) return null;
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", TMDB_KEY);
  url.searchParams.set("language", "pt-BR");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return browserFetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
}

async function getMovieDetail(tmdbId) {
  if (!tmdbId || !TMDB_KEY) return null;
  const key = `tmdb-movie:${tmdbId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const res = await tmdbFetch(`/movie/${tmdbId}`, { append_to_response: "external_ids,videos" });
    if (!res) return null;
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`tmdb HTTP ${res.status}`);
    const d = await res.json();
    const imdbId = d.external_ids?.imdb_id || "";
    const result = {
      id: `tmdb:${tmdbId}`,
      type: "movie",
      title: d.title || "",
      originalTitle: d.original_title || "",
      year: (d.release_date || "").substring(0, 4),
      overview: d.overview || "",
      poster: d.poster_path ? `${IMG_BASE}/w500${d.poster_path}` : "",
      backdrop: d.backdrop_path ? `${IMG_BASE}/w1280${d.backdrop_path}` : "",
      runtime: d.runtime || 0,
      genres: (d.genres || []).map(g => g.name),
      tmdbId,
      imdbId,
      voteAverage: d.vote_average || 0,
    };
    cache.set(key, result);
    return result;
  } catch (e) {
    console.error(`[tmdb] getMovieDetail: ${e.message}`);
    throw e;
  }
}

async function getTvDetail(tmdbId) {
  if (!tmdbId || !TMDB_KEY) return null;
  const key = `tmdb-tv:${tmdbId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const res = await tmdbFetch(`/tv/${tmdbId}`, { append_to_response: "external_ids" });
    if (!res) return null;
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`tmdb HTTP ${res.status}`);
    const d = await res.json();
    const imdbId = d.external_ids?.imdb_id || "";
    const result = {
      id: `tmdb:${tmdbId}`,
      type: "series",
      title: d.name || "",
      originalTitle: d.original_name || "",
      year: (d.first_air_date || "").substring(0, 4),
      overview: d.overview || "",
      poster: d.poster_path ? `${IMG_BASE}/w500${d.poster_path}` : "",
      backdrop: d.backdrop_path ? `${IMG_BASE}/w1280${d.backdrop_path}` : "",
      seasons: (d.seasons || []).filter(s => s.season_number > 0).map(s => ({
        number: s.season_number,
        name: s.name || `Season ${s.season_number}`,
        episodeCount: s.episode_count || 0,
        poster: s.poster_path ? `${IMG_BASE}/w300${s.poster_path}` : "",
      })),
      genres: (d.genres || []).map(g => g.name),
      genreIds: (d.genres || []).map(g => Number(g.id)).filter(Number.isFinite),
      originCountry: (d.origin_country || []).filter(Boolean),
      tmdbId,
      imdbId,
      voteAverage: d.vote_average || 0,
      totalSeasons: d.number_of_seasons || 0,
      totalEpisodes: d.number_of_episodes || 0,
    };
    cache.set(key, result);
    return result;
  } catch (e) {
    console.error(`[tmdb] getTvDetail: ${e.message}`);
    throw e;
  }
}

async function getTvSeason(tmdbId, seasonNumber) {
  if (!tmdbId || !TMDB_KEY) return null;
  const key = `tmdb-season:${tmdbId}:${seasonNumber}`;
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const res = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`);
    if (!res) return null;
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`tmdb HTTP ${res.status}`);
    const d = await res.json();
    const result = {
      seasonNumber: d.season_number || seasonNumber,
      name: d.name || `Season ${seasonNumber}`,
      episodes: (d.episodes || []).map(ep => ({
        number: ep.episode_number,
        title: ep.name || `Episode ${ep.episode_number}`,
        overview: ep.overview || "",
        still: ep.still_path ? `${IMG_BASE}/w300${ep.still_path}` : "",
        airDate: ep.air_date || "",
      })),
    };
    cache.set(key, result);
    return result;
  } catch (e) {
    console.error(`[tmdb] getTvSeason: ${e.message}`);
    throw e;
  }
}

async function resolveByImdb(imdbId, preferredType) {
  if (!imdbId) return null;
  const key = `tmdb-imdb:${imdbId}:${preferredType || "any"}`;
  const hit = cache.get(key);
  if (hit) return hit;

  if (TMDB_KEY) {
    try {
      const res = await tmdbFetch(`/find/${imdbId}`, { external_source: "imdb_id" });
      if (res && res.ok) {
        const data = await res.json();
        const movie = data.movie_results?.[0];
        const tv = data.tv_results?.[0];
        const pick = preferredType === "series" ? tv : (preferredType === "movie" ? movie : (movie || tv));
        if (pick) {
          const isMovie = pick === movie;
          const result = { id: `tmdb:${pick.id}`, type: isMovie ? "movie" : "series", tmdbId: pick.id, title: (isMovie ? pick.title : pick.name) || "", originalTitle: (isMovie ? pick.original_title : pick.original_name) || "", poster: pick.poster_path ? `${IMG_BASE}/w500${pick.poster_path}` : "" };
          cache.set(key, result);
          return result;
        }
      } else if (res && res.status !== 404) {
        console.error(`[tmdb] find HTTP ${res.status}`);
      }
    } catch (e) {
      console.error(`[tmdb] find: ${e.message}`);
    }
  }

  return null;
}

async function genresFor(caminho, rotulo) {
  const key = `tmdb-genres:${caminho}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await tmdbFetch(caminho);
  if (!res) return [];
  if (!res.ok) throw new Error(`tmdb HTTP ${res.status}`);
  const j = await res.json();
  const out = (j.genres || []).map((g) => ({ id: String(g.id), type: rotulo, name: g.name }));
  cache.set(key, out);
  return out;
}

// Busca da API publica. `type` opcional: movie | series | (vazio = as duas, via /search/multi).
// Falha de rede LANCA (regra do projeto) — o chamador decide o que responder; resultado vazio
// e retorno legitimo (titulo que nao existe), nao erro.
async function search(query, type, page) {
  const q = String(query || "").trim();
  if (!q || !TMDB_KEY) return [];
  const modo = type === "movie" ? "movie" : type === "series" ? "tv" : "multi";
  const key = `tmdb-search:${modo}:${q}:${page || 1}`;
  const hit = cacheBusca.get(key);
  if (hit) return hit;

  const res = await tmdbFetch(`/search/${modo}`, { query: q, page: page || 1, include_adult: "false" });
  if (!res) return [];
  if (!res.ok) throw new Error(`tmdb HTTP ${res.status}`);
  const j = await res.json();
  const out = (j.results || [])
    .filter((r) => (modo === "multi" ? r.media_type === "movie" || r.media_type === "tv" : true))
    .map((r) => {
      const tipo = modo === "movie" ? "movie" : modo === "tv" ? "series" : r.media_type === "movie" ? "movie" : "series";
      const data = tipo === "movie" ? r.release_date : r.first_air_date;
      return {
        id: `tmdb:${r.id}`,
        type: tipo,
        title: r.title || r.name || "",
        year: String(data || "").substring(0, 4),
        overview: r.overview || "",
        poster: r.poster_path ? `${IMG_BASE}/w500${r.poster_path}` : "",
        backdrop: r.backdrop_path ? `${IMG_BASE}/w1280${r.backdrop_path}` : "",
        voteAverage: r.vote_average || 0,
      };
    })
    .filter((r) => r.title);
  cacheBusca.set(key, out);
  return out;
}

async function genres() {
  const [filmes, series] = await Promise.all([
    genresFor("/genre/movie/list", "movie"),
    genresFor("/genre/tv/list", "series"),
  ]);
  return { movie: filmes, series };
}

module.exports = { getMovieDetail, getTvDetail, getTvSeason, resolveByImdb, search, genres };
