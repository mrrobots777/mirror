// Que MIME o PLAYER do Nuvio vai inferir para a URL que a fonte devolve?
//
//   node tools/mime.js                    # as 15 fontes, caso padrão
//   node tools/mime.js 1001 channel       # mesmo caso para todas
//   FONTES=rei,emb node tools/mime.js
//
// Port fiel de `PlayerMediaSourceFactory.inferMimeType` do NuvioTV
// (app/src/main/java/com/nuvio/tv/ui/screens/player/PlayerMediaSourceFactory.kt).
// A stream do plugin NAO tem `behaviorHints.proxyHeaders.response` (o Nuvio monta
// `ProxyHeaders(request = headers, response = null)`) nem `filename`, então o que
// decide é só a URL: extensão do caminho → query → token delimitado.
//
// `null` = o player abre como PROGRESSIVO (extractor). Para `.mp4` isso é o certo;
// para playlist HLS é o caminho do erro "UnrecognizedInputFormatException" +
// sonda de rede (só depois de a tela de play já ter reclamado).

const path = require("path");
const { chaveTmdb, PADRAO, casosDosArgs } = require("./casos");

const chave = chaveTmdb();
if (chave) globalThis.TMDB_API_KEY = chave;

const HLS = "application/x-mpegurl";
const DASH = "application/dash+xml";
const SS = "application/vnd.ms-sstr+xml";

const EXT = {
  m3u8: HLS, m3u: HLS,
  mpd: DASH,
  ism: SS, isml: SS,
  mkv: "video/x-matroska",
  webm: "video/webm",
  mp4: "video/mp4", m4v: "video/x-m4v",
  ts: "video/mp2t", mts: "video/mp2t", m2ts: "video/mp2t",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mpeg: "video/mpeg", mpg: "video/mpeg",
};

const QUERY_KEYS = ["format", "mime", "mime_type", "contenttype", "content_type", "type", "ext", "extension", "output", "protocol", "mode", "stream", "service"];
const QUERY_VALUES = {
  "application/vnd.apple.mpegurl": HLS, "application/mpegurl": HLS, "application/x-mpegurl": HLS,
  "audio/mpegurl": HLS, "audio/x-mpegurl": HLS, "application/m3u8": HLS, m3u8: HLS, m3u: HLS, hls: HLS,
  "application/dash+xml": DASH, "video/vnd.mpeg.dash.mpd": DASH, dash: DASH,
  "application/vnd.ms-sstr+xml": SS, smoothstreaming: SS, ss: SS,
};

const DELIMITED_M3U8 = /(^|[=/_.?&-])(m3u8|m3u)($|[=/_.?&-])/;
const PLAYLIST_HLS = /\/(playlist|hls|manifest|master|vs)\/(?!stream$|list$|info$|details$)[a-zA-Z0-9_/-]+$/;
const DELIMITED_MPD = /(^|[=/_.?&-])mpd($|[=/_.?&-])/;
const DELIMITED_SS = /(^|[=/_.?&-])(ism|isml)($|[=/_.?&-])/;

function adaptiveFrom(p) {
  if (!p || !p.trim()) return null;
  const norm = p.trim().toLowerCase();
  const semFragmente = norm.split("#")[0];
  const pathPart = semFragmente.split("?")[0];
  const ext = pathPart.substring(pathPart.lastIndexOf("/") + 1).split(".").pop();
  if (ext === pathPart.substring(pathPart.lastIndexOf("/") + 1) && !pathPart.includes(".")) return null;
  if (ext === "m3u8" || ext === "m3u") return HLS;
  if (ext === "mpd") return DASH;
  if (ext === "ism" || ext === "isml") return SS;
  return null;
}

function deQuery(query) {
  if (!query || !query.trim()) return null;
  for (const parametro of query.split("&")) {
    const key = parametro.split("=")[0].trim();
    const valor = parametro.includes("=") ? parametro.slice(parametro.indexOf("=") + 1).trim() : "";
    if (!key || !valor) continue;
    if (QUERY_KEYS.includes(key)) {
      const v = valor.substring(valor.lastIndexOf("/") + 1);
      const ext = v.substring(v.lastIndexOf(".") + 1);
      if (EXT[ext] === HLS) return HLS;
      if (EXT[ext] === DASH) return DASH;
      if (EXT[ext] === SS) return SS;
      if (EXT[ext]) return EXT[ext];
    }
    if (QUERY_VALUES[valor]) return QUERY_VALUES[valor];
  }
  return null;
}

function delimitado(v) {
  if (!v || !v.trim()) return null;
  if (DELIMITED_M3U8.test(v)) return HLS;
  if (PLAYLIST_HLS.test(v)) return HLS;
  if (DELIMITED_MPD.test(v)) return DASH;
  if (DELIMITED_SS.test(v)) return SS;
  return null;
}

function deCaminho(p) {
  if (!p || !p.trim()) return null;
  const norm = p.trim().toLowerCase();
  const semFragmente = norm.split("#")[0];
  const pathPart = semFragmente.split("?")[0];
  const queryPart = semFragmente.includes("?") ? semFragmente.slice(semFragmente.indexOf("?") + 1) : "";
  const nome = pathPart.substring(pathPart.lastIndexOf("/") + 1);
  const ext = nome.includes(".") ? nome.substring(nome.lastIndexOf(".") + 1) : "";
  if (EXT[ext]) return EXT[ext];
  return deQuery(queryPart) || delimitado(pathPart) || delimitado(queryPart);
}

function inferMimeType(url, filename, responseHeaders) {
  return adaptiveFrom(filename) || adaptiveFrom(url) || deCaminho(filename) || deCaminho(url);
}

const rotulo = {
  "application/x-mpegurl": "HLS ✓",
  "application/dash+xml": "DASH ✓",
  "video/mp4": "MP4 progressivo ✓",
  "video/mp2t": "TS progressivo ✓",
};

function diagnóstico(url) {
  const mime = inferMimeType(url, null, null);
  const caminho = url.split("?")[0];
  const ext = (caminho.substring(caminho.lastIndexOf("/") + 1).match(/\.([a-z0-9]+)$/i) || [])[1] || "(sem)";
  const éPlaylist = /m3u8|m3u|mpegurl|(^|\/)hls|master|playlist/i.test(url);
  let veredito;
  if (mime === HLS) veredito = "HLS pelo player ✓";
  else if (mime === "video/mp4" || mime === "video/mp2t" || mime === "video/x-m4v") veredito = "progressivo ✓";
  else if (éPlaylist) veredito = "PROGRESSIVO para uma PLAYLIST ✗ (vai dar erro e a sonda de rede tem que resgatar)";
  else veredito = `progressivo (${mime || "mime desconhecido"}) — extractor tem que sniffar`;
  return { mime: mime || "-", ext, veredito };
}

async function streamsDe(fonte, caso) {
  const fontes = require("../src/core/fontes");
  const arquivo = path.join(__dirname, "..", "dist", fontes.bundleDe(fonte));
  try {
    const mod = require(arquivo);
    return { lista: await mod.getStreams(caso[0], caso[1], caso[2], caso[3]), erro: "" };
  } catch (e) {
    return { lista: [], erro: String((e && e.message) || e) };
  }
}

(async () => {
  const fontes = require("../src/core/fontes");
  const argv = process.argv.slice(2);
  const casoComum = casosDosArgs(argv);
  const env = process.env.FONTES;
  const alvos = (env ? env.split(",").map((s) => s.trim()).filter(Boolean) : fontes.chaves())
    .filter((c) => fontes.FONTES[c])
    .map((chave) => ({ chave, caso: casoComum || PADRAO[chave] }));

  const ruins = [];
  for (const a of alvos) {
    const { lista, erro } = await streamsDe(a.chave, a.caso);
    if (erro) { console.log(`${a.chave.padEnd(4)} LANCOU: ${erro}`); continue; }
    if (!Array.isArray(lista) || !lista.length) { console.log(`${a.chave.padEnd(4)} 0 streams`); continue; }
    const vistos = new Set();
    for (const s of lista) {
      const url = s && s.url;
      if (!url || vistos.has(url)) continue;
      vistos.add(url);
      const d = diagnóstico(url);
      const marca = d.veredito.includes("✗") ? "✗" : " ";
      if (marca === "✗") ruins.push({ fonte: a.chave, url });
      console.log(`${a.chave.padEnd(4)} ${d.ext.padEnd(8)} ${d.mime.padEnd(26)} ${d.veredito}  ${url.slice(0, 110)}`);
    }
  }
  console.log("-".repeat(72));
  console.log(ruins.length
    ? `${ruins.length} URL(s) que o player NAO abre como HLS de primeira:`
    : "nenhuma URL levaria o player pelo caminho errado");
  for (const r of ruins) console.log(`  ${r.fonte} ${r.url}`);
})().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
