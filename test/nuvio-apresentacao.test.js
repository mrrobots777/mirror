// O CONTRATO DE APRESENTACAO do plugin Nuvio — o que o usuario ve na lista de streams.
//
// Tudo aqui e' SEM rede. O que se trava e' a ligacao com o que o APP faz com o objeto
// que o scraper devolve, medido no proprio codigo do Nuvio
// (`/tmp/nuviotv/app/src/main/java/com/nuvio/tv/...`):
//
//   `StreamRepositoryImpl.toPluginStream`
//     linha 1 = `name`, e o app ACRESCENTA " - <quality>" quando o texto ainda nao
//     contem a qualidade. Sem `quality`, escreve o rotulo de localizacao
//     `stream_quality_unknown` — "Desconhecido" em pt-BR (values-pt-rBR/strings.xml).
//     linha 2 = `description ?: title`, e `description` so existe se o scraper mandar
//     `size` ou `language` (`buildDescription` junta os dois com " • ").
//     `addonName` (badge, `maxLines = 1`) vem do `name` do MANIFESTO.
//
//   `StreamRepositoryImpl.pluginAddonName`
//     com "agrupar por repositorio" ligado, o badge vira o NOME DO REPOSITORIO e as 15
//     fontes viram uma so ("Mirror"). E por isso que a sigla vai no fim do `title`
//     alem do badge: a origem continua identificavel com a opcao ligada.
//
//   `LocalScraperResult`
//     e' um data class do Moshi. Campo a mais pode fazer o parse falhar em runtime,
//     entao o conjunto de campos aceitos e' fechado e travado aqui.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { apresenta, aoVivo, QUALIDADE_AO_VIVO, EMOJI_TV, rotuloEpisodio } =
  require("../nuvio/src/lib/apresentacao");
const fontes = require("../nuvio/src/core/fontes");

const RAIZ = path.join(__dirname, "..", "nuvio", "src");

// Os mesmos campos de `com.nuvio.tv.domain.model.LocalScraperResult`.
const ACEITOS = new Set([
  "name", "title", "description", "url", "quality", "size", "language", "provider",
  "type", "seeders", "peers", "infoHash", "headers", "subtitles"
]);

function soAceitos(s) {
  return Object.keys(s).filter((k) => !ACEITOS.has(k));
}

test("apresenta: linha 1 e o conteudo, e o app completa com a qualidade", () => {
  const s = apresenta({ sigla: "BLZ", url: "https://kakito.xyz/movie/a/b/1.mp4", titulo: "Matrix", ano: 1999, qualidade: "1080p" });
  assert.strictEqual(s.name, "Matrix (1999)");
  assert.strictEqual(s.quality, "1080p");
  // O app faz `name + " - " + quality`, entao o nome NAO pode repetir a qualidade.
  assert.ok(!s.name.includes(s.quality), `name repete a qualidade: ${s.name}`);
  assert.strictEqual(`${s.name} - ${s.quality}`, "Matrix (1999) - 1080p");
});

test("apresenta: ano fora de faixa nao vira parêntese", () => {
  for (const ano of [undefined, null, 0, 12, 1800, 9999, "abc"]) {
    const s = apresenta({ sigla: "BLZ", url: "https://x.test/a.mp4", titulo: "Matrix", ano });
    assert.strictEqual(s.name, "Matrix", `ano ${ano} entrou no nome`);
  }
});

test("apresenta: linha 2 e cascata e TERMINA na sigla", () => {
  const s = apresenta({
    sigla: "rtd", url: "https://x.test/a.m3u8", qualidade: "720p",
    idioma: "Dublado", temporada: 1, episodio: 3, detalhe: "no ar"
  });
  assert.strictEqual(s.title, "Dublado · S01E03 · no ar · RTD");
  assert.ok(s.title.endsWith("RTD"), "a sigla tem de ser a ultima peca");
});

test("apresenta: so a sigla na linha 2 quando nao ha nada mais", () => {
  const s = apresenta({ sigla: "VZR", url: "https://x.test/a.mp4" });
  assert.strictEqual(s.title, "VZR");
  assert.strictEqual(s.name, "VZR", "sem titulo, a linha 1 cai para a sigla");
});

test("apresenta: TV ao vivo nunca produz 'Desconhecido'", () => {
  const s = aoVivo({ sigla: "REI", titulo: "HBO", url: "https://x.test/a.txt?format=m3u8" });
  assert.strictEqual(s.quality, QUALIDADE_AO_VIVO);
  assert.ok(s.quality && s.quality.trim(), "sem quality o app escreve 'Desconhecido'");
  assert.strictEqual(s.name, `${EMOJI_TV} HBO`);
  assert.strictEqual(`${s.name} - ${s.quality}`, "📺 HBO - Ao Vivo");
});

test("apresenta: TV ao vivo nao inventa temporada nem ano", () => {
  const s = aoVivo({ sigla: "RCD", titulo: "Globo News", url: "https://x.test/a.m3u8", temporada: 1, episodio: 1, ano: 2020 });
  assert.strictEqual(s.title, "RCD", `linha 2 com eps de VOD: ${s.title}`);
});

test("apresenta: so devolve campos que o LocalScraperResult do Nuvio conhece", () => {
  const completo = apresenta({
    sigla: "DGO", url: "https://x.test/a.m3u8", qualidade: "1080p", idioma: "Legendado",
    temporada: 2, episodio: 5, headers: { Referer: "https://x.test/" },
    subtitles: [{ lang: "por", url: "https://x.test/s.vtt" }]
  });
  assert.deepStrictEqual(soAceitos(completo), [], `campos fora do contrato: ${soAceitos(completo)}`);
  assert.deepStrictEqual(
    Object.keys(completo).sort(),
    ["headers", "name", "quality", "subtitles", "title", "url"]
  );
});

test("apresenta: nao manda `language` nem `size` (esconderiam o title)", () => {
  // O app monta `description` como "size • language" e usa `description ?: title`.
  // Mandar os dois esconderia o `title`, que e a linha 2 com a informacao que importa.
  const s = apresenta({ sigla: "SPT", url: "https://x.test/a.m3u8", qualidade: "720p", idioma: "Dublado" });
  assert.ok(!("language" in s), "language preenchido esconderia o title");
  assert.ok(!("size" in s), "size preenchido esconderia o title");
  assert.strictEqual(s.title, "Dublado · SPT", "o idioma tem de estar no title");
});

test("apresenta:Titulo do conteúdo vai na linha 1, a sigla NÃO", () => {
  const s = apresenta({ sigla: "AON", url: "https://x.test/a.m3u8", titulo: "Naruto", qualidade: "720p" });
  assert.strictEqual(s.name, "Naruto");
  assert.ok(!s.name.includes("AON"), "a fonte nao pode ir na linha 1 (duplica o badge)");
  assert.ok(s.title.includes("AON"), "a fonte tem de ir na linha 2");
});

test("apresenta: headers vazio nao entra no objeto", () => {
  assert.ok(!("headers" in apresenta({ sigla: "REI", url: "https://x.test/a.m3u8", headers: {} })));
  assert.ok(soAceitos(apresenta({ sigla: "REI", url: "https://x.test/a.m3u8", headers: { "User-Agent": "x" } })).length === 0);
});

test("apresenta: url invalida e erro, nao stream quebrado", () => {
  assert.throws(() => apresenta({ sigla: "REI", url: "" }), /url/);
  assert.throws(() => apresenta({ sigla: "REI", url: "javascript:alert(1)" }), /http/);
  assert.throws(() => apresenta({ url: "https://x.test/a.m3u8" }), /sigla/);
});

test("apresenta: sigla e normalizada para maiusculas (o registro exige)", () => {
  const s = apresenta({ sigla: "blz", url: "https://x.test/a.mp4" });
  assert.strictEqual(s.title, "BLZ");
});

test("rotuloEpisodio: so quando temporada e episodio sao validos", () => {
  assert.strictEqual(rotuloEpisodio(1, 1), "S01E01");
  assert.strictEqual(rotuloEpisodio(12, 345), "S12E345");
  assert.strictEqual(rotuloEpisodio(null, null), "");
  assert.strictEqual(rotuloEpisodio(0, 1), "");
  assert.strictEqual(rotuloEpisodio(1, 0), "");
  assert.strictEqual(rotuloEpisodio("x", "y"), "");
});

test("as 15 fontes passam pelo contrato: nenhuma monta o objeto na mao", () => {
  const semContrato = [];
  for (const chave of fontes.chaves()) {
    // Os 3 paineis delegam para `lib/fonte-painel.js` e nao chamam `apresenta` no
    // arquivo deles — quem emite e' o motor. Eles tem teste proprio, abaixo.
    if (ehPainel(chave)) continue;
    const txt = fs.readFileSync(path.join(RAIZ, "scrapers", fontes.arquivoDe(chave)), "utf8");
    const montaNaMao = /name:\s*(SIGLA|"|painel\.|[A-Z]{3}\b)/.test(txt) ||
      /title:\s*`?\s*(\[|.*join\(" · "\))/.test(txt);
    const usa = /apresenta\(|streamDeTv\(/.test(txt);
    if (!usa || montaNaMao) semContrato.push(`${chave} (arquivo ${fontes.arquivoDe(chave)})`);
  }
  assert.deepStrictEqual(semContrato, [], `fora do contrato: ${semContrato.join(", ")}`);
});

function ehPainel(chave) {
  return ["blz", "spc", "ato"].includes(chave);
}

test("os tres paineis emitem pelo mesmo contrato (vem de lib/fonte-painel)", () => {
  for (const chave of ["blz", "spc", "ato"]) {
    const txt = fs.readFileSync(path.join(RAIZ, "scrapers", fontes.arquivoDe(chave)), "utf8");
    assert.ok(!/name:\s*painel\.sigla/.test(txt), `${chave} monta o objeto na mao`);
  }
  const painel = fs.readFileSync(path.join(RAIZ, "lib", "fonte-painel.js"), "utf8");
  assert.ok(/apresenta\(\{/.test(painel), "fonte-painel tem de montar pelo contrato");
});

test("qualifica: preenche a qualidade mas NUNCA inventa", () => {
  // O preenchimento acontece DEPOIS que a fonte entregou, entao o contrato ja foi
  // montado; o app le `quality` separado e completa a linha 1. Ver `src/lib/qualifica.js`.
  const txt = fs.readFileSync(path.join(RAIZ, "lib", "qualifica.js"), "utf8");
  assert.ok(/videoResolutionToQuality/.test(txt), "a qualidade tem de vir da resolucao lida");
  assert.ok(!/=\s*"(?:720|1080|4k)"/i.test(txt), "nao pode existir rotulo fixo de qualidade");
  const s = apresenta({ sigla: "SPC", url: "https://x.test/a.mp4", titulo: "Matrix", ano: 1999 });
  s.quality = "1080p";
  assert.strictEqual(`${s.name} - ${s.quality}`, "Matrix (1999) - 1080p");
});

test("a build embrulha TODO scraper com a qualifica (nao ha como esquecer)", () => {
  const build = fs.readFileSync(path.join(__dirname, "..", "nuvio", "build.js"), "utf8");
  assert.ok(/qualifica\(base\.getStreams/.test(build), "o embrulho da build disappeared");
  assert.ok(/entradaDe\(chave\)/.test(build), "as entradas precisam passar pelo embrulho");
  // E o embrulho precisa mesmo rodar: nenhum bundle pode chamar o `getStreams` cru.
  const dist = path.join(__dirname, "..", "nuvio", "dist");
  if (!fs.existsSync(dist)) return;
  for (const chave of fontes.chaves()) {
    const bundle = fs.readFileSync(path.join(dist, `${chave}.js`), "utf8");
    assert.ok(bundle.length > 0, `bundle de ${chave} vazio`);
  }
});

test("o video-probe do plugin nao depende do addon nem de Buffer", () => {
  const bruto = fs.readFileSync(path.join(RAIZ, "lib", "video-probe.js"), "utf8");
  const codigo = bruto.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/browserFetch|scraper-utils/.test(codigo), "o probe nao pode importar o addon");
  assert.ok(!/\bBuffer\b\s*[,.)]/.test(codigo), "Buffer nao existe no runtime do plugin");
  assert.ok(/new Uint8Array/.test(codigo), "a leitura tem de virar Uint8Array");
});