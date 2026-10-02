// A regra que resolve "tela branca + barulho ensurdecedor" em filme.
//
// MEDIDO em 29/09/2026, producao: 3 de 23 arquivos de painel eram H.265. Celular e TV que nao
// decodificam H.265 mostram a tela branca e continuam tocando SO O AUDIO — e audio
// reinterpretado na taxa errada e o barulho. Nao era painel quebrado nem player: o addon
// entregava codec que so parte dos aparelhos abre.
const assert = require("node:assert");
const test = require("node:test");

const { applyProbeFilters } = require("../src/scrapers/xtream");

const c = (codec, extra) => ({ item: { name: "X" }, probe: Object.assign({ alive: true, size: 0, durationSec: 0, codec }, extra || {}) });
const codecsDa = (lista) => applyProbeFilters(lista, 0).map((x) => (x.probe && x.probe.codec) || "sem");

test("codec: havendo H.264, e ele que fica (HEVC, VP9 e AV1 saem)", () => {
  assert.deepStrictEqual(
    codecsDa([c("hevc"), c("h264"), c("vp9"), c("av1")]),
    ["h264"],
    "a lista de um filme so pode ter o codec universal"
  );
});

test("codec: se TODOS forem de codec fechado, todos ficam", () => {
  // Aparelho novo decodifica; melhor um link que funciona na maioria do que nenhum link.
  assert.deepStrictEqual(codecsDa([c("hevc"), c("vp9")]), ["hevc", "vp9"]);
});

test("codec: sem prova de codec nao se condena ninguem", () => {
  // A ordem da lista e preservada; o que importa e que o sem-codec nao foi descartado.
  assert.deepStrictEqual(codecsDa([c(null), c("h264")]), ["sem", "h264"]);
  assert.deepStrictEqual(codecsDa([c(null), c(null)]), ["sem", "sem"]);
});

test("codec: a regra vale junto com a de link morto", () => {
  const morto = { item: { name: "M" }, probe: { alive: false, size: 0, durationSec: 0, codec: "h264" } };
  const out = applyProbeFilters([morto, c("hevc"), c("h264")], 0);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].probe.codec, "h264");
});

test("peek: o cliente HTTP le so o comeco de um arquivo gigante", async () => {
  // O painel kakito responde 200 com o arquivo inteiro mesmo pedindo faixa (medido: 1,3GB), e
  // por isso a sonda nunca tinha cabecalho para ler. O `peekBytes` resolve sem custo extra.
  const { browserFetch } = require("../src/lib/scraper-utils");
  const http = require("node:http");
  const local = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(50 * 1024 * 1024) });
    const bloco = Buffer.alloc(64 * 1024, 7);
    let enviados = 0;
    while (enviados < 8 * 1024 * 1024) { res.write(bloco); enviados += bloco.length; }
    res.end();
  });
  await new Promise((r) => local.listen(0, "127.0.0.1", r));
  const porta = local.address().port;
  try {
    const r = await browserFetch(`http://127.0.0.1:${porta}/a.mp4`, { timeout: 8000, peekBytes: 131072 });
    const buf = await r.buffer();
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get("content-length"), String(50 * 1024 * 1024), "o servidor jurou 50MB");
    // Corta em ~128KB (o pedaco chega inteiro, entao pode ficar um pouco abaixo do pedido).
    assert.ok(buf.length > 100 * 1024, `leu ${buf.length} bytes — leu demais para ser um peek`);
    assert.ok(buf.length <= 1024 * 1024, `leu ${buf.length} bytes — o peek nao cortou`);
  } finally {
    local.close();
  }
});
