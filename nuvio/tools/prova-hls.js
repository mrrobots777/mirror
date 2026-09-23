// Conteudo (`content-type`) e corpo das playlists das 4 fontes de TV — e' o que decide se o
// player do Nuvio reconhece a URL como HLS. O addon antigo servia a do REI como
// `application/vnd.apple.mpegurl`; agora a URL vai crua para o aparelho.
//
//   node tools/prova-hls.js [canal ...]

const path = require("path");
const fontes = require("../src/core/fontes");
const { UA } = require("../src/lib/ua");

const CANAIS = process.argv.slice(2).length ? process.argv.slice(2) : ["1001", "1141", "1261", "1081"];
const FONTES_TV = process.env.FONTES ? process.env.FONTES.split(",") : ["rei", "emb", "etc", "rcd"];

async function uma(url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: Object.assign({ "User-Agent": UA }, headers), signal: ctrl.signal, redirect: "follow" });
    const ct = r.headers.get("content-type") || "-";
    const body = Buffer.from(await r.arrayBuffer());
    const texto = body.toString("utf8", 0, Math.min(body.length, 4000));
    const ehHls = texto.includes("#EXTM3U");
    const semTags = texto.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    return { status: r.status, ct, bytes: body.length, ehHls, seg: semTags.length, inicio: texto.split("\n").slice(0, 3).join(" | ").slice(0, 160) };
  } catch (e) {
    return { status: 0, ct: "-", bytes: 0, ehHls: false, seg: 0, erro: String((e && e.message) || e).slice(0, 60) };
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  for (const id of CANAIS) {
    console.log(`\ncanal ${id}`);
    for (const f of FONTES_TV) {
      if (!fontes.FONTES[f]) continue;
      const mod = require(path.join(__dirname, "..", "dist", fontes.bundleDe(f)));
      let lista;
      const t0 = Date.now();
      try {
        lista = await mod.getStreams(String(id), "channel", null, null);
      } catch (e) {
        console.log(`  ${f.padEnd(4)} LANCOU ${String((e && e.message) || e).slice(0, 70)}`);
        continue;
      }
      if (!Array.isArray(lista) || !lista.length) {
        console.log(`  ${f.padEnd(4)} 0 streams (${Date.now() - t0}ms)`);
        continue;
      }
      for (const s of lista.slice(0, 2)) {
        const url = typeof s.url === "object" && s.url ? s.url.url : s.url;
        const r = await uma(url, s.headers || {});
        console.log(`  ${f.padEnd(4)} ${String(r.status).padStart(3)} ${String(r.ct).padEnd(34)} ${String(r.bytes).padStart(6)}B hls=${r.ehHls} linhas=${r.seg} ${Date.now() - t0}ms`);
        if (r.ehHls || r.erro) console.log(`        ${r.erro || r.inicio}`);
      }
    }
  }
})();
