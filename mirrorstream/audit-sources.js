require("dotenv").config();

const { spawnSync } = require("child_process");

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
const emb = require("./src/scrapers/embedtv");
const { matchVodTitle } = require("./src/lib/match");

const BASE = process.env.AUDIT_BASE || "http://localhost:7000";
const CASE_TIMEOUT_MS = 40000;

const SOURCE_NAMES = {
  blz: "BLZ (kakito)", spc: "SPC (telaplay)", spt: "SPT (playerflix)", kkt: "KKT (iptv.db)",
  shg: "SHG (otakulogia)", ron: "RON (animesdigital)",
  atb: "ATB (anitube)", dgo: "DGO (doramogo)", vzr: "VZR (vizer)",
};

const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const stripDecor = (s) => String(s || "")
  .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
  .replace(/\b\d{3,4}p\b|\b4k\b|S\d{2}E\d{2,3}|\(\d{4}\)/gi, " ")
  .replace(/\b(SHG|RON|AON|TOP|SPC|SPT|BLZ|ATO|KKT|RTD|ATB|DGO|EMB|PROXY|Mirror|Relay)\b/gi, " ")
  .replace(/[·|•]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const probeStats = new Map();
const ffTargets = new Map();
const caseResults = [];

function srcKey(stream, fallback) {
  return (stream.sources && stream.sources[0]) || fallback || "desconhecida";
}

function addProbe(src, r) {
  if (!probeStats.has(src)) probeStats.set(src, { ok: 0, fail: 0, ms: [], errs: [] });
  const st = probeStats.get(src);
  if (r.ok) { st.ok++; st.ms.push(r.ms); } else { st.fail++; st.errs.push(`${r.status || "ERR"} ${r.ct}${r.err ? " " + r.err : ""}`.slice(0, 70)); }
}

async function probe(url, extra = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-1023", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", ...extra },
      signal: AbortSignal.timeout(12000),
      redirect: "follow",
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "-";
    const ms = Date.now() - t0;
    const ok = (res.status === 200 || res.status === 206) && buf.length > 0 && !/text\/html/i.test(ct);
    return { ms, status: res.status, ct, bytes: buf.length, ok };
  } catch (e) {
    return { ms: Date.now() - t0, status: 0, ct: "-", bytes: 0, ok: false, err: e.message };
  }
}

function streamReq(s) {
  return (s && s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) || {};
}

function ffprobe(url, extra = {}) {
  const t0 = Date.now();
  const args = ["-v", "error", "-user_agent", extra["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "-read_intervals", "%+#10"];
  const hdrs = Object.entries(extra).filter(([k]) => !/user-agent|range/i.test(k)).map(([k, v]) => `${k}: ${v}`).join("\r\n");
  if (hdrs) args.push("-headers", hdrs);
  args.push("-show_entries", "format=duration,format_name", "-of", "json", url);
  const r = spawnSync("ffprobe", args, { timeout: 40000, encoding: "utf8" });
  const ms = Date.now() - t0;
  if (r.status !== 0) return { ok: false, ms, err: String(r.stderr || (r.error && r.error.message) || "").slice(0, 160) };
  try {
    const j = JSON.parse(r.stdout);
    return { ok: true, ms, detail: `duration=${j.format && j.format.duration}s format=${j.format && j.format.format_name}` };
  } catch (e) {
    return { ok: false, ms, err: "parse error" };
  }
}

function evaluateMatch(stream, c) {
  const title = String(stream.title || stream.name || "");
  const t = norm(stripDecor(title));
  const qWords = norm(c.q).split(/\s+/).filter(w => w.length > 1);
  const contain = qWords.every(w => t.includes(w));
  let epOk = true;
  let epDetail = "";
  if (c.type === "series") {
    const ss = String(c.season || 1).padStart(2, "0");
    const ee = String(c.ep || 1).padStart(2, "0");
    epOk = new RegExp(`s${ss}e${ee}`, "i").test(title);
    if (!epOk) epDetail = `esperado S${ss}E${ee}`;
  }
  if (!contain || !epOk) return { level: "BAD", detail: epDetail || `query "${c.q}" ausente no titulo` };
  const strict = matchVodTitle(stripDecor(title), c.q, c.type === "series", c.year);
  if (strict) return { level: "OK" };
  return { level: "LOOSE", detail: "query no titulo, matchVodTitle=false (localizacao/sequel?)" };
}

function pickProbes(streams) {
  if (streams.length <= 4) return streams.slice();
  const idx = [...new Set([0, Math.floor(streams.length / 3), Math.floor((2 * streams.length) / 3), streams.length - 1])];
  return idx.map(i => streams[i]);
}

async function runCase(c) {
  const t0 = Date.now();
  let streams = [];
  let err = null;
  try {
    streams = await Promise.race([
      c.run(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("case timeout " + CASE_TIMEOUT_MS + "ms")), CASE_TIMEOUT_MS).unref()),
    ]);
  } catch (e) {
    err = e;
    if (e && Array.isArray(e.partialStreams) && e.partialStreams.length) streams = e.partialStreams;
  }
  const ms = Date.now() - t0;
  const matches = [];
  for (const s of (streams || []).slice(0, 3)) matches.push(evaluateMatch(s, c));

  const probeList = pickProbes(streams || []);
  const probeResults = [];
  for (const s of probeList) {
    const r = await probe(s.url, streamReq(s));
    const src = srcKey(s, c.fonte);
    addProbe(src, r);
    probeResults.push({ src, ...r, url: s.url });
    if (r.ok && !ffTargets.has(src)) ffTargets.set(src, { url: s.url, hdr: streamReq(s) });
  }

  caseResults.push({ c, ms, n: (streams || []).length, err, matches, probeResults, titles: (streams || []).slice(0, 4).map(s => s.title || s.name) });

  const srcs = [...new Set((streams || []).map(s => srcKey(s, c.fonte)))].join(",");
  const status = (streams || []).length
    ? `${streams.length} streams [${srcs}]${err ? ` · degradado: ${err.message}` : ""}`
    : err ? `ERRO ${err.message}` : "0 streams";
  console.log(`\n### [${c.fonte}] ${c.label}: ${ms}ms · ${status}`);
  for (const t of caseResults[caseResults.length - 1].titles) console.log(`    · ${t}`);
  for (const p of probeResults) console.log(`    probe[${p.src}] ${p.ok ? "OK" : "FAIL"} ${p.status} ${p.ct} ${p.bytes}b ${p.ms}ms ${p.err || ""}`);
  for (const m of matches) if (m.level !== "OK") console.log(`    match ${m.level}: ${m.detail || ""}`);
}

const cases = [
  { fonte: "BLZ/SPC", label: "filme Matrix (1999)", q: "Matrix", type: "movie", year: 1999, run: () => xtream.streamsFor("Matrix", 1, "movie", undefined, 1, 1999) },
  { fonte: "BLZ/SPC", label: "serie Breaking Bad S01E05", q: "Breaking Bad", type: "series", season: 1, ep: 5, year: 2008, run: () => xtream.streamsFor("Breaking Bad", 5, "series", undefined, 1, 2008) },
  { fonte: "SPT", label: "filme Matrix (tmdb:603)", q: "Matrix", type: "movie", year: 1999, run: () => playerflix.streamsFor("Matrix", 1, "movie", 603, 1, 1999) },
  { fonte: "SPT", label: "serie Breaking Bad S01E05 (tmdb:1396)", q: "Breaking Bad", type: "series", season: 1, ep: 5, year: 2008, run: () => playerflix.streamsFor("Breaking Bad", 5, "series", 1396, 1, 2008) },
  { fonte: "KKT", label: "filme Matrix (1999)", q: "Matrix", type: "movie", year: 1999, run: () => kakito.streamsFor("Matrix", 1, "movie", 1, 1999) },
  { fonte: "KKT", label: "serie Breaking Bad S01E05", q: "Breaking Bad", type: "series", season: 1, ep: 5, year: 2008, run: () => kakito.streamsFor("Breaking Bad", 5, "series", 1, 2008) },
  { fonte: "KKT", label: "filme Duna (2021)", q: "Duna", type: "movie", year: 2021, run: () => kakito.streamsFor("Duna", 1, "movie", 1, 2021) },
  { fonte: "RTD", label: "filme Matrix (tmdb:603)", q: "Matrix", type: "movie", year: 1999, run: () => redetoons.streamsFor(603, 1, "movie", 1, "Matrix", 1999) },
  { fonte: "RTD", label: "serie Breaking Bad S01E05 (tmdb:1396)", q: "Breaking Bad", type: "series", season: 1, ep: 5, year: 2008, run: () => redetoons.streamsFor(1396, 5, "series", 1, "Breaking Bad", 2008) },
  { fonte: "SHG", label: "Naruto E1", q: "Naruto", type: "series", season: 1, ep: 1, run: () => otakulogia.streamsFor("Naruto", 1) },
  { fonte: "SHG", label: "Bleach E5", q: "Bleach", type: "series", season: 1, ep: 5, run: () => otakulogia.streamsFor("Bleach", 5) },
  { fonte: "RON", label: "Naruto S01E01", q: "Naruto", type: "series", season: 1, ep: 1, run: () => animesdigital.streamsFor("Naruto", 1, 1) },
  { fonte: "RON", label: "Shingeki no Kyojin S01E03", q: "Shingeki no Kyojin", type: "series", season: 1, ep: 3, run: () => animesdigital.streamsFor("Shingeki no Kyojin", 3, 1) },
  { fonte: "AON", label: "Naruto S01E01", q: "Naruto", type: "series", season: 1, ep: 1, run: () => aon.streamsFor("Naruto", 1, 1) },
  { fonte: "AON", label: "Dragon Ball S01E05", q: "Dragon Ball", type: "series", season: 1, ep: 5, run: () => aon.streamsFor("Dragon Ball", 5, 1) },
  { fonte: "ATB", label: "Naruto S01E01", q: "Naruto", type: "series", season: 1, ep: 1, run: () => anitube.streamsFor("Naruto", 1, 1) },
  { fonte: "ATB", label: "One Piece S01E100", q: "One Piece", type: "series", season: 1, ep: 100, run: () => anitube.streamsFor("One Piece", 100, 1) },
  { fonte: "DGO", label: "Goblin S01E03", q: "Goblin", type: "series", season: 1, ep: 3, year: 2016, run: () => doramogo.streamsFor("Goblin", 3, "series", 1, 2016) },
  { fonte: "DGO", label: "Conspiracao do Amor S01E02", q: "Conspiração do Amor", type: "series", season: 1, ep: 2, year: 2026, run: () => doramogo.streamsFor("Conspiração do Amor", 2, "series", 1, 2026) },
  { fonte: "VZR", label: "filme Matrix (tmdb:603)", q: "Matrix", type: "movie", year: 1999, run: () => vizer.streamsFor(603, 1, "movie", 1, "Matrix", 1999) },
  { fonte: "VZR", label: "serie Breaking Bad S01E05 (tmdb:1396)", q: "Breaking Bad", type: "series", season: 1, ep: 5, year: 2008, run: () => vizer.streamsFor(1396, 5, "series", 1, "Breaking Bad", 2008) },
  { fonte: "VZR", label: "filme Inception (tmdb:27205)", q: "A Origem", type: "movie", year: 2010, run: () => vizer.streamsFor(27205, 1, "movie", 1, "A Origem", 2010) },
];

async function auditEmb() {
  console.log("\n========== EMB (TV ao vivo) ==========");
  const t0 = Date.now();
  let metas = [];
  let catalogErr = null;
  try {
    metas = await Promise.race([emb.getCatalog(), new Promise((_, rej) => setTimeout(() => rej(new Error("catalog timeout")), 30000).unref())]);
  } catch (e) {
    catalogErr = e;
  }
  const catMs = Date.now() - t0;
  console.log(`catalogo: ${catalogErr ? "ERRO " + catalogErr.message : metas.length + " canais"} (${catMs}ms)`);
  if (catalogErr || !metas.length) return { catMs, catOk: false, channels: [] };

  const wanted = metas.filter(m => /hbo|sportv|espn|espn/i.test(String(m.id || ""))).slice(0, 3);
  const pick = wanted.length ? wanted : metas.slice(0, 3);
  const channels = [];
  for (const meta of pick) {
    const slug = String(meta.id || "").replace(/^tv:live:/, "");
    const t1 = Date.now();
    const streams = await emb.getStreams(slug, BASE).catch(e => { console.log(`  streams ${slug}: ERRO ${e.message}`); return []; });
    const ms = Date.now() - t1;
    console.log(`\n### [EMB] canal ${slug}: ${ms}ms · ${streams.length} streams`);
    for (const s of streams) {
      const r = await probe(s.url, streamReq(s));
      addProbe("emb", r);
      console.log(`    · ${s.title} | probe ${r.ok ? "OK" : "FAIL"} ${r.status} ${r.ct} ${r.bytes}b ${r.ms}ms ${r.err || ""}`);
      if (r.ok && !ffTargets.has("emb-primary") && /\/stream\/hls\//.test(s.url)) ffTargets.set("emb-primary", { url: s.url, hdr: streamReq(s) });
      if (r.ok && !ffTargets.has("emb-relay") && /relay|worker/i.test(s.url)) ffTargets.set("emb-relay", { url: s.url, hdr: streamReq(s) });
    }
    if (streams.length && !ffTargets.has("emb-relay")) ffTargets.set("emb-relay", { url: streams[streams.length - 1].url, hdr: {} });
    channels.push({ slug, ms, n: streams.length });
  }
  return { catMs, catOk: true, channels };
}


(async () => {
  console.log(`========== AUDITORIA DE FONTES — base=${BASE} ==========`);

  for (const c of cases) {
    await runCase(c);
  }

  const embRes = await auditEmb();

  console.log("\n========== PLAYBACK (ffprobe ~10s por fonte) ==========");
  const ffResults = [];
  for (const [src, t] of ffTargets) {
    const r = ffprobe(t.url, t.hdr);
    ffResults.push({ src, ...r });
    console.log(`ffprobe[${src}] ${r.ok ? "OK" : "FAIL"} ${r.detail || r.err || ""} (${r.ms}ms)`);
    console.log(`    ${t.url.slice(0, 130)}`);
  }

  console.log("\n========== RESUMO POR FONTE ==========");
  const byFonte = new Map();
  for (const cr of caseResults) {
    const k = cr.c.fonte;
    if (!byFonte.has(k)) byFonte.set(k, { cases: 0, okCases: 0, streams: 0, msMin: Infinity, msMax: 0, msSum: 0, matchBad: [], matchLoose: 0, errors: [] });
    const st = byFonte.get(k);
    st.cases++;
    if (cr.n > 0) st.okCases++;
    st.streams += cr.n;
    st.msMin = Math.min(st.msMin, cr.ms);
    st.msMax = Math.max(st.msMax, cr.ms);
    st.msSum += cr.ms;
    if (cr.err) st.errors.push(cr.err.message);
    for (const m of cr.matches) {
      if (m.level === "BAD") st.matchBad.push(`${cr.c.label}: ${m.detail}`);
      if (m.level === "LOOSE") st.matchLoose++;
    }
  }
  console.log("casos (scraper):");
  for (const [k, st] of byFonte) {
    console.log(`  ${k.padEnd(8)} casos ${st.okCases}/${st.cases} com stream · ${st.streams} streams · latência ${st.msMin === Infinity ? "-" : `${st.msMin}..${st.msMax}ms (média ${Math.round(st.msSum / st.cases)}` + "ms)"}${st.errors.length ? " · ERROS: " + st.errors.join(" | ") : ""}${st.matchBad.length ? " · MATCH BAD: " + st.matchBad.join(" | ") : ""}${st.matchLoose ? ` · match loose: ${st.matchLoose}` : ""}`);
  }
  console.log("\nlinks por fonte (probe Range):");
  for (const [src, st] of probeStats) {
    const avg = st.ms.length ? Math.round(st.ms.reduce((a, b) => a + b, 0) / st.ms.length) : 0;
    console.log(`  ${String(src).padEnd(6)} (${SOURCE_NAMES[src] || src}): ${st.ok} ok / ${st.fail} fail · probe médio ${avg}ms${st.fail ? " · falhas: " + [...new Set(st.errs)].slice(0, 3).join(" ; ") : ""}`);
  }
  console.log("\nplayback ffprobe:");
  for (const f of ffResults) console.log(`  ${f.src}: ${f.ok ? "OK " + f.detail : "FAIL " + (f.err || "")}`);
  console.log(`EMB: catalogo ${embRes.catOk ? embRes.catMs + "ms" : "FALHOU"}${embRes.channels.length ? " · canais: " + embRes.channels.map(c => `${c.slug}=${c.ms}ms/${c.n}`).join(", ") : ""}`);

  const totalProbes = [...probeStats.values()].reduce((a, s) => a + s.ok + s.fail, 0);
  const totalOk = [...probeStats.values()].reduce((a, s) => a + s.ok, 0);
  const badMatches = [...byFonte.values()].reduce((a, s) => a + s.matchBad.length, 0);
  console.log(`\n== TOTAL: ${caseResults.filter(c => c.n > 0).length}/${caseResults.length} casos com stream · probes ${totalOk}/${totalProbes} ok · matches BAD ${badMatches} · ffprobe ${ffResults.filter(f => f.ok).length}/${ffResults.length} ==`);
  process.exit(0);
})().catch(e => {
  console.error("AUDIT FATAL:", e);
  process.exit(1);
});
