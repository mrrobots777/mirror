require("dotenv").config();

const BASE = process.env.LOAD_BASE || process.env.E2E_BASE || "http://localhost:7000";
const TOTAL = Number(process.env.LOAD_TOTAL || 2000);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 50);

const PATHS = [
  "/health",
  "/manifest.json",
  "/install",
  "/catalog/tv/mirror-tv-live.json",
  "/meta/tv/tv:live:sportv2.json",
  "/stream/movie/tmdb:603.json",
  "/stream/tv/tv:live:sportv2.json",
  "/meta/movie/tmdb:603.json",
  "/logo.svg",
];

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function worker(wid, out) {
  let seed = wid + 1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const ip = `203.0.113.${wid % 250}.${Math.floor(wid / 250) % 250}`;
  while (true) {
    const idx = Math.floor(rnd() * PATHS.length);
    const path = PATHS[idx];
    const t0 = Date.now();
    let code = 0;
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { "X-Forwarded-For": ip, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(30000),
      });
      await res.arrayBuffer();
      code = res.status;
    } catch (e) {
      code = 0;
    }
    const n = out.n++;
    if (n >= TOTAL) return;
    out.results.push({ code, ms: Date.now() - t0, path });
  }
}

(async () => {
  const out = { n: 0, results: [] };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i, out)));
  const wall = (Date.now() - t0) / 1000;

  const codes = {};
  const byPath = {};
  const durs = [];
  for (const r of out.results) {
    codes[r.code] = (codes[r.code] || 0) + 1;
    durs.push(r.ms);
    (byPath[r.path] = byPath[r.path] || []).push(r.ms);
  }
  durs.sort((a, b) => a - b);

  console.log(`requisicoes: ${out.results.length} | concorrencia: ${CONCURRENCY} | wall: ${wall.toFixed(2)}s`);
  console.log(`RPS: ${Math.round(out.results.length / wall)}`);
  console.log(`codigos: ${JSON.stringify(codes)}`);
  console.log(`latencia p50=${pct(durs, .5)}ms p90=${pct(durs, .9)}ms p95=${pct(durs, .95)}ms p99=${pct(durs, .99)}ms max=${durs[durs.length - 1] || 0}ms`);
  console.log("por endpoint (p50/p95):");
  for (const [p, ds] of Object.entries(byPath).sort()) {
    ds.sort((a, b) => a - b);
    console.log(`  ${p.padEnd(45)} n=${String(ds.length).padEnd(5)} p50=${String(pct(ds, .5)).padStart(6)}ms p95=${String(pct(ds, .95)).padStart(7)}ms`);
  }
  const err = Object.entries(codes).filter(([c]) => Number(c) !== 200);
  if (err.length) {
    console.log("erros:", JSON.stringify(err));
    process.exitCode = 1;
  }
})();
