// OS TRES PRODUTOS SUBEM — o unico teste que prova isso.
//
// A decisao 155 aprendeu isso do jeito caro: a barreira lia `server.js` como TEXTO, e
// TEXTO NAO EXECUTA. Duas vezes um `require` quebrado (um `segmentos.registrar(app)`
// apontando para arquivo apagado) e uma `app.listen` deletada passaram a barreira
// inteira: o servidor nao subia, e o processo saia com codigo 0, sem escutar, sem erro.
// Daí nasceu `addon/test/server-carrega.test.js`, que sobe o servidor de verdade.
//
// A separacao em `nuvio/` (plugin) · `addon/` (catalogo para o Nuvio) · `stremio/`
// (addon Stremio) repete exatamente esse risco: tres `server.js` parecidos, tres
// conjuntos de caminho, e um `.gitignore`/`Dockerfile` que precisa saber onde cada um
// esta. Este teste sobe CADA um, em processo separado, e exige a linha de boot.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const os = require("node:os");

const RAIZ = path.join(__dirname, "..");

// Cada produto: o servidor e a frase que so ele escreve quando subiu de verdade.
// plugin/ NUNCA entra aqui: ele nao e' um servidor, roda dentro do app do Nuvio.
const PRODUTOS = [
  { chave: "mirrorstream", dir: "mirrorstream", nome: "MirrorStream (filmes e series: catalogo + player)", soVod: true },
  { chave: "mirrorview", dir: "mirrorview", nome: "MirrorView (TV ao vivo: 4 fontes, guia e catalogo)", soTv: true }
];

function sobe(produto, porta) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ["src/server.js"], {
      cwd: path.join(RAIZ, produto.dir),
      env: Object.assign({}, process.env, {
        PORT: String(porta),
        PUBLIC_BASE_URL: `http://127.0.0.1:${porta}`,
        DATA_DIR: path.join(os.tmpdir(), `mirror-boot-${produto.chave}-${porta}`),
        // O teste e' sobre "o processo sobe", nao sobre a topologia de producao.
        TV_BASE_URL: ""
      }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let saida = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ ok: false, motivo: `nao imprimiu a linha de boot em 30s`, saida: saida.slice(-400) });
    }, 30000);
    proc.stdout.on("data", (d) => {
      saida += String(d);
      if (saida.includes("[Mirror] listening on")) {
        clearTimeout(timer);
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 500);
        resolve({ ok: true, saida });
      }
    });
    proc.stderr.on("data", (d) => { saida += String(d); });
    proc.on("exit", (codigo) => {
      clearTimeout(timer);
      resolve({ ok: false, motivo: `saiu com codigo ${codigo}`, saida: saida.slice(-400) });
    });
  });
}

for (const produto of PRODUTOS) {
  test(`sobe de verdade: ${produto.chave}/ — ${produto.nome}`, async () => {
    const porta = 7600 + Math.floor(Math.random() * 300);
    const r = await sobe(produto, porta);
    assert.ok(r.ok, `${produto.chave}: ${r.motivo}\n${r.saida}`);
  });
}

test("os tres produtos tem onde viver, e nenhum se sobrepoe ao outro", () => {
  // `nuvio/` (plugin) nao tem `server.js`: ele roda DENTRO do app, e um `server.js`
  // la dentro seria um produto a mais sem dono.
  assert.ok(fs.existsSync(path.join(RAIZ, "plugin", "src", "core", "fontes.js")), "plugin/ sumiu");
  assert.ok(!fs.existsSync(path.join(RAIZ, "plugin", "server.js")), "plugin/ nao e' um servidor");
  for (const p of PRODUTOS) {
    assert.ok(fs.existsSync(path.join(RAIZ, p.dir, "src", "server.js")), `${p.dir}/src/server.js ausente`);
    assert.ok(fs.existsSync(path.join(RAIZ, p.dir, "public", "install.html")), `${p.dir}/public/install.html ausente`);
    assert.ok(fs.existsSync(path.join(RAIZ, p.dir, "package.json")), `${p.dir}/package.json ausente`);
  }
});

test("os tres produtos tem identidade propria e os ids nao batem", () => {
  // Dois addons com o mesmo `id` nao sao dois addons: o segundo sobrescreve o primeiro
  // na lista, e o usuario perde um dos dois sem nenhuma mensagem.
  const id = (dir) => {
    const src = fs.readFileSync(path.join(RAIZ, dir, "src", "server.js"), "utf8");
    // O id segue `com.<marca>.<produto>` — o regex accepts a marca inteira porque ela
    // mudou uma vez (com.mirror.* -> com.mirrorstream.*) e um padrao apertado aqui
    // acusaria a renomeacao como "id ausente" em vez de checar o que importa.
    const m = src.match(/id:\s*"(com\.[a-z]+\.[a-z]+)"/);
    return m ? m[1] : null;
  };
  const a = id("mirrorstream");
  const s = id("mirrorview");
  assert.ok(a, "o MirrorStream nao declara id com.<marca>.<produto>");
  assert.ok(s, "o MirrorView nao declara id com.<marca>.<produto>");
  assert.notStrictEqual(a, s, `os dois usam ${a} — um sobrescreve o outro na lista`);
  // o plugin tambem tem nome, e' o que o Nuvio mostra em Settings -> Plugins
  const fontes = require("/home/ubuntu/mirror/plugin/src/core/fontes.js");
  assert.strictEqual(fontes.NOME_REPOSITORIO, "MirrorStream", "o plugin se chama MirrorStream");
});

test("cada servidor resolve `public/` pelo modulo, nao pelo diretorio de execucao", () => {
  // MEDIDO 02/10/2026: com `process.cwd()`, `node addon/src/server.js` da raiz do repo
  // apontaria as quatro rotas de pagina para um `public/` que nao existe la. Isso e'
  // exatamente a armadilha que a separacao cria, e um servidor que so funciona de um
  // diretorio de trabalho quebra no container.
  for (const p of PRODUTOS) {
    const src = fs.readFileSync(path.join(RAIZ, p.dir, "src", "server.js"), "utf8");
    assert.ok(!/express\.static\("public"/.test(src), `${p.dir}: express.static ainda relativo ao cwd`);
    assert.ok(!/process\.cwd\(\),\s*"public"/.test(src), `${p.dir}: sendFile ainda relativo ao cwd`);
    assert.ok(/const PUBLICO = path\.join\(__dirname, "\.\.", "public"\)/.test(src), `${p.dir}: sem a constante PUBLICO`);
  }
});

test("o Dockerfile da raiz constroi o MirrorStream e aponta para a pasta certa", () => {
  const df = fs.readFileSync(path.join(RAIZ, "Dockerfile"), "utf8");
  assert.match(df, /COPY mirrorstream\/package\*\.json/, "o npm ci precisa do package.json do MirrorStream");
  assert.match(df, /COPY mirrorstream\/beamup-start\.js \/start/, "o /start do BeamUp esta em mirrorstream/");
  assert.match(df, /CMD \["node", "mirrorstream\/src\/server\.js"\]/, "o CMD tem de apontar para mirrorstream/src");
  assert.ok(!/CMD \["node", "src\/server\.js"\]/.test(df), "o CMD ainda aponta para a raiz");
  // O `.dockerignore` precisa nao vazar o `node_modules` do plugin para a imagem do addon.
  const di = fs.readFileSync(path.join(RAIZ, ".dockerignore"), "utf8");
  assert.match(di, /\*\*\/node_modules/, "node_modules do plugin entraria na imagem");
  assert.match(di, /\*\*\/test\//, "os testes de um produto entrariam na imagem de outro");
});