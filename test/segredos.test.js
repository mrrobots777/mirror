// AS CREDENCIAIS: o que ainda esta no padrao do codigo, e o que nunca pode ser commitado.
//
// MOTIVO (medido 01/10/2026, auditoria): o `.env` estava VERSIONADO apesar de estar no
// `.gitignore` (o gitignore nao tira o que ja esta versionado) e continha a senha do painel e a
// chave do TMDB. A rotacao dessas e acao do DONO (conta dele, nao nossa), e o que este arquivo
// garante e duplo:
//
//   1. NENHUM arquivo de ambiente pode ser versionado de novo — e o teste falha no CI, nao numa
//      auditoria manual meses depois;
//   2. toda variavel que tem cara de credencial precisa estar marcada no registro unico, para o
//      `/health` conseguir dizer `definida` ou `ausente` sem nunca mostrar o valor.
//
// O `.gitignore` sozinho nao resolve: ele so vale para o que ainda nao esta no indice.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Este teste e' DO REPO, nao de um produto: o `.gitignore` protege os tres (nuvio/,
// addon/ e stremio/) ao mesmo tempo. O `src/server.js`, esse sim, e' do addon.
const raiz = path.join(__dirname, "..");
const MS = path.join(raiz, "mirrorstream");
const nomes = require("../mirrorstream/src/core/nomes");

function arquivosVersionados() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: raiz, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (_) {
    // Sem git (rodando de um pacote, por exemplo) o teste nao tem o que medir: melhor pular do
    // que falhar por um motivo que nao e do codigo.
    return null;
  }
}

test("segredos: nenhum arquivo de ambiente pode estar versionado (o .env versionado expôs painel e TMDB)", () => {
  const arquivos = arquivosVersionados();
  if (!arquivos) return;
  const proibidos = arquivos.filter((f) => /^\.env(\.|$)|(^|\/)\.env\./i.test(f) && !/\.example$/i.test(f));
  assert.deepEqual(proibidos, [], `arquivo de ambiente versionado: ${proibidos.join(", ")} — remova com "git rm --cached"`);
  // O template continua versionado de proposito (e nao tem segredo: e o exemplo).
  assert.ok(arquivos.includes(".env.example"), "o .env.example e a documentacao das variaveis e deve existir");
});

test("segredos: o .gitignore cobre o .env (defesa em segunda linha)", () => {
  const ignore = fs.readFileSync(path.join(raiz, ".gitignore"), "utf8");
  assert.match(ignore, /^\.env\s*$/m, "o .env precisa estar no .gitignore");
});

test("segredos: toda variável com cara de credencial está marcada no registro único", () => {
  // Se alguem criar `XTREAM_BLZE_PASS` amanha e nao marcar `segredo: true`, o `/health` passa a
  // esconder dela e ninguem descobre. E o teste que fecha essa porta.
  const suspicious = /PASS|SECRET|TOKEN|_KEY|^.*_USER$|_USERNAME$|WEBHOOK/i;
  for (const [nome, meta] of Object.entries(nomes.VARIAVEIS)) {
    if (!suspicious.test(nome)) continue;
    assert.ok(meta && meta.segredo === true, `${nome} tem cara de credencial e precisa de segredo: true no registro`);
  }
});

test("segredos: o /health mostra o estado das credenciais e nunca o valor", () => {
  const fs2 = require("node:fs");
  const server = fs2.readFileSync(path.join(MS, "src", "server.js"), "utf8");
  assert.match(server, /credenciais: credenciaisNoAr\(\)/, "o /health tem que mostrar o estado das credenciais");
  assert.match(server, /function credenciaisNoAr\(\)/, "a funcao que monta o estado");
  // O ponto inteiro: estado, nunca conteudo.
  assert.match(server, /estado: definida \? "definida" : "ausente no ambiente"/,
    "so 'definida' ou 'ausente no ambiente' — nunca o valor, nem um pedaco dele");
  assert.ok(!/JSON\.stringify\(ENV\[/.test(server), "o valor da variavel nao pode ser serializado em lugar nenhum");
  // E todas as marcadas tem que existir de verdade no registro.
  const marcadas = Object.values(nomes.VARIAVEIS).filter((m) => m && m.segredo).length;
  assert.ok(marcadas >= 16, `esperado 16 credenciais marcadas no registro, veio ${marcadas}`);
});