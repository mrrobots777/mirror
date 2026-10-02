// Lista arquivos de codigo que NENHUM outro arquivo do repositorio referencia.
//
// Nao e' um teste — e' a ferramenta que roda antes de apagar qualquer coisa. Apagar por
// "parece que nao usa" e' como o projeto ja perdeu codigo: o `addon/src/` inteiro voltou
// por cima do `mirrorstream/` num `mv` e reintroduziu os modulos de TV.
//
// As duas armadilhas que a PRIMEIRA versao deste script caiu (medido 02/10/2026):
//
//   1. buscou pelo nome COM `.js` e declarou `lib/jogador.js` orfao. O require do projeto e'
//      `require("./lib/jogador")` — SEM extensao. O arquivo e' usado no `server.js:1593`
//      (`jogador.partesDe`), e apagar teria quebrado o `/api/streams` sem nenhum aviso.
//   2. nao distinguia import de uso: `mirrorview/src/server.js` faz `require("./lib/jogador")`
//      e NUNCA chama. O arquivo e' orfao ali, mas nao no MirrorStream.
//
// Por isso: casa tanto `x` quanto `x.js`, e separa quem so importa de quem chama.
//
// USO: node tools/achar-orfaos.js [pasta ...]   (padrao: as raizes de codigo dos produtos)
//
// Os `test/` sao EXECUTADOS (`node --test <dir>/`), nunca importados — entao eles aparecem
// como "ninguem importa" em qualquer ferramenta que so procure `require`. A primeira versao
// acusou 22 arquivos orfaos e 22 eram a barreira. Ignorar `test/` nao e' excecao: e' o
// definition de codigo nesta arvore.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
// So `src/`. As pastas de teste NAO entram: elas sao executadas por `node --test`, nunca
// importadas, entao qualquer busca por `require` as acusa como orfas. Passar `test/` como
// raiz nao resolve — o filtro e' por NOME de pasta, e a raiz chamaria o proprio nome.
const PADROES = ["mirrorstream/src", "mirrorview/src"];

function arquivosEm(alvo, acc = []) {
  const abs = path.join(RAIZ, alvo);
  if (!fs.existsSync(abs)) return acc;
  const st = fs.statSync(abs);
  if (st.isFile()) {
    // Relativo a RAIZ, de proposito: os relatorios citam caminhos que a pessoa abre, e
    // `path.join(RAIZ, absoluto)` viraria `/home/ubuntu/mirror/home/ubuntu/mirror/...`.
    if (abs.endsWith(".js")) acc.push(alvo);
    return acc;
  }
  for (const nome of fs.readdirSync(abs)) {
    if (nome === "node_modules" || nome.startsWith(".") || nome === "test") continue;
    // O `acc.push(...resultado)` e' obrigatorio: a primeira versao chamava a recursao e
    // JOGAVA o retorno fora, entao a ferramenta reportava "0 orfaos" com o src inteiro
    // cheio de arquivos. Uma ferramenta de busca que devolve vazio sem erro e' a pior
    // das duas falhas: ela "confirma" que nao ha nada para apagar.
    acc.push(...arquivosEm(path.join(alvo, nome)));
  }
  return acc;
}

// Todo arquivo de texto do repo, uma vez. Bundle minificado em plugin/public e' ruido: tem o
// nome de dentro de tudo e nao prova uso.
function todoOTexto() {
  const alvos = [];
  const anda = (d) => {
    const abs = path.join(RAIZ, d);
    if (!fs.existsSync(abs)) return;
    const st = fs.statSync(abs);
    if (st.isFile()) return alvos.push(abs);
    for (const n of fs.readdirSync(abs)) {
      if (["node_modules", ".git", "public"].includes(n)) continue;
      anda(path.join(d, n));
    }
  };
  anda(".");
  return alvos
    .filter((f) => /\.(js|yml|json|md|sh)$/.test(f))
    .filter((f) => !f.includes(`${path.sep}public${path.sep}`))
    .map((f) => ({ arquivo: f, texto: fs.readFileSync(f, "utf8") }));
}

const textos = todoOTexto();
const raizes = process.argv.length > 2 ? process.argv.slice(2) : PADROES;
const alvos = raizes.flatMap((r) => arquivosEm(r));

const escapa = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const linhas = [];
for (const alvo of alvos) {
  const nome = path.basename(alvo).replace(/\.js$/, "");
  const reRequire = new RegExp(`require\\(\\s*["'\`][^"'\`]*\\/${escapa(nome)}\\b`);
  const reChamada = new RegExp(`\\b${escapa(nome)}\\s*\\.`);

  const importaEm = [];
  const usaEm = [];
  for (const { arquivo, texto } of textos) {
    if (path.resolve(arquivo) === path.resolve(alvo)) continue;
    if (reRequire.test(texto)) importaEm.push(arquivo);
    if (reChamada.test(texto)) usaEm.push(arquivo);
  }
  linhas.push({ alvo, nome, importaEm, usaEm });
}

const orfaos = linhas.filter((l) => l.importaEm.length === 0);
const soImporta = linhas.filter((l) => l.importaEm.length > 0 && l.usaEm.length === 0);

console.log(`\n=== NINGUEM IMPORTA (candidato a apagar) — ${orfaos.length} ===`);
for (const l of orfaos) {
  console.log(`  ${l.alvo}  (${fs.readFileSync(path.join(RAIZ, l.alvo), "utf8").split("\n").length} linhas)`);
}

console.log(`\n=== SO IMPORTADO, NUNCA CHAMADO (import morto) — ${soImporta.length} ===`);
for (const l of soImporta) {
  console.log(`  ${l.alvo}`);
  for (const a of new Set(l.importaEm)) console.log(`      importado em ${a}`);
}

console.log(`\n=== EM USO (nao mexer) — ${linhas.length - orfaos.length - soImporta.length} ===`);
for (const l of linhas) {
  if (orfaos.includes(l) || soImporta.includes(l)) continue;
  console.log(`  ${l.alvo}  <- ${new Set(l.usaEm).size} arquivo(s) chamam`);
}
console.log();