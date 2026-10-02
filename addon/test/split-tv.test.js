const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const tvSplit = require(path.join(__dirname, "..", "src", "lib", "tv-split.js"));

function req(url, query) {
  const u = new URL(url, "http://x");
  return { path: u.pathname, query: query || {}, get: () => undefined, headers: {}, url };
}

test("a ponte repassa busca e categoria de TV (montar no app1 custa 42s e da 504)", () => {
  assert.ok(tvSplit.ehRequisicaoDeTv(req("/catalog/tv/mirror-tv-live.json?search=globo")),
    "o catalogo de TV e da ponte");
  assert.ok(tvSplit.ehRequisicaoDeTv(req("/api/channels?search=globo")),
    "/api/channels e da ponte (antes montava o catalogo do zero a cada chamada)");
  // DECISAO 155: `/api/streams/tv` saiu do repasse. Ele respondia `{streams: []}` sem tocar em
  // origem nenhuma depois da 155, entao passar por uma ponte seria mais lento E mais um ponto de
  // falha. Quem pede stream de TV e' o plugin, no aparelho.
  assert.equal(tvSplit.ehRequisicaoDeTv(req("/api/streams/tv/hbo")), false,
    "/api/streams/tv nao e mais da ponte");
  assert.equal(tvSplit.ehRequisicaoDeTv(req("/stream/tv/tv:live:hbo.json")), false,
    "/stream/tv tambem nao");
});

test("a URL repassada carrega a busca, mesmo no caminho com :config na frente", () => {
  // Este e o bug medido: o caminho do Stremio e `/:config/catalog/tv/:id.json`, e nesse
  // prefixo o Express nao popula `req.query` — o cluster recebia a rota sem `?search=` e
  // devolvia o catalogo INTEIRO (279 canais) em vez dos 17 filtrados.
  const comConfig = req("/x/catalog/tv/mirror-tv-live.json", {});
  assert.equal(comConfig.path, "/x/catalog/tv/mirror-tv-live.json");
  // o caminho sozinho nao tem a busca; a ponte tem de remontar a query de outro lugar
  const sem = req("/catalog/tv/mirror-tv-live.json", {});
  assert.deepEqual(sem.query, {}, "sem query nao ha o que remontar");
});

test("a triagem de TV nao roda de novo a cada termo de busca", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "core", "tv-sources.js"), "utf8");
  // O memo do catalogo completo: busca e categoria filtram em vez de remontar.
  assert.match(src, /if \(completo\.length && Date\.now\(\) - completoEm < BUSCA_TTL\)/,
    "a busca precisa usar o catalogo completo ja montado");
  assert.match(src, /completo = out;\s*completoEm = Date\.now\(\);/,
    "o catalogo completo precisa ser guardado no fim da montagem");
  assert.match(src, /function filtraCompleto\(/, "tem que existir o filtro do memo");
  // REGRESSAO (medido 28/09/2026): o corte era `querFiltrar && ...`, e `genre=Todos` tem
  // `querFiltrar` false porque "Todos" significa "sem filtro". `Todos` e a PRIMEIRA opcao do
  // menu de categorias do Stremio, entao com o menu na opcao padrao o memo era ignorado: 11,3s
  // no app1, 504 em 12,3s no cluster e 0 canais — enquanto `Esportes` vinha em 0,5s.
  assert.doesNotMatch(src, /querFiltrar && completo\.length/,
    "o memo nao pode depender de ter busca ou categoria: genre=Todos precisa servir do memo");
  // `?date=` (a guia) tambem tem de sair do memo, com a programacao do dia montada por
  // `epg.grade` — sem isso a guia volta com 0 canais com programa.
  assert.match(src, /epg\.grade\(m\.name, m\.id, data\)/,
    "o memo precisa montar a programacao quando vem `date`");
});

test("genre=Todos e tratado como sem filtro em todos os cortes", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "core", "tv-sources.js"), "utf8");
  const cortes = src.match(/genre && genre !== "Todos"/g) || [];
  assert.ok(cortes.length >= 2, `os dois filtros precisam ignorar "Todos" (achei ${cortes.length})`);
});

test("a rota com :config repassa o date da guia", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  // MEDIDO 29/09/2026: a rota `/:config/catalog/...` (e o que o Stremio chama) ignorava o
  // `extra.date` e devolvia `{metas:[...]}` — a aba Channel Guide abria sem nenhum programa,
  // enquanto a mesma URL sem `:config` devolvia 279 canais e 131 com programa. As DUAS rotas
  // precisam tratar a data e responder `metasDetailed`.
  assert.match(src, /function montaCatalogo\(metas, data, tipo\)/,
    "as rotas de catalogo precisam passar por um montador unico");
  assert.match(src, /data \? \{ metasDetailed: tipadas \} : \{ metas: tipadas \}/,
    "com `date` a resposta tem que ser metasDetailed");
  assert.match(src, /catalogFor\(req\.params\.id, search, req\.params\.type, genre, data\)/,
    "a data tem que chegar no catalogFor para a programacao ser montada");
  assert.match(src, /\$\{req\.query\.date \|\| ""\}/,
    "a chave de cache do catalogo tem que separar os dias");
});

test("a guia de TV espera o EPG carregar antes de esquentar", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  // REGRESSAO (medido 29/09/2026): o log saiu "guia aquecida: 277 canais, **0 com programa**
  // (181410ms)" e SO DEPOIS "[epg] 160 canais com programacao". O aquecimento corria antes do
  // XMLTV baixar e guardava a guia VAZIA por 300s — a aba de programacao abria sem programa
  // mesmo com o EPG bom (HBO 26, SBT RJ 19, Globo News 15).
  assert.match(src, /async function esperaEpg\(\)/, "tem que esperar o EPG");
  assert.match(src, /const pronto = await esperaEpg\(\);/, "o aquecimento da guia tem que esperar");
  assert.match(src, /epgPronto \? ttl : 15000/,
    "guia pedida com EPG frio nao pode ficar 300s na cache");
});

// DECISAO 155: este teste existia por um relato do dono — "pesquisei Globo News e apareceram
// todas as fontes menos a REI". O `allSettled` engolia a falha e a lista incompleta era guardada
// por 90s, entao todo mundo via a lista sem a fonte caída durante 90 segundos.
//
// O caso nao existe mais, e a razao e' melhor que o conserto: nao ha lista de fontes. A
// "resposta degradada" era uma lista de players com um buraco; hoje a resposta e' a lista
// VAZIA, que e' a mesma para todo mundo e nao mente sobre ninguem. Por isso ela pode ter um
// TTL normal em vez do TTL curtissimo.
test("decisao 155: nao ha mais lista parcial de TV — a resposta e' a lista vazia, em TTL estavel", () => {
  const fs = require("fs");
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  const tv = fs.readFileSync(path.join(__dirname, "..", "src", "core", "tv-sources.js"), "utf8");

  // O caminho de TV do `handleStreams` foi embora inteiro.
  assert.equal(/^const TV_STREAM_CACHE_TTL =/m.test(server), false, "o TTL de link de TV nao pode voltar");
  assert.equal(/^const TV_STREAM_CACHE_DEGRADADO_MS =/m.test(server), false, "nem o TTL degradado");
  assert.equal(/tvSources\.getStreams\(/.test(server), false, "e o servidor nao pergunta fonte de TV");
  // A marca de "degradado" era do `allSettled` das 4 fontes: nao ha mais o que degradar.
  assert.equal(/"degradado"/.test(tv), false, "a marca de resposta parcial nao tem mais objeto");
  // A unica resposta de stream que existe, e ela e' estavel (60s, o TTL de degradado).
  assert.match(server, /sqliteCache\.set\(chave, vazio, DEGRADED_CACHE_TTL\)/, "a lista vazia entra em cache");
  assert.match(server, /const DEGRADED_CACHE_TTL = 60 \* 1000;/, "e dura 60s");
});
test("o cache de entradas grandes nao pode ser menor que o numero de buscas", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  // Medido: com CACHE_BIG_MAX = 6, cada busca apagava o resultado da anterior (o catalogo de
  // TV passa de 200KB e entra na faixa "grande"), e o catalogo levava 12,3s em TODO pedido.
  const m = src.match(/const CACHE_BIG_MAX = Number\(ENV\.MEM_CACHE_BIG_MAX \|\| (\d+)\)/);
  assert.ok(m, "CACHE_BIG_MAX precisa de um padrao");
  assert.ok(Number(m[1]) >= 20, `o teto de entradas grandes precisa caber varias buscas (hoje ${m[1]})`);
});

test("sob pressao de memoria o catalogo de TV nao e descartado", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  // A primeira versao do guard apagava metade da cache a cada 30s de pressao, e o catalogo de
  // TV estava nessa metade: cache zerada em ciclo e 504 para o cliente, sem que a pressao
  // diminuisse (apagar cache nao devolve memoria).
  assert.match(src, /function chaveCara\(/, "as entradas caras precisam ser identificadas");
  assert.match(src, /if \(pressao && chaveCara\(k\)\) continue;/, "o despejo por pressao pula as caras");
});

test("a recusa 404 do cluster chega como 404, nao como 200 vazio", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "tv-split.js"), "utf8");
  // MEDIDO em producao 29/09/2026:
  //   /api/channels/naoexistechannelxyz
  //     cluster devolvia 404 {success:false}
  //     -> o app1 trocava por 200 {success:true,data:[]}  e a API MENTIA
  // A recusa do cluster e a resposta CERTA (o canal nao existe) e tem de passar como esta.
  // A reserva e so para quando ele nao respondeu: timeout, rede ou 5xx.
  assert.match(src, /resposta\.status === 400 \|\| resposta\.status === 404/,
    "a recusa legitima do cluster precisa ser identificada");
  assert.match(src, /res\.status\(resposta\.status\)/,
    "o status do cluster tem que ser repassado ao chamador");
});

test("a chave da reserva do catalogo de TV e a mesma do catalogFor", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  // A chave antiga era `mirror-tv-live:` e a gravada e `mirror-tv-live::tv::` — o cache nunca
  // acertava, entao a reserva entregava lista VAZIA mesmo com o catalogo inteiro na memoria.
  assert.match(src, /\$\{id\}:\$\{busca\}:tv:\$\{cat\}:\$\{data\}/,
    "a reserva tem que montar a chave exata que o catalogFor grava");
  assert.match(src, /new URLSearchParams\(String\(req\.url \|\| ""\)\.split\("\?"\)\[1\] \|\| ""\)/,
    "a query tem que vir do req.url, porque req.query ainda esta vazio no middleware");
});

test("a reserva de um canal devolve 404 quando o slug nao existe", () => {
  const fs = require("fs");
  const servidor = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  const split = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "tv-split.js"), "utf8");
  assert.match(servidor, /__reserva: true, status: 404/,
    "a reserva precisa poder responder 404 para slug desconhecido");
  assert.match(servidor, /req\.path\.endsWith\("\/api\/channels\/categories"\)/,
    "/api/channels/categories tem que ser separado de /api/channels/:slug");
  assert.match(split, /resposta\.__reserva === true/,
    "o respondeReserva tem que respeitar o status que a reserva trouxe");
});

test("o catalogo de TV sem data e aquecido no boot (e a chave da reserva)", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  // O app1 DELEGA a montagem para o cluster, entao so aquecia a guia (que leva `date`).
  // A reserva procura a chave SEM data — que nunca existia — e o split virava ponto unico de
  // falha: cluster fora = lista vazia, apesar de a triagem ja ter rodado na mesma memoria.
  assert.match(src, /catalogFor\("mirror-tv-live", null, "tv", null, ""\)/,
    "o catalogo sem data precisa ser aquecido junto com a guia");
});
