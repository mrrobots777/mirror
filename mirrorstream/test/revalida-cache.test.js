// Revalidacao do cache de stream: quando um link guardado morre, a entrada tem que ser
// invalida — e NUNCA no caminho da resposta.
//
// O buraco que ela fecha (medido em 29/09/2026, producao): a prova de vida roda quando a lista e
// MONTADA, mas o cache de stream vive 15 minutos. Um link que morreu aos 3 minutos continuava
// sendo entregue por mais 12 — foi assim que o VZR apareceu com 2 links mortos na auditoria
// (`Dark` e `Round 6`), sendo que o proprio scraper ja se protege e lanca
// `vizer nao entrega o arquivo (HTTP 403)`.
const assert = require("node:assert");
const test = require("node:test");

const pv = require("../src/lib/prova-viva");
const original = pv.provaDe;

// O teste precisa da espera: a agenda roda em segundo plano.
function espera(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function comSonda(falsa, fn) {
  pv.provaDe = falsa;
  return Promise.resolve()
    .then(fn)
    .then(() => espera(260))
    .finally(() => { pv.provaDe = original; });
}

test("revalida: nada acontece com lista vazia, nula ou sem links", async () => {
  const { agendaRevalidacao } = require("../src/lib/revalida-cache");
  const apagadas = [];
  agendaRevalidacao("vazia", { streams: [] }, (k) => apagadas.push(k));
  agendaRevalidacao("nula", null, (k) => apagadas.push(k));
  agendaRevalidacao("semUrl", { streams: [{ titulo: "sem url" }] }, (k) => apagadas.push(k));
  await espera(120);
  assert.deepStrictEqual(apagadas, [], "nada foi invalidado");
});

test("revalida: se a lista do cache esta saudavel, o cache fica", async () => {
  const { agendaRevalidacao, stats } = require("../src/lib/revalida-cache");
  const antes = stats().entradasInvalidadas;
  const apagadas = [];
  await comSonda(async () => ({ vivo: true }), () => {
    agendaRevalidacao("saudavel", { streams: [{ url: "https://cdn/a.m3u8" }] }, (k) => apagadas.push(k));
  });
  assert.deepStrictEqual(apagadas, [], "cache saudavel nao foi jogado fora");
  assert.strictEqual(stats().entradasInvalidadas, antes, "contador de invalidacao nao subiu");
});

test("revalida: um link morto INVALIDA a entrada do cache", async () => {
  const { agendaRevalidacao, stats } = require("../src/lib/revalida-cache");
  const apagadas = [];
  const antes = stats().entradasInvalidadas;
  await comSonda(async (url) => (url.includes("morto") ? { vivo: false, motivo: "HTTP 404" } : { vivo: true }), () => {
    agendaRevalidacao("comMorto", {
      streams: [{ url: "https://cdn/ok.m3u8" }, { url: "https://cdn/morto.m3u8" }],
    }, (k) => apagadas.push(k));
  });
  assert.ok(apagadas.includes("comMorto"), `a entrada foi invalida (veio ${JSON.stringify(apagadas)})`);
  assert.strictEqual(stats().entradasInvalidadas, antes + 1);
});

test("revalida: 'nao deu para saber' NAO invalida (link lento continua valendo)", async () => {
  const { agendaRevalidacao, stats } = require("../src/lib/revalida-cache");
  const apagadas = [];
  const antes = stats().entradasInvalidadas;
  await comSonda(async () => ({ vivo: null, motivo: "timeout" }), () => {
    agendaRevalidacao("incerto", { streams: [{ url: "https://cdn/lento.m3u8" }] }, (k) => apagadas.push(k));
  });
  assert.deepStrictEqual(apagadas, [], "veredito desconhecido nao condena o cache");
  assert.strictEqual(stats().entradasInvalidadas, antes, "contador nao subiu");
});

test("revalida: a mesma chave nao agenda duas checagens em paralelo", async () => {
  const { agendaRevalidacao } = require("../src/lib/revalida-cache");
  let chamadas = 0;
  const apagadas = [];
  await comSonda(async () => { chamadas++; return { vivo: true }; }, () => {
    const lista = { streams: [{ url: "https://cdn/um.m3u8" }] };
    agendaRevalidacao("mesma", lista, (k) => apagadas.push(k));
    agendaRevalidacao("mesma", lista, (k) => apagadas.push(k));
    agendaRevalidacao("mesma", lista, (k) => apagadas.push(k));
  });
  assert.strictEqual(chamadas, 1, `a sonda rodou ${chamadas}x — deveria ser 1`);
  assert.deepStrictEqual(apagadas, []);
});
