require("dotenv").config();
const { spawn } = require("child_process");

const BASE = process.env.PROBE_BASE || "http://localhost:7001";
const CONC = Number(process.env.PROBE_CONC || 4);
const SEGUNDOS = Number(process.env.PROBE_SEG || 5);
const ALVOS = (process.env.PROBE_CANAIS || "").split(",").map(s => s.trim()).filter(Boolean);

function decodifica(url, headers) {
  return new Promise(resolve => {
    const args = ["-v", "error", "-user_agent", "Mozilla/5.0", "-rw_timeout", "25000000"];
    for (const [k, v] of Object.entries(headers || {})) args.push("-headers", `${k}: ${v}\r\n`);
    args.push("-i", url, "-t", String(SEGUNDOS), "-f", "null", "-");
    const p = spawn("ffmpeg", args, { timeout: 60000 });
    let err = "";
    p.stderr.on("data", c => (err += c));
    p.on("error", e => resolve({ ok: false, motivo: e.message.slice(0, 50) }));
    p.on("close", code => {
      if (code === 0) return resolve({ ok: true, motivo: "decodificou" });
      const linhas = err.split("\n").filter(l => l && !/^\s*\[/.test(l));
      resolve({ ok: false, motivo: (linhas[0] || err.split("\n").filter(Boolean).pop() || "erro").slice(0, 68) });
    });
  });
}

function headersDo(s) {
  const ph = s.behaviorHints && s.behaviorHints.proxyHeaders;
  return (ph && ph.request) || s.headers || null;
}

async function canaisAlvo() {
  if (ALVOS.length) {
    const cat = await fetch(`${BASE}/catalog/tv/mirror-tv-live.json`, { signal: AbortSignal.timeout(40000) }).then(r => r.json()).catch(() => ({}));
    const todos = cat.metasDetailed || cat.metas || [];
    return todos.filter(m => ALVOS.some(a => m.name.toLowerCase() === a.toLowerCase()));
  }
  const cat = await fetch(`${BASE}/catalog/tv/mirror-tv-live.json`, { signal: AbortSignal.timeout(40000) }).then(r => r.json()).catch(() => ({}));
  return cat.metasDetailed || cat.metas || [];
}

async function testa(meta) {
  const st = await fetch(`${BASE}/stream/tv/${encodeURIComponent(meta.id)}.json`, { signal: AbortSignal.timeout(70000) }).then(r => r.json()).catch(() => ({}));
  const out = [];
  for (const s of (st.streams || [])) {
    const r = await decodifica(s.url, headersDo(s));
    out.push({ fonte: (s.sources || ["?"])[0], ok: r.ok, motivo: r.motivo, titulo: String(s.title || "").split("\n")[0] });
  }
  return { nome: meta.name, streams: out };
}

(async () => {
  const metas = await canaisAlvo();
  console.log(`\n=== DECODIFICACAO REAL DE ${metas.length} CANAIS (${SEGUNDOS}s cada stream) ===`);
  const res = [];
  let i = 0;
  async function worker() {
    while (i < metas.length) {
      const m = metas[i++];
      const r = await testa(m);
      res.push(r);
      process.stdout.write(`\r  ${res.length}/${metas.length} canais`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, metas.length) }, worker));
  process.stdout.write("\r" + " ".repeat(40) + "\r");

  const porFonte = new Map();
  for (const r of res) {
    for (const s of r.streams) {
      if (!porFonte.has(s.fonte)) porFonte.set(s.fonte, { ok: 0, total: 0 });
      const e = porFonte.get(s.fonte);
      e.total++;
      if (s.ok) e.ok++;
    }
  }
  const canaisOk = res.filter(r => r.streams.some(s => s.ok));
  const canaisFora = res.filter(r => r.streams.length && !r.streams.some(s => s.ok));
  const semStream = res.filter(r => !r.streams.length);

  console.log(`  canais que TOCAM .............. ${canaisOk.length}/${res.length}`);
  console.log(`  canais que NAO tocam .......... ${canaisFora.length}`);
  console.log(`  canais sem stream ............. ${semStream.length}`);
  console.log(`\n  --- por fonte ---`);
  for (const [k, v] of [...porFonte].sort()) {
    console.log(`  ${k.toUpperCase().padEnd(5)} ${v.ok}/${v.total} tocam (${Math.round((v.ok / v.total) * 100)}%)`);
  }
  if (canaisFora.length) {
    console.log(`\n  --- canais que NAO tocam (${canaisFora.length}) ---`);
    for (const r of canaisFora) {
      const m = r.streams.map(s => `${s.fonte}:${s.motivo.slice(0, 40)}`).join("  |  ");
      console.log(`  ${r.nome.padEnd(34).slice(0, 34)} ${m}`);
    }
  }
  const parciais = res.filter(r => r.streams.length > 1 && r.streams.some(s => !s.ok) && r.streams.some(s => s.ok));
  if (parciais.length) {
    console.log(`\n  --- fonte que falha dentro do canal (${parciais.length}) ---`);
    for (const r of parciais) {
      console.log(`  ${r.nome.padEnd(34).slice(0, 34)} ` + r.streams.map(s => `${s.fonte}:${s.ok ? "ok" : "falhou(" + s.motivo.slice(0, 24) + ")"}`).join("  "));
    }
  }
  process.exit(0);
})();
