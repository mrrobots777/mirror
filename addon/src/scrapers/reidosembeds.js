// REI — reidosembeds.online. NO SERVIDOR, SO METADADO (decisao 155).
//
// O REI e o DONO DO CATALOGO DE TV (decisao 126 confirmada na 138: "o catalogo e apenas do
// REI dos embeds") e a FONTE DE METADADO, LOGO e GUIA (decisao 121). E' o que o servidor
// continua usando, e e' tudo que ele precisa.
//
// DECISAO 155 (02/10/2026) — o dono: *"nada no servidor senao catalogo, todas as fontes sao via
// plugin"*. O player do REI saiu do servidor: a cadeia de 4 saltos (`v2.rdembed.sbs` -> `/__play/`
// -> iframe -> POST `ref`) que entregava o `src`, o `resolvePlaylist` do relay e o `getStreams`
// que montava a lista. Tudo isso vive agora em `nuvio/src/scrapers/reidosembeds.js`, rodando no
// aparelho, do IP residencial de quem assiste.
//
// O QUE FICOU E POR QUE:
//   * `loadCatalog()` — o `GET /api/channels` (327 canais, 256KB, logo em 100% deles, medido).
//     E' o catalogo, e a fonte do logo (`logo_url`) que o `/health` conta.
//   * `getCatalog()` / `getMeta()` — a meta no formato Stremio.
//   * `genreFor()` — o genero cru, que `core/tv-sources.js` joga dentro dos baldes (decisao 126).
//
// O QUE SAIU: `resolveSrc`, `resolvePlaylist`, `getStreams`, `temSegmentos`, `montaSrc`,
// `pegaEmbed`, `pegaIframe`, `refDaPagina`, o `cacheUrl`/`cacheOk` e o `REPREQ_MS`.
//
// O `preview_url` dos 327 canais continua SENDO MORTO (medido 01/10/2026: host `xn---...rent`
// responde 403 em todos, e `reidosembeds.online/img/<id>.prev.png` devolve 404). Por isso
// `makeMeta` nunca usa ele como `background` — o fundo do canal e o proprio logo.
const { ENV } = require("../core/nomes");
const { browserFetch, makeCache } = require("../lib/scraper-utils");
const { lower } = require("../lib/text");

const SOURCE = "rei";
const API = ENV.REI_API || "https://reidosembeds.online/api/channels";
const UA_HEADERS = { Accept: "application/json, text/plain, */*" };
const TTL_CAT_MS = Number(ENV.REI_CAT_TTL_MS || 30 * 60 * 1000);

const cacheCatalogo = makeCache(400, TTL_CAT_MS);
const voando = new Map();

function idDe(slug) {
  const raw = String(slug || "").replace(/^tv:live:/, "");
  return raw.startsWith(`${SOURCE}:`) ? raw.slice(SOURCE.length + 1) : raw;
}

function texto(ch) {
  return [ch.name, ch.category, ch.description].filter(Boolean);
}

// O `GET /api/channels` com trava de pedido em voo (varias rotas de catalogo batem aqui no mesmo
// boot, e sem isto saiam N leituras de 256KB da mesma origem).
async function loadCatalog() {
  const chave = "catalogo";
  const tem = cacheCatalogo.get(chave);
  if (tem) return tem;
  if (voando.has(chave)) return voando.get(chave);
  const p = (async () => {
    try {
      const r = await browserFetch(API, { headers: UA_HEADERS, timeout: 30000, maxBody: 4 * 1024 * 1024 });
      if (!r || !r.ok) throw new Error(`reidosembeds HTTP ${r ? r.status : 0}`);
      const j = JSON.parse(await r.text());
      const lista = (j && (j.data || j.channels)) || [];
      if (!Array.isArray(lista) || !lista.length) throw new Error("reidosembeds catalogo vazio");
      const canais = lista.filter((c) => c && c.id && c.is_active !== false);
      cacheCatalogo.set(chave, canais);
      return canais;
    } finally {
      voando.delete(chave);
    }
  })();
  voando.set(chave, p);
  return p;
}

function genreFor(ch) {
  return ch.category || "Geral";
}

function makeMeta(ch) {
  const logo = ch.logo_url || "";
  const agora = ch.now_playing_title || "";
  const linhas = [
    `📡 ${genreFor(ch)} • Ao Vivo`,
    agora ? `🔴 No ar: ${agora}` : `🔴 ${ch.name}`,
  ];
  return {
    id: `tv:live:${SOURCE}:${ch.id}`,
    type: "tv",
    name: ch.name,
    description: linhas.join("\n"),
    poster: logo,
    // A PREVIA DO REI E MORTA (medido em 30/09/2026): os 327 canais apontam para o host
    // `xn---...rent`, que responde 403, e o caminho `.prev.png` do proprio dominio da 404. Entao
    // ela nunca vira background — o fundo do canal e o proprio logo. A previa de frame de video
    // (decisao 63) vinha da EMB/ETC, que saíram do servidor na decisao 155.
    background: logo,
    posterShape: "square",
    genres: [genreFor(ch)],
    runtime: "🔴 Live",
    behaviorHints: { live: true },
  };
}

async function getCatalog(search, genre) {
  const canais = await loadCatalog();
  let list = canais;
  if (genre && genre !== "Todos") list = list.filter((ch) => genreFor(ch) === genre);
  if (search) {
    const q = lower(search);
    list = list.filter((ch) => texto(ch).some((t) => lower(t).includes(q)));
  }
  return list.map(makeMeta);
}

async function getMeta(slug) {
  if (!slug) return null;
  const id = idDe(slug);
  const canais = await loadCatalog().catch(() => []);
  const ch = canais.find((c) => c.id === id);
  return ch ? makeMeta(ch) : null;
}

const STABLE_GENRES = ["Esportes", "Variedades", "Canais Abertos", "Séries", "Notícias", "Filmes", "Infantil", "Desenhos", "Documentários", "24 Horas", "Realitys", "Geral"];

module.exports = { getCatalog, getMeta, loadCatalog, genreFor, SOURCE, STABLE_GENRES };
