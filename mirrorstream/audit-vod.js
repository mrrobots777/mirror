require("dotenv").config();

const { UA } = require("./src/lib/ua");
const { engine, buildContext } = require("./src/core/sources");
const { detectResolution } = require("./src/lib/video-probe");
const { videoResolutionToQuality } = require("./src/lib/quality");

const CASOS = [
  { tipo: "movie", titulo: "Matrix", id: 603, ep: 1, season: 0, ano: 1999 },
  { tipo: "movie", titulo: "Interstellar", id: 157336, ep: 1, season: 0, ano: 2014 },
  { tipo: "movie", titulo: "O Poderoso Chefão", id: 239, ep: 1, season: 0, ano: 1972 },
  { tipo: "series", titulo: "Breaking Bad", id: 1396, ep: 5, season: 1 },
  { tipo: "series", titulo: "Stranger Things", id: 66732, ep: 1, season: 1 },
  { tipo: "series", titulo: "Cidade Invisível", id: 67461, ep: 1, season: 1, kr: true },
  { tipo: "series", titulo: "Naruto", id: 0, ep: 3, season: 1, anime: true },
  { tipo: "series", titulo: "One Piece", id: 0, ep: 5, season: 1, anime: true },
];

function probe(url, headers) {
  return fetch(url, {
    headers: { "User-Agent": UA, Range: "bytes=0-262143", ...(headers || {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
  })
    .then(async r => {
      const limite = 4 * 1024 * 1024;
      const leitor = r.body.getReader();
      const partes = [];
      let total = 0;
      while (total < limite) {
        const pedaco = await leitor.read();
        if (pedaco.done) break;
        partes.push(Buffer.from(pedaco.value));
        total += pedaco.value.byteLength;
      }
      try { await leitor.cancel(); } catch (_) {}
      const b = Buffer.concat(partes);
      const f = detectResolution(new Uint8Array(b));
      return { status: r.status, bytes: b.length, qualidade: f ? videoResolutionToQuality(f.width, f.height) : null, tipo: r.headers.get("content-type") || "" };
    })
    .catch(e => ({ status: 0, bytes: 0, qualidade: null, tipo: "ERRO " + e.message.slice(0, 40) }));
}

async function testaFonte(source, ctx) {
  const t0 = Date.now();
  let streams = [];
  let erro = null;
  try {
    streams = await Promise.race([
      source.run(ctx),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout " + source.timeoutMs + "ms")), source.timeoutMs + 1500)),
    ]);
  } catch (e) {
    erro = e.message;
  }
  const ms = Date.now() - t0;
  const linhas = [];
  let comPlay = 0;
  let comQualidade = 0;
  for (const s of streams || []) {
    const headers = (s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) || (s.headers || null);
    const p = await probe(s.url, headers);
    if (p.status === 200 || p.status === 206) comPlay++;
    if (p.qualidade) comQualidade++;
    linhas.push({
      fonte: (s.sources || [])[0] || "?",
      qualidadeDeclarada: s.quality || "?",
      qualidadeReal: p.qualidade || "?",
      status: p.status,
      precisaHeader: !!(headers && Object.keys(headers).length),
      host: (() => { try { return new URL(s.url).hostname; } catch (e) { return "?"; } })(),
    });
  }
  return { fonte: source.id, ms, erro, total: (streams || []).length, comPlay, comQualidade, linhas };
}

(async () => {
  const resultados = new Map();
  for (const c of CASOS) {
    const ehAnime = c.anime === true;
    const ctx = buildContext({
      anime: ehAnime,
      type: c.tipo,
      title: c.titulo,
      episode: c.ep,
      season: c.season,
      year: c.ano,
      tmdbId: c.anime ? 0 : c.id,
      origin: c.kr ? ["KR"] : ["US"],
      key: c.titulo,
    });
    const jobs = engine.start(ctx);
    console.log(`\n=== ${c.titulo} (${c.tipo}) ===`);
    const rs = await Promise.all(jobs.map(j => testaFonte(j.source, ctx)));
    for (const r of rs) {
      const reg = resultados.get(r.fonte) || { fonte: r.fonte, casos: 0, comStream: 0, comPlay: 0, comQualidade: 0, erros: [], ms: [] };
      reg.casos++;
      if (r.total > 0) reg.comStream++;
      reg.comPlay += r.comPlay;
      reg.comQualidade += r.comQualidade;
      if (r.erro) reg.erros.push(r.erro.slice(0, 46));
      reg.ms.push(r.ms);
      resultados.set(r.fonte, reg);
      const estado = r.erro ? `ERRO: ${r.erro.slice(0, 44)}` : `${r.total} stream(s), ${r.comPlay} toca(m), ${r.comQualidade} com qualidade real, ${r.ms}ms`;
      console.log(`  ${r.fonte.padEnd(5)} ${estado}`);
      for (const l of r.linhas) {
        console.log(`        ${l.qualidadeReal.padEnd(7)} (declarado ${l.qualidadeDeclarada})  ${String(l.status).padEnd(4)} ${l.precisaHeader ? "hdr " : "    "}${l.host.slice(0, 40)}`);
      }
    }
  }

  console.log("\n\n===== RESUMO POR FONTE =====");
  console.log("  fonte titles  tocam  qual.real  erros  latência média");
  const linhas = [...resultados.values()].sort((a, b) => b.comPlay - a.comPlay);
  for (const r of linhas) {
    const med = Math.round(r.ms.reduce((a, b) => a + b, 0) / Math.max(1, r.ms.length));
    console.log(`  ${r.fonte.padEnd(5)} ${String(r.casos).padStart(5)} ${String(r.comPlay).padStart(6)} ${String(r.comQualidade).padStart(9)}  ${String(r.erros.length).padStart(5)}  ${String(med + "ms").padStart(8)}   ${r.erros.slice(0, 2).join(" | ")}`);
  }
  const stats = engine.stats();
  console.log(`\n  breakers abertos: ${stats.openBreakers.join(", ") || "nenhum"}`);
  process.exit(0);
})();
