const { pegar, pegarJson } = require("../lib/http");
const { matchVodTitle } = require("../lib/match");
const { extractQuality } = require("../lib/quality");
const { UA } = require("../lib/ua");
const { TETO_CORPO_BYTES } = require("../core/sandbox");

const API = "https://vizer.autos/wp-json/api/v1/player";
const REFERER = "https://vizer.autos/";
const SIGLA = "VZR";
const MS = 8e3;
const PEDIDO = { Referer: REFERER, "User-Agent": UA };

function idDe(valor) {
  const bruto = String(valor == null ? "" : valor).trim().replace(/^tmdb:/i, "");
  return bruto.replace(/[^0-9]/g, "") || null;
}

async function metaDe(id, isTv) {
  const chave = globalThis.TMDB_API_KEY;
  if (!chave || !String(chave).trim()) return undefined;
  const url = `https://api.themoviedb.org/3/${isTv ? "tv" : "movie"}/${encodeURIComponent(id)}?api_key=${encodeURIComponent(String(chave).trim())}&language=pt-BR`;
  const r = await pegarJson(url, { ms: MS });
  if (r.status === 404) return null;
  if (!r.ok || !r.dados) throw new Error(`TMDB ${r.status || "?"} em ${isTv ? "tv" : "movie"}/${id}`);
  const j = r.dados;
  return {
    titulos: [j.title || j.name, j.original_title || j.original_name].filter(Boolean),
    ano: Number(String(j.release_date || j.first_air_date || "").slice(0, 4)) || null
  };
}

function bate(meta, tituloDoSite, isTv) {
  if (!meta || !tituloDoSite) return false;
  const ano = isTv ? null : meta.ano;
  return meta.titulos.some((t) => matchVodTitle(String(tituloDoSite), String(t), isTv, ano));
}

async function drena(resposta) {
  const tipo = String(resposta.headers.get("content-type") || "").toLowerCase();
  const comprimento = Number(resposta.headers.get("content-length") || 0);
  const pequeno = resposta.status === 206 || (comprimento > 0 && comprimento <= TETO_CORPO_BYTES) || (!comprimento && tipo.startsWith("text/"));
  if (!pequeno) return "";
  try {
    return await resposta.text();
  } catch (_) {
    return "";
  }
}

async function provaDeVida(url) {
  let r = null;
  try {
    r = await pegar(url, { ms: 7e3, headers: { Range: "bytes=0-2047", Referer: REFERER, "User-Agent": UA } });
  } catch (_) {
    return true;
  }
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  await drena(r);
  if (r.status === 400 || r.status === 404 || r.status === 410 || r.status === 451) return false;
  if (r.status === 403 || r.status >= 500) return false;
  if (tipo.includes("text/plain") || tipo.includes("text/html")) return false;
  return true;
}

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  const id = idDe(tmdbId);
  if (!id) return [];
  const isTv = String(mediaType || "").toLowerCase() === "tv";
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  const meta = await metaDe(id, isTv);
  if (meta === null) return [];
  const corpo = new URLSearchParams({ type: isTv ? "episode" : "movie", tmdb: id });
  if (isTv) {
    corpo.set("season", String(s));
    corpo.set("episode", String(e));
  }
  const r = await pegarJson(API, {
    ms: MS,
    metodo: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: REFERER, "User-Agent": UA },
    corpo: corpo.toString()
  });
  if (r.status === 400 || r.status === 404) return [];
  if (!r.ok || !r.dados) throw new Error(`vzr HTTP ${r.status || "?"} em wp-json/api/v1/player`);
  const dados = r.dados;
  if (dados.success === false || !dados.url) return [];
  if (meta && !meta.titulos.length) return [];
  if (dados.title && !meta) console.log(`[VZR] sem TMDB_API_KEY: conferindo so prova de vida, o titulo "${dados.title}" nao foi confrontado com o id ${id}`);
  if (dados.title && meta && !bate(meta, dados.title, isTv)) return [];
  if (!/^https?:\/\//i.test(String(dados.url))) return [];
  if (!await provaDeVida(dados.url)) return [];
  const qualidade = extractQuality(dados.url) || extractQuality(dados.quality || "");
  return [{
    name: SIGLA,
    title: [qualidade, SIGLA].filter(Boolean).join(" · "),
    url: dados.url,
    ...(qualidade ? { quality: qualidade } : {}),
    headers: { Referer: REFERER, "User-Agent": UA }
  }];
};
