// A divisao em tres produtos deixou nomes de pasta antigos espalhados pelo codigo — e um
// deles derrubou a publicacao do plugin.
//
// MEDIDO 02/10/2026, nesta rodada:
//   - `plugin/tools/gerar-indice.js` tinha `path.join(RAIZ, "..", "addon", "src")` como PADRAO.
//     O addon virou `mirrorstream/`, e a CI caiu com `ENOENT .../addon/src/scrapers/xtream.js`.
//     Sem credenciais de painel, o indice nao era gerado, e o passo seguinte morria com
//     "public/ sem idx/indice.json".
//   - `plugin/src/lib/indice.js` mandava o usuario (no texto de erro que ele ve no aparelho)
//     publicar `nuvio/public/` e rodar `nuvio/tools/atualizar-indice.yml` — pasta que nao
//     existe mais.
//   - Havia DUAS copias dos workflows em `plugin/tools/*.yml` (138 e 118 linhas). Actions so
//     le `.github/workflows/`, entao elas nunca rodaram — so divergiram, e a divergencia
//     apontava para o `addon/`.
//
// Nenhum teste pega renomeacao de pasta: os caminhos continuam "validos" para quem nao sabe
// que a pasta foi renomeada. Por isso a varredura existe.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");

// As pastas que existiram antes da divisao. `plugin` e novo; `nuvio`, `addon` e `stremio`
// sao as tres que died.
const ANTIGAS = ["nuvio", "addon", "stremio"];

// Onde a varredura olha. `public/*.js` e `public/idx/` fora: sao bundles minificados gerados
// (eles carregam o texto antigo so ate o proximo `node build.js`) e o indice, que e' dado.
const ONDE = [
  "plugin/src",
  "plugin/tools",
  "plugin/build.js",
  "plugin/teste.js",
  "mirrorstream/src",
  "mirrorstream/test",
  "mirrorview/src",
  "mirrorview/test",
  "test",
  ".github/workflows"
];

function* arquivos(alvo) {
  const abs = path.join(RAIZ, alvo);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isFile()) {
    yield abs;
    return;
  }
  for (const nome of fs.readdirSync(abs)) yield* arquivos(path.join(alvo, nome));
}

// Comentario de JS comeca com `//` ou (dentro de bloco) `*`; comentario de SHELL, que e' o
// que vive dentro de um `run: |` do YAML, comeca com `#`. Os dois interessam: o passo
// clonar do `publicar-pages.yml` tem varias linhas de `#` explicando o porquê, e nenhuma
// delas e' codigo.
const ehComentario = (linha) => /^\s*(\/\/|\*|#)/.test(linha);

// Um nome de pasta vale quando e' **segmento de caminho de arquivo**. Tres formas, e so
// elas — a varredura mais larga acusou coisas que tem de ficar:
//
//   "../addon/src"          caminho relativo com `..`          -> QUEBRA no require
//   'addon/src/core'        caminho que comeca em literal       -> QUEBRA no require
//   `plugin/tools` -> "addon" nao entra; ja' e' o caminho novo
//
// O que NAO vale, e o que a versao larga acusou:
//
//   "/nuvio/manifest.json"  rota do adapter do Nuvio, NAO pasta. E' o protocolo do app.
//   "instalar o addon ..."  a palavra "addon" em prosa
//   "o addon e o plugin"    idem
//
// A distincao e a barra: `addon/src/` e' caminho; `/nuvio/` com barra ANTES e' rota.
const ALVO_DE_PASTA = new RegExp(
  [
    // caminho relativo explicito: `../addon/`, `./stremio/`
    "\\.\\.?\\/(?:" + ANTIGAS.join("|") + ")\\b",
    // caminho que comeca em literal de string: `"addon/src`
    "[\"'`](?:" + ANTIGAS.join("|") + ")\\/(?:src|tools|test|core|public|build\\.js|package)",
    // caminho que comeca no primeiro segmento, sem aspas visiveis
    "^\\s*(?:" + ANTIGAS.join("|") + ")\\/(?:src|tools|test)"
  ].join("|")
);

test("nenhum arquivo de codigo aponta para uma pasta que foi renomeada", () => {
  const achados = [];
  for (const alvo of ONDE) {
    for (const arquivo of arquivos(alvo)) {
      if (!/\.(js|yml|json)$/.test(arquivo)) continue;
      const rel = path.relative(RAIZ, arquivo);
      fs.readFileSync(arquivo, "utf8")
        .split("\n")
        .forEach((linha, i) => {
          if (ehComentario(linha)) return;
          if (ALVO_DE_PASTA.test(linha)) {
            achados.push(`${rel}:${i + 1}  ${linha.trim().slice(0, 90)}`);
          }
        });
    }
  }
  assert.deepStrictEqual(
    achados,
    [],
    `pasta renomeada ainda citada:\n    ${achados.join("\n    ")}`
  );
});

test("a varredura de pasta nao acusa as rotas /nuvio (sao o protocolo do Nuvio)", () => {
  // Regressao da propria varredura: `/nuvio/manifest.json` e' rota do adapter, nao pasta, e
  // o nome `nuvio` na palavra da rota nao tem nada a ver com a pasta que foi renomeada.
  const nomes = fs.readFileSync(path.join(RAIZ, "mirrorview", "src", "core", "nomes.js"), "utf8");
  assert.match(nomes, /"\/nuvio\/manifest\.json"/, "as rotas do Nuvio tem de continuar assim");
  for (const linha of nomes.split("\n")) {
    if (!/\/nuvio\//.test(linha)) continue;
    assert.equal(
      ALVO_DE_PASTA.test(linha),
      false,
      `a varredura esta confundindo rota com pasta: ${linha.trim().slice(0, 70)}`
    );
  }
});

// ── um mini scanner, porque "contar aspas" nao funciona ──
//
// A primeira versao deste teste decidia se um `require` estava em codigo ou em string
// contando as aspas antes dele, e deu dois falsos negativos e um falso positivo:
//
//   - `'... require("../src/lib/qualifica");'`  -> 4 aspas antes do `require`, entao "fora de
//     string", quando o require esta DENTRO da string. E' o `plugin/build.js` montando o
//     bundle, e o caminho e' relativo ao bundle em `public/`, nao ao `build.js`.
//
// Contar aspas so funciona se as tres delimitadoras forem equivalentes; com template
// literal atravessando linha, o total fica sem par. Este scanner e' o minimo para a
// pergunta que fazemos: "esta posicao e' codigo?" — e nao tenta ser um parser de JS.
const CODE = 0;
const LINHA = 1;
const BLOCO = 2;
const SIMPLES = 3;
const TEMPLATE = 4;
const EXPRESSAO = 5; // dentro de `${ ... }`

// Devolve um Uint8Array: 1 onde a posicao e' CODIGO, 0 onde e' string ou comentario.
//
// A PILHA e' o que faz funcionar `\`a ${ require("./dentro") } b\``: a string abre dentro de
// uma expressao, e quando fecha tem de voltar para a EXPRESSAO — nao para codigo. Sem a
// pilha o `}` que fecha o `${` passa despercebido e o resto do arquivo fica achando que
// ainda esta' dentro do template. Foi o que aconteceu nas duas primeiras versoes.
function mascaraDeCodigo(fonte) {
  const codigo = new Uint8Array(fonte.length);
  const pilha = [CODE];
  // qual aspa ABRIU a string: `"aspas require('./interno')"` fecha na `"`, nao na `'`.
  let delimitador = "";
  // quantas `{`(abrem) a expressao `${}` ja engoliu: o `}` que fecha e' o de profundidade 0
  let chave = 0;

  const empilha = (estado) => pilha.push(estado);
  const estado = () => pilha[pilha.length - 1];

  for (let i = 0; i < fonte.length; i++) {
    const c = fonte[i];
    const d = fonte[i + 1];
    const anterior = fonte[i - 1];
    const escapado = anterior === "\\" && fonte[i - 2] !== "\\";

    if (estado() === CODE) {
      codigo[i] = 1;
      if (c === "/" && d === "/") { empilha(LINHA); i += 1; continue; }
      if (c === "/" && d === "*") { empilha(BLOCO); i += 1; continue; }
      if (c === "'" || c === '"') { delimitador = c; empilha(SIMPLES); continue; }
      if (c === "`") { empilha(TEMPLATE); continue; }
      continue;
    }
    if (estado() === EXPRESSAO) {
      codigo[i] = 1;
      if (escapado) continue;
      if (c === "{") { chave += 1; continue; }
      if (c === "}") {
        if (chave === 0) { pilha.pop(); continue; } // fecha o `${`: volta pro texto
        chave -= 1;
        continue;
      }
      if (c === "'" || c === '"') { delimitador = c; empilha(SIMPLES); continue; }
      if (c === "`") { empilha(TEMPLATE); continue; }
      continue;
    }
    if (estado() === LINHA) {
      if (c === "\n") { pilha.pop(); codigo[i] = 1; }
      continue;
    }
    if (estado() === BLOCO) {
      if (c === "*" && d === "/") { pilha.pop(); i += 1; }
      else if (c === "\n") codigo[i] = 1; // a linha conta para o numero reportado
      continue;
    }
    if (estado() === SIMPLES) {
      // fecha SO na aspa que abriu: `"aspas require('./interno')"` fecha na `"`.
      if (!escapado && c === delimitador) { pilha.pop(); codigo[i] = 1; }
      else if (c === "\n") codigo[i] = 1; // string nao fechada: nao trava o resto
      continue;
    }
    // TEMPLATE: o texto do template NAO e' codigo
    if (escapado) continue;
    if (c === "`") { pilha.pop(); continue; }
    if (c === "$" && d === "{") {
      empilha(EXPRESSAO);
      chave = 0;
      codigo[i] = 1;
      i += 1;
    }
  }
  return codigo;
}

test("o scanner sabe dizer codigo de string e de comentario", () => {
  // A fonte e' montada por concatexacao para o `${...}` nao ser resolvido pelo proprio
  // template deste arquivo.
  const fonte = [
    'const a = require("./real");',                    // codigo
    '// require("./comentario")',                      // comentario de linha
    '/* require("./bloco") */',                        // comentario de bloco
    "const t = `texto require(\"./crase\") ${x} require(\"./depois\")`;",
    //   ^ `./crase` e' texto do template; `./depois` TAMBEM (o `${x}` ja fechou)
    "const w = `a ${ require(\"./dentro\") } b`;",      // `./dentro` e' CODIGO de verdade
    'const s = "aspas require(\'./interno\')";',        // string simples com aspas dentro
    "const u = 'const { a } = require(\"./montado\");';", // texto sendo GERADO
    'const v = require("./real2");'
  ].join("\n");

  const m = mascaraDeCodigo(fonte);
  const achados = [];
  const re = /require\(\s*["'`](\.[^"'`]+)["'`]\s*\)/g;
  let x;
  while ((x = re.exec(fonte))) {
    if (m[x.index] === 1) achados.push(x[1]);
  }

  assert.deepStrictEqual(
    achados,
    ["./real", "./dentro", "./real2"],
    "so codigo conta: comentario, texto de template e string simples nao; mas `${}` DENTRO do " +
    "template e' codigo e tem de contar"
  );
});

test("todo require relativo do repo aponta para um arquivo que existe", () => {
  // O `casos.js` lia `../../addon/src/core/nomes.js` e ninguem percebeu: o arquivo e' uma
  // ferramenta de medicao, entao nada no CI a executa. Um `require` quebrado e' um `catch`
  // silencioso, nao um erro.
  const quebrados = [];
  for (const alvo of ONDE) {
    for (const arquivo of arquivos(alvo)) {
      if (!/\.js$/.test(arquivo)) continue;
      const dir = path.dirname(arquivo);
      const texto = fs.readFileSync(arquivo, "utf8");
      const codigo = mascaraDeCodigo(texto);
      const re = /require\(\s*["'](\.[^"']+)["']\s*\)/g;
      let m;
      while ((m = re.exec(texto))) {
        if (codigo[m.index] !== 1) continue; // string ou comentario: e' texto
        if (m[1].includes("${")) continue; // caminho montado em runtime
        const alvoReq = path.resolve(dir, m[1]);
        const existe =
          fs.existsSync(alvoReq) ||
          fs.existsSync(alvoReq + ".js") ||
          fs.existsSync(path.join(alvoReq, "index.js"));
        if (!existe) {
          const linha = texto.slice(0, m.index).split("\n").length;
          quebrados.push(`${path.relative(RAIZ, arquivo)}:${linha}  ${m[1]}`);
        }
      }
    }
  }
  assert.deepStrictEqual(quebrados, [], `require quebrado:\n    ${quebrados.join("\n    ")}`);
});

test("o gerador do indice aponta para o mirrorstream, que e' onde estao as credenciais", () => {
  // Este e' o caminho que derrubou a publicacao: o PADRAO (sem --addon) e' o que a CI usa.
  const src = fs.readFileSync(path.join(RAIZ, "plugin", "tools", "gerar-indice.js"), "utf8");
  assert.ok(
    src.includes('path.join(RAIZ, "..", "mirrorstream", "src")'),
    "o gerador tem de ler ../mirrorstream/src — sem isso ele nao acha src/scrapers/xtream.js e nao gera indice"
  );
  assert.match(src, /--addon/, "o gerador ainda aceita --addon para o plugin fora do monorepo");
});

test("o texto de erro do plugin manda o usuario para onde ele consegue chegar", () => {
  // Este texto aparece NO APARELHO, quando o indice estatico nao esta publicado. Mandar o
  // cara para `nuvio/public/` (pasta que nao existe) e' pior que nao dizer nada.
  const src = fs.readFileSync(path.join(RAIZ, "plugin", "src", "lib", "indice.js"), "utf8");
  for (const velha of ANTIGAS) {
    assert.equal(
      new RegExp(`${velha}/`).test(src),
      false,
      `SEM_INDEX manda o usuario para \`${velha}/\` — pasta que nao existe mais`
    );
  }
  assert.ok(src.includes("plugin/public/"), "o texto tem de apontar para plugin/public/");
  assert.ok(
    src.includes(".github/workflows/publicar-pages.yml"),
    "e dizer qual workflow gera e publica isso"
  );
});

test("nao ha workflow duplicado fora de .github/workflows (Actions so le um lugar)", () => {
  const tools = path.join(RAIZ, "plugin", "tools");
  const sobrando = fs
    .readdirSync(tools)
    .filter((n) => /\.ya?ml$/.test(n));
  assert.deepStrictEqual(
    sobrando,
    [],
    `workflow em plugin/tools/ nunca e executado (Actions so le .github/workflows/): ${sobrando.join(", ")}`
  );
  // E o de verdade precisa existir.
  assert.ok(
    fs.existsSync(path.join(RAIZ, ".github", "workflows", "publicar-pages.yml")),
    "o workflow de publicacao sumiu"
  );
});

test("o Dockerfile e o .dockerignore falam dos tres produtos", () => {
  const df = fs.readFileSync(path.join(RAIZ, "Dockerfile"), "utf8");
  assert.ok(df.includes("mirrorstream/"), "o Dockerfile da raiz constroi o MirrorStream");
  assert.match(df, /CMD \["node", "mirrorstream\/src\/server\.js"\]/);

  const di = fs.readFileSync(path.join(RAIZ, ".dockerignore"), "utf8").split("\n");
  assert.ok(di.includes("plugin/"), "o plugin nao entra na imagem de nenhum addon");
  assert.ok(di.includes("mirrorview/"), "o MirrorView nao entra na imagem do MirrorStream");
  assert.ok(di.includes("**/node_modules"), "node_modules de um produto entraria na imagem de outro");
  for (const velha of ANTIGAS) {
    assert.equal(di.includes(`${velha}/`), false, `.dockerignore ainda exclui ${velha}/`);
  }
});