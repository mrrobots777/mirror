require("dotenv").config();

const xtream = require("./src/scrapers/xtream");
const playerflix = require("./src/scrapers/playerflix");
const kakito = require("./src/scrapers/kakito");
const otakulogia = require("./src/scrapers/otakulogia");
const animesdigital = require("./src/scrapers/animesdigital");
const aon = require("./src/scrapers/aon");
const anitube = require("./src/scrapers/anitube");
const doramogo = require("./src/scrapers/doramogo");
const vizer = require("./src/scrapers/vizer");
const redetoons = require("./src/scrapers/redetoons");
const { FONTES: REGISTRO } = require("./src/core/nomes");

const BASE = (process.env.AUDIT_BASE || "http://localhost:7000").replace(/\/$/, "");

const FONTES = [
  { chave: "shg", rotulo: "SHG", anime: true, chama: c => otakulogia.streamsFor(c.titulo, c.ep) },
  { chave: "ron", rotulo: "RON", anime: true, chama: c => animesdigital.streamsFor(c.titulo, c.ep, c.season) },
  { chave: "aon", rotulo: "AON", anime: true, chama: c => aon.streamsFor(c.titulo, c.ep, c.season) },
  { chave: "atb", rotulo: "ATB", anime: true, chama: c => anitube.streamsFor(c.titulo, c.ep, c.season) },
  { chave: "rtd", rotulo: "RTD", chama: c => redetoons.streamsFor(c.tmdbId, c.ep, c.tipo, c.season, c.titulo, c.year) },
  { chave: "dgo", rotulo: "DGO", kr: true, chama: c => doramogo.streamsFor(c.titulo, c.ep, c.tipo, c.tmdbId, c.year) },
  { chave: "blz", rotulo: "BLZ", painel: "blz", chama: c => xtream.streamsFor(c.titulo, c.ep, c.tipo, c.tmdbId, c.season, c.year, c.runtime) },
  { chave: "spc", rotulo: "SPC", painel: "spc", chama: c => xtream.streamsFor(c.titulo, c.ep, c.tipo, c.tmdbId, c.season, c.year, c.runtime) },
  { chave: "ato", rotulo: "ATO", painel: "ato", chama: c => xtream.streamsFor(c.titulo, c.ep, c.tipo, c.tmdbId, c.season, c.year, c.runtime) },
  { chave: "spt", rotulo: "SPT", chama: c => playerflix.streamsFor(c.titulo, c.ep, c.tipo, c.tmdbId, c.season, c.year) },
  { chave: "kkt", rotulo: "KKT", chama: c => kakito.streamsFor(c.titulo, c.ep, c.tipo, c.tmdbId, c.year) },
  { chave: "vzr", rotulo: "VZR", chama: c => vizer.streamsFor(c.tmdbId, c.ep, c.tipo, c.season, c.titulo, c.year) },
];

const CASOS = [
  { rotulo: "filme Matrix", tipo: "movie", titulo: "Matrix", tmdbId: 603, ep: 1, season: 0, year: 1999, runtime: 136 },
  { rotulo: "filme Interestelar", tipo: "movie", titulo: "Interestelar", tmdbId: 157336, ep: 1, season: 0, year: 2014, runtime: 169 },
  { rotulo: "filme Poderoso Chefao", tipo: "movie", titulo: "O Poderoso Chefão", tmdbId: 238, ep: 1, season: 0, year: 1972, runtime: 175 },
  { rotulo: "filme Duna", tipo: "movie", titulo: "Duna", tmdbId: 438631, ep: 1, season: 0, year: 2021, runtime: 155 },
  { rotulo: "serie Breaking Bad S01E05", tipo: "series", titulo: "Breaking Bad", tmdbId: 1396, ep: 5, season: 1, year: 2008 },
  { rotulo: "serie Stranger Things S01E01", tipo: "series", titulo: "Stranger Things", tmdbId: 66732, ep: 1, season: 1, year: 2016 },
  { rotulo: "serie The Last of Us S01E03", tipo: "series", titulo: "The Last of Us", tmdbId: 100088, ep: 3, season: 1, year: 2023 },
  { rotulo: "serie Cidade Invisivel S01E01 (KR)", tipo: "series", titulo: "Cidade Invisível", tmdbId: 110529, ep: 1, season: 1, year: 2021, kr: true },
  { rotulo: "anime Naruto S01E03", tipo: "series", titulo: "Naruto", tmdbId: 46260, ep: 3, season: 1, year: 2002, anime: true },
  { rotulo: "anime Bleach S01E05", tipo: "series", titulo: "Bleach", tmdbId: 30984, ep: 5, season: 1, year: 2004, anime: true },
  { rotulo: "anime One Piece S01E100", tipo: "series", titulo: "One Piece", tmdbId: 37854, ep: 100, season: 1, year: 1999, anime: true },
  { rotulo: "anime Golden Time S01E01", tipo: "series", titulo: "Golden Time", tmdbId: 67389, ep: 1, season: 1, year: 2013, anime: true },
];

function elegivel(f, c) {
  const registro = REGISTRO[f.chave];
  const motor = registro ? registro.motor : [];
  const lista = Array.isArray(motor) ? motor : [motor];
  if (!lista.includes(c.anime ? "anime" : "vod")) return false;
  if (f.kr && !c.kr) return false;
  return true;
}

async function veDoUsuario(c) {
  const t0 = Date.now();
  const url = `${BASE}/api/streams/${c.tipo}/tmdb:${c.tmdbId}` + (c.tipo === "series" ? `?season=${c.season}&episode=${c.ep}` : "");
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  const j = await r.json().catch(() => ({}));
  const lista = j.data || [];
  const contagem = {};
  const urls = new Set();
  for (const s of lista) {
    for (const f of s.sources || []) contagem[f] = (contagem[f] || 0) + 1;
    if (s.url) urls.add(String(s.url).replace(/:\/\/[^/]+/, ""));
  }
  return { ms: Date.now() - t0, total: lista.length, contagem, urls };
}

function filtraChave(streams, fonte) {
  if (!fonte.painel) return streams;
  return streams.filter(s => (s.sources || []).includes(fonte.painel));
}

async function temAFonte(fonte, c) {
  const t0 = Date.now();
  try {
    const r = await fonte.chama(c);
    const lista = filtraChave(Array.isArray(r) ? r : [], fonte);
    return { n: lista.length, ms: Date.now() - t0, erro: null, lista };
  } catch (e) {
    return { n: 0, ms: Date.now() - t0, erro: String(e && e.message || e).slice(0, 70), lista: [] };
  }
}

function urlLimpa(u) {
  return String(u || "").replace(/^https?:\/\/[^/]+/, "");
}

(async () => {
  const soProblemas = process.env.AUDIT_SO_PROBLEMAS === "1";
  const conta = { bloqueio: 0, dedup: 0, ok: 0, foraTem: 0, naoTem: 0, erro: 0 };
  const relatorio = [];

  for (const c of CASOS) {
    const user = await veDoUsuario(c);
    console.log(`\n=== ${c.rotulo} — usuario ve ${user.total} stream(s) em ${user.ms}ms ${JSON.stringify(user.contagem)}`);
    const linhas = [];

    const diretoPorFonte = {};
    for (const fonte of FONTES) {
      diretoPorFonte[fonte.chave] = await temAFonte(fonte, c);
    }

    for (const fonte of FONTES) {
      const chamado = elegivel(fonte, c);
      const direto = diretoPorFonte[fonte.chave];
      if (direto.n === 0) {
        if (direto.erro) { conta.erro++; linhas.push(`  ${fonte.rotulo}  nao tem — erro: ${direto.erro} (${direto.ms}ms)`); }
        else { conta.naoTem++; linhas.push(`  ${fonte.rotulo}  nao tem o titulo (${direto.ms}ms)`); }
        continue;
      }
      if (chamado && user.contagem[fonte.chave]) {
        conta.ok++;
        linhas.push(`  ${fonte.rotulo}  APARECE (${user.contagem[fonte.chave]})`);
        continue;
      }
      const todos = direto.lista.map(s => urlLimpa(s.url));
      const repetido = todos.length > 0 && todos.every(u => FONTES
        .filter(f => f.chave !== fonte.chave)
        .some(f => (diretoPorFonte[f.chave].lista || []).some(s => urlLimpa(s.url) === u)));
      if (repetido) {
        conta.dedup++;
        linhas.push(`  ${fonte.rotulo}  tem ${direto.n} mas e MESMO arquivo de outra fonte (dedup) (${direto.ms}ms)`);
      } else if (chamado) {
        conta.bloqueio++;
        linhas.push(`  ${fonte.rotulo}  *** TEM ${direto.n} E O USUARIO NAO VE *** (${direto.ms}ms) urls=${JSON.stringify(todos.slice(0, 2))}`);
      } else {
        conta.foraTem++;
        linhas.push(`  ${fonte.rotulo}  tem ${direto.n} mas nao e chamado neste tipo (por desenho) (${direto.ms}ms)`);
      }
    }

    relatorio.push({ caso: c.rotulo, linhas });
    if (!soProblemas || linhas.some(l => l.includes("USUARIO NAO VE"))) {
      for (const l of linhas) console.log(l);
    }
  }

  console.log("\n================ RESUMO ================");
  console.log(`APARECE certo                       : ${conta.ok}`);
  console.log(`TEM e o usuario NAO ve (defeito)    : ${conta.bloqueio}`);
  console.log(`tem mas e dedup de outra fonte      : ${conta.dedup}`);
  console.log(`tem mas nao e chamado neste tipo    : ${conta.foraTem}`);
  console.log(`nao tem o titulo                    : ${conta.naoTem}`);
  console.log(`erro da fonte                       : ${conta.erro}`);
  if (conta.bloqueio) {
    console.log("\n--- DEFEITOS: tem e o usuario nao ve ---");
    for (const r of relatorio) {
      for (const l of r.linhas) if (l.includes("USUARIO NAO VE")) console.log(`${r.caso}: ${l.trim()}`);
    }
  }
  process.exit(0);
})();
