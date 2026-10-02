// O MOTOR DO SERVIDOR, sem nenhuma fonte de VOD e sem nenhuma fonte de TV.
//
// DECISAO 154 (02/10/2026) — o dono: *"Nuvio e o unico cliente e os players passam a vir
// exclusivamente do plugin"*. As 10 fontes de VOD/anime (`shg ron aon atb blz kkt spt vzr dgo rtd`)
// sairam do servidor: elas existem agora so em `nuvio/src/scrapers/`. Este arquivo deixou de ser o
// registro delas e virou o que o nome ja dizia que era — o motor.
//
// DECISAO 155 (02/10/2026) — o dono: *"nada no servidor senao catalogo, todas as fontes sao via
// plugin"*. As 4 fontes de TV (`rei emb etc rcd`) sairam pelo mesmo caminho: o player delas vive
// em `nuvio/src/scrapers/`, no aparelho. O que o REI continua entregando ao servidor e' METADADO
// (canais, logo) e GUIA — e isso esta em `core/tv-sources.js`, que nunca passou por este motor.
//
// O QUE SAIU E POR QUE (medido, ver AGENTS.md e o relatorio das decisoes 154/155):
//   * as 10 chamadas a `engine.use()` (decisao 154) — cada uma carregava o scraper no boot e, no
//     pedido, painel de Streaming, base do KAK e catalogo em disco por 10 fontes que o Nuvio nem
//     consulta; e com elas o registro inteiro das 4 fontes de TV (decisao 155);
//   * os `require` dos 10 scrapers — `otakulogia/animesdigital/aon/anitube/xtream/kakito/
//     playerflix/vizer/doramogo/redetoons`. Os ARQUIVOS continuam em `src/scrapers/` (outros
//     modulos e os testes os referenciam); so o registro deixa de carrega-los. JA NAO E ASSIM
//     PARA AS 4 DE TV: `embedtv`, `embedcanais` e `reidoscanais` foram APAGADOS, porque o
//     servidor nao tinha mais uso nenhum de metadado delas — e o REI foi enxuto ao que e'
//     catalogo, logo e guia;
//   * `warmup()`/`scheduleWarmup()` — o unico trabalho delas era `kakito.preloadPlaylist()` e
//     `xtream.preloadLists()`, que pre-carregavam base e catalogo de painel. Sem fonte que os use,
//     o unico efeito era RAM e disco no boot, de graca para ninguem.
//
// O QUE CONTINUA: o motor existe (o `/health` reporta `capacity.scraperEngine`, o disjuntor e a
// trava de pedido continuam valendo) e `buildContext` continua exportado — e' o contrato de `run`,
// e quem registrar uma fonte de novo usa o mesmo formato.
const { createEngine } = require("../lib/scraper-engine");
const { ENV } = require("./nomes");

const CONCURRENCY = Number(ENV.SCRAPER_CONCURRENCY) > 0 ? Number(ENV.SCRAPER_CONCURRENCY) : 20;

const engine = createEngine({ concurrency: CONCURRENCY });

function variantesDeTitulo(input) {
  const lista = [];
  const push = (v) => {
    const t = String(v || "").trim();
    if (t && !lista.includes(t)) lista.push(t);
  };
  push(input.title);
  push(input.originalTitle);
  for (const t of input.altTitles || []) push(t);
  return lista;
}

function buildContext(input) {
  const type = input.type === "movie" ? "movie" : "series";
  const titles = variantesDeTitulo(input);
  return {
    titles,
    originalTitle: input.originalTitle || "",
    kind: input.anime ? "anime" : "vod",
    type,
    title: input.title,
    episode: Number(input.episode) > 0 ? Number(input.episode) : 1,
    season: type === "movie" ? 0 : (Number(input.season) > 0 ? Number(input.season) : 1),
    year: input.year || undefined,
    runtime: input.runtime || undefined,
    tmdbId: Number(input.tmdbId) > 0 ? Number(input.tmdbId) : 0,
    origin: input.origin || [],
    key: input.key || "",
  };
}

// A DUVIDA QUE VALE RESPONDER: existe fonte neste motor?
//
// Chamada no caminho de stream de filme/serie ANTES de resolver metadado, AniList ou TMDB. Sem
// fonte, `engine.start()` devolveria lista vazia e o pedido terminaria em `{streams: []}` — mas so
// DEPOIS de um punhado de trabalho que so servia para alimentar fontes que nao existem mais
// (busca no AniList, catalogo do painel, sonda de qualidade). A resposta agora e a mesma, na hora.
function temFonteDeVod() {
  return engine.size > 0;
}

// O MESMO PARA TV, e a MESMA RESPOSTA. O caminho `tv:live:` morou no servidor como caminho VIVO
// ate a decisao 155; agora ele responde pela MESMA atalho, o que mantem as tres rotas de stream
// (`/stream/*`, `/api/streams/*`, `/nuvio/stream/*`) com o mesmo formato e o mesmo cache — sem
// metadado, sem AniList e sem sonda. Ver `handleStreamsCore` no `server.js`.

module.exports = { engine, buildContext, temFonteDeVod, CONCURRENCY };