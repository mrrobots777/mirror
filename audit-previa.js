require("dotenv").config();
const epg = require("./src/lib/epg");
const tv = require("./src/core/tv-sources");

const BASE = process.env.PREV_BASE || "";
const CONC = Number(process.env.PREV_CONC || 8);

async function testaLogo(url) {
  if (!url) return { ok: false, motivo: "sem url" };
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "image/*,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const tipo = (r.headers.get("content-type") || "").toLowerCase();
    let bytes = 0;
    let assinaturaOk = false;
    if (r.ok) {
      const b = Buffer.from(await r.arrayBuffer());
      bytes = b.length;
      assinaturaOk = b.length > 300 &&
        (b[0] === 0x89 || b[0] === 0xff || b[0] === 0x52 || b.slice(0, 4).toString() === "RIFF" || b[0] === 0x47);
    }
      return {
      ok: r.ok && bytes > 300 && assinaturaOk,
      status: r.status,
      tipo,
      bytes,
      motivo: !r.ok ? `HTTP ${r.status}` : bytes <= 300 ? `so ${bytes}B` : !assinaturaOk ? "nao e imagem" : "",
    };
  } catch (e) {
    return { ok: false, status: 0, motivo: e.message.slice(0, 44) };
  }
}

(async () => {
  const cat = await tv.getCatalog();
  await epg.carregar();
  const hoje = epg.dataDe(Math.floor(Date.now() / 1000));
  console.log(`\n=== PREVIA E GUIA DE ${cat.length} CANAIS ===`);

  let i = 0;
  const res = [];
  async function worker() {
    while (i < cat.length) {
      const m = cat[i++];
      const logo = await testaLogo(m.poster);
      res.push({ nome: m.name, id: m.id, poster: m.poster || "", logo, guia: epg.grade(m.name, m.id, hoje).length });
      process.stdout.write(`\r  ${res.length}/${cat.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, cat.length) }, worker));
  process.stdout.write("\r" + " ".repeat(40) + "\r");

  const semCampo = res.filter(r => !r.poster);
  const comCampoQuebrado = res.filter(r => r.poster && !r.logo.ok);
  const previaBoa = res.filter(r => r.logo.ok);
  const comGuia = res.filter(r => r.guia > 0);
  const semGuia = res.filter(r => r.guia === 0);
  const semNada = res.filter(r => !r.logo.ok && r.guia === 0);

  console.log(`\n  previa que CARREGA .............. ${previaBoa.length}/${res.length}`);
  console.log(`  sem campo de previa ............. ${semCampo.length}`);
  console.log(`  com previa mas QUEBRADA ......... ${comCampoQuebrado.length}`);
  console.log(`  com guia ....................... ${comGuia.length}`);
  console.log(`  sem guia ....................... ${semGuia.length}`);
  console.log(`  sem previa E sem guia ........... ${semNada.length}`);

  if (comCampoQuebrado.length) {
    console.log(`\n  --- PREVIA QUEBRADA (${comCampoQuebrado.length}) ---`);
    const hosts = new Map();
    for (const r of comCampoQuebrado) {
      let h = "?";
      try { h = new URL(r.poster).host; } catch (_) {}
      hosts.set(h, (hosts.get(h) || 0) + 1);
    }
    console.log("  por servidor: " + [...hosts].map(([h, n]) => `${h} (${n})`).join("  "));
    for (const r of comCampoQuebrado.slice(0, 25)) {
      console.log(`  ${r.nome.padEnd(30).slice(0, 30)} ${String(r.logo.status).padEnd(4)} ${(r.logo.motivo || "").padEnd(12)} ${r.poster.slice(0, 62)}`);
    }
    if (comCampoQuebrado.length > 25) console.log(`  ... e mais ${comCampoQuebrado.length - 25}`);
  }
  if (semNada.length) {
    console.log(`\n  --- SEM PREVIA E SEM GUIA (${semNada.length}) ---`);
    console.log("  " + semNada.map(r => r.nome).join(" | ").slice(0, 900));
  }
  process.exit(0);
})();
