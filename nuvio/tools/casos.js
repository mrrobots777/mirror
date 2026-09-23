// Casos representativos das 15 fontes (mesmo caso para todas quando a bateria
// recebe `<id> <type> [temp ep]`), + a chave do TMDB do ambiente.
// Compartilhado por bateria.js e mime.js para os dois lerem o MESMO caso.

const path = require("path");
const fs = require("fs");

function chaveTmdb() {
  const env = process.env.TMDB_API_KEY;
  if (env && String(env).trim()) return String(env).trim();
  try {
    const { ENV } = require("../../src/core/nomes.js");
    if (ENV.TMDB_API_KEY && String(ENV.TMDB_API_KEY).trim()) return String(ENV.TMDB_API_KEY).trim();
  } catch (_) {}
  const padrao = /TMDB_API_KEY\s*=\s*["']?([0-9a-zA-Z_-]{20,})["']?/;
  for (const arquivo of [path.join(__dirname, "..", "..", ".env.example"), path.join(__dirname, "..", "..", "ecosystem.config.js")]) {
    try {
      const m = fs.readFileSync(arquivo, "utf8").match(padrao);
      if (m) return m[1];
    } catch (_) {}
  }
  return null;
}

const PADRAO = {
  shg: ["30984", "tv", 1, 1],
  ron: ["30984", "tv", 1, 1],
  aon: ["30984", "tv", 1, 1],
  atb: ["30984", "tv", 1, 1],
  spt: ["603", "movie", null, null],
  blz: ["603", "movie", null, null],
  spc: ["603", "movie", null, null],
  ato: ["603", "movie", null, null],
  rtd: ["603", "movie", null, null],
  dgo: ["94796", "tv", 1, 1],
  vzr: ["603", "movie", null, null],
  rei: ["hbo", "channel", null, null],
  emb: ["hbo", "channel", null, null],
  etc: ["hbo", "channel", null, null],
  rcd: ["globonews", "channel", null, null],
};

function casosDosArgs(argv) {
  // `node tools/bateria.js 1396 tv 1 5` → mesmo caso para todas as fontes.
  if (argv.length >= 2 && ["movie", "tv", "channel"].includes(argv[1])) {
    const s = argv[2];
    const e = argv[3];
    return [argv[0], argv[1], s === undefined || s === "" ? null : Number(s), e === undefined || e === "" ? null : Number(e)];
  }
  return null;
}

module.exports = { chaveTmdb, PADRAO, casosDosArgs };
