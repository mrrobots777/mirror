const { pegar, pegarJson } = require("../lib/http");
const { matchVodTitle } = require("../lib/match");
const { extractQuality } = require("../lib/quality");
const { apresenta } = require("../lib/apresentacao");
const { resolver } = require("../lib/extrator");
const { UA } = require("../lib/ua");
const { TETO_CORPO_BYTES } = require("../core/sandbox");

const BASE = "https://playerflix.ink";
const REFERER = `${BASE}/`;
const SIGLA = "SPT";
const MS = 8e3;
const PEDIDO = { Referer: REFERER, "X-Requested-With": "XMLHttpRequest", "User-Agent": UA };

// MEDIDO 02/10/2026: isto era `replace(/[^0-9]/g, "")`, que transformava o id do Cinemeta
// `tt0133093` (The Matrix) em `0133093` — o TMDB resolve esse numero como **"Strings" (2012)**.
// A fonte buscava o filme errado, nao casava com nada e devolvia `[]` SEM ERRO. Ver
// `src/lib/id-de-conteudo.js` para a medicao completa.
const { idDe } = require("../lib/id-de-conteudo");
const { tmdbIdDe } = require("../lib/tmdb");

async function metaDe(id, isTv) {
  const chave = globalThis.TMDB_API_KEY;
  if (!chave || !String(chave).trim()) throw new Error("TMDB_API_KEY ausente");
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
  const pequeno = resposta.status === 206 || (comprimento > 0 && comprimento <= TETO_CORPO_BYTES) || (!comprimento && tipo.includes("mpegurl"));
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
    r = await pegar(url, { ms: 5e3, headers: { Range: "bytes=0-2047", "User-Agent": UA } });
  } catch (_) {
    return true;
  }
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  const corpo = await drena(r);
  if (r.status === 403 || r.status === 404 || r.status === 410 || r.status === 451 || r.status >= 500) return false;
  if (tipo.includes("text/html")) return false;
  if (tipo.includes("mpegurl") && !corpo.includes("#EXTM3U")) return false;
  return true;
}

async function videoDe(embed) {
  try {
    const achado = await resolver(embed, {
      ms: MS,
      maxPaginas: 4,
      referer: REFERER,
      headers: { "X-Requested-With": "XMLHttpRequest", "User-Agent": UA }
    });
    return achado && achado.url ? achado.url : null;
  } catch (_) {
    return null;
  }
}

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  const isTv = String(mediaType || "").toLowerCase() === "tv";
  // O caminho real do dono: o usuario abre um vod do Cinemeta e o id que chega e' `tt0133093`
  // (medido 02/10/2026). `idDe` so' aceita TMDB, entao o IMDb e' resolvido aqui — sem isto a
  // fonte consultava "Strings" (2012) no lugar de "The Matrix" e devolvia `[]` sem erro.
  const id = await tmdbIdDe(tmdbId, isTv);
  if (!id) return [];
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  const meta = await metaDe(id, isTv);
  if (!meta || !meta.titulos.length) return [];
  const params = new URLSearchParams({ type: isTv ? "tv" : "movie", id });
  if (isTv) {
    params.set("season", String(s));
    params.set("episode", String(e));
  }
  const r = await pegarJson(`${BASE}/inc/Ajax.php?${params.toString()}`, { ms: MS, headers: PEDIDO });
  if (r.status === 404) return [];
  if (!r.ok || !r.dados) throw new Error(`spt HTTP ${r.status || "?"} em inc/Ajax.php`);
  const dados = r.dados;
  if (!dados.status || !dados.data || !Array.isArray(dados.data.options)) return [];
  if (!bate(meta, dados.data.title, isTv)) return [];
  const opcoes = dados.data.options.filter((o) => o && typeof o.embed === "string" && /^https?:\/\//i.test(o.embed));
  const assistir = opcoes.filter((o) => /watchplay/i.test(`${o.label || ""} ${o.embed}`));
  const resto = opcoes.filter((o) => !assistir.includes(o));
  const candidatos = [];
  const vistos = new Set();
  for (const lote of [assistir, resto]) {
    if (!lote.length || candidatos.length) continue;
    const resolvidos = await Promise.all(lote.map((o) => videoDe(o.embed)));
    resolvidos.forEach((url, i) => {
      if (!url || vistos.has(url)) return;
      vistos.add(url);
      const lang = String(lote[i].lang || "");
      candidatos.push({ url, idioma: /^pt/i.test(lang) ? "Dublado" : "Legendado" });
    });
  }
  const streams = [];
  for (const c of candidatos) {
    if (!await provaDeVida(c.url)) continue;
    const qualidade = extractQuality(c.url);
    streams.push(apresenta({
      sigla: SIGLA,
      url: c.url,
      qualidade,
      idioma: c.idioma,
      titulo: meta.titulos[0],
      ano: meta.ano,
      temporada: isTv ? s : null,
      episodio: isTv ? e : null
    }));
    if (streams.length >= 25) break;
  }
  return streams;
};
