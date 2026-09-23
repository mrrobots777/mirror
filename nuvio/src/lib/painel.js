const { pegar } = require("./http");
const { UA } = require("./ua");

const MS_PADRAO = 8e3;

// MEDIDO 02/10/2026: o painel ATO recusa IP de datacenter — `player_api.php` responde
// `200` com a pagina "Welcome to nginx!" de 235 B (direto) e o MESMO pedido pelo worker
// `/proxy` devolve `200 application/json` de 2.307 B com o `get_vod_info` de verdade.
// A reserva e' o caminho do DETALHE, nunca do video: a URL do video continua saindo
// direto, e quem baixa e o aparelho. O worker e' derivado da sigla (`mirror-<sigla>`),
// igual ao registro do addon — o nome nunca e escrito a mao.
const WORKER_SUFIXO = "dev-avmirror.workers.dev";

function workerDe(sigla) {
  const limpa = String(sigla || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!limpa) return null;
  return `https://mirror-${limpa}.${WORKER_SUFIXO}`;
}

function urlProxiada(sigla, url) {
  const base = workerDe(sigla);
  return base ? `${base}/proxy?url=${encodeURIComponent(url)}` : null;
}

function baseDe(painel) {
  const porta = String(painel.porta || "443");
  const proto = porta === "80" ? "http" : "https";
  return `${proto}://${painel.servidor}:${porta}`;
}

function credencial(painel) {
  return `username=${encodeURIComponent(painel.usuario)}&password=${encodeURIComponent(painel.senha)}`;
}

function urlApi(painel, params) {
  const qs = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");
  return `${baseDe(painel)}/player_api.php?${credencial(painel)}&${qs}`;
}

function paginaDeErro(texto) {
  const primeiro = String(texto || "").slice(0, 200);
  return /welcome to nginx|<!doctype html|<html/i.test(primeiro);
}

// Quem ja recusou com a pagina de erro volta direto pela reserva: a recusa e politica da
// origem, nao um tropeco de rede, e pagar 2 requests por candidato em painel que nunca
// aceita este IP so atrasa o primeiro link da lista.
const recusaram = new Set();

async function le(url, ms, sigla) {
  const r = await pegar(url, { ms: Math.min(Number(ms) || MS_PADRAO, MS_PADRAO), headers: { Accept: "application/json", "User-Agent": UA } });
  if (r.status === 404) return { situacao: "nao-existe" };
  if (!r.ok) return { situacao: "recusa", motivo: `${sigla} player_api.php HTTP ${r.status}` };
  const texto = await r.text();
  if (!String(texto || "").trim()) return { situacao: "vazio" };
  try {
    return { situacao: "ok", json: JSON.parse(texto) };
  } catch (e) {
    // MEDIDO: o painel ATO responde `200` com a pagina "Welcome to nginx!" de 235 B
    // quando o cliente e um IP de datacenter — nao e JSON corrompido, e recusa de origem.
    if (paginaDeErro(texto)) {
      return { situacao: "recusa", refuga: true, motivo: `${sigla}: a origem devolveu pagina de erro (${texto.length} B), nao JSON — este IP foi recusado pelo painel` };
    }
    // JSON invalido que nao e pagina de erro = corpo cortado pelo teto de 1 MB do runtime.
    // O worker corta no mesmo teto, entao tentar de novo so gastaria o orcamento.
    return { situacao: "cortado", motivo: `${sigla}: resposta de ${url} nao e JSON valido (${String(texto || "").length} bytes — o teto de 1 MB do runtime corta aqui)` };
  }
}

async function api(painel, params, ms) {
  const url = urlApi(painel, params);
  const teto = Math.min(Number(ms) || MS_PADRAO, MS_PADRAO);
  const sigla = String(painel.sigla || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const reserva = urlProxiada(painel.sigla, url);
  const direto = recusaram.has(sigla) ? { situacao: "recusa", motivo: null } : await le(url, teto, painel.sigla);
  if (direto.situacao === "ok") return direto.json;
  if (direto.situacao === "nao-existe" || direto.situacao === "vazio") return null;
  if (direto.situacao === "cortado" || !reserva) throw new Error(direto.motivo);
  if (direto.refuga) recusaram.add(sigla);
  const reservaR = await le(reserva, teto, painel.sigla);
  if (reservaR.situacao === "ok") return reservaR.json;
  if (reservaR.situacao === "nao-existe" || reservaR.situacao === "vazio") return null;
  throw new Error(direto.motivo || reservaR.motivo);
}


function infoDe(painel, id, ms) {
  return api(painel, { action: "get_vod_info", vod_id: id }, ms);
}

function infoDeSerie(painel, id, ms) {
  return api(painel, { action: "get_series_info", series_id: id }, ms);
}

function tmdbDe(info) {
  if (!info || typeof info !== "object") return null;
  const bloco = info.info && typeof info.info === "object" ? info.info : info;
  const bruto = bloco.tmdb_id !== undefined ? bloco.tmdb_id : bloco.tmdbId;
  const num = Number(String(bruto == null ? "" : bruto).replace(/[^0-9]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function nomeDe(info) {
  if (!info || typeof info !== "object") return "";
  const bloco = info.info && typeof info.info === "object" ? info.info : info;
  return String(bloco.name || bloco.o_name || bloco.title || "");
}

function urlDoFilme(painel, streamId, ext) {
  return `${baseDe(painel)}/movie/${encodeURIComponent(painel.usuario)}/${encodeURIComponent(painel.senha)}/${streamId}.${ext || "mp4"}`;
}

function urlDoEpisodio(painel, streamId, ext) {
  return `${baseDe(painel)}/series/${encodeURIComponent(painel.usuario)}/${encodeURIComponent(painel.senha)}/${streamId}.${ext || "mp4"}`;
}

function episodiosDe(info, temporada, episodio) {
  const eps = info && info.episodes && typeof info.episodes === "object" ? info.episodes : {};
  const lista = eps[String(temporada)] || eps[temporada] || [];
  if (!Array.isArray(lista)) return null;
  const alvo = Number(episodio) || 1;
  const validos = lista.filter((e) => e && e.id !== undefined && e.id !== null);
  const porNumero = validos.filter((e) => Number(e.episode_num) === alvo);
  if (porNumero.length) return porNumero[0];
  const semNumero = validos.filter((e) => e.episode_num === undefined || e.episode_num === null || e.episode_num === "");
  if (semNumero.length === alvo) return semNumero[alvo - 1];
  return semNumero[0] || null;
}

module.exports = {
  MS_PADRAO,
  api,
  baseDe,
  credencial,
  episodiosDe,
  infoDe,
  infoDeSerie,
  nomeDe,
  tmdbDe,
  urlApi,
  urlDoEpisodio,
  urlDoFilme,
  urlProxiada,
  workerDe
};