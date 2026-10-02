const { ENV } = require("../core/nomes");
const { makeHttpStream, vodTitle } = require("../lib/stream");
const { probeVideoInfo } = require("../lib/video-probe");
const { videoResolutionToQuality } = require("../lib/quality");
const { browserFetch } = require("../lib/scraper-utils");

const HOST = ENV.VIZER_HOST || "https://nixplay.lat";
const PATH_SEGMENTS = ENV.VIZER_PATH || "testelogado-vods/GwXanZ3Dj";
const API = "https://vizer.autos/wp-json/api/v1/player";
const SOURCE = "vzr";
const PROBE_HEADERS = { Referer: "" };

function pad(value, size) {
  return String(Number(value) || 0).padStart(size, "0");
}

function buildUrl(tmdbId, type, season, episode) {
  const id = String(tmdbId || "").replace(/\D/g, "");
  if (!id) return null;
  const isMovie = type === "movie";
  const file = isMovie ? `${id}.mp4` : `${id}${pad(season, 3)}${pad(episode, 3)}.mp4`;
  return `${HOST}/${isMovie ? "movie" : "series"}/${PATH_SEGMENTS}/${file}`;
}

// A URL do video vem da API que o PRÓPRIO player deles chama (POST com type/tmdb/season/episode;
// `type` e "movie" para filme e "episode" para episódio — ler os data-* do botão deles, não
// "series"). Guardar só o caminho derivado morreu: em 29/09/2026 os 8 títulos testados davam
// 404 nesse caminho enquanto a API continuava respondendo 200 com o mesmo link. Usar a API
// faz o scraper seguir o caminho atual deles em vez de uma config congelada.
async function resolveUrl(tmdbId, isMovie, season, episode) {
  const params = { type: isMovie ? "movie" : "episode", tmdb: String(tmdbId) };
  if (!isMovie) {
    params.season = String(Number(season) || 1);
    params.episode = String(Number(episode) || 1);
  }
  try {
    const r = await browserFetch(API, {
      method: "POST",
      timeout: 8000,
      maxBody: 300000,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    if (r.status === 400 || r.status === 404) return { url: null, veioDaApi: true };
    const body = await r.text();
    let j = null;
    try { j = JSON.parse(body); } catch (_) {}
    if (j && j.success && j.url) return { url: j.url, veioDaApi: true };
  } catch (_) {}
  return { url: buildUrl(tmdbId, isMovie ? "movie" : "series", season, episode), veioDaApi: false };
}

async function respondeEmTempo(url) {
  const r = await fetch(url, { headers: PROBE_HEADERS, redirect: "follow", signal: AbortSignal.timeout(4000) });
  // NAO cancelar o corpo. MEDIDO em 30/09/2026: `await r.body?.cancel()` logo apos o `fetch`
  // derrubava o processo com `ERR_INVALID_STATE: Controller is already closed` — o undici chama
  // `controller.resume()` para comecar a bombear os dados DEPOIS de o corpo ja ter sido fechado, e
  // essa excecao nasce dentro do undici, ASSINCRONA, fora de qualquer try/catch nosso: matava o
  // processo inteiro. Rodado 3x na fonte VZR: 1 de 3 morria (na reproducao com a URL real). Na
  // producao isso e o addon caindo no meio do play e voltando — parece "a fonte da errado".
  // O socket e solto pelo PROPRIO `AbortSignal.timeout(4000)` abaixo, entao nao faz falta.
  return r.status;
}

async function streamsFor(tmdbId, episode, type, season, title, year) {
  const isMovie = type === "movie";
  const id = String(tmdbId || "").replace(/\D/g, "");
  if (!id) return [];
  const sn = Number(season) || 1;
  const ep = Number(episode) || 1;

  const { url } = await resolveUrl(id, isMovie, sn, ep);
  if (!url) return [];

  let status;
  try {
    status = await respondeEmTempo(url);
  } catch (e) {
    throw new Error(`vizer fora do ar: ${String(e && e.message || e).slice(0, 50)}`);
  }
  // O 404 deixa de ser "esse título não existe" e passa a ser falha da origem: a API acabou de
  // devolver esta URL como disponível. Devolver [] aqui escondia a fonte morta do motor, que
  // seguia chamando gastando o budget de cada pedido.
  if (status >= 400) throw new Error(`vizer nao entrega o arquivo (HTTP ${status})`);

  const info = await probeVideoInfo(url, { headers: PROBE_HEADERS }).catch(() => null);
  if (!info) return [];
  const quality = videoResolutionToQuality(info.width, info.height);
  const stream = makeHttpStream({
      id: `${SOURCE}:${id}:${isMovie ? 0 : ep}`,
      type: isMovie ? "movie" : "series",
      title: vodTitle({
        name: title || "Filme",
        year,
        type: isMovie ? "movie" : "series",
        season: sn,
        episode: ep,
        quality,
        source: SOURCE,
      }),
      url,
      episode: isMovie ? 0 : ep,
      season: sn,
      quality,
      source: SOURCE,
      dubbed: false,
      portuguese: false,
      subtitle: false,
      headers: PROBE_HEADERS,
    });
  stream.audioUnknown = true;
  return [stream];
}

module.exports = { streamsFor, buildUrl, SOURCE };
