#!/usr/bin/env node
// Gera a branch `mirrorview`: a MESMA arvore do MirrorView, com o producto na RAIZ.
//
// POR QUE ISTO EXISTE (medido 02/10/2026)
//
// O dono quer DOIS apps no BeamUp: `mirrorstream` (VOD) e `mirrorview` (TV). O problema e'
// que o build do BeamUp (Dokku) sobe o `Dockerfile` da RAIZ do repositorio, e a CLI nao
// expoe `builder-dockerfile:set` — o SSH aceita apenas `logs` e responde
// `001cERR unsupported command` para qualquer outro (medido). A sonda dentro do container
// provou que tambem nao existe sinal de runtime: `os.hostname()` e' o ID do container
// (`e0a41c051a08`) e o ambiente so tem as variaveis do Dockerfile.
//
// Resultado: dois apps do MESMO repo, no MESMO branch, sao **identicos por construcao**. Foi
// o que aconteceu — os dois subiram servindo `com.mirrorstream.addon`.
//
// A SAIDA: o que o build constroi e' o REF empurrado, entao cada app recebe uma BRANCH
// diferente, e cada branch tem o Dockerfile da raiz do seu produto:
//
//   master            -> Dockerfile da raiz  -> MirrorStream (VOD)
//   branch mirrorview -> Dockerfile de TV    -> MirrorView (TV), com `src/` na raiz
//
// A branch e' GERADA, nunca editada a mao: a fonte da verdade continua sendo a pasta
// `mirrorview/` do `master`. Deriva e' impossivel por construcao, e `test/mirrorview-branch.test.js`
// trava que a branch na ar bate com a pasta.
//
// USO:
//   node tools/gerar-branch-mirrorview.js            # gera e mostra o diff
//   node tools/gerar-branch-mirrorview.js --push     # gera e empurra pro remote `novo`
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const RAIZ = path.join(__dirname, "..");
const PRODUTO = "mirrorview";
const PASTA = path.join(RAIZ, PRODUTO);

// A branch e' configuravel para o teste poder gerar numa branch de rascunho e comparar com a
// publicada. Gerar direto na `mirrorview` e comparar com ela mesma daria verde sempre.
const BRANCH =
  (process.argv.find((a) => a.startsWith("--branch=")) || "").split("=")[1] || "mirrorview";
const ARVORE = path.join("/tmp", "arvore-mirrorview");

const empurra = process.argv.includes("--push");

// `cmd` ja vem completo (com as flags). `opts` e' opcional. A primeira versao tinha um
// segundo argumento `args` concatenado por cima, e quando ele faltava virava a string
// "undefined" no fim do comando — que o git reclamava com um `usage:` enorme em vez de
// dizer o que tinha dado errado.
const roda = (cmd, opts = {}) =>
  cp.execSync(cmd, { cwd: RAIZ, encoding: "utf8", stdio: "pipe", ...opts }).trim();

if (!fs.existsSync(PASTA)) {
  console.error(`a pasta ${PRODUTO}/ nao existe — nada a gerar`);
  process.exit(1);
}

// 1. arvore limpa
cp.execSync(`rm -rf ${ARVORE}`);

// 2. worktree da branch, recriada do zero
try {
  cp.execSync(`git worktree remove --force ${ARVORE}`, { stdio: "ignore" });

// Sai com a branch no stdout quando o chamador pediu, para o teste consumir sem ler log.
if (process.env.MIRROR_IMPRIMIR_BRANCH) process.stdout.write(sha + "\n");
} catch (_) {
  /* nao existia */
}
try {
  cp.execSync(`git branch -D ${BRANCH}`, { stdio: "ignore" });
} catch (_) {
  /* nao existia */
}
roda(`git worktree add --detach ${ARVORE} HEAD`);

// 3. ESVAZIA o worktree. Ele nasce com o repositorio INTEIRO (do `HEAD`), e so adicionar os
//    arquivos do produto por cima deixaria `plugin/` e `mirrorstream/` dentro da branch — o app
//    de TV carregando o plugin e o addon de VOD na imagem. A primeira versao fez exatamente
//    isso e o teste `a branch NAO contem os outros dois produtos` pegou.
cp.execSync(`git -C ${ARVORE} rm -rq -f .`, { stdio: "ignore" });

// 4. o produto vai para a RAIZ da branch
for (const nome of fs.readdirSync(PASTA)) {
  if (nome === "Dockerfile") continue; // o Dockerfile da raiz seria sobrescrito
  if (nome === "node_modules") continue;
  if (nome.startsWith(".")) continue;
  cp.execSync(`cp -R ${JSON.stringify(path.join(PASTA, nome))} ${JSON.stringify(ARVORE + "/" + nome)}`);
}

// 4. o Dockerfile do MirrorView, com os caminhos reescritos para a raiz
const dfOrigem = fs.readFileSync(path.join(PASTA, "Dockerfile"), "utf8");
// Na raiz da branch nao existe pasta `mirrorview/`, entao todo caminho prefixado com ela
// perde o prefixo. E' a UNICA transformacao: se surgir outra, e' sinal de que a pasta e' a
// raiz e o Dockerfile da raiz e que esta certo.
const df = dfOrigem.split("mirrorview/").join("");
fs.writeFileSync(path.join(ARVORE, "Dockerfile"), df);

// 5. o launcher tambem mora na raiz agora
const startOrigem = fs.readFileSync(path.join(PASTA, "beamup-start.js"), "utf8");
fs.writeFileSync(
  path.join(ARVORE, "beamup-start.js"),
  startOrigem.replace('require("/app/mirrorview/src/server.js")', 'require("/app/src/server.js")')
);

// 6. `.dockerignore` proprio: a branch so tem o produto, entao nao ha o que excluir de outro
fs.writeFileSync(
  path.join(ARVORE, ".dockerignore"),
  ["node_modules", "**/node_modules", ".git", ".env", "**/.env", "*.md", "test/", "**/test/", ""].join("\n")
);

// 7. o lockfile tem que bater com o package.json (o build roda `npm ci`)
if (!fs.existsSync(path.join(ARVORE, "package-lock.json"))) {
  console.error("faltou package-lock.json na branch — o build roda `npm ci` e quebraria");
  process.exit(1);
}

// 8. commit na branch
roda(`git -C ${ARVORE} add -A`);
roda(`git -C ${ARVORE} -c user.name=mirror -c user.email=mirror@localhost commit -q -m "mirrorview: arvore do produto na raiz (gerada; nao editar a mao)"`);
roda(`git -C ${ARVORE} branch -f ${BRANCH}`);
const sha = roda(`git -C ${ARVORE} rev-parse HEAD`);

const arquivos = roda(`git -C ${ARVORE} ls-tree -r --name-only HEAD | wc -l`).trim();
console.log(`branch ${BRANCH}: ${arquivos} arquivos, ${sha.slice(0, 8)}`);
console.log(`  Dockerfile  -> ${/CMD \["node", "([^"]+)"/.exec(df)[1]}`);
console.log(`  /start     -> ${/require\("(\/app\/[^"]+)"\)/.exec(fs.readFileSync(path.join(ARVORE, "beamup-start.js"), "utf8"))[1]}`);

if (empurra) {
  const remoto = process.argv.find((a) => a.startsWith("--remote="))?.split("=")[1] || "novo";
  cp.execSync(`git push --force ${JSON.stringify(remoto)} ${BRANCH}:${BRANCH} ${BRANCH}:HEAD`, {
    cwd: RAIZ,
    stdio: "inherit",
  });
  console.log(`\nempurrada para \`${remoto}\`. Para o app do BeamUp:`);
  console.log(`  git push --force beamup-mv ${BRANCH}:master`);
} else {
  console.log(`\nnada foi empurrado. Para publicar: --push`);
}

cp.execSync(`git worktree remove --force ${ARVORE}`, { stdio: "ignore" });

// O teste consome a branch pelo stdout em vez de refazer a geracao aqui dentro. A primeira
// versao do teste COPIOU estes passos, e as duas versoes divergiram na primeira rodada — que
// e' o risco de duplicar a logica de um gerador: o teste passa, e nao prova nada. Se o teste
// chama o gerador de verdade, ha uma so implementacao.
if (process.env.MIRROR_IMPRIMIR_BRANCH) process.stdout.write(sha + "\n");