require("dotenv").config();

const BASE = (process.env.FLUXO_BASE || "https://c12e41ddc21b-mirror.baby-beamup.club").replace(/\/$/, "");
const CFG = process.env.FLUXO_CONFIG || "x";
const CATALOG_ID = "mirror-tv-live";

// O Stremio chama as rotas prefixed pelo config quando o addon esta configurado. E o que
// quebrou a busca: no formato `/:config/...` o SDK nao repassa a query ao handler.
function comConfig(p) { return `/${CFG}${p}`; }

const PASSOS = [
  { nome: "manifest", url: "/manifest.json", checar: (j) => j.behaviorHints && j.behaviorHints.epgProvider },
  { nome: "catalogo (sem config)", url: `/catalog/tv/${CATALOG_ID}.json`, metas: 100 },
  { nome: "catalogo (com config)", url: comConfig(`/catalog/tv/${CATALOG_ID}.json`), metas: 100 },
  { nome: "busca (sem config)", url: `/catalog/tv/${CATALOG_ID}.json?search=globo`, metas: 5, max: 60 },
  { nome: "busca (com config)", url: comConfig(`/catalog/tv/${CATALOG_ID}.json?search=globo`), metas: 5, max: 60 },
  { nome: "meta do canal (sem config)", url: "/meta/tv/tv:live:globosp.json", meta: true },
  { nome: "meta do canal (com config)", url: comConfig("/meta/tv/tv:live:globosp.json"), meta: true },
  { nome: "meta COM EPG (date)", url: comConfig(`/catalog/tv/${CATALOG_ID}.json?date=${dataDe()}&skip=0`), metas: 5 },
  { nome: "stream do canal (com config)", url: comConfig("/stream/tv/tv:live:globosp.json"), streams: 1 },
  { nome: "api canais", url: "/api/channels", canais: 100 },
  { nome: "api busca", url: "/api/channels?search=globo", canais: 3 },
  { nome: "api categorias", url: "/api/channels/categories", canais: 5 },
  { nome: "api um canal", url: "/api/channels/globosp", canais: 1 },
];

function dataDe() {
  return new Date().toISOString().slice(0, 10);
}

(async () => {
  console.log(`fluxo de usuario do Stremio em ${BASE}`);
  console.log(`config usado: "${CFG}"\n`);
  let falhas = 0;
  for (const p of PASSOS) {
    const t0 = Date.now();
    let linha;
    try {
      const r = await fetch(BASE + p.url, { signal: AbortSignal.timeout(45000) });
      const ms = Date.now() - t0;
      const texto = await r.text();
      let j = null;
      try { j = JSON.parse(texto); } catch (_) {}
      if (p.metas) {
        const n = (j && j.metas && j.metas.length) || 0;
        const ok = r.status === 200 && n >= p.metas && (!p.max || n <= p.max);
        linha = `${ok ? "ok   " : "FALHA"} ${p.nome.padEnd(28)} http=${r.status} ${String(ms + "ms").padStart(8)}  ${n} metas`;
        if (!ok) falhas++;
      } else if (p.meta) {
        const m = j && j.meta;
        const temEpg = !!(m && (m.videos || m.description));
        const ok = r.status === 200 && !!m;
        linha = `${ok ? "ok   " : "FALHA"} ${p.nome.padEnd(28)} http=${r.status} ${String(ms + "ms").padStart(8)}  meta=${m ? m.name : "AUSENTE"} videos=${(m && m.videos && m.videos.length) || 0}`;
        if (!ok || !temEpg) falhas++;
      } else if (p.streams) {
        const n = (j && j.streams && j.streams.length) || 0;
        const fontes = [...new Set(((j && j.streams) || []).map((s) => (s.sources || []).join(",")))];
        const ok = r.status === 200 && n >= p.streams;
        linha = `${ok ? "ok   " : "FALHA"} ${p.nome.padEnd(28)} http=${r.status} ${String(ms + "ms").padStart(8)}  ${n} stream(s) [${fontes.join(" ")}]`;
        if (!ok) falhas++;
      } else {
        const n = (j && j.data && j.data.length) || 0;
        const ok = r.status === 200 && n >= p.canais;
        linha = `${ok ? "ok   " : "FALHA"} ${p.nome.padEnd(28)} http=${r.status} ${String(ms + "ms").padStart(8)}  ${n} itens`;
        if (!ok) falhas++;
      }
    } catch (e) {
      linha = `FALHA ${p.nome.padEnd(28)} ${String(Date.now() - t0 + "ms").padStart(8)}  ERRO ${String(e.message).slice(0, 40)}`;
      falhas++;
    }
    console.log("  " + linha);
  }
  console.log(`\npassos com falha: ${falhas}/${PASSOS.length}`);
  process.exit(0);
})();
