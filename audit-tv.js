require("dotenv").config();

const { UA } = require("./src/lib/ua");
const tv = require("./src/core/tv-sources");
const epg = require("./src/lib/epg");

const FUNDO = (process.env.AUDIT_BASE || "http://localhost:7000").replace(/\/$/, "");
const LIMITE = Number(process.env.AUDIT_CONC || 8);
const PROFUNDO = process.env.AUDIT_DEEP !== "0";

async function buscar(url, headers, timeoutMs) {
  return fetch(url, {
    headers: { "User-Agent": UA, ...(headers || {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs || 20000),
  });
}

function headersDo(stream) {
  const ph = stream.behaviorHints && stream.behaviorHints.proxyHeaders;
  return (ph && ph.request) || stream.headers || null;
}

async function testaPlaylist(url, headers) {
  const r = await buscar(url, headers, 20000);
  const tipo = (r.headers.get("content-type") || "").toLowerCase();
  const texto = tipo.includes("mpegurl") || url.includes(".m3u8") ? await r.text().catch(() => "") : "";
  const variantes = (texto.match(/^#EXT-X-STREAM-INF/gm) || []).length;
  const segmentos = (texto.match(/^#EXTINF/gm) || []).length;
  return { status: r.status, tipo, variantes, segmentos, sample: texto.slice(0, 120) };
}

async function testaSegmento(playlistUrl, headers) {
  const r = await buscar(playlistUrl, headers, 20000);
  const texto = await r.text().catch(() => "");
  const linhas = texto.split(/\r?\n/).filter(l => l && !l.startsWith("#"));
  if (!linhas.length) return { ok: false, motivo: "playlist sem segmentos" };
  let alvo = linhas[0];
  try { alvo = new URL(alvo, playlistUrl).href; } catch (_) {}
  if (!/^https?:/i.test(alvo)) return { ok: false, motivo: "segmento nao-absoluto" };
  const r2 = await buscar(alvo, { ...(headers || {}), Range: "bytes=0-65535" }, 20000);
  let bytes = 0;
  try {
    const buf = await r2.arrayBuffer();
    bytes = buf.byteLength;
  } catch (_) {}
  return { ok: r2.status === 200 || r2.status === 206, status: r2.status, bytes, url: alvo };
}

function semAcento(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

async function canalPara(meta) {
  const nome = meta.name;
  const registro = {
    nome,
    id: meta.id,
    fontes: String(meta.description || "").match(/📺 ([A-Z+]+)/)?.[1] || "?",
    guiaHoje: epg.linhaGuia(nome) ? true : false,
    guiaAmanha: epg.grade(nome, meta.id, epg.dataDe(Math.floor(Date.now() / 1000) + 86400)).length > 0,
    streams: [],
    erro: null,
  };
  const caminho = `/stream/tv/${encodeURIComponent(meta.id)}.json`;
  try {
    const r = await buscar(FUNDO + caminho, null, 45000);
    const j = await r.json().catch(() => ({}));
    for (const s of j.streams || []) {
      const item = {
        fonte: (s.sources || [])[0] || "?",
        titulo: String(s.title || "").split("\n")[0],
        url: s.url,
        headers: headersDo(s),
        status: 0,
        tipo: "",
        toca: false,
        motivo: "",
      };
      try {
        const pl = await testaPlaylist(s.url, item.headers);
        item.status = pl.status;
        item.tipo = pl.tipo;
        item.variantes = pl.variantes;
        if (PROFUNDO && (pl.variantes || pl.segmentos) && pl.sample) {
          const sg = await testaSegmento(pl.sample.includes("#EXTM3U") ? s.url : s.url, item.headers);
          item.toca = sg.ok;
          item.motivo = sg.ok ? `${sg.bytes}B` : sg.motivo || `HTTP ${sg.status}`;
          item.segmentoStatus = sg.status;
        } else {
          item.toca = pl.status === 200 || pl.status === 206;
          item.motivo = pl.status === 200 || pl.status === 206 ? (pl.variantes ? `${pl.variantes} variantes` : `${pl.segmentos} seg`) : `HTTP ${pl.status}`;
        }
      } catch (e) {
        item.motivo = "ERRO " + e.message.slice(0, 50);
      }
      registro.streams.push(item);
    }
    if (!(j.streams || []).length) registro.erro = "nenhum stream";
  } catch (e) {
    registro.erro = e.message.slice(0, 60);
  }
  return registro;
}

async function comLimite(lista, fn, limite) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < lista.length) {
      const atual = i++;
      out[atual] = await fn(lista[atual]);
      process.stdout.write(`\r  processando ${out.filter(Boolean).length}/${lista.length} canais`);
    }
  }
  const n = Math.min(limite, lista.length);
  await Promise.all(Array.from({ length: n }, worker));
  process.stdout.write("\r" + " ".repeat(50) + "\r");
  return out;
}

(async () => {
  await epg.carregar();
  const cat = await tv.getCatalog();
  const filtro = process.env.AUDIT_ONLY
    ? cat.filter(m => new RegExp(process.env.AUDIT_ONLY, "i").test(m.name))
    : cat;
  console.log(`\n=== AUDITORIA DE TV AO VIVO (${filtro.length} canais) ===`);
  if (!PROFUNDO) console.log("  (modo leve: so a playlist; AUDIT_DEEP=0)");
  const t0 = Date.now();
  const res = await comLimite(filtro, canalPara, LIMITE);
  const ms = Date.now() - t0;

  const com2 = res.filter(r => r.fontes.includes("+"));
  const comGuia = res.filter(r => r.guiaHoje);
  const comGuiaAmanha = res.filter(r => r.guiaAmanha);
  const comStream = res.filter(r => r.streams.length);
  const semStream = res.filter(r => !r.streams.length);
  const tocando = res.filter(r => r.streams.some(s => s.toca));
  const todosMorto = res.filter(r => r.streams.length && !r.streams.some(s => s.toca));

  console.log(`\n--- RESUMO (${Math.round(ms / 1000)}s) ---`);
  console.log(`  canais auditados ........ ${res.length}`);
  console.log(`  com as DUAS fontes ...... ${com2.length}`);
  console.log(`  com 1 fonte só .......... ${res.length - com2.length}`);
  console.log(`  com guia hoje ........... ${comGuia.length}  (${Math.round(comGuia.length / res.length * 100)}%)`);
  console.log(`  com guia amanhã ......... ${comGuiaAmanha.length}`);
  console.log(`  com pelo menos 1 stream . ${comStream.length}`);
  console.log(`  sem nenhum stream ....... ${semStream.length}`);
  console.log(`  com stream que TOCA ..... ${tocando.length}`);
  console.log(`  TODOS os streams mortos . ${todosMorto.length}`);

  console.log(`\n--- POR FONTE (streams) ---`);
  const porFonte = new Map();
  for (const r of res) {
    for (const s of r.streams) {
      const k = s.fonte;
      if (!porFonte.has(k)) porFonte.set(k, { total: 0, toca: 0, erros: 0 });
      const e = porFonte.get(k);
      e.total++;
      if (s.toca) e.toca++;
      if (/^ERRO/.test(s.motivo)) e.erros++;
    }
  }
  for (const [k, v] of [...porFonte].sort((a, b) => b[1].toca - a[1].toca)) {
    const pct = v.total ? Math.round((v.toca / v.total) * 100) : 0;
    console.log(`  ${k.padEnd(5)} ${String(v.toca).padStart(4)}/${String(v.total).padEnd(4)} tocam (${String(pct).padStart(3)}%)  ${v.erros} erro de rede`);
  }

  if (semStream.length) {
    console.log(`\n--- SEM NENHUM STREAM (${semStream.length}) ---`);
    semStream.forEach(r => console.log(`  ${r.nome.padEnd(30).slice(0, 30)} ${r.fontes.padEnd(9)} ${r.erro || ""}`));
  }
  if (todosMorto.length) {
    console.log(`\n--- TODOS OS STREAMS MORTOS (${todosMorto.length}) ---`);
    todosMorto.forEach(r => {
      const m = r.streams.map(s => `${s.fonte}:${s.status || "?"}/${s.motivo}`).join("  ");
      console.log(`  ${r.nome.padEnd(28).slice(0, 28)} ${m}`);
    });
  }
  const parciais = res.filter(r => r.streams.length > 1 && r.streams.some(s => !s.toca));
  if (parciais.length) {
    console.log(`\n--- FONTE QUE FALHA DENTRO DO CANAL (${parciais.length}) ---`);
    parciais.forEach(r => {
      const m = r.streams.map(s => `${s.fonte}:${s.toca ? "ok" : "falhou(" + s.motivo.slice(0, 22) + ")"}`).join("  ");
      console.log(`  ${r.nome.padEnd(28).slice(0, 28)} ${m}`);
    });
  }

  console.log(`\n--- SEM GUIA (${res.length - comGuia.length}) ---`);
  console.log("  " + res.filter(r => !r.guiaHoje).map(r => r.nome).join(" | ").slice(0, 900));
  process.exit(0);
})();
