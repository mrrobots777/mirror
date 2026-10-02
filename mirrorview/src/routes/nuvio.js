// O ADAPTER DO NUVIO — a peca `mirrorhub`.
//
// O Nuvio nao trata `tv` como vivo: nele `tv` = serie, e canal ao vivo e' do tipo `channel` do
// Stremio (`LivePlaybackUiPolicy.kt:7-13`). A lista de canais do Nuvio vem sempre de um addon, e o
// addon do Mirror publica TV como tipo `channel`, com o `id` em NUMERO — porque o NuvioTV so
// deixa o plugin rodar em id numerico (`ensureTmdbId`, `TmdbService.kt:227-229`).
//
// DECISAO 155 (02/10/2026) — o servidor virou SO CATALOGO. Estas 4 rotas publicam o catalogo, a
// meta e a GRADE DO DIA; o player vem do plugin, que tem as 4 fontes de TV dentro dele e resolve
// o canal pelo mesmo mapa (`nuvio/src/lib/canais.js`) que este arquivo importa.
//
// A QUARTA ROTA (`/nuvio/stream/channel/:id`) E' A DECISAO MAIS DELICADA, e a resposta e' duas
// coisas ao mesmo tempo:
//
//   1. `stream` SAI da lista `resources` do manifesto. Isso e' o que declara a verdade: um addon
//      que se anuncia como recurso `stream` promete um player, e o servidor nao tem nenhum. O
//      dono pediu "nada no servidor senao catalogo", e o manifesto e' a parte do servidor que o
//      cliente le primeiro.
//
//   2. A ROTA CONTINUA REGISTRADA e responde `{"streams": []}` com 200 e cache curto. Por que
//      nao 404: o manifesto vive em cache (o proprio `/nuvio/manifest.json` tem 120s de borda, e
//      o Nuvio guarda o que ele leu), entao um cliente com o manifesto antigo vai PEDIR essa
//      rota. Um 404 ali vira "erro do addon" na tela do usuario; `{streams: []}` vira "nenhuma
//      fonte", que e' a resposta honesta e e' a mesma que as outras duas rotas de stream
//      (`/stream/*` e `/api/streams/*`) ja devolvem. Nenhum cliente quebra, e nenhum toma 500.
//
// O `id` numerico continua sendo o ponto de contato com o plugin: `src/lib/nuvio-canais.js`
// importa o MESMO arquivo que o plugin usa. Um canal fora do mapa nao existe para o Nuvio.
const { ROTAS, ENV } = require("../core/nomes");
const tvSources = require("../core/tv-sources");
const tvSplit = require("../lib/tv-split");
const ncanais = require("../lib/nuvio-canais");

const ID_ADDON = "com.mirror.nuvio";
const VERSAO = "1.0.0";
const NOME_ADDON = "MirrorHub";
const TIPO = "channel";
const CATALOGO = "tv";
// O teto da ponte para o cluster de TV e' o mesmo do split: com o cluster ligado, o
// `/nuvio/catalog` e' delegado.
const TEMPO_PONTE = Number(ENV.TV_PROXY_TIMEOUT_MS || 8000);
const BYTES_DO_CATALOGO = 8 * 1024 * 1024;

function descricao() {
  return "MirrorHub — os canais de TV ao vivo do Mirror no formato que o Nuvio entende: tipo channel, id numerico e a grade do dia. Os players sao entregues pelo plugin mirror, nao por aqui.";
}

function manifesto(req, base) {
  return {
    id: ID_ADDON,
    version: VERSAO,
    name: NOME_ADDON,
    description: descricao(),
    logo: `${base || ""}/logo.svg`,
    types: [TIPO],
    // `catalog` e `meta` SO (decisao 155). O `stream` saiu: o servidor nao tem player, e
    // declarar o recurso seria prometer um link que nunca vem. A rota continua existindo
    // (respondendo `{streams: []}`) para o cliente que ainda tem o manifesto antigo em cache.
    resources: ["catalog", "meta"],
    catalogs: [{
      type: TIPO,
      id: CATALOGO,
      name: "Mirror TV",
      posterShape: "square",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
        // O MENU DE GENERO E' O MESMO BALDE DO CATALOGO DE TV (decisao 126): um menu escrito a mao
        // aqui voltaria a esconder os canais que o filtro nao encontra.
        { name: "genre", isRequired: false, options: ["Todos", ...tvSources.BUCKETS] },
        { name: "date", isRequired: false },
      ],
    }],
    // `epgProvider` e' a mesma flag da decisao 55/56: e' ela que faz o Stremio abrir a aba
    // *Channel Guide*. O Nuvio nao depende dela — o catalogo ja declara o extra `date` e a grade do
    // dia vem em `videos` de qualquer jeito — mas declara-la e' inofensivo e mantem os dois clientes
    // com o mesmo sinal.
    behaviorHints: { configurable: false, epgProvider: true },
  };
}

// O `id` do video da grade e' `<id do canal>:epg:<inicio>`. Ele nasce com o `tv:live:<chave>`
// porque e' o que `epg.grade` monta, e volta para o numero — que e' o que o cliente vai pedir.
function videoDeNucleo(video, numero) {
  const inicio = String(video.startTime || "").replace(/^.*:epg:/, "");
  return { ...video, id: `${numero}:epg:${inicio}` };
}

function canalDoCatalogo(meta, data) {
  const reg = ncanais.registroDeCatalogo(meta);
  if (!reg) return null;
  const id = String(reg.numero);
  const out = {
    id,
    type: TIPO,
    name: meta.name || reg.nome,
    description: meta.description,
    poster: meta.poster,
    background: meta.background,
    posterShape: meta.posterShape || "square",
    genres: meta.genres || [],
  };
  if (data && (meta.videos || []).length) {
    out.videos = meta.videos.map((v) => videoDeNucleo(v, id));
    out.behaviorHints = { ...(meta.behaviorHints || {}), hasScheduledVideos: true };
  }
  return out;
}

// DELEGA AO CLUSTER DE TV. So o catalogo: e' o unico dos quatro que, montado no app1, custa a
// triagem inteira. Meta e stream sao por canal e o app1 ja responde os dois sem o cluster (medido
// em producao com o cluster fora do ar). O caminho repassado e' o mesmo, entao o cluster responde
// com as MESMAS rotas.
async function repassa(req, res) {
  if (!tvSplit.TV_BASE || tvSplit.ehOProprioClusterDeTv(req)) return false;
  try {
    const resposta = await fetch(tvSplit.TV_BASE + String(req.url || req.originalUrl || ""), {
      headers: { accept: "application/json", "accept-encoding": "identity" },
      signal: AbortSignal.timeout(TEMPO_PONTE),
    });
    if (!resposta || !resposta.ok) return false;
    const corpo = Buffer.from(await resposta.arrayBuffer());
    if (!corpo.length || corpo.length > BYTES_DO_CATALOGO) return false;
    res.status(200);
    res.set("Content-Type", resposta.headers.get("content-type") || "application/json");
    res.send(corpo);
    return true;
  } catch (_) {
    return false;
  }
}

function registrar(app, deps) {
  // `handleStreams` saiu do destructuring na decisao 155: a rota de stream nao chama mais o
  // servidor (ela responde `{streams: []}` sozinha). `basePublica` segue no manifesto, para o
  // logo sair absoluto.
  const { basePublica, catalogoDeTv } = deps;

  app.get(ROTAS.nuvio.manifesto, (req, res) => {
    res.json(manifesto(req, basePublica(req)));
  });

  app.get(ROTAS.nuvio.catalogo, async (req, res) => {
    if (!ncanais.temMapa()) return res.status(503).json({ error: "mapa de canais do Nuvio ausente" });
    if (await repassa(req, res)) return res;
    try {
      const data = req.query.date || "";
      const metas = await catalogoDeTv(req.query.search || null, req.query.genre || null, data);
      const vistos = new Set();
      const saida = [];
      for (const meta of metas) {
        const canal = canalDoCatalogo(meta, data);
        if (!canal || vistos.has(canal.id)) continue;
        vistos.add(canal.id);
        saida.push(canal);
      }
      saida.sort((a, b) => Number(a.id) - Number(b.id));
      res.json({ metas: saida, cacheMaxAge: 300, staleRevalidate: 900 });
    } catch (e) {
      console.error(`[nuvio] catalog: ${e.message}`);
      res.json({ metas: [], cacheMaxAge: 0 });
    }
  });

  app.get(ROTAS.nuvio.meta, async (req, res) => {
    try {
      const reg = ncanais.registroDeNumero(req.params.id);
      if (!reg) return res.json({ meta: null });
      const data = req.query.date || "";
      const meta = await tvSources.getMeta(reg.chave, data);
      if (!meta) return res.json({ meta: null });
      const id = String(reg.numero);
      const videos = (meta.videos || []).map((v) => videoDeNucleo(v, id));
      const out = { ...meta, id, type: TIPO, name: meta.name || reg.nome };
      if (videos.length) {
        out.videos = videos;
        out.behaviorHints = { ...(meta.behaviorHints || {}), hasScheduledVideos: true };
      }
      res.json({ meta: out, cacheMaxAge: 300, staleRevalidate: 600 });
    } catch (e) {
      console.error(`[nuvio] meta: ${e.message}`);
      res.json({ meta: null });
    }
  });

  // A rota de stream SEM recurso declarado (decisao 155). Ela responde o que o servidor sabe:
  // nada. Ver o bloco do topo sobre por que ela existe em vez de sumir.
  app.get(ROTAS.nuvio.stream, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("CDN-Cache-Control", "no-store");
    res.set("Cloudflare-CDN-Cache-Control", "no-store");
    res.json({ streams: [] });
  });

  return app;
}

module.exports = { registrar, manifesto, canalDoCatalogo, videoDeNucleo, ID_ADDON, NOME_ADDON, TIPO, CATALOGO };
