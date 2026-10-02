require("dotenv").config();

const tv = require("./src/core/tv-sources");
const { UA } = require("./src/lib/ua");

const BASE = (process.env.AUDIT_BASE || "http://localhost:7000").replace(/\/$/, "");
const LIMITE = Number(process.env.AUDIT_LIMITE) || 0;
const CONC = Number(process.env.AUDIT_CONC) || 6;
const PROBE = process.env.AUDIT_PROBE === "1";

function headersDo(s) {
  return (s && s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) || {};
}

async function buscar(url, headers, ms) {
  return fetch(url, {
    headers: { "User-Agent": UA, ...(headers || {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(ms || 20000),
  });
}

async function veDoUsuario(id) {
  const t0 = Date.now();
  try {
    const lista = (await tv.getStreams(id, BASE)) || [];
    const fontes = [...new Set(lista.map(s => (s.sources || [])[0]).filter(Boolean))];
    return { ms: Date.now() - t0, lista, fontes };
  } catch (e) {
    return { ms: Date.now() - t0, lista: [], fontes: [], erro: String(e.message).slice(0, 60) };
  }
}

async function temNoProvedor(member) {
  const prov = tv.PROVIDERS.find(p => p.id === member.providerId);
  if (!prov) return { n: 0, erro: "provedor desconhecido" };
  const t0 = Date.now();
  try {
    const r = await prov.module.getStreams(member.slug, BASE);
    const lista = Array.isArray(r) ? r : [];
    return { n: lista.length, ms: Date.now() - t0, erro: null, lista };
  } catch (e) {
    return { n: 0, ms: Date.now() - t0, erro: String(e.message).slice(0, 60) };
  }
}

async function toca(stream) {
  const headers = headersDo(stream);
  try {
    const r = await buscar(stream.url, headers, 20000);
    if (r.status !== 200 && r.status !== 206) return { ok: false, motivo: `HTTP ${r.status}` };
    const texto = await r.text().catch(() => "");
    if (!/#EXTM3U/.test(texto)) {
      return { ok: true, motivo: `HTTP ${r.status} sem playlist` };
    }
    const linhas = texto.split(/\r?\n/).filter(l => l && !l.startsWith("#"));
    if (!linhas.length) return { ok: false, motivo: "playlist sem segmentos" };
    let alvo = linhas[0];
    try { alvo = new URL(alvo, stream.url).href; } catch (_) {}
    const r2 = await buscar(alvo, headers, 20000);
    const buf = await r2.arrayBuffer().catch(() => new ArrayBuffer(0));
    const ok = r2.status === 200 || r2.status === 206;
    return { ok, motivo: ok ? `${buf.byteLength}B` : `segmento HTTP ${r2.status}` };
  } catch (e) {
    return { ok: false, motivo: "ERRO " + String(e.message).slice(0, 40) };
  }
}

(async () => {
  console.log("carregando catalogo de TV (popula os grupos)...");
  const t0 = Date.now();
  const catalogo = await tv.getCatalog();
  console.log(`catalogo: ${catalogo.length} canais em ${Date.now() - t0}ms`);

  const lista = LIMITE > 0 ? catalogo.slice(0, LIMITE) : catalogo;
  let bloqueios = 0;
  let semStream = 0;
  let naoToca = 0;
  const relatorio = [];

  const fila = lista.slice();
  async function worker() {
    while (fila.length) {
      const meta = fila.shift();
      if (!meta) break;
      const id = meta.id;
      const user = await veDoUsuario(id);
      const membros = tv.membersOf(id);
      const linhas = [];

      for (const m of membros) {
        if (user.fontes.includes(m.providerId)) {
          linhas.push({ fonte: m.providerId, estado: "aparece", n: user.lista.filter(s => (s.sources || [])[0] === m.providerId).length });
          continue;
        }
        const direto = await temNoProvedor(m);
        if (direto.n > 0) {
          bloqueios++;
          linhas.push({ fonte: m.providerId, estado: "BLOQUEIO", n: direto.n, ms: direto.ms });
        } else {
          linhas.push({ fonte: m.providerId, estado: "nao tem", erro: direto.erro, ms: direto.ms });
        }
      }

      if (!user.lista.length) semStream++;

      let play = null;
      if (PROBE && user.lista.length) {
        play = await toca(user.lista[0]);
        if (!play.ok) naoToca++;
      }

      relatorio.push({ nome: meta.name, id, linhas, user: user.fontes, total: user.lista.length, erroUser: user.erro, play });
      const feitos = relatorio.length;
      if (feitos % 20 === 0 || feitos === lista.length) {
        const bloq = relatorio.reduce((a, r) => a + r.linhas.filter(l => l.estado === "BLOQUEIO").length, 0);
        const semSt = relatorio.filter(r => !r.total).length;
        console.log(`  ... ${feitos}/${lista.length} canais | bloqueios=${bloq} sem stream=${semSt}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONC }, worker));

  const soProblemas = process.env.AUDIT_SO_PROBLEMAS === "1";
  for (const r of relatorio) {
    const temBloqueio = r.linhas.some(l => l.estado === "BLOQUEIO");
    const problema = temBloqueio || !r.total || (r.play && !r.play.ok);
    if (soProblemas && !problema) continue;
    const marca = temBloqueio ? "***" : (!r.total ? "!!" : "  ");
    console.log(`${marca} ${r.nome} (${r.id}) — usuario ve ${r.total} stream(s) [${r.user.join(",") || "-"}]${r.total ? "" : " ERRO: " + (r.erroUser || "nenhum stream")}`);
    for (const l of r.linhas) {
      if (l.estado === "aparece") console.log(`      ${l.fonte}: aparece (${l.n})`);
      else if (l.estado === "BLOQUEIO") console.log(`      ${l.fonte}: *** TEM ${l.n} E NAO APARECE *** (${l.ms}ms)`);
      else console.log(`      ${l.fonte}: nao tem${l.erro ? " — " + l.erro : ""}`);
    }
    if (r.play) console.log(`      play do 1o: ${r.play.ok ? "OK " + r.play.motivo : "NAO TOCA — " + r.play.motivo}`);
  }

  console.log("\n================ RESUMO TV ================");
  console.log(`canais auditados                : ${relatorio.length}`);
  console.log(`provedor TEM e o usuario nao ve  : ${bloqueios}`);
  console.log(`canais sem nenhum stream         : ${semStream}`);
  if (PROBE) console.log(`1o stream nao respondeu           : ${naoToca}`);
  if (bloqueios) {
    console.log("\n--- BLOQUEIOS ---");
    for (const r of relatorio) {
      for (const l of r.linhas) if (l.estado === "BLOQUEIO") console.log(`${r.nome} (${r.id}): ${l.fonte} tem ${l.n} e nao aparece`);
    }
  }
  if (semStream) {
    console.log("\n--- SEM STREAM ---");
    for (const r of relatorio) if (!r.total) console.log(`${r.nome} (${r.id}) — membros: ${r.linhas.map(l => l.fonte + ":" + l.estado).join(", ")}`);
  }
  process.exit(0);
})();
