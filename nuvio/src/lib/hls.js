const CHAVE = "format";
const VALOR = "m3u8";

const CHAVES_FORMATO = ["format", "mime", "mime_type", "contenttype", "content_type", "type", "ext", "extension", "output", "protocol", "mode", "stream", "service"];
const FORMATOS = ["m3u8", "m3u", "mpd", "ism", "isml", "mkv", "webm", "mp4", "m4v", "ts", "mts", "m2ts", "mov", "avi", "mpeg", "mpg"];
const VALORES_MANIFESTO = [
  "application/vnd.apple.mpegurl", "application/mpegurl", "application/x-mpegurl",
  "audio/mpegurl", "audio/x-mpegurl", "application/m3u8", "m3u8", "m3u", "hls",
  "application/dash+xml", "video/vnd.mpeg.dash.mpd", "dash",
  "application/vnd.ms-sstr+xml", "smoothstreaming", "ss"
];

function caminhoDe(url) {
  return String(url || "").split("#")[0].split("?")[0];
}

function queryDe(url) {
  const semFragmente = String(url || "").split("#")[0];
  return semFragmente.includes("?") ? semFragmente.slice(semFragmente.indexOf("?") + 1) : "";
}

function extensaoDe(caminho) {
  const nome = caminho.substring(caminho.lastIndexOf("/") + 1);
  return nome.includes(".") ? nome.substring(nome.lastIndexOf(".") + 1).toLowerCase() : "";
}

function jaDiz(url) {
  const ext = extensaoDe(caminhoDe(url));
  if (FORMATOS.includes(ext)) return true;
  return queryDe(url).split("&").some((p) => {
    const i = p.indexOf("=");
    const k = (i < 0 ? p : p.slice(0, i)).trim().toLowerCase();
    const v = (i < 0 ? "" : p.slice(i + 1)).trim().toLowerCase();
    if (!k || !v) return false;
    if (CHAVES_FORMATO.includes(k)) {
      const formato = v.substring(v.lastIndexOf("/") + 1);
      const nome = formato.substring(formato.lastIndexOf(".") + 1);
      if (FORMATOS.includes(nome)) return true;
    }
    return VALORES_MANIFESTO.includes(v);
  });
}

function sinaliza(url) {
  if (!url) return url;
  if (jaDiz(url)) return url;
  const sep = String(url).includes("?") ? "&" : "?";
  return `${url}${sep}${CHAVE}=${VALOR}`;
}

module.exports = { sinaliza };
