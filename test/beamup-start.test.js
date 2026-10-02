// O `/start` e' o que o scheduler do BeamUp EXECUTA (`node /start web`). O `CMD` do
// Dockerfile nao e' o que roda em producao — e' so o que roda no `docker run`.
//
// MEDIDO 02/10/2026: os dois apps novos subiram em loop de crash com
//     Error: Cannot find module '/app/src/server.js'
//     at Object.<anonymous> (/start:12:1)
//     requireStack: [ '/start' ]
// Os dois `beamup-start.js` faziam `require("/app/src/server.js")`, que era o caminho
// ANTIGO (quando o servidor era o `src/` na raiz). Apos a divisao em tres produtos o caminho
// virou `/app/mirrorstream/src/server.js` e `/app/mirrorview/src/server.js` — e o `CMD` foi
// atualizado, mas o `/start` nao.
//
// POR QUE A BARREIRA NAO PEGOU: `produtos-sobem.test.js` sobe o servidor com o comando do
// `CMD` (`node <produto>/src/server.js`), que estava certo. O `/start` e' um arquivo
// COPIADO para fora da arvore (`COPY <produto>/beamup-start.js /start`), entao ele nao esta
// em lugar nenhum que o teste percorra. Um arquivo que so quebra em producao, num caminho
// que so existe dentro da imagem.
//
// A regra que este arquivo trava: **o que o `/start` require tem de ser o mesmo arquivo que
// o `CMD` executa.** Nao basta os dois existirem — tem de ser o MESMO.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");

const PRODUTOS = [
  { nome: "MirrorStream", dockerfile: "Dockerfile", produto: "mirrorstream" },
  { nome: "MirrorView", dockerfile: "mirrorview/Dockerfile", produto: "mirrorview" }
];

for (const { nome, dockerfile, produto } of PRODUTOS) {
  test(`${nome}: o /start e o CMD executam o MESMO arquivo`, () => {
    const df = fs.readFileSync(path.join(RAIZ, dockerfile), "utf8");
    const start = fs.readFileSync(path.join(RAIZ, produto, "beamup-start.js"), "utf8");

    // o CMD
    const cmd = /CMD \["node",\s*"([^"]+)"/.exec(df);
    assert.ok(cmd, `o ${dockerfile} precisa de um CMD "node <arquivo>"`);
    const peloCmd = cmd[1]; // p.ex. "mirrorstream/src/server.js"

    // o que o /start require
    const req = /require\("(\/app\/[^"]+)"\)/.exec(start);
    assert.ok(req, `o ${produto}/beamup-start.js precisa ter require("/app/...")`);
    const peloStart = req[1].replace(/^\/app\//, ""); // p.ex. "mirrorstream/src/server.js"

    assert.strictEqual(
      peloStart,
      peloCmd,
      `o /start sobe "${peloStart}" e o CMD sobe "${peloCmd}" — em producao so o /start roda ` +
        `(o scheduler do BeamUp executa \`node /start web\`), entao o app cai em loop com ` +
        `Cannot find module '/app/${peloStart}'. Corrija o require do beamup-start.js.`
    );

    // e o arquivo tem de existir de fato na arvore (o resto do caminho da imagem)
    assert.ok(
      fs.existsSync(path.join(RAIZ, peloCmd)),
      `o CMD aponta para "${peloCmd}", que nao existe no repo — o build passa (COPY . .) e o app nao sobe`
    );
  });

  test(`${nome}: o beamup-start.js copia do lugar certo e tem shebang executavel`, () => {
    const df = fs.readFileSync(path.join(RAIZ, dockerfile), "utf8");
    assert.ok(
      df.includes(`COPY ${produto}/beamup-start.js /start`),
      `o ${dockerfile} tem que copiar ${produto}/beamup-start.js para /start — sem isso o scheduler ` +
        `roda um /start inexistente e o container entra em loop`
    );
    assert.match(df, /RUN chmod \+x \/start/, "o /start precisa ser executavel");
    assert.match(df, /USER node/, "o processo nao pode rodar como root");
  });
}

test("o nenhum dos dois /start aponta para o caminho antigo do src/ na raiz", () => {
  // O caminho `/app/src/server.js` existia quando o servidor era o `src/` na raiz. Com tres
  // produtos ele nao existe em lugar nenhum, e o erro so aparece em producao.
  for (const { produto } of PRODUTOS) {
    const start = fs.readFileSync(path.join(RAIZ, produto, "beamup-start.js"), "utf8");
    assert.equal(
      start.includes('require("/app/src/server.js")'),
      false,
      `${produto}/beamup-start.js ainda sobe "/app/src/server.js" — esse caminho era do ` +
        "`src/` na raiz e nao existe mais (MEDIDO 02/10/2026: crash loop nos dois apps novos)"
    );
  }
});

test("o `src/` na raiz really nao existe mais (o caminho que o /start usava)", () => {
  assert.equal(
    fs.existsSync(path.join(RAIZ, "src")),
    false,
    "o `src/` na raiz voltou? Se voltou, reveja as tres pastas de produto antes de mexer no /start"
  );
  assert.ok(fs.existsSync(path.join(RAIZ, "plugin")), "o plugin precisa estar em plugin/");
  assert.ok(fs.existsSync(path.join(RAIZ, "mirrorstream")), "o addon de VOD precisa estar em mirrorstream/");
  assert.ok(fs.existsSync(path.join(RAIZ, "mirrorview")), "o addon de TV precisa estar em mirrorview/");
});