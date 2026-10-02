const { ENV } = require("../core/nomes");

const TV_BASE = String(ENV.TV_BASE_URL || "").trim().replace(/\/+$/, "");
const TV_BASE_HOST = (() => {
  if (!TV_BASE) return "";
  try { return new URL(TV_BASE).host.toLowerCase(); } catch (_) { return ""; }
})();
// O TIMEOUT da ponte tem de caber no ORCAMENTO DO GATEWAY (~12,3s), nao ser o unico limite.
//
// Medido em 28/09/2026: com 8s aqui, `/catalog/tv/...?search=globo` dava 504 SEMPRE. A ponte
// esperava 8s, o `catch` caia em `next()`, e o app1 comecava a MONTAR o catalogo de TV do
// zero (127s medidos) — alem do 504, levava o app1 a 330MB de RSS. 1a chamada 12,3s/504, depois
// 157 canais (parcial), depois 281. A busca usa OUTRA chave de cache, entao cada termo novo
// repetia o 504. `/api/channels` era o pior caso: nao entrava em `ehRequisicaoDeTv`, logo
// nunca era repassado e o app1 montava do zero em TODA chamada.
//
// Subir para 8,5s NAO resolveu: o gateway mede o tempo INTEIRO, do app1 ate a resposta, e nao
// so a ponte. Com 8,5s sobrava menos de 4s para o app1, e ele gastava ~4s tentando servir o
// catalogo do proprio cache antes de delegar. O conserto nao e aumentar este numero: e FAZER O
// APP1 DELEGAR o catalogo assim que o pedido chega (ver a rota em `server.js`), de modo que
// aqui sobre so o tempo de ida e volta — medido em 0,05s com o cluster quente.
//
// 8s mantem: e o que cabe, e ainda da tempo de cair em `next()` se o cluster estiver fora.
const TIMEOUT_MS = Number(ENV.TV_PROXY_TIMEOUT_MS || 8000);

// O QUE O CLUSTER DE TV AINDA REPASSA, E O QUE PAROU DE REPASSAR (decisao 155).
//
// O split nasceu (decisao 58/60) por causa de UM numero: montar o catalogo de TV no app1 custava
// **127s** e estourava os 12,3s do gateway. A causa era a TRIAGEM — 284 canais x 3 fontes de
// player, em concorrencia 48, tudo para decidir quem entrava na lista.
//
// MEDIDO depois da 155, no app1, com o mesmo codigo: **catalogo frio 1,17s** (uma leitura de
// 256KB na API do REI) e **0ms** para busca e categoria (o memo filtra). O EPG, que e' a outra
// parte cara, ja rodava em segundo plano nos dois apps. Entao o numero que criou o cluster nao
// existe mais.
//
// MESMO ASSIM O CLUSTER CONTINUA, e a decisao e' do dono, nao minha. Desligar `TV_BASE_URL`
// deixa o app2 como uma copia do app1 — e isso e' mudanca de topologia em producao, nao uma
// limpeza. O que a 155 FAZ e estreitar o repasse para o que o cluster ainda tem razao de servir:
//
//   * `/catalog/tv/*` e `/api/channels*` — o catalogo e a API de canais (continuam, e sao cheap).
//   * `/meta/tv/*` — a meta do canal, que carrega a grade do dia.
//
// E SAIRAM do repasse (porque nao ha mais trabalho nelas para delegar):
//   * `/stream/tv/*` — resolvia a playlist nas 4 fontes e depois no relay. Isso saiu com as
//     fontes (decisao 155); a rota responde `{streams: []}` sem tocar em origem nenhuma, entao
//     passar por uma ponte seria slower E mais um ponto de falha.
//   * `/api/streams/tv` — mesma coisa, pelo mesmo caminho de `handleStreams`.
//
// MEDIDO: a ponte custa uma ida e volta de rede. Com o cluster quente ela responde em ~0,05s —
// e a rota local, sozinha, responde em 0ms. Para as DUAS rotas de stream a delegacao e hoje
// estritamente pior.
function ehRequisicaoDeTv(req) {
  if (req.path.includes("/catalog/tv/")) return true;
  if (req.path.startsWith("/api/channels")) return true;
  let caminho = req.path;
  try { caminho = decodeURIComponent(caminho); } catch (_) {}
  return /^\/(?:[^/]+\/)?meta\/tv\/tv:live:/.test(caminho);
}

// Busca e filtro por categoria NAO podem ser montados no app1: cada termo e uma chave nova e
// a montagem custa 42s (triagem de 283 canais nas 3 fontes). O cluster responde em 0,05s, e o
// app1 sem cache chegava a 330MB de RSS refazendo a triagem por termo.
//
// MEDIDO em 28/09/2026: `?search=globo` e `?category=Globo` davam 504 no app1 enquanto o
// catalogo completo passava em 0,27s. Este predicado fica AQUI, no middleware, e nao na rota
// do servidor, porque o caminho que o Stremio usa e `/:config/catalog/:type/:id.json` — com
// um segmento `config` na frente — e por isso nao casa com a rota Express de `/catalog/...`.
//
// A busca e lida do `req.url`, nunca do `req.query`: o middleware global roda antes do query
// parser do Express, entao `req.query` chega vazio aqui (medido).
function temQueryBusca(bruto) {
  const s = String(bruto || "");
  const i = s.indexOf("?");
  if (i < 0) return false;
  return /(^|&)(search|genre|category)=/.test(s.slice(i + 1));
}

function ehBuscaDeTv(req) {
  if (req.path.startsWith("/api/channels")) return temQueryBusca(req.url || req.originalUrl) || !!(req.query && (req.query.search || req.query.genre || req.query.category));
  if (!req.path.includes("/catalog/tv/")) return false;
  return temQueryBusca(req.url || req.originalUrl) || !!(req.query && (req.query.search || req.query.genre));
}

// Resposta de RESERVA quando o cluster de TV nao responde.
//
// MEDIDO 28/09/2026: com o cluster lento ou fora, a ponte caia em `next()` e o app1 ia
// MONTAR o catalogo de TV sozinho — 127s, muito acima dos 12,3s do gateway, entao 504. O
// dono via "o catalogo nao carrega" toda vez que o cluster estava aquecendo depois de um
// deploy. Montar no app1 e o que NAO deve acontecer: o cluster existe para isso.
//
// Entao, para pedido de catalogo de TV, a falha da ponte responde na hora com o que houver:
// o catalogo velho se existir, senao lista vazia. Lista vazia e honesta (o Stremio mostra
// "nada encontrado" e o usuario volta em segundos); 504 derruba o addon inteiro na percepcao.
let aoFalharCluster = null;

// Registra o que fazer com o CORPO fresco do cluster quando ele e de catalogo de TV. E o
// app1 guardando a propria reserva (ver o trecho no fim de `repassaTv`).
let aoRepasse = null;
function definirAoRepasse(fn) {
  aoRepasse = typeof fn === "function" ? fn : null;
}

function definirFallbackTv(fn) {
  aoFalharCluster = typeof fn === "function" ? fn : null;
}

function respondeReserva(req, res) {
  if (!aoFalharCluster) return false;
  const resposta = aoFalharCluster(req);
  if (!resposta) return false;
  // A reserva pode trazer o STATUS junto (404 de um canal que nao existe, por exemplo).
  // Enviar tudo com 200 mentiria da mesma forma que o defeito que ela veio corrigir — a API
  // diria `success:true` para um canal que o catalogo nem conhece.
  const comStatus = typeof resposta === "object" && resposta.__reserva === true;
  const corpo = comStatus ? resposta.corpo : resposta;
  if (!corpo) return false;
  res.status(comStatus ? (resposta.status || 200) : 200);
  res.set("Content-Type", "application/json");
  res.set("Cache-Control", "no-store");
  res.set("Access-Control-Allow-Origin", "*");
  res.send(JSON.stringify(corpo));
  return true;
}

// Remove o `:config` do caminho.
//
// MEDIDO em 28/09/2026, e este e o defeito final da busca: o caminho que o Stremio usa e
// `/:config/catalog/:type/:id.json`, e nesse formato o `defineCatalogHandler` do SDK NAO recebe
// a busca no `extra` — entao o filtro nunca era aplicado e a resposta vinham com o catalogo
// INTEIRO. No mesmo cluster, no mesmo instante:
//   /catalog/tv/mirror-tv-live.json?search=globo  ->  17 canais (Globo News)   [ok]
//   /x/catalog/tv/mirror-tv-live.json?search=globo -> 279 canais (sem filtro)  [defeito]
// A busca funcionava; o `:config` que a engolia.
//
// Tirar o segmento resolve sem tocar no SDK e sem perder configuracao: a busca e um filtro de
// nome e nao depende de config. O cluster monta o catalogo completo uma vez (e so isso e caro,
// porque a triagem pergunta `getStreams` dos 283 canais nas 3 fontes) e a busca sai em 0,05s.
function tiraConfig(caminho) {
  const m = String(caminho || "").match(/^\/[^/]+(\/(?:catalog|meta|stream)\/.*)$/);
  return m ? m[1] : caminho;
}

// Remonta o caminho do cluster com a query.
//
// MEDIDO 28/09/2026: relying em `req.query` aqui dava VAZIO, e por isso a busca se perdia
// inteiro. A razao e a ordem do Express: o middleware global roda ANTES do `query parser`, entao
// `req.query` so e populado depois. Confirmado medindo os dois campos no mesmo pedido.
function comQuery(req) {
  const base = tiraConfig(req.path || req.originalUrl || "");
  const bruto = String(req.url || req.originalUrl || "");
  const i = bruto.indexOf("?");
  const query = i >= 0 ? bruto.slice(i + 1) : "";
  if (query) return base + (base.includes("?") ? "&" : "?") + query;
  const q = req.query || {};
  const partes = [];
  for (const chave of Object.keys(q)) {
    const valor = q[chave];
    if (valor === undefined || valor === null || valor === "") continue;
    const lista = Array.isArray(valor) ? valor : [valor];
    for (const v of lista) partes.push(`${encodeURIComponent(chave)}=${encodeURIComponent(v)}`);
  }
  if (!partes.length) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${partes.join("&")}`;
}

function semPorta(h) {
  return String(h || "").trim().toLowerCase().replace(/:\d+$/, "");
}

function primeiroRotulo(h) {
  return semPorta(h).split(".")[0] || "";
}

function ehOProprioClusterDeTv(req) {
  if (!TV_BASE_HOST) return false;
  const h = req.headers || {};
  const candidatos = [req.get && req.get("host"), req.get && req.get("x-forwarded-host"), h["x-forwarded-host"], h["host"]];
  for (const c of candidatos) {
    const host = semPorta(String(c || "").split(",")[0]);
    if (!host) continue;
    if (host === TV_BASE_HOST) return true;
    if (primeiroRotulo(host) && primeiroRotulo(host) === primeiroRotulo(TV_BASE_HOST)) return true;
  }
  return false;
}

// A busca vai direto para o cluster, com a query remontada, e com um orcamento proprio.
//
// O orcamento e o da PONTE (8s), nao o do gateway: e a ponte que faz a ida e volta, e o
// cluster responde a busca em 0,05s quando tem o catalogo montado. O caminho que o Stremio
// usa tem um `:config` na frente, e nesse prefixo o Express nao popula `req.query` — por isso
// a query e lida do `req.url` e remontada aqui, senao o cluster responde o catalogo inteiro.
async function repassaBusca(req, res, next) {
  try {
    const resposta = await fetch(TV_BASE + comQuery(req), {
      headers: {
        accept: "application/json",
        "user-agent": String((req.get && req.get("user-agent")) || "Mozilla/5.0"),
        "accept-encoding": "identity",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resposta || !resposta.ok) return next();
    const corpo = Buffer.from(await resposta.arrayBuffer());
    if (!corpo.length || corpo.length > 4 * 1024 * 1024) return next();
    res.status(200);
    res.set("Content-Type", resposta.headers.get("content-type") || "application/json");
    res.set("Cache-Control", "no-store");
    res.set("Access-Control-Allow-Origin", "*");
    return res.send(corpo);
  } catch (_) {
    if (respondeReserva(req, res)) return res;
    return next();
  }
}

async function repassaTv(req, res, next) {
  if (!TV_BASE) return next();
  if (ehOProprioClusterDeTv(req)) return next();
  if (!ehRequisicaoDeTv(req)) return next();
  // A busca e a categoria vao para o cluster sem esperar montagem local: cada termo e uma
  // chave nova e montar aqui custa 42s (504) e 330MB de RSS. O criterio le a query do
  // `req.url` porque o `req.query` ainda esta vazio neste ponto do ciclo do Express.
  if (ehBuscaDeTv(req) && !ehOProprioClusterDeTv(req)) {
    return repassaBusca(req, res, next);
  }
  // O catalogo de TV (com ou sem `:config`) e resposta de RESERVA quando o cluster nao
  // responde: velho cache ou lista vazia, nao 504. Montar aqui custaria 127s.
  const eCatalogoTv = req.path.includes("/catalog/tv/") || req.path.startsWith("/api/channels");
  // BUG REAL (medido 28/09/2026): a busca de canais nao atravessava. `req.originalUrl` no
  // Express NAO inclui a query string, entao o cluster recebia `/catalog/tv/...json` SEM o
  // `?search=` e devolvia o catalogo inteiro — ou, ja sem cache, remontava tudo e o app1
  // recebia 504. O sintoma era "a busca da erro". Montar a URL com o `req.url` (que tem a
  // query) resolve, e e o que o proprio cluster precisa para responder de verdade.
  //
  // E o `req.url` sozinho NAO bastava, porque o caminho do Stremio tem um `:config` na frente
  // (`/:config/catalog/tv/:id.json`). MEDIDO: no cluster, `/x/catalog/tv/mirror-tv-live.json`
  // com `?search=globo` devolvia os 279 canais em vez dos 17 — a busca nao chegava. Como o
  // app1 repassa o caminho do cliente, o cluster recebia `?search=` num prefixo que nao popula
  // `req.query`, e o filtro era ignorado. Aqui a query e remontada a partir de `req.query` e
  // anexada de forma explicita, para nao depender de como o Express parseou o caminho.
  const destino = TV_BASE + comQuery(req);
  let resposta;
  try {
    resposta = await fetch(destino, {
      headers: {
        accept: "application/json",
        "user-agent": String((req.get && req.get("user-agent")) || "Mozilla/5.0"),
        "accept-encoding": "identity",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (_) {
    if (eCatalogoTv && respondeReserva(req, res)) return res;
    return next();
  }
  if (!resposta || !resposta.ok) {
    // A RECUSA LEGITIMA NAO E FALHA DO CLUSTER. Se ele respondeu 400/404, aquilo e a resposta
    // certa (canal nao existe, id malformado) e tem que passar como esta. MEDIDO 29/09/2026:
    //   /api/channels/naoexistechannelxyz -> cluster devolvia 404 {success:false}
    //   -> aqui virava 200 {success:true,data:[]}  e a API MENTIA (o chamador achava que o
    //      canal existe e so esta sem conteudo)
    // A reserva so entra quando o cluster de fato nao respondeu: timeout, rede ou 5xx.
    if (resposta && (resposta.status === 400 || resposta.status === 404)) {
      try {
        const recusa = Buffer.from(await resposta.arrayBuffer());
        if (recusa.length && recusa.length <= 4 * 1024 * 1024) {
          res.status(resposta.status);
          res.set("Content-Type", resposta.headers.get("content-type") || "application/json");
          res.set("Cache-Control", "no-store");
          res.set("Access-Control-Allow-Origin", "*");
          return res.send(recusa);
        }
      } catch (_) {}
    }
    if (eCatalogoTv && respondeReserva(req, res)) return res;
    return next();
  }
  let corpo;
  try { corpo = Buffer.from(await resposta.arrayBuffer()); } catch (_) {
    if (eCatalogoTv && respondeReserva(req, res)) return res;
    return next();
  }
  if (!corpo.length || corpo.length > 4 * 1024 * 1024) return next();
  res.status(resposta.status);
  res.set("Content-Type", resposta.headers.get("content-type") || "application/json");
  res.set("Cache-Control", "no-store");
  res.set("Access-Control-Allow-Origin", "*");
  // A RESERVA SE RENOVA NO PROPRIO REPASSE. O app1 recebe o catalogo fresco do cluster em
  // todo pedido de catalogo — e e a unica coisa que a reserva guarda. Sem isto ela nascia no
  // boot e morria 15 min depois: o addon ficava um periodo sem abrir, o cluster caia, e o
  // proximo usuario recebia 503 com o catalogo existindo do outro lado. Guardar aqui custa um
  // JSON.parse por catalogo repassado e mantem a reserva sempre tao fresca quanto o trafego.
  if (eCatalogoTv && aoRepasse) { try { aoRepasse(req, corpo); } catch (_) {} }
  return res.send(corpo);
}

module.exports = { TV_BASE, TV_BASE_HOST, repassaTv, ehRequisicaoDeTv, ehOProprioClusterDeTv, definirFallbackTv, definirAoRepasse };
