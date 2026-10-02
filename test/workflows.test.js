// Os WORKFLOWS sao codigo e nao eram testados.
//
// MEDIDO 02/10/2026, duas vezes na mesma rodada:
//   1. `publicar-pages` caiu com "syntax error near unexpected token `echo'" — um `fi` tinha
//      ficado colado no `echo` seguinte, e ninguem executa o workflow antes de subir.
//   2. `testes` ficou vermelho SO no GitHub, com MODULE_NOT_FOUND em `/home/ubuntu/...`:
//      um caminho absoluto da minha maquina dentro de um teste.
//
// O segundo e' o mais instrutivo: o teste PASSAVA aqui e falhava la. Este arquivo pega os
// dois na mao, e a CI roda ele antes de qualquer outra coisa.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const WORKFLOWS = [".github/workflows/testes.yml", ".github/workflows/publicar-pages.yml"];

for (const arquivo of WORKFLOWS) {
  test(`${arquivo}: nenhum fechamento de bloco colado no comando seguinte`, () => {
    const linhas = fs.readFileSync(path.join(RAIZ, arquivo), "utf8").split("\n");
    const colados = linhas
      .map((linha, i) => ({ n: i + 1, linha }))
      // `fi`/`done` que ainda tem comando na mesma linha: bash nao le `fi echo ...`
      .filter((x) => /^\s*(fi|done)\s+\S/.test(x.linha));
    assert.deepStrictEqual(
      colados.map((x) => `${x.n}: ${x.linha.trim()}`),
      [],
      "fechamento colado (foi o que derrubou a publicacao)"
    );
  });

  test(`${arquivo}: todo \`if [\` tem um \`fi\``, () => {
    const texto = fs.readFileSync(path.join(RAIZ, arquivo), "utf8");
    const abrem = (texto.match(/^\s*if \[/gm) || []).length;
    const fecham = (texto.match(/^\s*fi\s*$/gm) || []).length;
    assert.strictEqual(abrem, fecham, `${abrem} \`if [\` e ${fecham} \`fi\``);
  });
}

test("nenhum teste do repo tem caminho absoluto (o que so existe na minha maquina)", () => {
  // MEDIDO 02/10/2026: `test/produtos-sobem.test.js` fazia
  // `require("/home/ubuntu/mirror/plugin/src/core/fontes.js")`. Passava aqui, quebrava na CI
  // com MODULE_NOT_FOUND em `/home/runner/...`. Todo caminho tem de vir de `__dirname`.
  const achados = [];
  for (const pasta of ["test", "mirrorstream/test", "mirrorview/test"]) {
    const dir = path.join(RAIZ, pasta);
    if (!fs.existsSync(dir)) continue;
    for (const nome of fs.readdirSync(dir)) {
      if (!nome.endsWith(".js")) continue;
      const arquivo = path.join(dir, nome);
      const texto = fs.readFileSync(arquivo, "utf8").split("\n");
      texto.forEach((linha, i) => {
        // `/home/<algo>` fora de comentario e fora de string de exemplo e' caminho fixo
        if (/^\s*(\/\/|\*)/.test(linha)) return;
        if (!/\/home\/[a-z]/i.test(linha)) return;
        // o proprio arquivo pode citar o path no comentario que explica o defeito
        if (/nao existe em|que nao existe|MODULE_NOT_FOUND|passa aqui|foi assim/.test(linha)) return;
        achados.push(`${pasta}/${nome}:${i + 1}  ${linha.trim().slice(0, 90)}`);
      });
    }
  }
  assert.deepStrictEqual(achados, [], `caminho absoluto: ${achados.join(" | ")}`);
});

test("a CI conhece os tres produtos", () => {
  const testes = fs.readFileSync(path.join(RAIZ, ".github/workflows/testes.yml"), "utf8");
  for (const produto of ["plugin", "mirrorstream", "mirrorview"]) {
    assert.ok(
      testes.includes(produto),
      `a CI nao menciona ${produto} — um produto sem barreira nao tem rede de seguranca`
    );
  }
  // e o piso conta a soma das tres, nao so de uma
  assert.match(
    testes,
    /total=\$\(\(ms \+ mv \+ repo\)\)/,
    "o piso tem de somar as tres barreiras"
  );
  assert.match(
    fs.readFileSync(path.join(RAIZ, ".github/workflows/publicar-pages.yml"), "utf8"),
    /working-directory: plugin/,
    "a publicacao tem de rodar de dentro do plugin"
  );
});

test("o .dockerignore nao vaza o node_modules do plugin nem o mirrorview", () => {
  const di = fs.readFileSync(path.join(RAIZ, ".dockerignore"), "utf8").split("\n");
  assert.ok(di.includes("**/node_modules"), "node_modules de um produto entraria na imagem de outro");
  assert.ok(di.includes("**/test/"), "os testes de um produto entrariam na imagem de outro");
  assert.ok(di.includes("plugin/"), "o plugin nao tem porque entrar na imagem de nenhum addon");
  // `mirrorview/` nao pode estar aqui. A regra "o MirrorView nao entra na imagem do
  // MirrorStream" era minha e estava ERRADA: o `.dockerignore` vale para o CONTEXTO, que e'
  // a raiz para os dois Dockerfiles, e o `mirrorview/Dockerfile` copia da propria pasta.
  // Excluir quebrava a imagem do MirrorView sem a BeamUp notar (ela sobe o `./Dockerfile`
  // da raiz). A regra correta e a de `test/dockerignore.test.js`.
  assert.equal(
    di.some((l) => l.trim() === "mirrorview/"),
    false,
    "mirrorview/ nao pode estar no .dockerignore — o mirrorview/Dockerfile copia dela"
  );
});
test("cada worker tem o seu config, e o da borda e' um arquivo proprio", () => {
  // MEDIDO 02/10/2026: eu sobrescrevi o `wrangler.toml` (que e' o do worker GENERICO, e
  // documenta o `[placement] region = "aws:sa-east-1"` da decisao 123) com o config do worker
  // DE BORDA, e `timers.test.js` acusou na hora. Sao dois workers diferentes, com cotas
  // diferentes (o plano gratis da Cloudflare da cota POR WORKER) — um config so seria uma
  // fonte de confusao e de publicacao no lugar errado.
  const borda = fs.readFileSync(path.join(RAIZ, "wrangler-borda.toml"), "utf8");
  assert.match(borda, /main\s*=\s*"worker-borda\.mjs"/, "o config da borda tem de apontar pro worker da borda");
  assert.match(borda, /name\s*=\s*"mirror-borda"/);
  assert.match(borda, /ORIGEM\s*=\s*"https:\/\/e75602c18409-mirror/, "a origem tem de ser um dos dois addons");

  // E o worker da borda tem que existir de verdade, no caminho que o config declara.
  const main = /main\s*=\s*"([^"]+)"/.exec(borda)[1];
  assert.ok(
    fs.existsSync(path.join(RAIZ, main)),
    `o \`main\` do config da borda aponta para ${main}, que nao existe`
  );

  // Os dois workers nao podem ter o mesmo nome (a Cloudflare trataria como um so).
  const generico = fs.readFileSync(path.join(RAIZ, "wrangler.toml"), "utf8");
  const nomeBorda = /name\s*=\s*"([^"]+)"/.exec(borda)[1];
  const nomeGenerico = /name\s*=\s*"([^"]+)"/.exec(generico)[1];
  assert.notStrictEqual(nomeBorda, nomeGenerico, "os dois workers precisam de nomes diferentes");
});

test("o worker da borda e' ESM e passa na checagem de sintaxe do CI", () => {
  // O CI roda `node --check` num `.mjs` copiado, porque `node -c` em CommonJS da SyntaxError
  // num arquivo que e' ESM — e a propria CI ja caiu uma vez por isso.
  const worker = path.join(RAIZ, "worker-borda.mjs");
  assert.ok(fs.existsSync(worker), "worker-borda.mjs");
  assert.match(fs.readFileSync(worker, "utf8"), /export default/, "o worker tem que exportar `fetch`");
  assert.match(
    fs.readFileSync(worker, "utf8"),
    /export function classifica/,
    "`classifica` tem que ser exportada: e' a funcao pura que `test/worker-borda.test.js` exercita sem rede"
  );
});
