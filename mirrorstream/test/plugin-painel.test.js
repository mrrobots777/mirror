// O painel Xtream do plugin: a reserva pelo worker e o orcamento do detalhe.
//
// Este arquivo nasceu como `nuvio-fontes-tv.test.js` e cobria as 4 fontes de live TV
// do plugin. MEDIDO 02/10/2026: TV saiu do plugin (decisao do dono) — o catalogo de TV
// vem do addon MirrorView, que o Nuvio instala como addon. Duplicar as 4 fontes nos
// dois lugares daria duas versoes do mesmo player medindo diferente: o plugin roda do IP
// residencial do aparelho, o addon do IP de datacenter que varias origens recusam.
//
// O que estes testes PRENDEM continua inteiro e e' de `plugin/src/lib/painel.js`:
//   1. o worker e DERIVADO da sigla — nenhum `mirror-<fonte>` escrito a mao (decisao 124);
//   2. a recusa do ATO vira reserva, e a recusa nao se paga duas vezes (decisao 152);
//   3. 404 nao aciona a reserva — o item nao existe, nao ha o que perguntar ao worker.
//
// A cobertura das 4 fontes de TV volta no `mirrorview/test/`, do lado do servidor, na etapa
// que registra os players nele.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const painel = require("../../plugin/src/lib/painel");

const RAIZ = path.join(__dirname, "..", "..", "plugin", "src");

test("o worker e derivado da sigla — nenhum mirror-<fonte> escrito a mao no plugin", () => {
  assert.strictEqual(painel.workerDe("ato"), "https://mirror-ato.dev-avmirror.workers.dev");
  assert.strictEqual(painel.workerDe("blz"), "https://mirror-blz.dev-avmirror.workers.dev");
  // Sigla suja vira limpa (o registro usa minusculas, mas a chamada vem do painel).
  assert.strictEqual(painel.workerDe(" ATO "), "https://mirror-ato.dev-avmirror.workers.dev");
  // Sem sigla nao ha reserva e o chamador cai no erro direto — nunca numa URL montada a mao.
  assert.strictEqual(painel.workerDe(""), null);
  assert.strictEqual(painel.workerDe(null), null);
  assert.strictEqual(painel.urlProxiada("", "https://h/player_api.php"), null);

  const proxiada = painel.urlProxiada("ato", "https://h/player_api.php?username=u&password=p&action=get_vod_info");
  assert.strictEqual(proxiada,
    "https://mirror-ato.dev-avmirror.workers.dev/proxy?url=" +
    encodeURIComponent("https://h/player_api.php?username=u&password=p&action=get_vod_info"));

  // Varredura: o nome do worker so pode aparecer como template em painel.js.
  const problemas = [];
  const varre = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const cheio = path.join(dir, nome);
      if (fs.statSync(cheio).isDirectory()) { varre(cheio); continue; }
      if (!nome.endsWith(".js")) continue;
      const texto = fs.readFileSync(cheio, "utf8");
      for (const m of texto.matchAll(/mirror-[a-z0-9]+/g)) {
        problemas.push(`${path.relative(RAIZ, cheio)}: ${m[0]}`);
      }
    }
  };
  varre(RAIZ);
  assert.deepEqual(problemas, [], `worker escrito a mao: ${problemas.join(", ")}`);
});

test("o detalhe do ATO: recusa da origem vira reserva, e a recusa nao se paga duas vezes", async () => {
  const original = global.fetch;
  const chamadas = [];
  const resposta = (status, corpo) => ({
    ok: status >= 200 && status < 300,
    status,
    url: "https://x/",
    text: async () => corpo,
    headers: { get: () => null },
  });
  const json = JSON.stringify({ movie_data: [{ stream_id: 603, name: "Matrix" }], info: { tmdb_id: 603 } });
  const recusa = "<html><head><title>Welcome to nginx!</title></head><body>235 bytes</body></html>";

  let recusaDireto = true;
  global.fetch = async (url) => {
    const u = String(url);
    chamadas.push(u);
    if (u.includes("/proxy?url=")) return resposta(200, json);
    if (recusaDireto) return resposta(200, recusa);
    return resposta(500, "boom");
  };

  try {
    const p = { servidor: "4x4u29c.autos", porta: "443", usuario: "u", senha: "s", sigla: "ato" };
    // 1a: direto devolve a pagina de erro -> reserva devolve o JSON de verdade.
    const dados = await painel.infoDe(p, 603, 1000);
    assert.strictEqual(dados.info.tmdb_id, 603, "o JSON veio da reserva");
    assert.ok(chamadas[0].includes("4x4u29c.autos"), "primeiro e o direto");
    assert.ok(chamadas[1].includes("/proxy?url="), "depois a reserva pelo worker");

    // 2a: o direto e pulado (a recusa e politica da origem, nao tropeco) — 1 chamada so.
    chamadas.length = 0;
    recusaDireto = false;
    const deNovo = await painel.infoDe(p, 603, 1000);
    assert.strictEqual(deNovo.info.tmdb_id, 603);
    assert.strictEqual(chamadas.length, 1, "o direto ja sabido como recusado nao e pago de novo");
    assert.ok(chamadas[0].includes("/proxy?url="));
  } finally {
    global.fetch = original;
  }
});

test("a reserva NAO e usada quando a origem so nao tem o item (404)", async () => {
  const original = global.fetch;
  const chamadas = [];
  global.fetch = async (url) => {
    const u = String(url);
    chamadas.push(u);
    return { ok: false, status: 404, url: u, text: async () => "", headers: { get: () => null } };
  };
  try {
    const p = { servidor: "inexistente.invalid", porta: "443", usuario: "u", senha: "s", sigla: "zzz" };
    assert.strictEqual(await painel.infoDe(p, 1, 1000), null);
    assert.strictEqual(chamadas.length, 1, "404 e resposta da origem: nao ha o que a reserva refazer");
    assert.equal(chamadas[0].includes("/proxy?url="), false);
  } finally {
    global.fetch = original;
  }
});
