const H = require("../lib/html");
const { pegar } = require("../lib/http");
const { tituloDe } = require("../lib/tmdb");
const { bonusTemporada, PEN_SHIPPUDEN_PADRAO, PEN_SHIPPUDEN_ALT, PEN_BORUTO, PEN_FINAL_SEASON, PEN_FILME, PEN_HEN } = require("../lib/match");
const { resolver } = require("../lib/extrator");
const { extractQuality } = require("../lib/quality");
const { apresenta } = require("../lib/apresentacao");
const { decodeEntities, normalizeLoose, lower } = require("../lib/text");
const { UA } = require("../lib/ua");

const BASE = "https://animesdigital.org";
const SIGLA = "RON";
const MS = 8e3;
const PEDIDO = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" };
const PARADAS = new Set([
  "dublado", "dublada", "dublagem", "legendado", "legendada", "legenda", "pt", "br", "hd", "full",
  "online", "assistir", "assistindo", "todos", "todas", "episodios", "episodio", "completo", "completa",
  "remaster", "remasterizado", "remasterizacao", "classico", "classica", "a", "o", "e", "as", "os",
  "temp", "temporada", "temporadas", "part", "parte", "season", "versao", "com", "sem", "nova", "novo"
]);
const RECUSA = /\bfilmes?\b|\bmovies?\b|\bheroines\b|\bfilme\b|\bova\b|\bovas\b|\bespeciais?\b|\bspecials?\b|\bextras\b|\brecursos?\b|\bresumos?\b|\btrailers?\b|\bamostras?\b|\beducacional\b|\bmusical\b|\bescolinha\b|\bamigos\b|\bcarros?\b/i;

function pagina(url) {
  return pegar(url, { ms: MS, headers: PEDIDO }).then(async (r) => {
    if (!r.ok) throw new Error(`ron HTTP ${r.status} em ${url.slice(0, 90)}`);
    return r.text();
  });
}

function palavras(txt) {
  return lower(String(txt || ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function semQualificador(titulo) {
  return decodeEntities(String(titulo || ""))
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s*[-–—|]\s*(?:dublado|dublada|legendado|legendada|dublagem|legendagem)\s*$/i, " ")
    .replace(/\s+(?:dublado|dublada|legendado|legendada|dublagem|legendagem)\s*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function candidatosDe(html) {
  const doc = H.parse(html);
  const out = [];
  const vistos = new Set();
  for (const div of H.seleciona(doc, "div")) {
    if (!/(^|\s)itemA(\s|$)/.test(String(div.attrs.class || ""))) continue;
    for (const a of H.seleciona(div, "a")) {
      const href = String(a.attrs.href || "");
      if (!/\/anime\//.test(href)) continue;
      const span = H.um(a, "span.title_anime");
      const titulo = semQualificador(H.textoDe(span));
      if (!titulo || vistos.has(href)) continue;
      vistos.add(href);
      out.push({ titulo, url: href.startsWith("http") ? href : `${BASE}${href}` });
    }
  }
  return out;
}

function proximaPaginaDeBusca(html) {
  const doc = H.parse(html);
  for (const a of H.seleciona(doc, "a")) {
    if (/\/page\/\d+\//.test(String(a.attrs.href || ""))) {
      const href = a.attrs.href;
      return href.startsWith("http") ? href : `${BASE}${href}`;
    }
  }
  return null;
}

function nota(cand, pedido, temporada) {
  const bruto = decodeEntities(String(cand.titulo || ""));
  if (RECUSA.test(bruto)) return -100;
  const t = palavras(semQualificador(bruto));
  const q = palavras(pedido);
  if (!t.length || !q.length) return -100;
  let pontos = 0;
  if (normalizeLoose(semQualificador(bruto)) === normalizeLoose(pedido)) pontos = 100;
  else if (q.every((p, i) => t[i] === p)) {
    const resto = t.slice(q.length);
    const fora = resto.filter((p) => !PARADAS.has(p) && !/^\d+$/.test(p));
    pontos = fora.length ? 0 : 100 - fora.length * 10 - resto.length * 2;
  } else if (t.every((p, i) => q[i] === p)) {
    const resto = q.slice(t.length);
    const fora = resto.filter((p) => !PARADAS.has(p));
    pontos = fora.length ? 0 : 80;
  } else return -100;
  const marca = PEN_SHIPPUDEN_PADRAO.re.test(bruto) || PEN_SHIPPUDEN_ALT.re.test(bruto) || PEN_BORUTO.re.test(bruto) || PEN_FINAL_SEASON.re.test(bruto) || PEN_HEN.re.test(bruto);
  if (marca && !PEN_SHIPPUDEN_PADRAO.re.test(pedido) && !PEN_SHIPPUDEN_ALT.re.test(pedido) && !PEN_BORUTO.re.test(pedido) && !PEN_FINAL_SEASON.re.test(pedido)) pontos -= 60;
  if (/\b(?:filme|movie)\b/i.test(bruto) && !/\b(?:filme|movie)\b/i.test(pedido)) pontos -= 60;
  pontos += bonusTemporada(bruto, temporada);
  return pontos;
}

function indiceDe(html) {
  const doc = H.parse(html);
  const paginas = new Set([1]);
  for (const a of H.seleciona(doc, "a")) {
    const m = String(a.attrs.href || "").match(/\/page\/(\d+)\//);
    if (m) paginas.add(Number(m[1]));
  }
  let canonica = null;
  for (const link of H.seleciona(doc, "link")) {
    if (String(link.attrs.rel || "").toLowerCase() === "canonical" && link.attrs.href) {
      canonica = link.attrs.href;
      break;
    }
  }
  const eps = new Map();
  for (const a of H.seleciona(doc, "a")) {
    const href = String(a.attrs.href || "");
    if (!/\/video\/[^/]+/.test(href)) continue;
    const img = H.um(a, "img");
    const alt = decodeEntities(String((img && img.attrs.alt) || H.textoDe(a)));
    const m = alt.match(/Epis[óo]dio\s*0*(\d+)/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > 0 && !eps.has(n)) eps.set(n, href.startsWith("http") ? href : `${BASE}${href}`);
  }
  return { paginas, canonica, eps, porPagina: eps.size || 50 };
}

function paginaDoEpisodio(indice, numero) {
  const numeros = [...indice.eps.keys()];
  if (!numeros.length) return [];
  const maximo = Math.max(...numeros);
  const ultima = Math.max(...indice.paginas);
  const porPagina = indice.porPagina;
  const alvo = Math.min(ultima, Math.max(1, Math.ceil((maximo - numero + 1) / porPagina)));
  const lista = [alvo];
  for (const p of [alvo + 1, alvo - 1, ultima]) if (p >= 1 && p <= ultima && !lista.includes(p)) lista.push(p);
  return lista;
}

function urlDoIframe(src) {
  const bruto = String(src || "").trim();
  const m = bruto.match(/videohls\.php\?d=([^"'&]+)/i);
  if (m) {
    let real = m[1];
    try {
      real = decodeURIComponent(real);
    } catch (_) {
    }
    if (/^https?:\/\//i.test(real)) return real;
  }
  return null;
}

async function videoDe(epHtml, epUrl) {
  const doc = H.parse(epHtml);
  const achados = [];
  const vistos = new Set();
  for (const iframe of H.seleciona(doc, "iframe")) {
    const direto = urlDoIframe(iframe.attrs.src);
    if (direto && !vistos.has(direto)) {
      vistos.add(direto);
      achados.push(direto);
    }
  }
  if (achados.length) return achados[0];
  const achado = await resolver(epUrl, { ms: 6e3, maxPaginas: 3, referer: BASE, headers: { "User-Agent": UA } });
  return achado.url;
}

function idiomaDe(titulo) {
  return /dublad/i.test(decodeEntities(String(titulo || ""))) ? "Dublado" : "Legendado";
}

async function drena(r) {
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  const tamanho = Number(r.headers.get("content-length") || 0);
  const pequeno = r.status === 206 || (tamanho > 0 && tamanho <= 262144) || (!tamanho && tipo.includes("mpegurl"));
  if (!pequeno) return "";
  try {
    return await r.text();
  } catch (_) {
    return "";
  }
}

async function provaDeVida(url) {
  let r = null;
  try {
    r = await pegar(url, { ms: 6e3, headers: { Range: "bytes=0-2047", "User-Agent": UA } });
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

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  const info = await tituloDe(tmdbId, mediaType, season, episode);
  if (!info || !info.titulo) return [];
  const serie = String(mediaType || "").toLowerCase() === "tv";
  const temporada = Number(season) > 0 ? Number(season) : 1;
  const numero = Number(episode) > 0 ? Number(episode) : 1;

  const termos = [...new Set([info.titulo, info.original].filter(Boolean).map((t) => String(t).trim()))];
  let lista = [];
  let proxima = null;
  let erro = null;
  for (const termo of termos) {
    if (!palavras(termo).length) continue;
    let html = "";
    try {
      html = await pagina(`${BASE}/pesquisa/?s=${encodeURIComponent(termo)}`);
    } catch (e) {
      if (!erro) erro = e;
      continue;
    }
    const novos = candidatosDe(html);
    for (const c of novos) if (!lista.some((x) => x.url === c.url)) lista.push(c);
    if (lista.some((c) => nota(c, info.titulo, temporada) >= 0)) break;
    if (!proxima) proxima = proximaPaginaDeBusca(html);
  }
  if (!lista.length && erro) throw erro;

  let acima = lista.filter((c) => nota(c, info.titulo, temporada) >= 0);
  if (!acima.length && proxima) {
    const segunda = candidatosDe(await pagina(proxima));
    for (const c of segunda) if (!lista.some((x) => x.url === c.url)) lista.push(c);
    acima = lista.filter((c) => nota(c, info.titulo, temporada) >= 0);
  }
  if (!acima.length) return [];
  acima.sort((a, b) => nota(b, info.titulo, temporada) - nota(a, info.titulo, temporada));

  const saida = [];
  const vistos = new Set();
  let falha = null;
  for (const cand of acima.slice(0, 3)) {
    try {
      const html = await pagina(cand.url);
      const indice = indiceDe(html);
      let alvo = indice.eps.get(numero) || null;
      if (!alvo) {
        const bases = [...new Set([(indice.canonica || "").replace(/\/$/, ""), cand.url.replace(/\/$/, "")])].filter(Boolean);
        for (const base of bases) {
          for (const p of paginaDoEpisodio(indice, numero).slice(0, 3)) {
            const alvoPagina = p === 1 ? `${base}/` : `${base}/page/${p}/`;
            const lista2 = indiceDe(await pagina(alvoPagina));
            if (lista2.eps.has(numero)) {
              alvo = lista2.eps.get(numero);
              break;
            }
          }
          if (alvo) break;
        }
      }
      if (!alvo) continue;
      const epHtml = await pagina(alvo);
      const url = await videoDe(epHtml, alvo);
      if (!url || vistos.has(url)) continue;
      if (!await provaDeVida(url)) continue;
      vistos.add(url);
      const qualidade = extractQuality(url);
      saida.push(apresenta({
        sigla: SIGLA,
        url,
        qualidade,
        idioma: idiomaDe(cand.titulo),
        titulo: info.titulo,
        ano: info.ano,
        temporada,
        episodio: numero,
        headers: { "User-Agent": UA }
      }));
      if (saida.length >= 10) break;
    } catch (e) {
      if (!falha) falha = e;
    }
  }
  if (!saida.length && falha) throw falha;
  return saida;
};
