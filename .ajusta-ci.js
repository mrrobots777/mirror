const fs = require("fs");
const path = require("path");

// O `addon/` era a raiz antiga. Depois da divisao ele virou `mirrorstream/` (VOD) e
// `mirrorview/` (TV), e nao ha mais ninguem para onde apontar: o Dockerfile da raiz, a CI,
// o .dockerignore e as docs ja foram trocados. Some com ele.
const RAIZ = "/home/ubuntu/mirror";

// o .gitignore precisa cobrir o novo espelho do node_modules
{
  const p = path.join(RAIZ, ".gitignore");
  let t = fs.readFileSync(p, "utf8");
  if (!t.includes("mirrorstream/node_modules")) {
    t = t.replace(
      "nuvio/node_modules/\nnuvio/dist/\nnuvio/public/idx/",
      "plugin/node_modules/\nplugin/dist/\nplugin/public/idx/\nmirrorstream/node_modules/\nmirrorview/node_modules/"
    );
    fs.writeFileSync(p, t);
    console.log("ok .gitignore");
  }
}

// o .dockerignore nao pode vazar o node_modules do plugin nem o mirrorview
{
  const p = path.join(RAIZ, ".dockerignore");
  let t = fs.readFileSync(p, "utf8");
  t = t.replace("stremio/\n", "mirrorview/\nplugin/\n");
  fs.writeFileSync(p, t);
  console.log("ok .dockerignore: mirrorview e plugin fora da imagem");
}

// Dockerfile da raiz: constroi o MIRRORSTREAM (o addon de VOD)
{
  const p = path.join(RAIZ, "Dockerfile");
  let t = fs.readFileSync(p, "utf8");
  t = t.split("addon/").join("mirrorstream/");
  t = t.split("mirrorstream/beamup-start.js /start").join("mirrorstream/beamup-start.js /start");
  t = t.replace(
    "Este Dockerfile mora na RAIZ do repo de proposito: e' o ponto de entrada que o BeamUp\n// usa (o build roda `docker build .` na raiz), e um Dockerfile dentro de `mirrorstream/` exigiria",
    "Este Dockerfile mora na RAIZ do repo de proposito: e' o ponto de entrada que o BeamUp\n// usa (o build roda `docker build .` na raiz), e um Dockerfile dentro de `mirrorstream/` exigiria"
  );
  t = t.replace("O repo tem TRES produtos (`nuvio/`, `addon/`, `stremio/`) e este e' o do `addon/`.",
                "O repo tem TRES produtos (`plugin/`, `mirrorstream/`, `mirrorview/`) e este e' o do\n// `mirrorstream/` (filmes e series). O do `mirrorview/` e' `mirrorview/Dockerfile`.");
  fs.writeFileSync(p, t);
  console.log("ok Dockerfile da raiz -> mirrorstream/");
}

// o Dockerfile do mirrorview
{
  const p = path.join(RAIZ, "mirrorview/Dockerfile");
  let t = fs.readFileSync(p, "utf8");
  t = t.split("stremio/").join("mirrorview/");
  t = t.split("mirrorstream/beamup-start.js /start").join("mirrorview/beamup-start.js /start");
  t = t.replace("CMD [\"node\", \"mirrorview/src/server.js\"]", "CMD [\"node\", \"mirrorview/src/server.js\"]");
  t = t.replace("# MirrorStream Stremio", "# MirrorView");
  fs.writeFileSync(p, t);
  console.log("ok mirrorview/Dockerfile");
}

// a CI: tres produtos, tres barreiras
{
  const p = path.join(RAIZ, ".github/workflows/testes.yml");
  let t = fs.readFileSync(p, "utf8");
  t = t.split("addon/").join("mirrorstream/");
  t = t.split("working-directory: nuvio").join("working-directory: plugin");
  t = t.split("node -c nuvio/").join("node -c plugin/");
  t = t.split("nuvio/src").join("plugin/src");
  t = t.split("nuvio/build.js nuvio/teste.js").join("plugin/build.js plugin/teste.js");
  t = t.replace("          mirrorstream/package-lock.json", "          mirrorstream/package-lock.json\n            mirrorview/package-lock.json");
  t = t.replace("- name: instala as dependencias (stremio)", "- name: instala as dependencias (mirrorview)");
  t = t.replace("        working-directory: stremio", "        working-directory: mirrorview");
  t = t.replace("      # O repo tem TRES produtos: `plugin/` (plugin), `addon/` (catalogo para o Nuvio)\n      # e `stremio/` (addon Stremio). Cada um tem o seu package.json e as suas deps.",
                "      # O repo tem TRES produtos: `plugin/` (o plugin do Nuvio), `mirrorstream/` (addon\n      # de filmes e series) e `mirrorview/` (addon de TV ao vivo). Cada um tem o seu\n      # package.json e as suas dependencias.");
  t = t.replace("          for produto in addon stremio; do", "          for produto in mirrorstream mirrorview; do");
  t = t.replace("        run: node --test addon/test/", "        run: node --test mirrorstream/test/");
  t = t.replace("          addon=$(node --test addon/test/ 2>&1", "          ms=$(node --test mirrorstream/test/ 2>&1");
  t = t.replace("          total=$((addon + repo))", "          total=$((ms + repo))");
  t = t.replace('          echo "addon: $addon | repo: $repo | total: $total"', '          echo "mirrorstream: $ms | repo: $repo | total: $total"');
  fs.writeFileSync(p, t);
  console.log("ok .github/workflows/testes.yml");
}

// a publicacao do plugin
{
  const p = path.join(RAIZ, ".github/workflows/publicar-pages.yml");
  let t = fs.readFileSync(p, "utf8");
  t = t.split("working-directory: nuvio").join("working-directory: plugin");
  t = t.split("path: nuvio/public").join("path: plugin/public");
  t = t.split("node tools/gerar-indice.js").join("node tools/gerar-indice.js");
  t = t.replace("if [ -f ../addon/src/scrapers/xtream.js ]; then", "if [ -f ../mirrorstream/src/scrapers/xtream.js ]; then");
  fs.writeFileSync(p, t);
  console.log("ok .github/workflows/publicar-pages.yml");
}