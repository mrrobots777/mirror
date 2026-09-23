const H = require("../lib/html");
const { pegar, pegarJson } = require("../lib/http");
const { tituloDe } = require("../lib/tmdb");
const { matchVodTitle, bonusTemporada, PEN_SHIPPUDEN_PADRAO, PEN_SHIPPUDEN_ALT, PEN_BORUTO, PEN_FINAL_SEASON, PEN_FILME, PEN_HEN } = require("../lib/match");
const { extractQuality, normalizeQuality } = require("../lib/quality");
const { decodeEntities, normalizeLoose, lower } = require("../lib/text");
const { UA } = require("../lib/ua");

const BASE = "https://animesonline.io";
const API = `${BASE}/wp-json/wp/v2`;
const TOKEN_REFERER = "https://anidrive.click/";
const SIGLA = "AON";
const MS = 8e3;
const POR_PAGINA = 100;
const PARADAS = new Set([
  "dublado", "dublada", "dublagem", "legendado", "legendada", "legenda", "leg", "pt", "br", "hd", "fhd",
  "full", "online", "assistir", "assistindo", "todos", "todas", "episodios", "episodio", "completo",
  "completa", "remaster", "remasterizado", "remasterizacao", "classico", "classica", "a", "o", "e",
  "as", "os", "temp", "temporada", "temporadas", "part", "parte", "season", "versao", "com", "sem",
  "nova", "novo", "sub", "dub", "raw"
]);
const RECUSA = /\bfilmes?\b|\bmovies?\b|\bheroines\b|\bfilme\b|\bova\b|\bovas\b|\bespeciais?\b|\bspecials?\b|\bextras\b|\brecursos?\b|\bresumos?\b|\btrailers?\b|\bamostras?\b|\beducacional\b|\bmusical\b|\bescolinha\b|\bamigos\b|\bcarros?\b|\bclothes\b|\bboondocks\b|\bbake\b|\bsketch\b|\byuri\b/i;

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
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+(?:dublado|dublada|dublagem|legendado|legendada|legendagem|legenda|leg|raw|sub|dub)\b\s*$/i, " ")
    .replace(/\s*[-–—|]\s*(?:dublado|dublada|dublagem|legendado|legendada|legendagem|legenda|leg|raw|sub|dub)\s*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function nota(cand, pedido, temporada) {
  const bruto = decodeEntities(String(cand || ""));
  if (RECUSA.test(bruto)) return -100;
  const base = semQualificador(bruto);
  const t = palavras(base);
  const q = palavras(pedido);
  if (!t.length || !q.length) return -100;
  let pontos;
  if (normalizeLoose(base) === normalizeLoose(pedido)) pontos = 100;
  else if (q.every((p, i) => t[i] === p)) {
    const resto = t.slice(q.length);
    const fora = resto.filter((p) => !PARADAS.has(p) && !/^\d+$/.test(p));
    pontos = fora.length ? 0 : 100 - fora.length * 10 - resto.length * 2;
  } else if (t.every((p, i) => q[i] === p)) {
    const resto = q.slice(t.length);
    const fora = resto.filter((p) => !PARADAS.has(p));
    pontos = fora.length ? 0 : 80 - fora.length * 10;
  } else if (!matchVodTitle(base, pedido, true)) return -100;
  else pontos = 60;
  const marca = PEN_SHIPPUDEN_PADRAO.re.test(bruto) || PEN_SHIPPUDEN_ALT.re.test(bruto) || PEN_BORUTO.re.test(bruto) || PEN_FINAL_SEASON.re.test(bruto) || PEN_HEN.re.test(bruto);
  if (marca && !PEN_SHIPPUDEN_PADRAO.re.test(pedido) && !PEN_SHIPPUDEN_ALT.re.test(pedido) && !PEN_BORUTO.re.test(pedido) && !PEN_FINAL_SEASON.re.test(pedido)) pontos -= 60;
  if (PEN_FILME.re.test(bruto) && !PEN_FILME.re.test(pedido)) pontos -= 60;
  pontos += bonusTemporada(bruto, temporada);
  return pontos;
}

function paginaDoEpisodio(total, numero) {
  const alvo = Math.max(1, Math.ceil((Math.max(Number(total) || 0, numero) - numero + 1) / POR_PAGINA));
  const lista = [alvo];
  for (const p of [alvo + 1, alvo - 1]) if (p >= 1 && !lista.includes(p)) lista.push(p);
  return lista;
}

function numeroDoPost(post) {
  const mb = post && post.meta_box ? post.meta_box : null;
  const bruto = mb && mb.ero_episodebaru ? String(mb.ero_episodebaru) : decodeEntities(post && post.title && post.title.rendered ? post.title.rendered : "");
  const m = String(bruto).match(/(\d{1,4})/);
  return m ? Number(m[1]) : 0;
}

function tokenDoPost(post) {
  const mb = post && post.meta_box ? post.meta_box : null;
  const lista = mb && Array.isArray(mb.ero_embed) ? mb.ero_embed : [];
  const achados = [];
  for (const item of lista) {
    const m = String(item || "").match(/https:\/\/anidrive\.click\/token\/[A-Za-z0-9_-]+/);
    if (m && !achados.includes(m[0])) achados.push(m[0]);
  }
  return achados[0] || null;
}

async function categoriasDo(termo) {
  const r = await pegarJson(`${API}/categories?search=${encodeURIComponent(termo)}&per_page=20&_fields=id,name,count,slug`, {
    ms: MS,
    headers: { Accept: "application/json", "User-Agent": UA }
  });
  if (!r.ok) throw new Error(`aon HTTP ${r.status} nas categorias de "${termo}"`);
  return Array.isArray(r.dados) ? r.dados.filter((c) => c && c.name && Number(c.count) > 0) : [];
}

async function postsDaCategoria(catId, pagina) {
  if (pagina < 1) return [];
  const r = await pegarJson(`${API}/posts?categories=${encodeURIComponent(catId)}&per_page=${POR_PAGINA}&page=${pagina}&_fields=id,title,meta_box`, {
    ms: MS,
    headers: { Accept: "application/json", "User-Agent": UA }
  });
  if (r.status === 400) return [];
  if (!r.ok) throw new Error(`aon HTTP ${r.status} nos posts da categoria ${catId}`);
  return Array.isArray(r.dados) ? r.dados.filter((p) => p && p.title && p.title.rendered) : [];
}

function base64ParaBytes(txt) {
  const bin = atob(String(txt || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function xorTexto(b64Dados, b64Chave) {
  try {
    const dados = base64ParaBytes(b64Dados);
    const chave = base64ParaBytes(b64Chave);
    if (!dados.length || !chave.length) return null;
    const out = new Uint8Array(dados.length);
    for (let i = 0; i < dados.length; i++) out[i] = dados[i] ^ chave[i % chave.length];
    if (typeof TextDecoder === "function") return new TextDecoder("utf-8").decode(out);
    let s = "";
    for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
    return s;
  } catch (_) {
    return null;
  }
}

function objetoBalanced(src, marca) {
  const marcador = src.indexOf(marca);
  if (marcador < 0) return null;
  const inicio = src.indexOf("{", marcador);
  if (inicio < 0) return null;
  let depth = 0;
  let emString = false;
  let escape = false;
  for (let i = inicio; i < src.length; i++) {
    const ch = src[i];
    if (emString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') emString = false;
      continue;
    }
    if (ch === '"') emString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(src.slice(inicio, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

function configDoPlayer(html) {
  const blocos = String(html || "").match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const chamada = /\w+\((\[[^\[\]]*\])\s*,\s*(\[[^\[\]]*\])\s*,\s*["']([A-Za-z0-9+/=]+)["']\)/g;
  for (const bloco of blocos) {
    const codigo = bloco.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    if (!codigo || codigo.length < 200) continue;
    const direto = objetoBalanced(codigo, "window.AniDrivePlayerConfig");
    if (direto) return direto;
    let m;
    chamada.lastIndex = 0;
    while ((m = chamada.exec(codigo)) !== null) {
      let arr;
      let idx;
      try {
        arr = JSON.parse(m[1]);
        idx = JSON.parse(m[2]);
      } catch (_) {
        continue;
      }
      if (!Array.isArray(arr) || !Array.isArray(idx)) continue;
      const partes = [];
      for (const i of idx) {
        const p = arr[Number(i)];
        if (typeof p === "string") partes.push(p);
      }
      if (!partes.length) continue;
      const decodado = xorTexto(partes.join(""), m[3]);
      if (!decodado) continue;
      const cfg = objetoBalanced(decodado, "window.AniDrivePlayerConfig");
      if (cfg) return cfg;
    }
  }
  return null;
}

function alturaDe(rotulo) {
  const m = String(rotulo || "").match(/(\d{3,4})p?/i);
  return m ? Number(m[1]) : 0;
}

function melhorFonte(cfg) {
  const fontes = cfg && Array.isArray(cfg.sources) ? cfg.sources : [];
  const candidatas = [];
  for (const s of fontes) {
    if (!s || !s.file || !/^https?:\/\//i.test(String(s.file))) continue;
    const rotulo = String(s.label || "");
    const tipo = String(s.type || "") + " " + String(s.file);
    if (!/mp4/i.test(tipo)) continue;
    const qualidade = normalizeQuality(rotulo) || extractQuality(rotulo) || (alturaDe(rotulo) ? normalizeQuality(`${alturaDe(rotulo)}p`) : null);
    candidatas.push({ url: String(s.file), qualidade, altura: alturaDe(rotulo) });
  }
  if (!candidatas.length) return null;
  candidatas.sort((a, b) => b.altura - a.altura);
  return candidatas[0];
}

async function paginaDoToken(urlToken) {
  const r = await pegar(urlToken, { ms: MS, headers: { "User-Agent": UA, Referer: TOKEN_REFERER } });
  if (!r.ok) throw new Error(`aon HTTP ${r.status} no token do player`);
  return await r.text();
}

async function drena(resposta) {
  const tipo = String(resposta.headers.get("content-type") || "").toLowerCase();
  const tamanho = Number(resposta.headers.get("content-length") || 0);
  const pequeno = resposta.status === 206 || (tamanho > 0 && tamanho <= 262144) || (!tamanho && tipo.includes("mpegurl"));
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

function jsonLdDe(html) {
  const doc = H.parse(html);
  const saida = [];
  const vistos = new Set();
  for (const script of H.seleciona(doc, "script")) {
    if (!/ld\+json/i.test(String(script.attrs.type || ""))) continue;
    const cru = H.textoDe(script).trim();
    if (!cru) continue;
    let dados = null;
    try {
      dados = JSON.parse(cru);
    } catch (_) {
      const inicio = cru.indexOf("{");
      const fim = cru.lastIndexOf("}");
      if (inicio < 0 || fim <= inicio) continue;
      try {
        dados = JSON.parse(cru.slice(inicio, fim + 1));
      } catch (_2) {
        continue;
      }
    }
    const nos = dados && Array.isArray(dados["@graph"]) ? dados["@graph"] : [dados];
    for (const no of nos) {
      if (!no || !/ItemList/i.test(String(no["@type"] || ""))) continue;
      const itens = Array.isArray(no.itemListElement) ? no.itemListElement : [];
      for (const item of itens) {
        const url = String(item && item.url ? item.url : "");
        const nome = decodeEntities(String(item && item.name ? item.name : ""));
        if (!/\/anime\//.test(url) || !nome || vistos.has(url)) continue;
        vistos.add(url);
        saida.push({ titulo: nome, url });
      }
    }
  }
  return saida;
}

function episodiosDoHtml(html) {
  const doc = H.parse(html);
  const mapa = new Map();
  for (const li of H.seleciona(doc, "li")) {
    if (!("data-index" in (li.attrs || {}))) continue;
    const a = H.um(li, "a");
    if (!a) continue;
    const href = String(a.attrs.href || "");
    if (!/^https?:\/\//i.test(href) && !/^\/\d+\/?$/.test(href)) continue;
    const num = H.um(li, "div.epl-num");
    const m = H.textoDe(num).match(/(\d{1,4})/);
    if (!m) continue;
    const ep = Number(m[1]);
    if (ep > 0 && !mapa.has(ep)) mapa.set(ep, href.startsWith("http") ? href : `${BASE}${href}`);
  }
  return mapa;
}

function tokenDoHtml(html) {
  const m = String(html || "").match(/https:\/\/anidrive\.click\/token\/[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}

async function viaHtml(termos, info, temporada, numero) {
  const candidatas = [];
  let erro = null;
  for (const termo of termos) {
    if (!palavras(termo).length) continue;
    let html = "";
    try {
      const r = await pegar(`${BASE}/?s=${encodeURIComponent(termo)}`, { ms: MS, headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
      if (!r.ok) throw new Error(`aon HTTP ${r.status} na busca de "${termo}"`);
      html = await r.text();
    } catch (e) {
      if (!erro) erro = e;
      continue;
    }
    for (const c of jsonLdDe(html)) {
      if (!candidatas.some((x) => x.url === c.url)) candidatas.push(c);
    }
    if (candidatas.some((c) => nota(c.titulo, info.titulo, temporada) >= 0)) break;
  }
  const acima = candidatas
    .map((c) => ({ ...c, nota: nota(c.titulo, info.titulo, temporada) }))
    .filter((c) => c.nota >= 0)
    .sort((a, b) => b.nota - a.nota);
  if (!acima.length) {
    if (erro) throw erro;
    return [];
  }
  const saida = [];
  for (const cand of acima.slice(0, 3)) {
    try {
      const r = await pegar(cand.url, { ms: MS, headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
      if (!r.ok) throw new Error(`aon HTTP ${r.status} na pagina do anime`);
      const mapa = episodiosDoHtml(await r.text());
      const alvo = mapa.get(numero);
      if (!alvo) continue;
      const r2 = await pegar(alvo, { ms: MS, headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
      if (!r2.ok) throw new Error(`aon HTTP ${r2.status} na pagina do episodio`);
      const token = tokenDoHtml(await r2.text());
      if (!token) continue;
      const fonte = melhorFonte(configDoPlayer(await paginaDoToken(token)));
      if (!fonte) continue;
      if (!await provaDeVida(fonte.url)) continue;
      saida.push(fonte);
      if (saida.length) break;
    } catch (e) {
      if (!erro) erro = e;
    }
  }
  return saida;
}

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  const info = await tituloDe(tmdbId, mediaType, season, episode);
  if (!info || !info.titulo) return [];
  const temporada = Number(season) > 0 ? Number(season) : 1;
  const numero = Number(episode) > 0 ? Number(episode) : 1;
  const termos = [...new Set([info.titulo, info.original].filter(Boolean).map((t) => String(t).trim()))];

  const cats = new Map();
  let erro = null;
  for (const termo of termos) {
    if (!palavras(termo).length) continue;
    let lista = [];
    try {
      lista = await categoriasDo(termo);
    } catch (e) {
      if (!erro) erro = e;
      continue;
    }
    for (const c of lista) if (!cats.has(c.id)) cats.set(c.id, c);
    if ([...cats.values()].some((c) => nota(c.name, info.titulo, temporada) >= 0)) break;
  }

  const acima = [...cats.values()]
    .map((c) => ({ ...c, nota: nota(c.name, info.titulo, temporada) }))
    .filter((c) => c.nota >= 0 && Number(c.count) >= numero)
    .sort((a, b) => b.nota - a.nota || b.count - a.count);

  const saida = [];
  const vistos = new Set();
  for (const cat of acima.slice(0, 3)) {
    let post = null;
    for (const pagina of paginaDoEpisodio(cat.count, numero).slice(0, 2)) {
      let posts = [];
      try {
        posts = await postsDaCategoria(cat.id, pagina);
      } catch (e) {
        if (!erro) erro = e;
        continue;
      }
      post = posts.find((p) => numeroDoPost(p) === numero) || null;
      if (post) break;
    }
    if (!post) continue;
    const token = tokenDoPost(post);
    if (!token) continue;
    try {
      const fonte = melhorFonte(configDoPlayer(await paginaDoToken(token)));
      if (!fonte || vistos.has(fonte.url)) continue;
      if (!await provaDeVida(fonte.url)) continue;
      vistos.add(fonte.url);
      const nome = semQualificador(cat.name) || semQualificador(post.title.rendered) || info.titulo;
      const dublado = /dublad/i.test(cat.name);
      saida.push({
        nome,
        dublado,
        qualidade: fonte.qualidade,
        url: fonte.url
      });
    } catch (e) {
      if (!erro) erro = e;
    }
    if (saida.length >= 2) break;
  }

  if (!saida.length) {
    const extra = await viaHtml(termos, info, temporada, numero).catch((e) => {
      if (!erro) erro = e;
      return [];
    });
    for (const f of extra) {
      if (vistos.has(f.url)) continue;
      vistos.add(f.url);
      saida.push({
        nome: info.titulo,
        dublado: /dublad/i.test(info.titulo),
        qualidade: f.qualidade,
        url: f.url
      });
    }
  }

  if (!saida.length && erro) throw erro;
  return saida.map((s) => {
    const idioma = s.dublado ? "Dublado" : "Legendado";
    return {
      name: SIGLA,
      title: [s.qualidade, idioma, SIGLA].filter(Boolean).join(" · "),
      url: s.url,
      ...(s.qualidade ? { quality: s.qualidade } : {}),
      headers: { "User-Agent": UA }
    };
  });
};
