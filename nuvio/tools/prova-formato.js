// O player do Nuvio so reconhece HLS pela extensão `.m3u8` da URL ou pelo
// `format=m3u8` na query (port em tools/mime.js). REI e EMB terminam em `.txt`.
// Este script resolve o link de verdade e prova que a ORIGEM aceita o parâmetro
// extra: mesmo status, mesmo content-type, mesmo corpo.
//
//   node tools/prova-formato.js            # hbo nas duas fontes
//   node tools/prova-formato.js cnnbrasil  # outro canal

const path = require("path");
const fontes = require("../src/core/fontes");

async function resolve(chave, canal) {
  const mod = require(path.join(__dirname, "..", "dist", fontes.bundleDe(chave)));
  const lista = await mod.getStreams(canal, "channel", null, null);
  return (lista || [])[0] || null;
}

async function olha(url, etiqueta) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" }, redirect: "follow" });
    const corpo = await r.text();
    const cabecalho = r.headers.get("content-type") || "-";
    const éHls = corpo.startsWith("#EXTM3U");
    const segs = (corpo.match(/^https?:\/\/\S+/gm) || []).length;
    const rel = (corpo.match(/^\/\S+/gm) || []).length;
    console.log(`  ${etiqueta.padEnd(18)} ${r.status} ${cabecalho.padEnd(28)} ${String(Date.now() - t0).padStart(5)}ms  #EXTM3U=${éHls} segmentosAbs=${segs} relativos=${rel} ${corpo.length}B`);
    return { status: r.status, éHls, corpo };
  } catch (e) {
    console.log(`  ${etiqueta.padEnd(18)} FALHOU: ${e.message}`);
    return { status: 0, éHls: false, corpo: "" };
  }
}

(async () => {
  const canal = process.argv[2] || "hbo";
  for (const chave of (process.env.FONTES || "rei,emb").split(",")) {
    const s = await resolve(chave.trim(), canal);
    if (!s) { console.log(`${chave}: sem stream`); continue; }
    console.log(`${chave} ${canal}`);
    console.log(`  url: ${s.url}`);
    const sep = s.url.includes("?") ? "&" : "?";
    const a = await olha(s.url, "original");
    const b = await olha(`${s.url}${sep}format=m3u8`, "+format=m3u8");
    const igual = a.corpo && a.corpo === b.corpo;
    console.log(`  => ${b.éHls && b.status === 200 ? (igual ? "aceita o parâmetro, corpo IDÊNTICO" : "aceita o parâmetro, corpo DIFERENTE") : "RECUOU com o parâmetro"}`);
  }
})().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
