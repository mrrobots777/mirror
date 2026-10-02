// O WORKER DE BORDA — as regras de cache, testadas SEM REDE.
//
// Por que testar uma borda: as regras aqui nao sao preferences, sao **decisoes** que custaram
// dinheiro e confusao. Cada uma delas ja causou um defeito medido, e este arquivo carrega o
// motivo de cada linha:
//
//   - cachear STREAM -> devolve o mesmo link assinado para todo mundo, e o TTL dele nao
//     sobrevive a borda (decisao 49)
//   - cachear o catalogo COM `?date=` -> 1,1MB por dia, uma chave por dia (medido)
//   - cachear ERRO -> um 404 transitorio vira "o addon sumiu" por 4 horas (decisao 140)
//   - cachear `/health` -> uptime congelado (medido)
//
// O worker e' `.mjs` para o `import()` do Node conseguir carregar; o Cloudflare aceita os dois.
// O teste monta um `caches` falso e uma `fetch` falsa, entao nao ha rede nem Cloudflare.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
let worker;
const mod = async () => (worker ||= await import(path.join(RAIZ, "worker-borda.mjs")));

test("STREAM nunca vai para a borda — em nenhuma das tres formas", async () => {
  const { classifica } = await mod();
  for (const u of [
    "/stream/movie/tmdb:603.json",
    "/stream/tv/tv:live:hbo.json",
    "/pt/stream/series/tt0944947:1:1.json",
    "/api/streams/movie/603",
    "/api/streams/tv/hbo",
    "/nuvio/stream/channel/hbo"
  ]) {
    const r = classifica(u, "");
    assert.strictEqual(r.cache, false, `${u} NAO pode ser cacheado — e' link de video`);
  }
});

test("o catalogo com ?date= nao vai: 1,1MB por dia, uma chave por dia", async () => {
  const { classifica } = await mod();
  const semData = classifica("/catalog/tv/mirror-tv-live.json", "");
  const comData = classifica("/catalog/tv/mirror-tv-live.json", "?date=2026-10-02");

  assert.strictEqual(semData.cache, true, "sem data, o catalogo DEVE ir para a borda");
  assert.strictEqual(comData.cache, false, "com data, 1,1MB por dia nao vale uma chave por dia");
  assert.match(comData.motivo, /1,1MB/);
  assert.notStrictEqual(semData.chave, comData.chave, "a query precisa entrar na chave");
});

test("erro nunca e' guardado", async () => {
  const { deixaGuardar } = await mod();
  const res = (status, headers = {}) =>
    new Response("{}", { status, headers: { "content-type": "application/json", ...headers } });

  assert.strictEqual(deixaGuardar(res(200)), true, "200 JSON entra");
  for (const s of [400, 403, 404, 429, 500, 502, 503]) {
    assert.strictEqual(deixaGuardar(res(s)), false, `${s} NUNCA pode ficar guardado`);
  }
  // 304 fica de fora de proposito: `new Response(body, {status:304})` e' invalido no undici
  // (304 nao pode ter corpo), e o `fetch` da Cloudflare nunca entrega um 304 para o worker —
  // o cache responde antes. O que eu QUERIA testar era "so entra 2xx", e as linhas acima ja
  // provam isso.
  // HTML nao entra: e' pagina de erro da SDK, e foi o que o dono viu na tela.
  assert.strictEqual(
    deixaGuardar(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })),
    false,
    "pagina HTML nao e' dado de catalogo"
  );
  // Acima do teto de 512KB nao entra.
  assert.strictEqual(
    deixaGuardar(res(200, { "content-length": String(600 * 1024) })),
    false,
    "objeto acima de 512KB nao entra"
  );
});

test("diagnostico e paginas nao se congelam", async () => {
  const { classifica } = await mod();
  for (const u of ["/health", "/metrics", "/dashboard", "/install", "/tv", "/p2p/report"]) {
    assert.strictEqual(classifica(u, "").cache, false, `${u} mudar com o tempo nao pode ser cacheado`);
  }
});

test("o que entra e com que TTL", async () => {
  const { classifica } = await mod();
  const casos = [
    ["/manifest.json", 300],
    ["/catalog/movie/top.json", 1800],
    ["/catalog/series/top.json", 1800],
    ["/meta/movie/tmdb:603.json", 900],
    ["/meta/tv/tv:live:hbo.json", 900],
    ["/nuvio/catalog/channel/tv.json", 1800],
    ["/nuvio/meta/channel/tv:live:hbo.json", 900],
    ["/api/channels", 600],
    ["/api/vod/genres", 600]
  ];
  for (const [u, ttl] of casos) {
    const r = classifica(u, "");
    assert.strictEqual(r.cache, true, `${u} deveria ir para a borda`);
    assert.strictEqual(r.ttl, ttl, `${u} com TTL ${r.ttl}, esperado ${ttl}`);
  }
});

test("a chave de cache inclui a query inteira", async () => {
  const { classifica } = await mod();
  // `?genre=` e `?search=` mudam o resultado: sem eles na chave, o primeiro pedido decide
  // para todo mundo. E `?date=` e `?skip=` sao o motivo de a chave ser a query CRUA.
  const a = classifica("/catalog/tv/mirror-tv-live.json", "?genre=Esportes");
  const b = classifica("/catalog/tv/mirror-tv-live.json", "?search=hbo");
  assert.notStrictEqual(a.chave, b.chave, "query diferentes tem chaves diferentes");
});

test("rota desconhecida nao e' cacheada — promessa de cache e' promessa", async () => {
  const { classifica } = await mod();
  const r = classifica("/rota/que/ninguem/conhece.json", "");
  assert.strictEqual(r.cache, false);
  assert.match(r.motivo, /nao classificada/);
});

test("o ciclo HIT -> revalidar -> MISS funciona, e a origem pode cair", async () => {
  const { mod: _ } = await mod();
  const w = (await mod()).default;

  // Um cache falso que conta e um `fetch` falso. Nenhuma rede.
  let guardados = new Map();
  const cacheFalso = {
    async match(k) { return guardados.get(k.url) || undefined; },
    async put(k, r) { guardados.set(k.url, r); }
  };

  let origemViva = true;
  let idas = 0;
  const respostaFalsa = () =>
    new Response('{"metas":[]}', { status: 200, headers: { "content-type": "application/json" } });

  globalThis.caches = { default: cacheFalso };
  const fetchAntigo = globalThis.fetch;
  globalThis.fetch = async () => {
    idas++;
    if (!origemViva) throw new Error("origem fora do ar");
    return respostaFalsa();
  };

  // O `ctx` falso precisa GUARDAR as promessas do `waitUntil`. A primeira versao fazia
  // `waitUntil: (p) => p.catch(()=>{})` e o teste esperava `ctx._p`, que nunca existiu — o
  // `await` era sobre `undefined`, ou seja, nao esperava nada, e a revalidacao "nao tinha ido
  // a origem" porque ainda nem tinha comecado.
  const pendentes = [];
  const ctx = { waitUntil: (p) => pendentes.push(Promise.resolve(p).catch(() => {})) };
  const esperar = () => Promise.all(pendentes.splice(0));
  const req = (u) => new Request("https://borda.example" + u);

  try {
    // 1. primeira vez: MISS, e guarda
    const r1 = await w.fetch(req("/catalog/tv/mirror-tv-live.json"), { ORIGEM: "https://origem" }, ctx);
    assert.strictEqual(r1.headers.get("X-Mirror-Borda"), "MISS");
    await esperar(); // deixa o PUT do cache terminar
    assert.strictEqual(guardados.size, 1, "o primeiro pedido tem que encher o cache");

    // 2. segunda vez: HIT, e revalida em segundo plano
    // O contador e' lido ANTES da chamada, e nao depois: a revadalidacao dentro do
    // `waitUntil` e' uma IIFE que comeca a rodar sincronamente e chama `fetch` antes do
    // primeiro `await`, entao o contador ja sobe durante o proprio `w.fetch`. Medir
    // "depois" da chamada e' medir depois da revalidacao e nunca ve a diferenca.
    const idasAntesDoHit = idas;
    const r2 = await w.fetch(req("/catalog/tv/mirror-tv-live.json"), { ORIGEM: "https://origem" }, ctx);
    assert.strictEqual(r2.headers.get("X-Mirror-Borda"), "HIT");
    await esperar();
    assert.ok(idas > idasAntesDoHit, "a revalidacao em segundo plano ainda vai a origem");

    // 3. A ORIGEM CAI. O HIT tem que continuar servindo — e' o objetivo do SWR.
    origemViva = false;
    const r3 = await w.fetch(req("/catalog/tv/mirror-tv-live.json"), { ORIGEM: "https://origem" }, ctx);
    assert.strictEqual(
      r3.status,
      200,
      "com a origem fora do ar, o cache tem que responder — senao o addon inteiro cai junto"
    );
    assert.strictEqual(r3.headers.get("X-Mirror-Borda"), "HIT");

    // 4. stream NUNCA passa pelo cache, nem com origem morta. E o erro tem de ser LIMPO:
    //    sem o try/catch no caminho sem cache, o worker LANCA e a Cloudflare devolve 1101
    //    ("Worker threw exception"), que e' opaco e nao diz que o problema e' da origem.
    const r4 = await w.fetch(req("/stream/tv/tv:live:hbo.json"), { ORIGEM: "https://origem" }, ctx);
    assert.notStrictEqual(r4.headers.get("X-Mirror-Borda"), "HIT", "stream nunca HIT");
    assert.strictEqual(r4.status, 503, "origem fora do ar = 503 limpo, nao exception");
    assert.strictEqual(r4.headers.get("X-Mirror-Borda"), "ORIGEM-FORA");
    const corpo = await r4.json();
    assert.match(corpo.dica || "", /origem/, "o erro tem que dizer que o problema e' da origem");

    // 5. e o MISS com cache vazio + origem morta tambem: 503, nao exception
    const r5 = await w.fetch(req("/meta/movie/tmdb:603.json"), { ORIGEM: "https://origem" }, ctx);
    assert.strictEqual(r5.status, 503, "sem cache e sem origem, 503 — nunca exception");
  } finally {
    globalThis.fetch = fetchAntigo;
    delete globalThis.caches;
  }
});

test("sem ORIGEM configurada o worker diz isso, e nao chinga a origem", async () => {
  const w = (await mod()).default;
  const ctx = { waitUntil: () => {} };
  const r = await w.fetch(new Request("https://borda.example/manifest.json"), {}, ctx);
  assert.strictEqual(r.status, 500);
  const j = await r.json();
  assert.match(j.error, /ORIGEM/);
});

test("o /__borda responde no proprio PoP, sem tocar na origem", async () => {
  const w = (await mod()).default;
  let chamou = false;
  const fetchAntigo = globalThis.fetch;
  globalThis.fetch = async () => { chamou = true; return new Response("{}"); };
  try {
    const r = await w.fetch(
      new Request("https://borda.example/__borda"),
      { ORIGEM: "https://e75602c18409-mirrorstream.baby-beamup.club" },
      { waitUntil: () => {} }
    );
    assert.strictEqual(r.status, 200);
    const j = await r.json();
    assert.strictEqual(j.ok, true);
    assert.match(j.origem, /mirrorstream/, "o diagnostico tem que dizer qual origem ele mira");
    assert.strictEqual(chamou, false, "o /__borda NAO pode ir na origem");
  } finally {
    globalThis.fetch = fetchAntigo;
  }
});