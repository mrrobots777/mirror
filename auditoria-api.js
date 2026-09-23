require("dotenv").config();

const BASE = (process.env.AUDIT_BASE || "http://localhost:7000").replace(/\/$/, "");
const CONC = Number(process.env.AUDIT_CONC) || 3;
const ESQECAR = process.env.AUDIT_CACHE !== "0";

const VOD = [
  { rotulo: "busca filme", path: "/api/vod/search?q=matrix&type=movie&limit=5", precisa: ["603"] },
  { rotulo: "busca serie", path: "/api/vod/search?q=breaking+bad&type=series&limit=5", precisa: ["1396"] },
  { rotulo: "busca sem tipo", path: "/api/vod/search?q=duna", precisa: ["438631"] },
  { rotulo: "generos", path: "/api/vod/genres", precisa: [] },
  { rotulo: "detalhe filme", path: "/api/vod/movie/tmdb:603", precisa: ["603"] },
  { rotulo: "detalhe serie", path: "/api/vod/series/tmdb:1396", precisa: ["1396"] },
  { rotulo: "streams filme", path: "/api/streams/movie/tmdb:603", streams: true },
  { rotulo: "streams serie S01E07", path: "/api/streams/series/tmdb:1396?season=1&episode=7", streams: true },
  { rotulo: "streams anime", path: "/api/streams/series/tmdb:46260?season=1&episode=7", streams: true },
  { rotulo: "streams kdrama", path: "/api/streams/series/tmdb:110529?season=1&episode=1", streams: true },
  { rotulo: "streams tv", path: "/api/streams/tv/hbo", streams: true },
  { rotulo: "canais", path: "/api/channels", precisa: [], pesado: true },
  { rotulo: "categorias de canal", path: "/api/channels/categories", precisa: [], pesado: true },
  { rotulo: "um canal", path: "/api/channels/hbo", precisa: [], pesado: true },
  { rotulo: "canal por busca", path: "/api/channels?search=globo", precisa: [], pesado: true },
  { rotulo: "canal por categoria", path: "/api/channels?category=Globo", precisa: [], pesado: true },
  { rotulo: "id inexistente (404)", path: "/api/vod/movie/tmdb:999999999", precisa: [], erro: true },
  { rotulo: "stream de id inexistente", path: "/api/streams/movie/tmdb:999999999", precisa: [], erroOk: true },
  { rotulo: "canal inexistente (404)", path: "/api/channels/naoexistechannelxyz", precisa: [], pesado: true, erro: true },
];

function temAlgum(texto, chaves) {
  return chaves.length === 0 || chaves.some(c => texto.includes(c));
}

function comCache(path, temQuery) {
  if (!ESQECAR || !temQuery) return path;
  return path + (path.includes("?") ? "&" : "?") + `_=${Date.now()}`;
}

(async () => {
  console.log(`API sob teste: ${BASE}`);
  console.log(ESQECAR ? "cache furado so nas rotas COM query (a de parametro nao leva lixo)\n" : "usando o cache do servidor\n");

  const conta = { ok: 0, falha: 0 };
  const relatorio = [];
  let pico = 0;

  async function mede(c) {
    const temQuery = c.path.includes("?");
    const url = `${BASE}${comCache(c.path, temQuery)}`;
    const t0 = Date.now();
    let linha = { rotulo: c.rotulo, path: c.path };
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(150000) });
      const ms = Date.now() - t0;
      pico = Math.max(pico, ms);
      const texto = await r.text();
      let j = null;
      try { j = JSON.parse(texto); } catch (_) {}
      const envelopeOk = j && typeof j === "object" && typeof j.success === "boolean";
      if (c.streams) {
        const lista = (j && j.data) || [];
        const n = Array.isArray(lista) ? lista.length : 0;
        return { ...linha, ms, http: r.status, ok: r.status === 200 && n > 0, detalhe: `${n} stream(s) [${[...new Set(lista.map(s => (s.sources || []).join(",")))].join(" ")}]` };
      }
      const n = j && j.data != null ? (Array.isArray(j.data) ? j.data.length : 1) : 0;
      const base = { ...linha, ms, http: r.status, detalhe: `success=${j ? j.success : "?"} itens=${n}` };
      if (c.erro) return { ...base, ok: r.status === 404 && envelopeOk && j.success === false, detalhe: `404 esperado -> ${base.detalhe}` };
      if (c.erroOk) return { ...base, ok: r.status === 200 && envelopeOk, detalhe: `200 com lista vazia -> ${base.detalhe}` };
      return { ...base, ok: r.status === 200 && envelopeOk && temAlgum(texto, c.precisa || []), detalhe: base.detalhe };
    } catch (e) {
      return { ...linha, ms: Date.now() - t0, http: 0, ok: false, detalhe: "ERRO " + String(e.message).slice(0, 50) };
    }
  }

  const leves = VOD.filter(c => !c.pesado);
  const pesados = VOD.filter(c => c.pesado);

  let cursor = 0;
  async function worker() {
    while (cursor < leves.length) {
      const c = leves[cursor++];
      const linha = await mede(c);
      if (linha.ok) conta.ok++; else conta.falha++;
      relatorio.push(linha);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  for (const c of pesados) {
    const linha = await mede(c);
    if (linha.ok) conta.ok++; else conta.falha++;
    relatorio.push(linha);
  }

  relatorio.sort((a, b) => a.rotulo.localeCompare(b.rotulo));
  console.log("rota".padEnd(28) + "http".padEnd(6) + "tempo".padStart(10) + "  detalhe");
  for (const r of relatorio) {
    console.log(`${r.ok ? "ok  " : "FALHA"} ${r.rotulo.padEnd(22)} ${String(r.http).padEnd(5)} ${String(r.ms + "ms").padStart(11)}  ${r.detalhe}`);
  }
  const lentas = relatorio.filter(r => r.ms > 3000).map(r => `${r.rotulo}=${r.ms}ms`);
  console.log(`\nrotas ok: ${conta.ok}/${relatorio.length}   falhas: ${conta.falha}   mais lenta: ${pico}ms`);
  if (lentas.length) console.log(`acima de 3s: ${lentas.join(", ")}`);
  process.exit(0);
})();
