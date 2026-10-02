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

// PROVA DE PLAYLIST DE TV AO VIVO — o que pode descartar um canal e o que nao pode.
//
// MEDIDO 02/10/2026 no RCD (`cdn-sp2.satlabscloud.com.br`): a cadeia de 3 saltos
// resolve e entrega `index.m3u8?token=...` (um token real, de quem resolveu), mas a
// playlist responde **403 para o IP de datacenter deste servidor**. O token e' de
// origem e o aparelho baixa do IP residencial de quem assiste, entao o 403 NAO prova
// que o canal esta morto para o usuario — e a regua do projeto e' exatamente essa
// (decisoes 131/134: "nao deu para saber" nunca vira "morreu"; e o video nunca passa
// por este servidor).
//
// O que DESCARTA: a origem respondeu que nao ha video — 404, 410, 451, ou resposta
// 2xx sem `#EXTM3U` e sem segmento.
// O que NAO descarta: 403, 429, 5xx, timeout e rede. A cadeia achou o link; entregar
// e melhor do que esconder o canal, porque o dono pediu "se achar, apareca o player".
function contaSegmentos(texto) {
  const t = String(texto || "");
  if (!t.includes("#EXTM3U")) return 0;
  return t.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
}

function provaPlaylist(status, texto) {
  if (status === 404 || status === 410 || status === 451) return "morta";
  if (status < 200 || status >= 300) return "indeciso";
  return contaSegmentos(texto) > 0 ? "viva" : "morta";
}

module.exports = { contaSegmentos, provaPlaylist, sinaliza };
