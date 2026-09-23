const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const fontes = require("./src/core/fontes");
const { TETO_CORPO_BYTES, TETO_CORPO_LIMITED_BYTES } = require("./src/core/sandbox");

const raiz = __dirname;

function arquivoDe(chave) {
  return path.join(raiz, "src", "scrapers", fontes.arquivoDe(chave));
}

function confereRegistro() {
  const erros = [];
  for (const chave of fontes.chaves()) {
    const f = fontes.FONTES[chave];
    const arquivo = arquivoDe(chave);
    if (!fs.existsSync(arquivo)) erros.push(`fonte ${chave} sem src/scrapers/${f.arquivo}`);
    if (!f.sigla || f.sigla !== chave.toUpperCase()) erros.push(`fonte ${chave}: sigla "${f.sigla}" deveria ser ${chave.toUpperCase()}`);
    if (!f.conteudos || !f.conteudos.length) erros.push(`fonte ${chave} sem conteudos`);
    for (const c of f.conteudos) {
      if (!fontes.CONTEUDOS.includes(c)) erros.push(`fonte ${chave}: conteudo "${c}" fora de CONTEUDOS`);
    }
    for (const t of f.tipos) {
      if (!["movie", "tv", "channel"].includes(t)) erros.push(`fonte ${chave}: tipo "${t}" fora de movie|tv|channel`);
    }
    if (f.tipos.includes("channel") && f.conteudos.length !== 1) erros.push(`fonte ${chave}: so "channel" pode servir mais de um conteudo`);
    if (!f.tipos.includes("channel") && f.conteudos.includes("tv")) erros.push(`fonte ${chave}: conteudo tv exige tipos ["channel"]`);
    if (!f.descricao) erros.push(`fonte ${chave} sem descricao (o dono le isso na tela de Plugins)`);
  }
  const dir = path.join(raiz, "src", "scrapers");
  const declarados = new Set(fontes.chaves().map(chave => fontes.arquivoDe(chave)));
  const naoDeclarados = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(nome => nome.endsWith(".js")).filter(nome => !declarados.has(nome))
    : [];
  for (const nome of naoDeclarados) {
    erros.push(`src/scrapers/${nome} nao esta no registro (src/core/fontes.js) — some do dist`);
  }
  if (erros.length) throw new Error(erros.join("; "));
}

function confereManifesto(manifest) {
  const erros = [];
  if (!manifest.name) erros.push("manifest sem name");
  if (!manifest.version) erros.push("manifest sem version");
  if (!Array.isArray(manifest.scrapers) || !manifest.scrapers.length) erros.push("manifest sem scrapers");
  if (manifest.scrapers.length !== fontes.chaves().length) {
    erros.push(`manifest declara ${manifest.scrapers.length} scrapers e o registro tem ${fontes.chaves().length}`);
  }
  const esperado = fontes.scrapers();
  manifest.scrapers.forEach((scraper, i) => {
    const doRegistro = esperado[i];
    if (!doRegistro) return;
    for (const campo of ["id", "name", "filename", "description"]) {
      if (scraper[campo] !== doRegistro[campo]) {
        erros.push(`scraper ${doRegistro.id}: ${campo} "${scraper[campo]}" difere do registro "${doRegistro[campo]}"`);
      }
    }
    if (String(scraper.supportedTypes) !== String(doRegistro.supportedTypes)) {
      erros.push(`scraper ${doRegistro.id}: supportedTypes difere do registro`);
    }
  });
  for (const scraper of manifest.scrapers || []) {
    for (const campo of ["id", "name", "version", "filename", "description"]) {
      if (!scraper[campo]) erros.push(`scraper ${scraper.id || "?"} sem ${campo}`);
    }
    if (!Array.isArray(scraper.supportedTypes) || !scraper.supportedTypes.length) {
      erros.push(`scraper ${scraper.id}: supportedTypes vazio`);
    }
    if (scraper.id && scraper.filename && scraper.filename !== `${scraper.id}.js`) {
      erros.push(`scraper ${scraper.id}: filename "${scraper.filename}" difere de ${scraper.id}.js`);
    }
  }
  if (erros.length) throw new Error(erros.join("; "));
  return manifest;
}

function apagaFora(diretorio, nomes) {
  if (!fs.existsSync(diretorio)) return [];
  const removidos = [];
  for (const nome of fs.readdirSync(diretorio)) {
    if (nomes.includes(nome)) continue;
    const alvo = path.join(diretorio, nome);
    if (fs.statSync(alvo).isDirectory()) continue;
    fs.unlinkSync(alvo);
    removidos.push(nome);
  }
  return removidos;
}

function tetoDoIndice() {
  const indice = path.join(raiz, "public", "idx", "indice.json");
  if (!fs.existsSync(indice)) return null;
  try {
    const dados = JSON.parse(fs.readFileSync(indice, "utf8"));
    let maior = { chave: "-", bytes: 0 };
    for (const fonte of Object.keys(dados.fontes || {})) {
      const shard = dados.fontes[fonte].maiorShard || { chave: "?", bytes: 0 };
      if (shard.bytes > maior.bytes) maior = { chave: `${fonte}/${shard.chave}`, bytes: shard.bytes };
    }
    return { ...maior, total: Number(dados.totalItens) || 0 };
  } catch (_) {
    return null;
  }
}

async function main() {
  confereRegistro();
  const manifest = confereManifesto(fontes.manifesto());

  const entradas = {};
  for (const chave of fontes.chaves()) entradas[chave] = arquivoDe(chave);

  const saida = path.join(raiz, "dist");
  fs.mkdirSync(saida, { recursive: true });

  await esbuild.build({
    entryPoints: entradas,
    outdir: saida,
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2020",
    minify: true,
    external: ["cheerio", "crypto-js"],
    logLevel: "warning",
  });

  const esperado = fontes.chaves().map(chave => `${chave}.js`).concat("manifest.json");
  const removidos = apagaFora(saida, esperado);
  const corpo = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(saida, "manifest.json"), corpo);

  // `public/` e a raiz que vai para o GitHub Pages: tem que servir o manifest, os
  // `<fonte>.js` E o `idx/` (indice estatico de blz/spc/ato) no mesmo endereco, porque o
  // provider monta a URL do shard a partir da MESMA base do manifest. `idx/` e
  // gerado pelo `tools/gerar-indice.js` e nunca e apagado aqui.
  const gerados = fontes.chaves().map(chave => `${chave}.js`).sort();
  const publica = path.join(raiz, "public");
  if (fs.existsSync(publica)) {
    const removidosPublica = apagaFora(publica, esperado.concat(["PLANO-PUBLICACAO.md"]));
    for (const nome of esperado) fs.copyFileSync(path.join(saida, nome), path.join(publica, nome));
    const idx = path.join(publica, "idx");
    const fontesIdx = fs.existsSync(idx) ? fs.readdirSync(idx).filter(f => fs.statSync(path.join(idx, f)).isDirectory()) : [];
    if (removidosPublica.length) console.log(`[build] public/: removidos ${removidosPublica.join(", ")}`);
    console.log(`[build] public/: ${gerados.length} js + manifest.json copiados (idx: ${fontesIdx.length ? fontesIdx.join(", ") : "AUSENTE — rode tools/gerar-indice.js"})`);
  }

  const teto = tetoDoIndice();
  if (teto) {
    console.log(
      `[build] indice: ${teto.total} itens | maior shard ${teto.chave} ${(teto.bytes / 1024).toFixed(0)} KB ` +
      `(teto do runtime ${(TETO_CORPO_BYTES / 1024).toFixed(0)} KB, ou ${(TETO_CORPO_LIMITED_BYTES / 1024).toFixed(0)} KB na quota limited)`
    );
  }
  if (removidos.length) console.log(`[build] dist/: removidos ${removidos.join(", ")}`);

  console.log(`[build] dist/: ${gerados.length} js (${gerados.join(", ")}) + manifest.json`);
  console.log(`[build] registro (src/core/fontes.js): ${fontes.chaves().length} fontes | manifesto declara ${manifest.scrapers.length} scrapers`);
}

main().catch((e) => {
  console.error("[build] erro:", e && e.message ? e.message : e);
  process.exit(1);
});