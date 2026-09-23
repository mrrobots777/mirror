// O plugin do Nuvio (nuvio/) — as pecas que decidem se o player abre o video certo.
//
// Tudo aqui e' SEM rede: o `global.fetch` e substituido por um duplo que responde o
// formato de cada salto da cadeia. O que se trava e' o CONTRATO, nao a origem:
//
//   1. `sinaliza()` — o Nuvio tira o MIME do caminho da URL, depois da query
//      (`PlayerMediaSourceFactory.kt`), e o `proxyHeaders.response` e sempre nulo para
//      scraper. O REI entrega a playlist como `.../__index.txt` com `content-type:
//      text/plain`; sem o aviso `format=m3u8` o player trata o manifesto como arquivo
//      progressivo e o video nao abre. Medido: sem o aviso a inferencia dizia `.txt`
//      (progressivo) para rei/emb.
//   2. a REPROVA lenta (decisao do REI) — a origem do REI leva **10,2s** para responder
//      404 num canal morto. Com o probe de 8s o fetch estourava, o erro subia, e o canal
//      aparecia como "fonte com erro" em vez de "sem fonte" (medido: 1041/1101 lancando
//      `timeout de 8000ms`). O probe tem de caber essa medicao.
//   3. a reserva do painel ATO — `player_api.php` devolve 235 B de "Welcome to nginx!"
//      para IP de datacenter e o MESMO pedido pelo worker devolve o JSON de verdade
//      (medido 02/10/2026). O worker e' derivado da sigla, nunca escrito a mao.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { sinaliza } = require("../nuvio/src/lib/hls");
const painel = require("../nuvio/src/lib/painel");

const RAIZ = path.join(__dirname, "..", "nuvio", "src");

function fonte(nome) {
  return fs.readFileSync(path.join(RAIZ, "scrapers", nome), "utf8");
}

// ---------------------------------------------------------------------------
// 1. sinaliza()
// ---------------------------------------------------------------------------

test("sinaliza: o player so le a URL, entao o formato tem de estar nela", () => {
  // Quem JA diz o formato nao muda: repetir o aviso criaria `?format=m3u8` duas vezes
  // e a query depende da origem aceitar o parametro.
  assert.strictEqual(sinaliza("https://cdn.test/live.m3u8?token=1"), "https://cdn.test/live.m3u8?token=1");
  assert.strictEqual(sinaliza("https://cdn.test/live.m3u8"), "https://cdn.test/live.m3u8");
  assert.strictEqual(sinaliza("https://cdn.test/x.m3u8?token=1&format=m3u8"), "https://cdn.test/x.m3u8?token=1&format=m3u8");
  // Chave certa com valor de manifesto ja conta como aviso.
  assert.strictEqual(sinaliza("https://cdn.test/a?ext=m3u8"), "https://cdn.test/a?ext=m3u8");
  assert.strictEqual(sinaliza("https://cdn.test/a?type=hls"), "https://cdn.test/a?type=hls");
  // E' idempotente: rodar duas vezes nao muda a URL (o mesmo stream pode ser reconstruido).
  const uma = sinaliza("https://xn--host/docs/avelar62/__index.txt?token=abc");
  assert.strictEqual(sinaliza(uma), uma);
  assert.match(uma, /\?token=abc&format=m3u8$/, "a query existente e preservada e o aviso vai no fim");
  // Caminho sem query ganha `?`.
  assert.strictEqual(sinaliza("https://host/docs/x.txt"), "https://host/docs/x.txt?format=m3u8");
  // Arquivo de VIDEO nao recebe aviso de manifesto: o caminho ja diz o formato, e mentir
  // para a origem so abre margem para erro.
  assert.strictEqual(sinaliza("https://host/movie/u/p/603.mp4"), "https://host/movie/u/p/603.mp4");
  assert.strictEqual(sinaliza("https://host/seg.ts?x=1"), "https://host/seg.ts?x=1");
  // Chave de formato com valor que NAO e formato ("?stream=123" e um id) nao conta como aviso.
  assert.strictEqual(sinaliza("https://host/x.txt?stream=123"), "https://host/x.txt?stream=123&format=m3u8");
  // URL nula/vazia volta igual (nada e' montado em cima de undefined).
  assert.strictEqual(sinaliza(""), "");
  assert.strictEqual(sinaliza(null), null);
});

// ---------------------------------------------------------------------------
// 2. os 4 scrapers de TV emitem URL sinalizada
// ---------------------------------------------------------------------------

test("os 4 scrapers de TV passam a URL do stream pelo sinaliza", () => {
  for (const nome of ["reidosembeds.js", "embedtv.js", "embedcanais.js", "reidoscanais.js"]) {
    const src = fonte(nome);
    assert.match(src, /require\("\.\.\/lib\/hls"\)/, `${nome} nao importa o sinaliza`);
    // Toda saida de stream e `url:` dentro de um array-literal de stream; nenhuma pode
    // entregar a URL crua da origem.
    const crus = src.match(/url:\s*(?!sinaliza\()[a-zA-Z][^\n]*/g) || [];
    const permitido = /url:\s*(?:String\(r\.url|url\b|hls\.url)/;
    assert.deepEqual(
      crus.filter((l) => !permitido.test(l)),
      [],
      `${nome}: stream saindo sem sinaliza -> ${crus.filter((l) => !permitido.test(l)).join(" | ")}`
    );
  }
});

test("sinaliza nos pontos de saida dos 4 (e so la)", () => {
  // O `sinaliza` tem de estar EXATAMENTE no `url:` do objeto de stream — um require
  // sem uso passaria no teste de cima e deixaria a URL crua no player.
  for (const nome of ["reidosembeds.js", "embedtv.js", "embedcanais.js", "reidoscanais.js"]) {
    const src = fonte(nome);
    assert.match(src, /url:\s*sinaliza\(/, `${nome}: o url do stream nao passa pelo sinaliza`);
  }
  // E o import nao pode faltar onde ha saida.
  assert.match(fonte("reidoscanais.js"), /const \{ sinaliza \} = require\("\.\.\/lib\/hls"\);/);
});

// ---------------------------------------------------------------------------
// 3. o orcamento da REPROVA do REI
// ---------------------------------------------------------------------------

test("o probe da playlist do REI cabe a origem que responde 404 em 10,2s", () => {
  const src = fonte("reidosembeds.js");
  const pega = (nome) => {
    const m = src.match(new RegExp(`const ${nome} = (\\d+)e3`));
    return m ? Number(m[1]) * 1000 : null;
  };
  const ms = pega("MS");
  const playlist = pega("MS_PLAYLIST");
  const teto = pega("TETO_MS");
  assert.ok(ms === 8000, `MS = ${ms} — o salto da cadeia continua com 8s`);
  // MEDIDO: a origem do REI leva 10,2s para devolver 404 num canal morto. Com um probe
  // de 8s o fetch estourava e o erro subia como "fonte com erro" (1041/1101: `timeout de
  // 8000ms`), em vez de uma lista vazia honesta.
  assert.ok(playlist >= 10200, `MS_PLAYLIST = ${playlist} — tem de cobrir os 10,2s medidos`);
  assert.ok(teto > playlist, `TETO_MS = ${teto} tem de deixar o probe inteiro rodar`);
  // O teto tem de caber cadeia + probe SEM estourar os 60s do PluginRuntime do Nuvio
  // (PLUGIN_TIMEOUT_MS) — e nao pode ser tao grande que uma fonte morta prenda o chip.
  assert.ok(teto <= 30000, `TETO_MS = ${teto} — acima disso o canal morto segura o chip por meio minuto`);
  // O probe usa o orcamento RESTANTE do sandbox (restante), nao o `p.ms()` que trunca em 8s.
  assert.match(src, /ms:\s*restante\(p,\s*MS_PLAYLIST\)/, "o probe tem de poder passar de 8s");
});

test("o REI nao emite Referer no stream (a origem responde 403 com Referer errado)", () => {
  // MEDIDO: o `__index.txt` responde 200 SEM Referer e 403 com Referer errado. O Nuvio
  // so manda `proxyHeaders` quando o scraper declara `headers`, entao declarar qualquer
  // Referer erraria o pedido — o canal sumiria do player.
  const src = fonte("reidosembeds.js");
  assert.equal(/headers:\s*\{[^}]*Referer/.test(src.split("module.exports.getStreams")[1] || ""), false,
    "o stream do REI nao pode trazer headers");
});

// A cadeia do REI com a origem FALSA: cada salto responde o formato do salto de verdade,
// e o que se prova e' a DECISAO do fim da linha — o que vira lista vazia e o que vira erro.
// (A diferenca e' o chip da tela: "sem fonte" contra "fonte com erro".)
function origemFalsa(opcoes) {
  const o = opcoes || {};
  const chamadas = [];
  const resp = (status, corpo) => ({
    ok: status >= 200 && status < 300,
    status,
    url: "https://dupla/",
    text: async () => corpo,
    headers: { get: () => null },
  });
  const fetch = async (url) => {
    const u = String(url);
    chamadas.push(u);
    if (o.rede && o.rede.test(u)) throw new Error("fetch failed");
    if (u.startsWith("https://v2.rdembed.sbs/")) {
      if (o.embedStatus) return resp(o.embedStatus, "sem cadeia");
      return resp(200, '<div class="box"><iframe src="https://play.test/__play/hbo?pt=abc"></iframe></div>');
    }
    if (u.startsWith("https://play.test/")) return resp(200, '<iframe src="https://player.test/embed/1"></iframe>');
    if (u.startsWith("https://player.test/")) return resp(200, 'var sources = [{"src":"https://cdn.test/live.txt"}];');
    if (u.startsWith("https://cdn.test/")) return resp(o.playlistStatus || 404, o.playlistStatus === 200 ? "#EXTM3U\n#EXT-X-TARGETDURATION:7\n#EXTINF:7.0,\nseg1.ts\n" : "not found");
    throw new Error(`url fora do roteiro: ${u}`);
  };
  return { fetch, chamadas };
}

async function comOrigem(opcoes, fn) {
  const original = global.fetch;
  const dupla = origemFalsa(opcoes);
  global.fetch = dupla.fetch;
  try {
    return await fn(dupla);
  } finally {
    global.fetch = original;
  }
}

test("REI: playlist viva vira stream com o formato sinalizado na URL", async () => {
  await comOrigem({ playlistStatus: 200 }, async (dupla) => {
    const rei = require("../nuvio/src/scrapers/reidosembeds");
    const lista = await rei.getStreams("1140", "channel", null, null);
    assert.strictEqual(lista.length, 1, "a cadeia resolveu e a playlist tem segmento");
    assert.strictEqual(lista[0].name, "REI");
    assert.match(lista[0].title, /HBO/, "o titulo vem do canal do catalogo");
    // O caminho termina em `.txt` com `content-type: text/plain` — sem o aviso o Nuvio
    // trata o manifesto como arquivo progressivo (medido em tools/mime.js).
    assert.strictEqual(lista[0].url, "https://cdn.test/live.txt?format=m3u8");
    // E o stream nao declara cabecalho nenhum: a origem devolve 403 com Referer errado.
    assert.equal(lista[0].headers, undefined);
  });
});

test("REI: playlist que responde 404 vira lista vazia, e nao erro de fonte", async () => {
  await comOrigem({ playlistStatus: 404 }, async (dupla) => {
    const rei = require("../nuvio/src/scrapers/reidosembeds");
    const lista = await rei.getStreams("1140", "channel", null, null);
    assert.deepEqual(lista, [], "a origem RESPONDEU e nao tem playlist: e' lista vazia");
    // A segunda tentativa (o `src` deles rotaciona) roda porque sobrou orcamento.
    const sondas = dupla.chamadas.filter((u) => u.startsWith("https://cdn.test/"));
    assert.ok(sondas.length >= 2, `a cadeia tem de ser refazida uma vez (sondas: ${sondas.length})`);
  });
});

test("REI: 404 na cadeia tambem e lista vazia (a origem respondeu)", async () => {
  await comOrigem({ embedStatus: 404 }, async () => {
    const rei = require("../nuvio/src/scrapers/reidosembeds");
    assert.deepEqual(await rei.getStreams("1140", "channel", null, null), []);
  });
});

test("REI: falha de REDE sobe como erro — nunca vira lista vazia", async () => {
  // A regra da decisao 131: so o que foi de fato consultado e veio vazio vira `[]`.
  // Rede, timeout e 5xx sobem, para o cliente marcar a fonte como degradada em vez de
  // guardar "esse canal nao tem nada".
  await comOrigem({ rede: /v2\.rdembed\.sbs/ }, async () => {
    const rei = require("../nuvio/src/scrapers/reidosembeds");
    await assert.rejects(() => rei.getStreams("1140", "channel", null, null), /fetch failed|falha de rede/);
  });
});

// ---------------------------------------------------------------------------
// 4. a reserva do painel ATO (worker derivado da sigla)
// ---------------------------------------------------------------------------

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
