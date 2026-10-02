const { pegar, pegarJson } = require("../lib/http");
const { matchVodTitle } = require("../lib/match");
const { extractQuality } = require("../lib/quality");
const { apresenta } = require("../lib/apresentacao");
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

// PROVA DE VIDA — o que pode condenar o link e o que nao pode.
//
// MEDIDO 02/10/2026: a origem do VZR responde `302` para um CDN assinado
// (`cdn99xn----booster.anipixel.best`) e esse CDN responde `429 text/html` para o
// IP de datacenter deste servidor. A versao anterior seguia o redirect, via o
// `content-type`, e condemned um stream que estava VIVO — e por isso o VZR
// devolvia `[]` para Matrix. Regra do proprio projeto (decisao 131/134): "nao deu
// para saber" nunca vira "morreu". Entao:
//
//   - 3xx SEM seguir o redirect e PROVA DE VIDA: existe CDN assinado esperando.
//   - 429 NUNDA condena: e limite de taxa, o link continua valendo.
//   - timeout/rede NUNCA condena (link lento ainda funciona).
//   - 400/404/410/451, 403, 5xx e `text/plain` SIM: a origem respondeu que nao ha
//     video, e `text/plain` e o corpo que o addon ja documentou para "conteudo
//     ausente" nesta fonte.
async function provaDeVida(url) {
  let r = null;
  try {
    r = await pegar(url, {
      ms: 7e3,
      redirect: "manual",
      headers: { Range: "bytes=0-2047", "User-Agent": UA }
    });
  } catch (_) {
    return true;
  }
  if (r.status >= 300 && r.status < 400) return true;
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  await drena(r);
  if (r.status === 429 || r.status === 408) return true;
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
  return [apresenta({
    sigla: SIGLA,
    url: dados.url,
    qualidade,
    titulo: (meta && meta.titulos[0]) || dados.title,
    ano: meta && meta.ano,
    temporada: isTv ? s : null,
    episodio: isTv ? e : null,
    // MEDIDO tambem no addon: o `nixplay` recusa qualquer valor de Referer e aceita
    // ausente ou vazio. Como o Nuvio so manda cabecalho quando o scraper declara, o
    // valor e declarado explicitamente vazio em vez de omitido.
    headers: { Referer: "" }
  })];
};
