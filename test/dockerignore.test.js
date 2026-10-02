// O `.dockerignore` e' o unico arquivo que decide o que ENTRA na imagem, e ele e' aplicado
// ao CONTEXTO DE BUILD — que, para os dois addons, e' a RAIZ do repo.
//
// MEDIDO 02/10/2026: eu tinha posto `mirrorview/` no `.dockerignore` para o MirrorStream
// nao carregar codigo de TV. O efeito colateral foi silencioso e total: o
// `mirrorview/Dockerfile` faz
//
//     COPY mirrorview/package*.json ./
//     COPY mirrorview/beamup-start.js /start
//
// e os dois passam a falhar, porque a pasta nem chega no contexto. **O deploy da BeamUp nao
// pegou**, porque ela sobe o `./Dockerfile` da raiz — que nunca precisou dessa pasta. O
// defeito so aparecia em `docker build -f mirrorview/Dockerfile .`, que e' o que o README
// manda rodar.
//
// Nenhum teste acusaria: `produtos-sobem.test.js` sobe os servidores com `node`, sem Docker.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");

const regras = fs
  .readFileSync(path.join(RAIZ, ".dockerignore"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  // Barra final NAO faz parte do nome: `plugin/` casa `plugin/src/x.js`, e comparar com
  // `regra + "/"` daria `plugin//` e nunca casaria. Foi o que fez este teste acusar
  // "o plugin nao entra na imagem" com `plugin/` claramente no arquivo.
  .map((l) => l.replace(/\/+$/, ""));

const DOCKERFILES = [
  { arquivo: "Dockerfile", nome: "MirrorStream" },
  { arquivo: "mirrorview/Dockerfile", nome: "MirrorView" }
];

// Todo caminho que um Dockerfile copia precisa sobreviver ao .dockerignore.
function ignorado(caminho) {
  return regras.some((regra) => {
    if (regra.includes("*")) {
      const re = new RegExp(
        "^" +
          regra
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*\//g, "(?:.*/)?")
            .replace(/\*/g, "[^/]*") +
          "$"
      );
      return re.test(caminho);
    }
    return caminho === regra || caminho.startsWith(regra + "/");
  });
}

for (const { arquivo, nome } of DOCKERFILES) {
  test(`${nome}: todo caminho que o Dockerfile copia chega no contexto de build`, () => {
    const df = fs.readFileSync(path.join(RAIZ, arquivo), "utf8");
    const copies = [...df.matchAll(/^COPY\s+(.+)$/gm)].map((m) =>
      m[1]
        .replace(/--from=\S+/g, "")
        .trim()
        .split(/\s+/)
    );

    assert.ok(copies.length > 0, `${arquivo}: nenhum COPY para conferir`);

    for (const args of copies) {
      const destino = args[args.length - 1];
      // `COPY . .` e `COPY a b c dest/` nao nomeiam arquivo de entrada
      if (destino === ".") continue;
      for (const origem of args.slice(0, -1)) {
        if (origem.includes("*") && !origem.startsWith("mirror")) {
          // `package*.json` precisa que a PASTA exista
          const pasta = origem.split("*")[0].replace(/\/$/, "");
          if (pasta && !ignorado(pasta)) continue;
        }
        if (origem.startsWith("mirrorview/") || origem.startsWith("mirrorstream/")) {
          assert.equal(
            ignorado(origem.split("*")[0].replace(/\/$/, "")),
            false,
            `${arquivo} faz \`COPY ${origem} …\`, mas \`.dockerignore\` exclui "${origem.split("/")[0]}/" — ` +
              `o build falha com "COPY failed: no such file". O contexto de build e' a RAIZ, e o ` +
              `.dockerignore vale para os DOIS addons.`
          );
        }
      }
    }
  });
}

test("o .dockerignore nao exclui nenhuma pasta de produto", () => {
  // `plugin/` PODE ser excluido: nenhum dos dois addons o usa. `mirrorview/` e
  // `mirrorstream/` NAO podem — os Dockerfiles de cada um copiam da propria pasta.
  assert.ok(ignorado("plugin/src/server.js"), "o plugin nao entra na imagem de nenhum addon");
  assert.equal(ignorado("mirrorview"), false, "mirrorview/ e' copiado pelo mirrorview/Dockerfile");
  assert.equal(ignorado("mirrorstream"), false, "mirrorstream/ e' copiado pelo Dockerfile da raiz");
});

test("os dois Dockerfiles sao construiveis com o MESMO contexto (a raiz)", () => {
  // E' o que o `mirrorview/README.md` manda rodar. Um Dockerfile que so funciona com
  // contexto proprio obriga a documentacao a divergir do comando de deploy.
  for (const p of ["mirrorstream", "mirrorview"]) {
    for (const precisa of ["package.json", "package-lock.json", "src/server.js", "beamup-start.js"]) {
      const caminho = `${p}/${precisa}`;
      assert.ok(
        fs.existsSync(path.join(RAIZ, caminho)),
        `o ${p}/Dockerfile precisa de ${caminho}`
      );
      assert.equal(ignorado(caminho), false, `${caminho} esta no .dockerignore`);
    }
  }
});