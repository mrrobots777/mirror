// A branch `mirrorview` e' o que o app de TV constroi. Ela e' GERADA por
// `tools/gerar-branch-mirrorview.js` a partir da pasta `mirrorview/` do `master`, e nao se
// edita a mao.
//
// POR QUE A BRANCH EXISTE (medido 02/10/2026)
//
// O dono quer DOIS apps no BeamUp: `mirrorstream` (VOD) e `mirrorview` (TV). O build do
// BeamUp (Dokku) sobe o `Dockerfile` da RAIZ do repositorio, e a CLI nao expoe
// `builder-dockerfile:set` — o SSH aceita so `logs` e responde `001cERR unsupported
// command` para o resto (medido). Uma sonda dentro do container provou que tambem nao ha
// sinal de runtime: `os.hostname()` e' o ID do container (`e0a41c051a08`) e o ambiente so
// tem as variaveis do Dockerfile.
//
// Ou seja: dois apps do MESMO repo, no MESMO branch, sao IDENTICOS POR CONSTRUCAO. Foi o
// que aconteceu — os dois subiram servindo `com.mirrorstream.addon`. O que o build consome
// e' o REF empurrado, entao cada app recebe uma BRANCH diferente, e cada branch tem o
// Dockerfile do seu produto na raiz:
//
//   master             -> Dockerfile da raiz  -> MirrorStream (VOD)
//   branch mirrorview  -> Dockerfile de TV    -> MirrorView (TV), com `src/` na raiz
//
// A branch e' gerada, nunca editada a mao: a fonte da verdade continua sendo a pasta
// `mirrorview/`. Este teste roda o gerador DE VERDADE numa branch de rascunho e compara com a
// publicada.
//
// A primeira versao deste teste COPIOU a logica do gerador em vez de chama-lo — e as duas
// divergiram na primeira rodada (a copia esvaziava o worktree, o gerador nao, depois
// vice-versa). Um teste que reimplementa o que testa passa sem provar nada. Por isso o
// teste chama o gerador.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");

const RAIZ = path.join(__dirname, "..");
const BRANCH = "mirrorview";
const RASCUNHO = "mirrorview-verificacao";
const GERADOR = path.join(RAIZ, "tools", "gerar-branch-mirrorview.js");

const temBranch = (b) => cp.spawnSync("git", ["rev-parse", "--verify", b], { cwd: RAIZ }).status === 0;

// Roda o gerador numa branch de rascunho e devolve o commit. Nao empurra nada.
//
// O `try` nos dois `branch -D` nao e' cosmetico: `stdio: "ignore"` esconde a SAIDA, mas o
// `execSync` continua LANCANDO quando o comando sai diferente de zero — e apagar uma branch
// que nao existe da erro. Foi o que fez os tres primeiros testes falharem com
// "Command failed: git branch -D mirrorview-verificacao".
const apagaBranch = (b) => {
  try {
    cp.execSync(`git branch -D ${b}`, { cwd: RAIZ, stdio: "ignore" });
  } catch (_) {
    /* nao existia */
  }
};

function geraRascunho() {
  apagaBranch(RASCUNHO);
  const saida = cp.execSync(`node ${JSON.stringify(GERADOR)} --branch=${RASCUNHO}`, {
    cwd: RAIZ,
    encoding: "utf8",
    env: { ...process.env, MIRROR_IMPRIMIR_BRANCH: "1" },
  });
  const sha = saida.trim().split("\n").pop().trim();
  apagaBranch(RASCUNHO);
  assert.match(sha, /^[0-9a-f]{40}$/, `o gerador nao devolveu um commit:\n${saida}`);
  return sha;
}

// A assinatura da arvore: caminho + hash do CONTEUDO. Ignora o historico de proposito — o que
// importa e que os arquivos batem, e nao o commit que os produziu.
function assinatura(commit) {
  const arquivos = cp
    .execSync(`git ls-tree -r --name-only ${commit}`, { cwd: RAIZ, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .sort();
  return arquivos.map((f) => {
    const buf = cp.execSync(`git show ${commit}:${JSON.stringify(f)}`, {
      cwd: RAIZ,
      maxBuffer: 64 * 1024 * 1024,
    });
    return `${f}:${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16)}`;
  });
}

test("a pasta mirrorview/ do master e' a fonte da verdade", () => {
  // Se alguem comecar a editar a branch direto, a pasta deixa de ser a fonte. Isso nao e'
  // erro de sintaxe nem de teste: e' um produto inteiro divergindo em silencio.
  assert.ok(fs.existsSync(path.join(RAIZ, "mirrorview", "Dockerfile")));
  assert.ok(fs.existsSync(path.join(RAIZ, "mirrorview", "package.json")));
  assert.ok(fs.existsSync(path.join(RAIZ, "mirrorview", "package-lock.json")), "sem lock o `npm ci` quebra");
  assert.ok(fs.existsSync(path.join(RAIZ, "mirrorview", "src", "server.js")));
  assert.ok(fs.existsSync(path.join(RAIZ, "mirrorview", "beamup-start.js")));
});

test("o gerador produz uma arvore que o build aceita", () => {
  const sha = geraRascunho();

  const df = cp.execSync(`git show ${sha}:Dockerfile`, { cwd: RAIZ, encoding: "utf8" });
  const start = cp.execSync(`git show ${sha}:beamup-start.js`, { cwd: RAIZ, encoding: "utf8" });

  // o CMD e o /start tem de apontar para o MESMO arquivo, na raiz da branch. Em producao so
  // o /start roda (o scheduler executa `node /start web`), entao divergencia aqui e' crash.
  const cmd = /CMD \["node",\s*"([^"]+)"/.exec(df)[1];
  const req = /require\("(\/app\/[^"]+)"\)/.exec(start)[1].replace(/^\/app\//, "");
  assert.strictEqual(
    req,
    cmd,
    `o /start sobe "${req}" e o CMD sobe "${cmd}" — so o /start roda em producao`
  );

  // o build nao pode achar caminho com a pasta `mirrorview/` dentro: na branch o produto esta
  // na RAIZ, entao `COPY mirrorview/...` falharia
  assert.equal(
    /mirrorview\//.test(df),
    false,
    "o Dockerfile da branch ainda copia `mirrorview/...`, mas na branch o produto esta na raiz"
  );
  assert.match(df, /COPY package\*\.json \.\//, "o `npm ci` precisa do package.json na raiz");
  cp.execSync(`git show ${sha}:package-lock.json`, { cwd: RAIZ, maxBuffer: 64 * 1024 * 1024 });
  assert.ok(fs.existsSync(path.join(RAIZ, "mirrorview", "src", "core", "tv-sources.js")));
});

test("a branch mirrorview NAO carrega os outros dois produtos", () => {
  // O worktree de geracao nasce com o repositorio INTEIRO. A primeira versao do gerador so
  // copiava o produto por cima, sem esvaziar antes — e a branch subiu com `plugin/` e
  // `mirrorstream/` dentro: o app de TV carregando o plugin e o addon de VOD na imagem.
  const sha = geraRascunho();
  const arquivos = cp
    .execSync(`git ls-tree -r --name-only ${sha}`, { cwd: RAIZ, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  for (const proibido of ["plugin/", "mirrorstream/", "tools/"]) {
    assert.equal(
      arquivos.some((f) => f.startsWith(proibido)),
      false,
      `a branch gerada tem ${proibido} — o app de TV nao deve carregar o plugin nem o addon de VOD`
    );
  }
  assert.ok(
    arquivos.includes("src/server.js"),
    "a branch precisa do produto na raiz (`src/server.js`), e nao em `mirrorview/src/server.js`"
  );
  // o que tem de estar
  for (const preciso of ["package.json", "package-lock.json", "Dockerfile", "beamup-start.js"]) {
    assert.ok(arquivos.includes(preciso), `a branch precisa de ${preciso} na raiz`);
  }
});

test(
  "a branch `mirrorview` publicada bate com a pasta mirrorview/",
  { skip: !temBranch(BRANCH) && "a branch ainda nao foi gerada" },
  () => {
    const gerada = geraRascunho();
    const publicada = cp.execSync(`git rev-parse ${BRANCH}`, { cwd: RAIZ, encoding: "utf8" }).trim();

    const a = assinatura(gerada);
    const b = assinatura(publicada);
    const soNaGerada = a.filter((x) => !b.includes(x));
    const soNaPublicada = b.filter((x) => !a.includes(x));

    assert.deepStrictEqual(
      { soNaGerada, soNaPublicada },
      { soNaGerada: [], soNaPublicada: [] },
      `a branch "${BRANCH}" diverge da pasta mirrorview/ — o app de TV subiria um codigo que o ` +
        `repositorio nao tem. Regere e publique:\n` +
        `  node tools/gerar-branch-mirrorview.js --push\n` +
        `  git push --force beamup-mv ${BRANCH}:master`
    );
  }
);

test(
  "a branch mirrorview publicada tem o produto na raiz",
  { skip: !temBranch(BRANCH) && "a branch ainda nao foi gerada" },
  () => {
    const arquivos = cp
      .execSync(`git ls-tree -r --name-only ${BRANCH}`, { cwd: RAIZ, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    assert.ok(arquivos.includes("src/server.js"), "`src/server.js` na raiz e' o que o build executa");
    assert.equal(
      arquivos.some((f) => f.startsWith("mirrorview/")),
      false,
      "a branch nao pode ter o produto dentro de `mirrorview/` — o CMD aponta para a raiz"
    );
  }
);