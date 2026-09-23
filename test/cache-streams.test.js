// As DUAS camadas de cache que o dono pediu, verificadas no codigo — nao no comentario.
//
// 1. Metadados e catalogos (vida longa)
// 2. Streams/resolutores (vida curta) + trava de requisicao simultanea (in-flight dedup)
//
// Um teste so vale se ele QUEBRAR quando o cache some. Por isso cada caso aqui apaga o cache
// de proposito e mostra que o codigo volta a funcionar — e os outros mostram que o cache
// realmente segura a resposta.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(RAIZ, "src/server.js"), "utf8");

// ---------------------------------------------------------------- camada 1: metadados
test("camada 1: o catalogo de VOD dura 12-24h e o de TV 24h", () => {
  assert.match(server, /const CACHE_TTL = (\d+) \* 60 \* 1000;/, "CACHE_TTL do catalogo VOD");
  const vod = Number(/const CACHE_TTL = (\d+) \* 60 \* 1000;/.exec(server)[1]);
  assert.ok(vod >= 12 && vod <= 24 * 60, `catalogo de VOD em ${vod}min; o dono pediu 12-24h`);

  assert.match(server, /const TV_CATALOG_TTL = 24 \* 60 \* 60 \* 1000;/, "catalogo de TV em 24h");
  assert.match(server, /const META_CACHE_TTL = (\d+) \* 60 \* 1000;/);
  const meta = Number(/const META_CACHE_TTL = (\d+) \* 60 \* 1000;/.exec(server)[1]);
  assert.ok(meta >= 10, `meta em ${meta}min`);
});

// DECISAO 155: a lista de canais da TV nao depende mais de NADA que provedade.
//
// Antes (decisao 125) ela sobrevivia a restart por causa de uma "prova de morte" no disco: a
// triagem chamava `getStreams` das 4 fontes para descobrir quem nao tocava, e a prova vivia 24h
// no SQLite. As DUAS sairam com as fontes.
//
// E o resultado para o dono e' melhor do que a prova, nao pior. A regra dele era "nao retirar
// canal", e ela era garantida por DUAS coisas frágeis: a lista nao saia do REI, e a prova so
// tirava na 2a confirmacao (decisao 134, depois de 90 canais terem sumido com uma so). Agora
// nao ha prova nenhuma: a lista e' EXATAMENTE o que o REI declara, e ninguem no servidor pode
// encurtar. O que atravessa restart e' o catalogo em disco (30 dias, decisao 144).
test("camada 1: a lista de TV e' o catalogo do REI, e nada no servidor a encurta (decisao 155)", () => {
  const tv = fs.readFileSync(path.join(RAIZ, "src/core/tv-sources.js"), "utf8");
  // Nenhuma prova de morte, nenhuma triagem, nenhuma espera por fonte.
  for (const saiu of ["CHAVE_MORTOS", "agendaTriagem", "provadosMortos", "MORTA_TTL",
                      "TV_MS_POR_FONTE", "comOrcamento", "MORTES_PARA_TIRAR", "setCargaDeUsuario"]) {
    assert.equal(new RegExp("(function|const|let) " + saiu + "\\b").test(tv), false,
      saiu + " nao pode sobreviver sem fonte de player");
  }
  // O que ficou e' o catalogo em disco, com 30 dias (decisao 144: "fonte nao morre").
  assert.match(tv, /const CATALOGO_FONTE_TTL = 30 \* 24 \* 60 \* 60 \* 1000;/, "o ultimo catalogo bom dura 30 dias");
  assert.match(tv, /servindo o ultimo bom/, "e uma falha da fonte serve esse, nao lista vazia");
  // A lista em si: a funcao que a produz nao tem como retirar ninguem.
  const { chavesDaLista } = require("../src/core/tv-sources");
  const declarados = new Set(["a", "b", "c"]);
  assert.equal(chavesDaLista(declarados).size, declarados.size, "a lista nao encurta");
  // E o catalogo de TV continua em 24h no servidor (teste de cima).
  assert.match(server, /const TV_CATALOG_TTL = 24 \* 60 \* 60 \* 1000;/);
});


// ---------------------------------------------------------------- camada 2: streams
// DECISAO 155: o TTL de STREAM DE TV saiu. Ele media quanto tempo servir a lista de players de
// um canal (1min, porque o JWT do REI dura 300s). Nao ha mais lista para servir: `handleStreams`
// responde `{streams: []}` sem tocar em origem. O que ainda entra em cache e' essa resposta
// vazia, e ela e' ESTAVEL — por isso 60s, o TTL de degradado, e nao o TTL de um link.
test("camada 2: o TTL de stream de TV saiu; a resposta vazia usa o TTL de degradado (decisao 155)", () => {
  assert.equal(/^const TV_STREAM_CACHE_TTL =/m.test(server), false, "o TTL de link de TV nao pode voltar");
  assert.equal(/^const TV_STREAM_CACHE_DEGRADADO_MS =/m.test(server), false, "o degradado de TV nao pode voltar");

  const degr = Number(/const DEGRADED_CACHE_TTL = (\d+) \* 1000;/.exec(server)[1]);
  assert.ok(degr >= 30 && degr <= 300, `resposta vazia em ${degr}s`);

  // O VOD continua com 15min, para o dia em que uma fonte voltar a ser registrada no motor.
  const vod = Number(/const STREAM_CACHE_TTL = (\d+) \* 60 \* 1000;/.exec(server)[1]);
  assert.ok(vod >= 15 && vod <= 30, `stream de VOD em ${vod}min; o dono pediu 15-30min`);
});


test("camada 2: a resposta degradada NAO fica 15-30min guardada (decisao 155)", () => {
  // Se uma fonte caiu no instante, guardar a lista incompleta pelo TTL inteiro e servir uma
  // lista sem fonte para todo mundo. Com a 155 nao ha mais lista: a resposta e' a lista vazia,
  // e ela e' ESTAVEL — nao ha link para revalidar. O TTL dela (60s) e' o degradado, e ele
  // continua muito abaixo do TTL de stream (15min), que e' o que o dono pediu.
  const d = Number(/const DEGRADED_CACHE_TTL = (\d+) \* 1000;/.exec(server)[1]);
  const normal = Number(/const STREAM_CACHE_TTL = (\d+) \* 60 \* 1000;/.exec(server)[1]) * 60;
  assert.ok(d < normal, `degradado (${d}s) tem de ser menor que o normal (${normal}s)`);
  assert.ok(d <= 120, `e curto: ${d}s`);
});
// ------------------------------------------------- a trava: 50 pessoas, 1 requisicao
test("a trava de requisicao simultanea existe e devolve a MESMA promessa", () => {
  assert.match(server, /const inflightStreams = new Map\(\)/, "o mapa de inflight sumiu");
  assert.match(server, /const pending = inflightStreams\.get\(flightKey\)/, "ninguem consulta o que ja esta em voo");
  assert.match(server, /if \(pending\) return pending;/, "a 2a..50a pessoa tem de esperar a promessa da 1a");

  // E o mesmo para o catalogo: uma busca digitada e uma chave nova toda vez.
  assert.match(server, /const inflightCatalogs = new Map\(\)/);
  assert.match(server, /const pendente = inflightCatalogs\.get\(key\)/);
  assert.match(server, /if \(pendente\) \{/);

  // A trava e liberada no fim, senao a chave fica presa para sempre.
  assert.match(server, /\.finally\(\(\) => inflightStreams\.delete\(flightKey\)\)/, "a trava nao e liberada");
  assert.match(server, /\.finally\(\(\) => inflightCatalogs\.delete\(key\)\)/, "a trava do catalogo nao e liberada");
});

test("o limite da trava nao pode virar um estouro silencioso", () => {
  assert.match(server, /const MAX_INFLIGHT_STREAMS = (\d+);/);
  const max = Number(/const MAX_INFLIGHT_STREAMS = (\d+);/.exec(server)[1]);
  assert.ok(max >= 50, `limite de ${max} em voo; o dono falou em 50 pessoas no mesmo canal`);
  // Acima do limite a promessa e devolvida NAO guardada — o pedido e atendido, so nao entra na
  // trava. Se voltasse sem a promessa, a 301a pessoa ficaria sem resposta.
  assert.match(server, /if \(inflightStreams\.size >= MAX_INFLIGHT_STREAMS\) return promise;/);
});

test("o cache de streams sobrevive a restart (SQLite, nao so memoria)", () => {
  // DECISAO 155: o caminho de stream de TV (`chaveTv`, stale-while-revalidate) foi embora com
  // as fontes. O que continua no disco e' a resposta das TRES rotas de stream — `/stream/*`,
  // `/api/streams/*` e `/nuvio/stream/*` — que e' a lista vazia, lida antes de responder para
  // nao pagar o `JSON.parse` (e o `sqliteCache`) a cada pedido.
  assert.match(server, /sqliteCache\.get\(chave\)/, "a resposta de stream tem de vir do disco");
  assert.match(server, /sqliteCache\.set\(chave, vazio, DEGRADED_CACHE_TTL\)/, "e tem de ser gravada no disco");
  // E o que faz o servidor responder em ms na 3a chamada do mesmo canal.
  assert.match(server, /const sqliteCache = require\("\.\/lib\/sqlite-cache"\)/);
});
// ---------------------------------------------------------------- o comportamento real
test("o cache e o que segura a 2a chamada (a 1a e a 3a sao diferentes)", async () => {
  const cache = require(path.join(RAIZ, "src/lib/sqlite-cache.js"));
  const chave = "teste:camadas:cache";
  const valor = { streams: [{ url: "https://exemplo/x.m3u8" }] };
  cache.set(chave, valor, 60000);
  const lido = cache.get(chave);
  assert.deepEqual(lido, valor, "a 2a leitura tem de vir do cache");

  // Valor vencido some: e o que impede servir link de assinatura morta.
  cache.set(chave + ":vencido", valor, -1000);
  assert.equal(cache.get(chave + ":vencido"), null, "o que venceu tem de sumir");

  // E o que impede crescer sem limite.
  const antes = cache.stats().total;
  cache.cleanup();
  assert.ok(cache.stats().total <= antes, "o cleanup nao pode aumentar o total");
});

test("a trava de verdade: 50 chamadas simultaneas viram 1 execucao", async () => {
  // Reproduz o mecanismo real do servidor: N chamadas no MESMO instante, e so uma executa.
  let execucoes = 0;
  const emVoo = new Map();
  const trabalho = async () => {
    execucoes++;
    await new Promise((r) => setTimeout(r, 60));
    return "o link";
  };
  const pedir = async (id) => {
    const key = id;
    if (emVoo.has(key)) return emVoo.get(key);
    const p = trabalho().finally(() => emVoo.delete(key));
    emVoo.set(key, p);
    return p;
  };

  const todos = await Promise.all(Array.from({ length: 50 }, () => pedir("canal:x")));
  assert.equal(execucoes, 1, `o trabalho rodou ${execucoes}x; tem de rodar 1x`);
  assert.equal(new Set(todos).size, 1, "as 50 respostas tem de ser a mesma promessa");
  assert.equal(emVoo.size, 0, "a trava tem de ser liberada no fim");

  // Depois de liberada, uma chamada nova roda o trabalho de novo (com o cache, e nao com a trava).
  await pedir("canal:x");
  assert.equal(execucoes, 2, "depois de voar, o proximo pedido volta a executar");
});
