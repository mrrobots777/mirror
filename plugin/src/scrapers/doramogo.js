const H = require("../lib/html");
const { pegar, pegarJson } = require("../lib/http");
const { matchVodTitle, matchScore } = require("../lib/match");
const { extractQuality } = require("../lib/quality");
const { apresenta } = require("../lib/apresentacao");
const { literal } = require("../lib/extrator");
const { UA } = require("../lib/ua");
const { TETO_CORPO_BYTES } = require("../core/sandbox");

const BASE = "https://www.doramogo.net";
const RESERVA = "https://ondemand.madfirebox.shop";
const FORKS = "https://forks-doramas.madfirebox.shop";
const REFERER = `${BASE}/`;
const SIGLA = "DGO";
const MS = 8e3;
const PEDIDO = { Referer: REFERER, "User-Agent": UA };

// MEDIDO 02/10/2026: ver `src/lib/id-de-conteudo.js`. O `replace(/[^0-9]/g, "")` de antes
// transformava `tt0133093` (The Matrix) em `0133093`, que o TMDB resolve como "Strings" (2012).
const { idDe } = require("../lib/id-de-conteudo");
const { tmdbIdDe } = require("../lib/tmdb");

async function metaDe(id) {
  const chave = globalThis.TMDB_API_KEY;
  if (!chave || !String(chave).trim()) throw new Error("TMDB_API_KEY ausente");
  const url = `https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}?api_key=${encodeURIComponent(String(chave).trim())}&language=pt-BR`;
  const r = await pegarJson(url, { ms: MS });
  if (r.status === 404) return null;
  if (!r.ok || !r.dados) throw new Error(`TMDB ${r.status || "?"} em tv/${id}`);
  const j = r.dados;
  return {
    titulos: [j.name || j.original_name, j.original_name].filter(Boolean),
    ano: Number(String(j.first_air_date || "").slice(0, 4)) || null,
    origens: Array.isArray(j.origin_country) ? j.origin_country : []
  };
}

function limpaTitulo(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s*[([][^)\]]{0,30}(?:legendado|dublado|legendada|dublada)[^)\]]{0,10}[)\]]\s*/gi, " ")
    .replace(/\s*[-–—]\s*(?:legendado|dublado|legendada|dublada)\s*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function candidatosDe(html) {
  const doc = H.parse(html);
  const saida = [];
  const vistos = new Set();
  for (const a of H.seleciona(doc, "a")) {
    const href = String(a.attrs.href || "");
    const m = href.match(/\/series\/([a-z0-9-]+)(?:\/|$)/i);
    if (!m) continue;
    const slug = m[1];
    if (vistos.has(slug)) continue;
    vistos.add(slug);
    const img = H.um(a, "img");
    const alt = img ? String(img.attrs.alt || "") : "";
    saida.push({ slug, titulo: limpaTitulo(alt) || limpaTitulo(slug.replace(/-/g, " ")) });
  }
  return saida;
}

function episodioDe(html, site, s, e) {
  const doc = H.parse(html);
  const re = /\/series\/[^/"'?#]+\/temporada-(\d+)\/episodio-(\d+)/i;
  for (const a of H.seleciona(doc, "a")) {
    const href = String(a.attrs.href || "");
    const m = href.match(re);
    if (!m || Number(m[1]) !== s || Number(m[2]) !== e) continue;
    try {
      return new URL(href, site).href;
    } catch (_) {
      return href.startsWith("http") ? href : null;
    }
  }
  return null;
}

function pad2(n) {
  return String(Number(n) || 0).padStart(2, "0");
}

function urlDe(cfg, host) {
  const slug = String(cfg.slug);
  const inicial = slug.charAt(0).toUpperCase();
  const caminho = String(cfg.tipo || "").toLowerCase() === "filmes"
    ? `${inicial}/${slug}/stream/stream.m3u8`
    : `${inicial}/${slug}/${pad2(cfg.temporada)}-temporada/${pad2(cfg.episodio)}/stream.m3u8`;
  return `${host}/${caminho}`;
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
    r = await pegar(url, { ms: 8e3, headers: { Range: "bytes=0-2047", Referer: REFERER, "User-Agent": UA } });
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

async function busca(termo) {
  const r = await pegar(`${BASE}/search/?q=${encodeURIComponent(termo)}`, { ms: MS, headers: PEDIDO });
  if (!r.ok) throw new Error(`dgo HTTP ${r.status} na busca de "${termo}"`);
  return await r.text();
}

async function pagina(url) {
  const r = await pegar(url, { ms: MS, headers: PEDIDO });
  if (!r.ok) throw new Error(`dgo HTTP ${r.status} em ${url.slice(0, 70)}`);
  return await r.text();
}

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  if (String(mediaType || "").toLowerCase() !== "tv") return [];
  // MEDIDO 02/10/2026: o caminho real do dono e' o id IMDb do Cinemeta (`tt0133093`). `idDe`
// so' aceita TMDB, entao o IMDb e' resolvido aqui. `false` porque DGO so' serve serie.
const id = await tmdbIdDe(tmdbId, false);
  if (!id) return [];
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  const meta = await metaDe(id);
  if (!meta || !meta.titulos.length) return [];
  if (meta.origens.length && !meta.origens.includes("KR")) return [];
  const termos = [...new Set(meta.titulos.map((t) => String(t).trim()).filter(Boolean))];
  const candidatos = [];
  const vistos = new Set();
  let erro = null;
  for (const termo of termos) {
    if (candidatos.length >= 3) break;
    let html = "";
    try {
      html = await busca(termo);
    } catch (e2) {
      if (!erro) erro = e2;
      continue;
    }
    for (const c of candidatosDe(html)) {
      if (vistos.has(c.slug)) continue;
      vistos.add(c.slug);
      const confere = meta.titulos.some((t) => matchVodTitle(c.titulo, String(t), true));
      if (!confere) continue;
      c.nota = Math.max(...meta.titulos.map((t) => matchScore(String(t), c.titulo)));
      candidatos.push(c);
    }
  }
  candidatos.sort((a, b) => b.nota - a.nota);
  for (const cand of candidatos.slice(0, 3)) {
    const site = BASE;
    try {
      const serie = await pagina(`${site}/series/${cand.slug}`);
      const alvo = episodioDe(serie, site, s, e);
      if (!alvo) continue;
      const ep = await pagina(alvo);
      const cfg = literal(ep, "var urlConfig =");
      if (!cfg || typeof cfg !== "object" || !cfg.slug) continue;
      cfg.temporada = Number(cfg.temporada) || s;
      cfg.episodio = Number(cfg.episodio) || e;
      const hosts = [...new Set([cfg.base || FORKS, FORKS, RESERVA])];
      const escolhido = [];
      for (const host of hosts) {
        const url = urlDe(cfg, host);
        if (escolhido.includes(url)) continue;
        const vivo = await provaDeVida(url);
        if (vivo) escolhido.push(url);
        if (escolhido.length) break;
      }
      if (!escolhido.length) continue;
      const dublado = /dublad/i.test(`${cand.titulo} ${cfg.slug}`);
      const idioma = dublado ? "Dublado" : "Legendado";
      return escolhido.map((url) =>
          apresenta({
            sigla: SIGLA,
            url,
            qualidade: extractQuality(url),
            idioma,
            titulo: meta.titulos[0],
            ano: meta.ano,
            temporada: cfg.temporada,
            episodio: cfg.episodio,
            // MEDIDO: o CDN do DGO responde 403 sem este `Referer`. Como o Nuvio so
            // manda cabecalho quando o scraper declara, perder o campo aqui e a
            // diferenca entre o player tocar e dar 403 (bateria 02/10/2026: 403).
            headers: { Referer: REFERER, "User-Agent": UA }
          })
        );
    } catch (e2) {
      if (!erro) erro = e2;
    }
  }
  if (erro) throw erro;
  return [];
};
