const assert = require("node:assert");
const test = require("node:test");

const { createEngine, erroTransitorio } = require("../src/lib/scraper-engine");

const CTX = { kind: "anime", type: "series", title: "Naruto", episode: 1, season: 1, key: "k" };

function fonte(id, run, extra) {
  const e = createEngine();
  e.use(Object.assign({ id, kind: "anime", timeoutMs: 5000, run }, extra || {}));
  return e;
}

test("motor: tropeco de rede na 1a chamada e recuperado na 2a", async () => {
  let n = 0;
  const e = fonte("x", () => {
    n++;
    if (n === 1) { throw new Error("socket hang up"); }
    return [{ url: "https://cdn/a.m3u8", sources: ["x"] }];
  });
  const r = await e.fanOut(CTX);
  assert.strictEqual(r.streams.length, 1, "devolveu o stream");
  assert.strictEqual(n, 2, "chamou 2 vezes");
  assert.strictEqual(r.failures.length, 0, "nao contou como falha");
  assert.strictEqual(e.stats().retries, 1, "retry registrado");
  assert.strictEqual(e.stats().bySource.x.failed, 0, "falha nao abriu o disjuntor");
});

test("motor: timeout NAO e refeito (o orcamento do pedido ja foi)", async () => {
  let n = 0;
  // O timer do `withTimeout` tem `unref()` (padrao do projeto: nao segurar o event loop). Num
  // servidor isso nao importa, porque o HTTP segura o processo; no teste o loop secaria antes do
  // timeout, entao o teste precisa do proprio beacon.
  const beacon = setInterval(() => {}, 30);
  try {
    const e = fonte("x", () => {
      n++;
      return new Promise(() => {});
    }, { timeoutMs: 120 });
    const r = await e.fanOut(CTX);
    assert.strictEqual(n, 1, "chamou so uma vez");
    assert.strictEqual(r.streams.length, 0);
    assert.strictEqual(e.stats().retries, 0, "nenhum retry");
    assert.strictEqual(e.stats().bySource.x.timeout, 1, "contou como timeout, nao como falha");
    assert.strictEqual(e.stats().bySource.x.failed, 0, "timeout nao abre disjuntor");
  } finally {
    clearInterval(beacon);
  }
});

test("motor: lista vazia NAO e refeita (resposta legitima)", async () => {
  let n = 0;
  const e = fonte("x", () => { n++; return []; });
  await e.fanOut(CTX);
  assert.strictEqual(n, 1, "uma chamada so");
  assert.strictEqual(e.stats().retries, 0);
});

test("motor: erro permanente NAO e refeito", async () => {
  let n = 0;
  const e = fonte("x", () => { n++; throw new Error("nao encontrei o titulo no catalogo"); });
  await e.fanOut(CTX);
  assert.strictEqual(n, 1);
  assert.strictEqual(e.stats().retries, 0);
  assert.strictEqual(e.stats().bySource.x.failed, 1);
});

test("motor: falha transitoria que nunca passa nao entra em laco", async () => {
  let n = 0;
  const e = fonte("x", () => { n++; throw new Error("ECONNRESET"); });
  await e.fanOut(CTX);
  assert.strictEqual(n, 2, "tenta uma vez e desiste");
  assert.strictEqual(e.stats().bySource.x.failed, 1, "conta UMA falha, nao duas");
});

test("motor: 3 falhas abrem o disjuntor e a fonte sai da lista", async () => {
  let n = 0;
  const e = fonte("x", () => { n++; throw new Error("ECONNRESET"); });
  for (let k = 0; k < 3; k++) await e.fanOut(Object.assign({}, CTX, { key: "k" + k }));
  assert.strictEqual(n, 6, "3 chamadas x 2 tentativas");
  assert.strictEqual(e.stats().openBreakers.length, 1, "disjuntor aberto");
  const depois = await e.fanOut(Object.assign({}, CTX, { key: "outro" }));
  assert.strictEqual(depois.streams.length, 0);
  assert.strictEqual(n, 6, "fonte com disjuntor aberto nao e chamada");
  assert.strictEqual(e.stats().bySource.x.skipped, 1);
});

test("motor: uma falha NAO derruba as outras fontes", async () => {
  const e = createEngine();
  e.use({ id: "ruim", kind: "anime", run: () => { throw new Error("HTTP 500"); } });
  e.use({ id: "bom", kind: "anime", run: () => [{ url: "https://cdn/b.m3u8" }] });
  const r = await e.fanOut(CTX);
  assert.strictEqual(r.streams.length, 1, "a boa entregou");
  assert.strictEqual(r.failures.length, 1, "a ruim falhou sozinha");
  assert.ok(r.streams[0].behaviorHints, "stream normalizado");
});

test("motor: erro marcado com semRetry nao e refeito", () => {
  const e = new Error("502");
  e.semRetry = true;
  assert.strictEqual(erroTransitorio(e), false);
});

test("motor: a classificacao de transitorio cobre o que acontece de verdade", () => {
  for (const m of ["socket hang up", "ECONNRESET", "fetch failed", "HTTP 502", "503", "aborted", "EAI_AGAIN", "too many hosts"]) {
    assert.ok(erroTransitorio(new Error(m)), `deveria ser transitorio: ${m}`);
  }
  for (const m of ["nao encontrei o titulo", "HTTP 404", "animesdigital: nenhum video extraido", "rotd bloqueado (turnstile)"]) {
    assert.ok(!erroTransitorio(new Error(m)), `NAO deveria ser transitorio: ${m}`);
  }
  const t = new Error("x: timeout 8000ms");
  t.timeout = true;
  assert.strictEqual(erroTransitorio(t), false, "timeout nao e transitorio por definicao");
});
