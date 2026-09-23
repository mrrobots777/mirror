const { pegarJson } = require("./http");
const memo = new Map();
function chaveDoId(tmdbId) {
  return String(tmdbId == null ? "" : tmdbId).trim().replace(/^tmdb:/i, "").replace(/:\d+:\d+$/, "");
}
function chaveApi() {
  const chave = globalThis.TMDB_API_KEY;
  if (!chave || !String(chave).trim()) {
    throw new Error("TMDB_API_KEY ausente: defina globalThis.TMDB_API_KEY antes de chamar tituloDe");
  }
  return String(chave).trim();
}
function anoDe(data) {
  const m = String(data || "").match(/^(\d{4})/);
  return m ? m[1] : null;
}
async function buscaJson(caminho, chave) {
  const url = `https://api.themoviedb.org/3${caminho}${caminho.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(chave)}`;
  const r = await pegarJson(url, { ms: 8e3 });
  if (r.status === 404) return null;
  if (!r.ok || !r.dados) throw new Error(`TMDB ${r.status || "?"} em ${caminho}`);
  if (r.dados.success === false) throw new Error(`TMDB recusou ${caminho}: ${r.dados.status_message || "erro"}`);
  return r.dados;
}
async function tituloDe(tmdbId, tipo, temp, ep) {
  const id = chaveDoId(tmdbId);
  if (!id) throw new Error("tituloDe: id TMDB ausente");
  const chave = chaveApi();
  const eSerie = String(tipo || "").toLowerCase() === "tv";
  const s = Number(temp);
  const e = Number(ep);
  const comEpisodio = eSerie && temp !== null && temp !== void 0 && ep !== null && ep !== void 0 && Number.isFinite(s) && Number.isFinite(e);
  const memoChave = `${eSerie ? "tv" : "movie"}:${id}:${comEpisodio ? `${s}:${e}` : "-"}`;
  if (memo.has(memoChave)) return memo.get(memoChave);
  const base = await buscaJson(eSerie ? `/tv/${id}` : `/movie/${id}`, chave);
  if (!base) {
    memo.set(memoChave, null);
    return null;
  }
  const saida = {
    titulo: base.title || base.name || null,
    original: base.original_title || base.original_name || base.title || base.name || null,
    ano: anoDe(eSerie ? base.first_air_date : base.release_date),
    epNome: null,
    epData: null
  };
  if (comEpisodio) {
    const episodio = await buscaJson(`/tv/${id}/season/${s}/episode/${e}`, chave);
    if (episodio) {
      saida.epNome = episodio.name || episodio.episode_name || null;
      saida.epData = episodio.air_date || null;
    }
  }
  memo.set(memoChave, saida);
  return saida;
}
module.exports = { tituloDe };
