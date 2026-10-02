// O ORCAMENTO DE TEMPO do plugin — `src/lib/http.js`.
//
// Tudo aqui e' SEM rede: o `global.fetch` e' um duplo que devolve um corpo que so
// termina depois do prazo. E' o defeito que a medicao de 02/10/2026 encontrou.
//
// O QUE ERA O DEFETO: `pegar` resolvia `Promise.race([fetch, estouro])`, que termina
// quando os HEADERS chegam, e limpava o relogio no `finally`. O `res.text()` ficava
// sem nenhum limite. MEDIDO no DGO (`forks-doramas.madfirebox.shop`): headers em
// 0,23 s e corpo de 24 KB pronto em 15,1 s — entao a fonte pagava 15,6 s com um teto
// de 8 s, e o `getStreams` podia passar do orcamento do Nuvio sem ninguem perceber.
// Depois da correcao a mesma fonte levou 5,6 s e ainda entregou o link.
const test = require("node:test");
const assert = require("node:assert");

const http = require("../../plugin/src/lib/http");

function comFetch(duplo, fn) {
  const anterior = globalThis.fetch;
  globalThis.fetch = duplo;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = anterior;
    });
}

// Cabecalho na hora, corpo que so resolve depois de `demorar` ms.
function corpoLento(demorar, corpo) {
  return (_url, init) => {
    const ctrl = init && init.signal;
    let pronto = false;
    const timer = setTimeout(() => {
      pronto = true;
    }, demorar);
    if (ctrl) {
      ctrl.addEventListener("abort", () => clearTimeout(timer), { once: true });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      url: "https://exemplo.test/x",
      redirected: false,
      type: "basic",
      headers: new Map([["content-type", "application/json"]]),
      text: () => new Promise((res, rej) => {
        const t2 = setTimeout(() => res(corpo === undefined ? '{"ok":true}' : corpo), demorar);
        if (ctrl) {
          ctrl.addEventListener("abort", () => {
            clearTimeout(t2);
            rej(new Error("aborted"));
          }, { once: true });
        }
      }),
      json: () => JSON.parse(corpo === undefined ? '{"ok":true}' : corpo),
      arrayBuffer: () => new Promise((res) => setTimeout(() => res(new Uint8Array(0)), demorar)),
      blob: () => new Promise((res) => setTimeout(() => res(null), demorar))
    });
  };
}

test("pegar: o prazo cobre o CORPO, nao so os cabecalhos", async () => {
  await comFetch(corpoLento(5000), async () => {
    const t0 = Date.now();
    await assert.rejects(
      () => http.pegarTexto("https://exemplo.test/x", { ms: 400 }),
      /timeout de 400ms/
    );
    const gasto = Date.now() - t0;
    assert.ok(gasto < 3000, `estourou o prazo: ${gasto}ms com teto de 400ms`);
  });
});

test("pegarTexto: corpo dentro do prazo volta inteiro", async () => {
  await comFetch(corpoLento(10, '{"ok":true}'), async () => {
    const r = await http.pegarTexto("https://exemplo.test/x", { ms: 2000 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.texto, '{"ok":true}');
  });
});

test("pegarJson: prazo no corpo tambem vale para o JSON", async () => {
  await comFetch(corpoLento(5000, '{"ok":true}'), async () => {
    const t0 = Date.now();
    await assert.rejects(() => http.pegarJson("https://exemplo.test/x", { ms: 400 }), /timeout de 400ms/);
    assert.ok(Date.now() - t0 < 3000, "o JSON nao respeitou o prazo");
  });
});

test("pegar: a resposta embrulhada continua expondo o que o plugin usa", async () => {
  await comFetch(corpoLento(5, "texto"), async () => {
    const r = await http.pegar("https://exemplo.test/x", { ms: 2000 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.url, "https://exemplo.test/x");
    assert.strictEqual(typeof r.headers.get, "function");
    assert.strictEqual(r.headers.get("content-type"), "application/json");
    assert.strictEqual(await r.text(), "texto");
  });
});

test("pegar: nada de relogio pendente depois da chamada (nao segura o processo)", async () => {
  await comFetch(corpoLento(5, "x"), async () => {
    const antes = process._getActiveHandles().length;
    await http.pegarTexto("https://exemplo.test/x", { ms: 1000 });
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(process._getActiveHandles().length <= antes + 1, "relogio ficou pendurado");
  });
});

test("pegar: duas leituras do mesmo corpo nao compartilham prazo", async () => {
  await comFetch(corpoLento(5, "texto"), async () => {
    const r = await http.pegar("https://exemplo.test/x", { ms: 2000 });
    assert.strictEqual(await r.text(), "texto");
    // Uma segunda leitura tem o SEU prazo (o metodo rearma o relogio).
    assert.strictEqual(await r.text(), "texto");
  });
});

test("pegar: erro de rede continua com a mensagem antiga", async () => {
  const duplo = () => Promise.reject(new Error("ECONNREFUSED"));
  await comFetch(duplo, async () => {
    await assert.rejects(() => http.pegar("https://exemplo.test/x", { ms: 500 }), /falha de rede em https:\/\/exemplo\.test\/x: ECONNREFUSED/);
  });
});