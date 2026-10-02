const assert = require("node:assert");
const test = require("node:test");

const H = require("../src/lib/html");
const ex = require("../src/lib/extrator");

// -------- interpretador de HTML --------

test("html: atributo com aspas, sem aspas e com aspas simples", () => {
  const doc = H.parse(`<video src="a.m3u8" data-x=b.m3u8 data-y='c.m3u8'></video>`);
  const v = H.um(doc, "video");
  assert.strictEqual(v.attrs.src, "a.m3u8");
  assert.strictEqual(v.attrs["data-x"], "b.m3u8");
  assert.strictEqual(v.attrs["data-y"], "c.m3u8");
});

test("html: tag sem fechar nao engole o resto", () => {
  const doc = H.parse(`<div class="a"><p>um<br>dois<img src=x.png><span>tres</span></div><b>quatro</b>`);
  assert.strictEqual(H.textoDe(H.um(doc, "b")), "quatro");
  assert.ok(H.um(doc, "br"), "tag vazia continua na arvore");
});

test("html: classe em qualquer ordem", () => {
  const doc = H.parse(`<i class="itemA title_anime ativo"></i><i class="outro"></i>`);
  assert.strictEqual(H.seleciona(doc, ".itemA").length, 1);
  assert.strictEqual(H.seleciona(doc, ".title_anime.ativo").length, 1);
});

test("html: script com HTML dentro nao vira elemento", () => {
  const doc = H.parse(`<script>var a = "<div class='falso'>"; if (x<3) {}</script><div class="real"></div>`);
  assert.strictEqual(H.seleciona(doc, ".falso").length, 0);
  assert.strictEqual(H.seleciona(doc, ".real").length, 1);
  assert.ok(H.um(doc, "script").children[0].text.includes("x<3"));
});

test("html: acento em entidade volta ao caractere", () => {
  const doc = H.parse(`<a href="/a?b=1&amp;c=2" title="N&atilde;o">x</a>`);
  const a = H.um(doc, "a");
  assert.strictEqual(a.attrs.href, "/a?b=1&c=2");
  assert.ok(a.attrs.title.includes("Não"));
});

test("html: seletor por atributo com os 5 operadores", () => {
  const doc = H.parse(`<source src="x720.m3u8" data-q="720"><source data-q="1080p"><i data-k="a-b"></i>`);
  assert.strictEqual(H.seleciona(doc, "[data-q]").length, 2);
  assert.strictEqual(H.seleciona(doc, `[data-q="720"]`).length, 1);
  assert.strictEqual(H.seleciona(doc, `[data-q^="1080"]`).length, 1);
  assert.strictEqual(H.seleciona(doc, `[src$=".m3u8"]`).length, 1);
  assert.strictEqual(H.seleciona(doc, `[data-k*="-b"]`).length, 1);
});

test("html: descendente acha neto, filho nao", () => {
  const doc = H.parse(`<div id="a"><span><b>x</b></span></div><div id="b"><b>y</b></div>`);
  assert.strictEqual(H.seleciona(doc, "#a b").length, 1, "descendente acha");
  assert.strictEqual(H.seleciona(doc, "#b > b").length, 1, "filho direto");
  assert.strictEqual(H.seleciona(doc, "#a > b").length, 0, "neto nao e filho");
});

test("html: tag de fechamento orfa e ignorada", () => {
  const doc = H.parse(`</div><p>sobrevive</p></section>`);
  assert.strictEqual(H.textoDe(H.um(doc, "p")), "sobrevive");
});

test("html: lixo nao derruba o interpretador", () => {
  assert.doesNotThrow(() => H.parse(`<<<>>><a href=<<x>>texto</a><3 <div`));
});

// -------- motor: literal de JavaScript --------

test("extrator: literal com chave e colchete dentro de string", () => {
  const r = ex.literal(`<script>window.Cfg = {"a":"}", "b":{"c":1}, "d":"[x]"};</script>`, "window.Cfg =");
  assert.deepStrictEqual(r, { a: "}", b: { c: 1 }, d: "[x]" });
});

test("extrator: objeto nao-JSON (chave sem aspas, virgula solta)", () => {
  assert.deepStrictEqual(ex.flexivel(`{file:"x.m3u8", label:"720p"}`), { file: "x.m3u8", label: "720p" });
});

test("extrator: objeto com comentario dentro", () => {
  const r = ex.literal(`var c = {"a":1 /* fecha } nao */ , "b":{"u":"https://x/y.m3u8"}};`, "var c =");
  assert.deepStrictEqual(r, { a: 1, b: { u: "https://x/y.m3u8" } });
});

test("extrator: objeto incompleto nao devolve truncado", () => {
  assert.strictEqual(ex.flexivel(`{a:1, b:{c:2`), null);
});

test("extrator: https:// dentro de string nao vira comentario", () => {
  assert.deepStrictEqual(ex.flexivel(`{"u":"https://cdn.x/a.m3u8"}`), { u: "https://cdn.x/a.m3u8" });
});

// -------- motor: coleta e pontuacao --------

test("extrator: barra escapada e &amp; sao desfeitos (medido no SPT e no REI)", () => {
  // Exatamente como o SPT escreve: `https:\/\/host\/…` e `&amp;` no meio da query.
  const html = '<script>createMyPlayer({url:"https:\\/\\/cdn.x.io\\/v\\/a\\/720.m3u8?a=1&amp;b=2"});</script>';
  assert.ok(html.includes("\\/\\"), "o texto de teste tem a barra escapada de verdade");
  const achados = ex.coletar(html, {});
  assert.ok(achados.some((c) => c.url === "https://cdn.x.io/v/a/720.m3u8?a=1&b=2"),
    `achou ${JSON.stringify(achados.map((c) => c.url))}`);
});

test("extrator: o trailer e a capa nao entram como video", () => {
  const html = `<img src="/logo.png"><meta property="og:image" content="/capa.jpg">
    <a href="/trailer-do-ep.mp4">trailer</a><video data-src="/re/720.m3u8"></video>`;
  const urls = ex.coletar(html, { base: "https://s.tv/e/1" }).map((c) => c.url);
  assert.deepStrictEqual(urls, ["https://s.tv/re/720.m3u8"]);
});

test("extrator: o melhor ganha do pior (1080 antes de 720 antes da legenda)", () => {
  const html = `<script>var p={file:"https://cdn.x/hls/1080/master.m3u8",sub:"https://cdn.x/leg.m3u8",sd:"https://cdn.x/sd.m3u8"}</script>`;
  const urls = ex.coletar(html, {}).map((c) => c.url);
  assert.strictEqual(urls[0], "https://cdn.x/hls/1080/master.m3u8");
  assert.ok(urls.indexOf("https://cdn.x/leg.m3u8") > 0);
});

test("extrator: video dentro de parametro de outra URL (medido no ATB e no RON)", () => {
  const html = `<script>var u="https://api.anivideo.net/videohls.php?d=https%3A%2F%2Fcdn.y%2Fs%2F01.mp4%2Findex.m3u8";</script>`;
  const urls = ex.coletar(html, {}).map((c) => c.url);
  assert.ok(urls.includes("https://cdn.y/s/01.mp4/index.m3u8"), `achou ${JSON.stringify(urls)}`);
  assert.ok(urls[0] === "https://cdn.y/s/01.mp4/index.m3u8",
    `a origem direta vem antes da pagina php (achou ${urls[0]})`);
});

test("extrator: chave de configuracao vale sem extensao, atributo nao (medido no REI)", () => {
  const config = ex.coletar(`<script>var s=[{"src":"https://cdn.x/__index.txt?token=1","type":"application/x-mpegURL"}];</script>`, {});
  assert.ok(config.some((c) => c.url.endsWith("__index.txt?token=1")), "config com src forte entra");
  const atributo = ex.coletar(`<div src="https://v2.rdembed.sbs/__play/x?pt=1"></div>`, {});
  assert.strictEqual(atributo.length, 0, "src de atributo NAO entra como video");
});

test("extrator: pagina seguinte e achada mesmo sem ser iframe (medido no REI)", () => {
  const html = `<html><body><div class="x"><span data-play="https://v2.rdembed.sbs/__play/afazenda7?pt=1&amp;pc=2"></span></div></body></html>`;
  const prox = ex.paginasIntermedarias(html, "https://v2.rdembed.sbs/afazenda7");
  assert.ok(prox.includes("https://v2.rdembed.sbs/__play/afazenda7?pt=1&pc=2"), `achou ${JSON.stringify(prox)}`);
});

test("extrator: about:blank e conteudo de meta nao viram pagina (medido no SPT)", () => {
  assert.strictEqual(ex.absolute("about:blank", "https://s.tv/"), null);
  const html = `<meta name="viewport" content="width=device-width,initial-scale=1"><iframe src="about:blank"></iframe>`;
  const prox = ex.paginasIntermedarias(html, "https://v1.watchplay.shop/movie/603");
  assert.deepStrictEqual(prox, []);
});

test("extrator: ref com barra escapada e achado (medido no REI)", () => {
  const html = `<script>var sources=[{"src":"","ref":"\\/NPIKSmpl.PV0OXyJ09tf"}];</script>`;
  assert.deepStrictEqual(ex.refsDe(html), ["/NPIKSmpl.PV0OXyJ09tf"]);
});

test("extrator: arquitetura descreve o site sem abrir na mao", () => {
  const html = `<html><head><script src="/wp-content/x.js"></script><script>Hls.js</script>
    <div class="g-recaptcha"></div></head></html>`;
  const nomes = ex.arquitetura(html, "https://x.tv/").nomes;
  assert.ok(nomes.includes("WordPress"), `veio ${JSON.stringify(nomes)}`);
  assert.ok(nomes.includes("player HLS (hls.js)"));
  assert.ok(nomes.includes("pede captcha"));
});

test("extrator: a tabela de sites de video esta ligada no motor (384 linhas orfas)", () => {
  const { detectHost, HOSTERS } = require("../src/lib/url-resolver");
  assert.ok(Object.keys(HOSTERS).length >= 15, `tem ${Object.keys(HOSTERS).length} tipos`);
  assert.strictEqual(detectHost("https://www.mp4upload.com/abc/file.mp4"), "mp4upload");
  assert.strictEqual(detectHost("https://x.tv/a.m3u8"), "direct");
  assert.strictEqual(detectHost("https://x.tv/pagina"), null);
});

test("decisao 155: a variante sem cabecalho saiu do servidor (o worker nao alcanca o googlevideo)", () => {
  // MEDIDO em 29/09/2026, e a razao de oServers ter funcionado ate aqui: o `redirector.googlevideo.com`
  // responde **403 para o IP do worker** (a URL e' assinada com o IP de quem pediu). Por isso
  // as fontes que exigem cabecalho (`rtd`, `dgo`) ganhavam uma 2a variante pelo worker, e so
  // essas duas: as demais ou nao precisam (`aon` ja sai pelo `/p/`) ou o worker nao alcanca.
  //
  // A 155 levou embora a MASCARA de stream (`lib/proxy.js`, `headerlessVariant`, `NEEDS_REFERRER`).
  // Sem servidor por tras, essa variante nao tem para onde ir. Quem monta o player — e quem
  // precisa decidir entre link direto e link com cabecalho — e' o plugin, no aparelho, com o
  // IP residencial de quem assiste: la o `googlevideo` responde, e o problema nunca existiu.
  const fs = require("node:fs");
  const path = require("path");
  const src = fs.readFileSync(require.resolve("../src/server.js"), "utf8");
  for (const saiu of ["NEEDS_REFERRER", "headerlessVariant", "maskStreamUrls", "cifraOrigens", "maskTvUrls"]) {
    assert.equal(new RegExp("(function|const|let) " + saiu + "\\b").test(src), false,
      saiu + " nao pode voltar sem mascara de stream");
  }
  assert.equal(/NEEDS_UA/.test(src), false, "nenhuma lista de User-Agent no servidor");
  // E a variante continua onde ela e' util: o plugin tem as 15 fontes e o mesmo problema.
  const plugin = fs.readFileSync(path.join(__dirname, "..", "..", "nuvio", "src", "core", "fontes.js"), "utf8");
  assert.ok(plugin.includes("rtd") && plugin.includes("dgo"), "o plugin registra as duas fontes que exigem cabecalho");
});