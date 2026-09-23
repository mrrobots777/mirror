// O SERVIDOR SOBE DE PE. DECISAO 155.
//
// Este arquivo existe por um buraco que a 155 abriu e que os outros 245 testes NAO pegaram.
//
// MEDIDO: com as 4 fontes de TV e o relay fora, o `server.js` ficou com um
// `segmentos.registrar(app)` para um arquivo apagado. O processo morria no boot com
// `ReferenceError: segmentos is not defined` — e a barreira de testes ficava VERDE, porque ela
// le o `server.js` como TEXTO (`readFileSync`) e procura regex. Texto nao executa: nenhuma das
// centenas de verificacoes dela podia ver um `require` quebrado.
//
// A segunda metade do estrago foi pior e mais silenciosa: uma delecao por linha levou junto o
// `app.listen(...)` e o guard de memoria. O arquivo passava no `node -c` (a sintaxe estava
// certainissima), os 245 testes passavam, e o servidor nao subia — saia com codigo 0 e nao
// escutava em lugar nenhum.
//
// Entao este teste faz a unica coisa que pega os dois: SOBE o servidor de verdade, num processo
// separado, e exige que ele escute. Nao da para fingir isso com regex.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawn } = require("node:child_process");

const RAIZ = path.join(__dirname, "..");

// Sobe o servidor, espera ele announces a porta, e devolve o que ele disse.
function sobeServidor(porta, ms = 25000) {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [path.join(RAIZ, "src", "server.js")], {
      cwd: RAIZ,
      env: {
        ...process.env,
        PORT: String(porta),
        PUBLIC_BASE_URL: `http://localhost:${porta}`,
        DATA_DIR: `/tmp/mirror-test-boot-${porta}`,
        // Sem o cluster: o teste e' sobre o boot, nao sobre a topologia de producao.
        TV_BASE_URL: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    let pronto = false;
    const escuta = (marcador) => {
      if (pronto) return;
      if (!saida.includes(marcador)) return;
      pronto = true;
      clearTimeout(timer);
      resolve({ ok: true, saida, filho });
    };
    const timer = setTimeout(() => {
      if (pronto) return;
      pronto = true;
      filho.kill("SIGKILL");
      resolve({ ok: false, saida, motivo: "timeout esperando o servidor escutar" });
    }, ms);
    filho.stdout.on("data", (d) => { saida += d.toString(); escuta("[Mirror] listening on"); });
    filho.stderr.on("data", (d) => { saida += d.toString(); });
    filho.on("exit", (code) => {
      if (pronto) return;
      pronto = true;
      clearTimeout(timer);
      resolve({ ok: false, saida, motivo: `o processo saiu com codigo ${code} antes de escutar` });
    });
  });
}

test("decisao 155: o servidor SOBE e ESCUTA (nenhum require quebrado, nenhum bloco apagado)", async () => {
  const r = await sobeServidor(7099);
  try {
    assert.equal(r.ok, true, `${r.motivo || "nao escutou"}\n--- saida do processo ---\n${r.saida}`);
    assert.ok(r.saida.includes("[Mirror] listening on :7099"), "a linha de boot tem de aparecer");
    // O `ReferenceError` que a 155 deixou e' o sintoma de `require` quebrado. Se ele voltar,
    // o processo morre antes de escutar e o teste acima ja falha — mas a mensagem deixa clara
    // a causa, que e' o que importa quando alguem rodar isso daqui a seis meses.
    assert.equal(/ReferenceError/.test(r.saida), false, "houve ReferenceError no boot");
  } finally {
    if (r.filho) r.filho.kill("SIGKILL");
  }
});

test("decisao 155: nenhum arquivo de src/ require um modulo que nao existe", () => {
  // O mesmo buraco, visto de dentro: um `require` de modulo apagado e' o sintoma. O
  // `ReferenceError` e' so o primeiro deles — o segundo (uma variavel que ficou sem valor) so
  // aparece em TEMPO DE EXECUCAO, e e' o teste de cima que pega esse.
  const fs = require("fs");
  const RAIZ_SRC = path.join(RAIZ, "src");
  const anda = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const cheio = path.join(dir, e.name);
    return e.isDirectory() ? anda(cheio) : [cheio];
  });
  const problemas = [];
  for (const arquivo of anda(RAIZ_SRC).filter((f) => f.endsWith(".js"))) {
    const texto = fs.readFileSync(arquivo, "utf8");
    for (const m of texto.matchAll(/require\("(\.[^"]+)"\)/g)) {
      const alvo = path.resolve(path.dirname(arquivo), m[1]);
      const existe = [".js", ".json", ""].some((ext) => fs.existsSync(alvo + ext))
        || fs.existsSync(path.join(alvo, "index.js"));
      if (!existe) problemas.push(`${path.relative(RAIZ_SRC, arquivo)} -> ${m[1]}`);
    }
  }
  assert.deepEqual(problemas, [], "require de modulo inexistente: " + problemas.join(" | "));
});
