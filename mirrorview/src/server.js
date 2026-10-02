require("dotenv").config();
// O registro único de nomes vem primeiro de tudo: ENV, ROTAS e FONTES são lidos
// desde as primeiras linhas do arquivo, então ele precisa existir antes.
const { ROTAS, PREFIXOS, ENV, defineEnv, categoriasDasFontes, VARIAVEIS } = require("./core/nomes");
const express = require("express");
const compression = require("compression");
const path = require("node:path");

// O `public/` e' resolvido pelo MODULO e nao pelo diretorio de execucao.
// MEDIDO 02/10/2026: o addon passou a viver em `addon/` dentro do monorepo, e o
// `WORKDIR` do container e' a raiz do repo — com `process.cwd()` as quatro rotas de
// pagina apontariam para um `public/` que nao existe ali, e o `express.static` nao
// serviria nada. Um servidor que so funciona de um diretorio de trabalho e' armadilha:
// `node src/server.js` dentro de um container e' o mesmo que fora dele.
const PUBLICO = path.join(__dirname, "..", "public");
const crypto = require("node:crypto");

// Compara dois segredos sem vazar o quanto eles coincidem: `===` sai no primeiro byte
// diferente e mede o tamanho da sobra. So importa para token de rota de diagnostico, mas e o
// mesmo cuidado que a mascara de stream tinha (o `lib/proxy.js` saiu na decisao 155; o token de
// diagnostico ficou, e e' ele que protege o `/admin/limpar-cache`).
function timingSafeIgual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const { searchAnime, getAnime, getTitles } = require("./scrapers/anilist");
const { getKitsu } = require("./scrapers/kitsu");

const tvSources = require("./core/tv-sources");
const { getMovieDetail, getTvDetail, getTvSeason, resolveByImdb, search: tmdbSearch, genres: tmdbGenres } = require("./scrapers/tmdb");
const { rankAnimeStreams } = require("./lib/anime-ranking");
const { resolveExternal, getMeta: getCinemetaMeta } = require("./scrapers/cinemeta");
const { probeHlsQuality, browserFetch } = require("./lib/scraper-utils");
const { resolveUrl: resolveMultiUrl } = require("./lib/url-resolver");
const memoria = require("./lib/memoria");
const jogador = require("./lib/jogador");
const { melhorCorrespondencia } = require("./lib/portao-correspondencia");
const { engine, buildContext, temFonteDeVod, temFonteDeTv, aqueceTv, CONCURRENCY: SCRAPER_CONCURRENCY } = require("./core/sources");
const tvSplit = require("./lib/tv-split");
const { resolveSourceId, SOURCES, SOURCE_PRIORITY } = require("./lib/source-names");
const { qualityRank, normalizeQuality, videoResolutionToQuality } = require("./lib/quality");
const { probeResolution, detectResolution } = require("./lib/video-probe");
const { agendaRevalidacao } = require("./lib/revalida-cache");
const cacheErro = require("./lib/cache-erro");
const nuvio = require("./routes/nuvio");
const { stripDiacritics } = require("./lib/text");
const { hasExpiredSignedUrl, injectTitleQuality } = require("./lib/stream");
const sqliteCache = require("./lib/sqlite-cache");
const redis = require("./lib/redis");

const PORT = Number(ENV.PORT || 3000);
const BASE_URL = String(ENV.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const SCRAPERS_TIMEOUT_MS = Number(ENV.SCRAPER_TIMEOUT_MS) || 20000;
let runtimeBase = BASE_URL;

// A BASE PUBLICA DO ADDON, num lugar so.
//
// MEDIDO em 29/09/2026: 7 rotas montavam a base com `${req.protocol}://${req.get("host")}` e o
// Dokku/BeamUp reescreve o `Host` para SO o nome do app (`c12e41ddc21b-mirror2`, sem dominio).
// O resultado era a URL de TV ao vivo quebrada na resposta —
// `https://c12e41ddc21b-mirror2/stream/hls/hbo.m3u8`, sem dominio nenhum. O Stremio nao tinha
// onde buscar e a TV nao tocava. O `x-forwarded-host` chega VAZIO nesse gateway, entao a unica
// base confiavel e a que o proprio processo ja montou: `runtimeBase` (que no cluster de TV e o
// `TV_BASE_URL` completo, com dominio) e, depois, o `PUBLIC_BASE_URL`.
//
// A ultima reserva e o host do request, e SO se ele for um dominio de verdade — com um rotulo
// sem ponto (`localhost`, `c12e41ddc21b-mirror2`) nao serve, e por isso devolvemos string
// vazia: quem chama decide o que fazer sem base, e nenhum stream sai com `undefined` no meio
// da URL.
function basePublica(req) {
  if (runtimeBase) return runtimeBase;
  // A base do ambiente, lida do registro de nomes. Antes vinha de `getPublicBaseUrl()` do
  // `lib/proxy.js` (que saiu na decisao 155); a expressao e' identica, e a leitura continua
  // happening NO MOMENTO do uso — e' o que o `basePublica` acima precisa para o auto-detect.
  const cfg = String(ENV.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (cfg) return cfg;
  const pedido = req || {};
  const headers = pedido.headers || {};
  const host = String(headers["x-forwarded-host"] || (pedido.get && pedido.get("host")) || headers.host || "")
    .split(",")[0].trim();
  if (host && /[a-z]/i.test(host) && host.includes(".")) {
    const proto = headers["x-forwarded-proto"] || pedido.protocol || "http";
    return `${proto}://${host}`;
  }
  return "";
}

const animeTitleCache = new Map();
function isLikelyAnime(title) {
  if (!title) return false;
  const cached = animeTitleCache.get(title);
  if (cached !== undefined) return cached;
  const t = title.toLowerCase();
  if (/\bmovie\b/i.test(t)) { animeTitleCache.set(title, false); return false; }
  const result = /\b(naruto|one piece|bleach|attack on titan|shingeki|demon slayer|kimetsu|jujutsu|dragon ball|hunter x hunter|my hero|boku no|fullmetal|fma|sword art|sao|tokyo ghoul|death note|evangelion|ghibli|studio ghibli|inuyasha|yu yu|fairy tail|black clover|one punch|mob psycho|code geass|death parade|stein;s|re:zero|konosuba|overlord|shield hero|slime)\b/i.test(t) || /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(t);
  if (animeTitleCache.size > 500) animeTitleCache.clear();
  animeTitleCache.set(title, result);
  return result;
}

function parseConfig(configStr) {
  const cfg = { lang: "all", quality: "all", sources: "all", subtitles: "all", sort: "quality" };
  if (!configStr) return cfg;
  let decoded;
  try { decoded = decodeURIComponent(configStr); } catch (_) { decoded = configStr; }
  for (const part of decoded.split(/[&+]/)) {
    const [k, v] = part.split("=");
    if (k === "lang") cfg.lang = v || "all";
    else if (k === "quality") cfg.quality = v || "all";
    else if (k === "sources") cfg.sources = v || "all";
    else if (k === "subtitles") cfg.subtitles = v || "all";
    else if (k === "sort") cfg.sort = v || "quality";
  }
  return cfg;
}

function buildManifest(config) {
  const cfg = parseConfig(config);
  const langLabel = { dubbed: "Dublado", subtitled: "Legendado", all: "Todos" }[cfg.lang] || "Todos";
  return {
    id: "com.mirrorstream.view", version: "1.0.1", name: `MirrorView${config ? ` [${langLabel}]` : ""}`,
    logo: "/logo.svg",
    description: "MirrorView — TV ao vivo com guia (EPG), logo e catálogo de 327 canais. Dublado e legendado em português brasileiro.",
    resources: ["catalog", "meta", "stream"], types: ["tv"],
    idPrefixes: ["tv:live:", "<id>:<start>"],
    config: [
      { id: "lang", type: "text", default: "all", values: ["all", "dubbed", "subtitled"] },
      { id: "quality", type: "text", default: "all", values: ["all", "720p", "1080p", "4k"] },
      { id: "sources", type: "text", default: "all", values: ["all", ...Object.values(SOURCES).map(s => s.id)] },
      { id: "subtitles", type: "text", default: "all", values: ["all", "ptbr", "translate"] }
    ],
    catalogs: [
      { type: "tv", id: "mirror-tv-live", name: "\ud83d\udce1 TV ao Vivo", posterShape: "square", extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
        { name: "date", isRequired: false },
        // O MENU VEM DOS BALDES DO CATALOGO (decisao 126). MEDIDO 30/09: o menu era uma lista
        // escrita a mao com 10 opcoes e as metas traziam 19 generos crus, entao 6 opcoes
        // estavam quebradas ("Abertos" devolvia 10 e escondia os 40 "Canais Abertos"; "Filmes e
        // Series" devolvia 1 e escondia 137; "Eventos" e "Portugal" devolviam 0). Agora o menu e
        // a MESMA lista que o filtro usa — trocar um lado sem o outro volta a quebrar em silencio.
        { name: "genre", isRequired: false, options: ["Todos", ...tvSources.BUCKETS] },
      ] },
    ],
    behaviorHints: { configurable: false, configurationRequired: false, epgProvider: true }
  };
}
const defaultManifest = buildManifest("");
const builder = new addonBuilder(defaultManifest);

const MAX_CACHE_SIZE = 200;
const SEARCH_CACHE_TTL = 60 * 1000;
const CACHE_TTL = 15 * 60 * 1000;
// A RESERVA DO SPLIT e o unico lugar onde o catalogo de TV e lido neste app — o resto e
// repassado para o cluster, que e quem monta. Entao ela tem que sobreviver a ociosidade: com
// os 15 min de sempre, o addon ficava um periodo sem abrir, o cluster caia, e a reserva ja
// tinha vencido — o usuario recebia 503 com o catalogo existindo do outro lado. O valor nao
// envelhece so: a resposta fresca do cluster e gravada no proprio repasse (definirAoRepasse).
const TV_CATALOG_TTL = 24 * 60 * 60 * 1000;
const EMPTY_CACHE_TTL = 60 * 1000;
// VOD: 15min, como o dono pediu. Antes eram 6min, e nao havia motivo — medido o que encurta de
// verdade e o outro TTL (o degradado), nao este: a assinatura do RTD vale ~3 dias e a do VZR 5h,
// e o cache ja descarta o que venceu (`hasExpiredSignedUrl`). 15min segura um titulo que
// alguem abre varias vezes numa sessao sem re-scrapar as 13 fontes.
const STREAM_CACHE_TTL = 15 * 60 * 1000;
// DECISAO 155: `TV_STREAM_CACHE_TTL` (1min) e `TV_STREAM_CACHE_DEGRADADO_MS` (10s) sairam daqui.
//
// Eles guardavam a LISTA DE PLAYERS de um canal — 90s era o prazo do JWT do REI (300s) e 10s era
// o "degradado" que evitava servir a lista sem uma das fontes. Nao ha mais lista para guardar:
// `handleStreams` responde `{streams: []}` para TV sem tocar em origem nenhuma. A unica resposta
// que ainda entra em cache e' essa, e ela e' estavel — por isso usa o `DEGRADED_CACHE_TTL` (60s)
// abaixo, e nao um TTL de link.
const INFO_CACHE_TTL = 30 * 60 * 1000;
const META_CACHE_TTL = 10 * 60 * 1000;
const DEGRADED_CACHE_TTL = 60 * 1000;

const cache = new Map();

// Teto global do cache em memoria. Medido em 28/09/2026: o cache era limitado por CHAVE
// (MAX_CACHE_SIZE=200 por tipo de cache) e nao no total — e `cacheSet` recebe o limite como
// parametro, entao cada chamada criava sua propria janela. Com 300 pessoas simultaneas cada
// uma gerando streams de VOD, de serie e de TV, o total passava do teto sem nenhuma entrada
// unica estourar. Este e o limite que vale.
// MEDIDO 01/10/2026 com 2.000 usuarios simultaneos (carga-ram.js): 4.000 entradas_guardavam RSS
// em 208MB de pico e 165MB de repouso; com 2.000 entradas e 24 caras o pico foi para **167MB** e o
// repouso para **158MB**, e a latencia MELHOROU (p95 350ms -> 326ms, p99 789ms -> 716ms). Cache
// grande demais nao economiza trabalho aqui: o que se refaz e o que a fonte tem em disco.
const MAX_CACHE_TOTAL = Number(ENV.MEM_CACHE_MAX || 2000);

// Entradas CARAS de reconstruir nunca podem ser despejadas sob pressao de memoria.
//
// MEDIDO 28/09/2026, e foi uma regressao deste mesmo dia: o `cleanup` disparava a cada 10s
// quando o RSS passava de 240MB e apagava METADE da cache. O catalogo de TV estava nessa
// metade, entao ele era jogado fora a cada 10s — e leva 127s para remontar (triagem de 283
// canais nas 3 fontes). Resultado: o catalogo de TV NUNCA ficava pronto e o Stremio recebia
// 504 sempre. O log dizia `[memory] HIGH: 330MB RSS, 0 entradas`: cache zerada em ciclo.
//
// E o pior: a pressao nao diminuia, porque apagar a cache nao devolve memoria — o que segura
// o RSS sao socket e o `heapTotal` do V8. Entao o despejo rodava a cada 10s sem nunca ajudar.
// Pior que nao fazer nada.
//
// Por isso: (1) o catalogo de TV e o cache de info sao imunes ao despejo por pressao; (2) o
// despejo so alcanca 1/4 da cache, nao a metade. O limite por QUANTIDADE (MAX_CACHE_TOTAL)
// continua valendo e e o mecanismo saudavel de controle de tamanho.
function chaveCara(k) {
  const s = String(k || "");
  return s.includes("mirror-tv-live") || s.includes("info:") || s.includes("epg");
}

function cacheEvictIfNeeded(pressao) {
  if (!pressao && cache.size <= MAX_CACHE_TOTAL) return 0;
  const maximo = pressao
    ? Math.max(1, Math.floor(cache.size / 4))
    : cache.size - MAX_CACHE_TOTAL;
  let removidos = 0;
  for (const k of [...cache.keys()]) {
    if (removidos >= maximo) break;
    if (pressao && chaveCara(k)) continue;
    cache.delete(k);
    removidos++;
  }
  return removidos;
}

// Igual ao cacheGet, mas sem respeito ao prazo: devolve a entrada mesmo vencida, se ainda
// existir. Usado so para servir o catalogo enquanto o novo se monta.
async function cacheGetVelho(key) {
  const hit = cache.get(key);
  return hit ? hit.value : null;
}

async function cacheGet(key, ttl) {
  const redisKey = key.replace(/[^a-zA-Z0-9:._-]/g, "_");
  if (redis.isAvailable()) {
    const hit = await redis.cacheGet("ac", redisKey);
    if (hit !== null) return hit;
  }
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.value;
  cache.delete(key);
  return null;
}

// Teto do DONO: 300MB de RSS, medido via /health. O aviso de pressao entra em 240MB (80%),
// o que deixa 60MB de folga para a memoria subir antes do fim. Medido 28/09/2026: o limite
// estava em 220 e o app1 jaedia 295MB — o numero era MENOR que o teto real, entao o aviso
// disparava tarde demais (ou nunca, com o gatilho no heap).
// TETO DO DONO (01/10/2026): 150MB. O codigo usava 240, que era so o limiar de AVISO; o pedido
// agora e 150MB de verdade, e a leitura e: acima disso o app recolhe e descarta cache. O
// `MEM_RSS_LIMIT_MB` no ambiente sobrescreve (util para medir com um teto maior).
const LIMITE_RSS_MB = Number(ENV.MEM_RSS_LIMIT_MB || 150);
const CACHE_BIG_BYTES = 200 * 1024;
// Antes 6, e era a causa do catalogo de TV levar 12,3s em TODO pedido (medido na prod em
// 28/09/2026). A regra era: ao guardar uma entrada grande, apagar TODAS as outras grandes.
// O catalogo de TV passa de 200KB (112KB compactado, ~250KB em memoria) e a busca tambem —
// entao cada chamada apagava o resultado da anterior e o cache nunca acertava. A montagem
// inteira do catalogo (283 canais, triagem nas 3 fontes) roda em ~12s, entao o efeito era:
// 1a chamada 12,3s, 2a chamada 12,3s, para sempre. Com 60, um catalogo completo + as buscas
// de termos diferentes cabem juntos e o cache volta a acertar (medido: 2a chamada em 0,05s).
const CACHE_BIG_MAX = Number(ENV.MEM_CACHE_BIG_MAX || 24);

function tamanhoAprox(valor) {
  try {
    const t = typeof valor === "string" ? valor : JSON.stringify(valor);
    return t ? t.length : 0;
  } catch (_) {
    return 0;
  }
}

async function cacheSet(key, value, ttl, maxSize) {
  const redisKey = key.replace(/[^a-zA-Z0-9:._-]/g, "_");
  if (redis.isAvailable()) {
    await redis.cacheSet("ac", redisKey, value, Math.floor(ttl / 1000));
  }
  const bytes = tamanhoAprox(value);
  const grande = bytes > CACHE_BIG_BYTES;
  if (grande) {
    for (const [k, v] of cache) {
      if (v.bytes > CACHE_BIG_BYTES) cache.delete(k);
    }
  }
  const limite = grande ? CACHE_BIG_MAX : maxSize;
  if (limite && cache.size >= limite) {
    let remove = cache.size >= limite ? 1 : 0;
    if (grande && cache.size >= limite) remove = cache.size;
    while (remove-- > 0) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(key, { value, ts: Date.now(), bytes });
  cacheEvictIfNeeded();
}

function streamDedupKey(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname}${u.search}`;
  } catch (_) {
    return String(url);
  }
}

function absolute(p) {
  return `${runtimeBase || ""}${p}`;
}

function mergeSubtitles(baseSubs, itemSubs, { translateMode, ptBrOnly } = {}) {
  const allSubs = [...(baseSubs || []), ...(itemSubs || [])];
  allSubs.sort((a, b) => {
    const aLang = (a.lang || a.label || a.language || "").toLowerCase();
    const bLang = (b.lang || b.label || b.language || "").toLowerCase();
    const aPt = aLang.match(/pt|por|portuguese|brazil/) ? 0 : 1;
    const bPt = bLang.match(/pt|por|portuguese|brazil/) ? 0 : 1;
    return aPt - bPt;
  });
  const merged = [];
  const seenUrls = new Set();
  const seenLangs = new Set();
  let hasPtSub = false;
  for (const sub of allSubs) {
    const subUrl = sub.url || sub.file;
    if (!subUrl) continue;
    const subLang = (sub.lang || sub.label || sub.language || "").toLowerCase();
    if (seenUrls.has(subUrl)) continue;
    seenUrls.add(subUrl);
    const raw = subLang.replace(/[^a-z-]/g, "");
    let iso = LANG_CODE_MAP[raw] || LANG_CODE_MAP[subLang] || "";
    if (!iso) {
      for (const [key, val] of Object.entries(LANG_CODE_MAP)) {
        if (subLang.includes(key) && key.length >= 3) { iso = val; break; }
      }
    }
    if (!iso) continue;
    if (iso === "por" && subUrl) hasPtSub = true;
    const flag = getFlag(iso);
    const label = LANG_LABELS[iso] || iso;
    const isPt = iso === "por";
    const isEn = iso === "eng";
    if (isPt) {
      if (translateMode) continue;
      if (seenLangs.has("por")) continue;
      seenLangs.add("por");
      merged.push({ id: sub.id || `stream-pt-${subUrl || "sub"}`, lang: "por", url: subUrl || "", title: sub.title || `${flag} ${label}` });
    } else if (isEn) {
      if (!seenLangs.has(`eng:${subUrl}`)) {
        seenLangs.add(`eng:${subUrl}`);
        merged.push({ id: sub.id || `stream-en-${subUrl || "sub"}`, lang: "eng", url: subUrl || "", title: sub.title || `${flag} ${label}` });
      }
      const translatedUrl = subUrl || "";
      if (translatedUrl && !seenLangs.has("por") && !seenLangs.has(`translated:${subUrl}`)) {
        seenLangs.add(`translated:${subUrl}`);
        seenLangs.add("por");
        merged.push({ id: `stream-translated-${subUrl || "sub"}`, lang: "por", url: "", translate: true, translateSource: subUrl, title: `\u{1F1E7}\u{1F1F7} Portugues (Traduzido)` });
      }
    } else if (!ptBrOnly && !translateMode) {
      if (seenLangs.has(iso)) continue;
      seenLangs.add(iso);
      merged.push({ id: sub.id || `stream-${iso}-${subUrl || "sub"}`, lang: iso, url: subUrl || "", title: sub.title || `${flag} ${label}` });
    }
  }
  return merged;
}

const LANG_CODE_MAP = {
  pt: "por", "pt-br": "por", portuguese: "por", brazil: "por", brazuca: "por", br: "por",
  "portugues": "por", "portugues(brasil)": "por", "portuguesbrazil": "por",
  "portuguese (brazil)": "por", "portuguese (brasil)": "por", "portugues (brasil)": "por",
  en: "eng", eng: "eng", english: "eng", "en-us": "eng", "en-gb": "eng",
  es: "spa", spa: "spa", spanish: "spa",
  fr: "fre", fre: "fre", french: "fre",
  de: "ger", ger: "ger", german: "ger",
  it: "ita", ita: "ita", italian: "ita",
  ru: "rus", rus: "rus", russian: "rus",
  ar: "ara", ara: "ara", arabic: "ara",
  ja: "jpn", jpn: "jpn", japanese: "jpn", jap: "jpn",
  ko: "kor", kor: "kor", korean: "kor",
  zh: "chi", chi: "chi", chinese: "chi",
  tr: "tur", tur: "tur", turkish: "tur",
  hi: "hin", hin: "hin", hindi: "hin",
  th: "tha", tha: "tha", thai: "tha",
  vi: "vie", vie: "vie", vietnamese: "vie",
  id: "ind", ind: "ind", indonesian: "ind",
  malay: "msa", mal: "msa",
  pl: "pol", pol: "pol", polish: "pol",
  nl: "dut", dut: "dut", dutch: "dut",
  sv: "swe", swe: "swe", swedish: "swe",
};

const LANG_LABELS = {
  por: "Portugues (Brasil)", eng: "English", spa: "Espanol", fre: "Francais",
  ger: "Deutsch", ita: "Italiano", rus: "Russian", ara: "Arabic",
  jpn: "Japanese", kor: "Korean", chi: "Chinese", tur: "Turkish",
  hin: "Hindi", tha: "Thai", ind: "Indonesian", vie: "Vietnamese",
  pol: "Polish", dut: "Dutch", msa: "Malay", swe: "Swedish",
};

const LANG_FLAGS = {
  pt: "\u{1F1E7}\u{1F1F7}", br: "\u{1F1E7}\u{1F1F7}", "pt-br": "\u{1F1E7}\u{1F1F7}", portuguese: "\u{1F1E7}\u{1F1F7}", por: "\u{1F1E7}\u{1F1F7}",
  en: "\u{1F1EC}\u{1F1E7}", eng: "\u{1F1EC}\u{1F1E7}", english: "\u{1F1EC}\u{1F1E7}",
  es: "\u{1F1EA}\u{1F1F8}", spa: "\u{1F1EA}\u{1F1F8}", spanish: "\u{1F1EA}\u{1F1F8}",
  fr: "\u{1F1EB}\u{1F1F7}", fre: "\u{1F1EB}\u{1F1F7}", french: "\u{1F1EB}\u{1F1F7}",
  de: "\u{1F1E9}\u{1F1EA}", ger: "\u{1F1E9}\u{1F1EA}", german: "\u{1F1E9}\u{1F1EA}",
  it: "\u{1F1EE}\u{1F1F9}", ita: "\u{1F1EE}\u{1F1F9}", italian: "\u{1F1EE}\u{1F1F9}",
  ru: "\u{1F1F7}\u{1F1FA}", rus: "\u{1F1F7}\u{1F1FA}", russian: "\u{1F1F7}\u{1F1FA}",
  ar: "\u{1F1F8}\u{1F1E6}", ara: "\u{1F1F8}\u{1F1E6}", arabic: "\u{1F1F8}\u{1F1E6}",
  ja: "\u{1F1EF}\u{1F1F5}", jpn: "\u{1F1EF}\u{1F1F5}", japanese: "\u{1F1EF}\u{1F1F5}",
  ko: "\u{1F1F0}\u{1F1F7}", kor: "\u{1F1F0}\u{1F1F7}", korean: "\u{1F1F0}\u{1F1F7}",
  zh: "\u{1F1E8}\u{1F1F3}", chi: "\u{1F1E8}\u{1F1F3}", chinese: "\u{1F1E8}\u{1F1F3}",
  tr: "\u{1F1F9}\u{1F1F7}", tur: "\u{1F1F9}\u{1F1F7}", turkish: "\u{1F1F9}\u{1F1F7}",
  hi: "\u{1F1EE}\u{1F1F3}", hin: "\u{1F1EE}\u{1F1F3}", hindi: "\u{1F1EE}\u{1F1F3}",
  th: "\u{1F1F9}\u{1F1ED}", tha: "\u{1F1F9}\u{1F1ED}", thai: "\u{1F1F9}\u{1F1ED}",
  id: "\u{1F1EE}\u{1F1E9}", ind: "\u{1F1EE}\u{1F1E9}", indonesian: "\u{1F1EE}\u{1F1E9}",
  vi: "\u{1F1FB}\u{1F1F3}", vie: "\u{1F1FB}\u{1F1F3}", vietnamese: "\u{1F1FB}\u{1F1F3}",
  pl: "\u{1F1F5}\u{1F1F1}", pol: "\u{1F1F5}\u{1F1F1}", polish: "\u{1F1F5}\u{1F1F1}",
  nl: "\u{1F1F3}\u{1F1F1}", dut: "\u{1F1F3}\u{1F1F1}", dutch: "\u{1F1F3}\u{1F1F1}",
  msa: "\u{1F1F2}\u{1F1FE}", swe: "\u{1F1F8}\u{1F1EA}", that: "\u{1F1F9}\u{1F1ED}",
};

function getFlag(lang) {
  const l = (lang || "").toLowerCase().replace(/[-_ ].*/,"");
  return LANG_FLAGS[l] || "";
}

function episodeVideos(meta) {
  const episodes = meta?.episodes || meta?.videos?.[0]?.episode || 0;
  const total = Math.min(Math.max(Number(episodes), 0), 500);
  if (!meta?.videos || meta.videos.length <= 1) {
    return Array.from({ length: total }, (_, i) => ({ id: `${meta.id}:1:${i + 1}`, title: `Episódio ${i + 1}`, season: 1, episode: i + 1 }));
  }
  return meta.videos.map(v => ({
    id: v.id || `${meta.id}:${v.season || 1}:${v.episode || v.number}`,
    title: v.title || `T${v.season || 1} E${v.episode || v.number}`,
    season: v.season || 1,
    episode: v.episode || v.number || 0,
  }));
}

const inflightCatalogs = new Map();

// Catalogo de TV em cache de memoria + mapa de grupos andam juntos: e preciso invalidar os dois
// juntos, senao o catalogo velho segue sendo servido (medido antes: a meta dizia "EMB+ETC+REI" e
// o clique so encontrava EMB). Usado no boot e pelo reset de cache.
function invalidarCatalogoTv() {
  cache.clear();
  geracaoPorChave.clear();
  sqliteCache.cleanup && sqliteCache.cleanup(true);
}
// Geracao do mapa de grupos com que cada catalogo em cache foi montado.
const geracaoPorChave = new Map();

// CATALOGO DE TV: a busca e a categoria sao um FILTRO da lista, nunca uma montagem.
//
// MEDIDO em 29/09/2026 (producao e cluster local): `?search=globo` levava 11,5s na app1 e
// voltava VAZIA, e no cluster de TV levava 64s a 85s (estourando os 12,3s do gateway). A causa
// era dupla e as duas se somavam:
//
//   (1) `tvSources.getCatalog` so reaproveita o catalogo completo em memoria por
//       `BUSCA_TTL` = 60s. Passados 60s, QUALQUER busca refazia a triagem inteira dos canais
//       nas 3 fontes. Cada termo digitado e uma chave nova de cache, entao toda busca era um
//       cache miss — e logo depois da anterior, que ja tinha virado o memo. O efeito medido
//       era uma remontagem de ~85s por termo, e o cache de cada termo nunca chegava a servir.
//   (2) A lista INTEIRA ja estava guardada no cache (chave `mirror-tv-live::tv::`, TTL de
//       24h, aquecida no boot), mas ninguem filtrava a partir dela. Filter em memoria custa
//       0,05s e nao toca em rede.
//
// A ordem agora e: se o pedido tem busca, categoria OU GUIA, filtra a lista guardada; so se ela
// nao existir (bot novo, cache apagado) chama a triagem de verdade.
//
// A lista guardada e SEMPRE a chave sem data (`mirror-tv-live::tv::`). A guia e o que o filtro
// ACRESCENTA: `filtraCatalogo` recebe a lista sem grade e anexa `videos` do dia pedido, com uma
// varredura em memoria do EPG. MEDIDO em 29/09/2026: ler a chave **com** a data (`...::<data>`)
// e um erro — ela so existe depois que alguem pediu aquela data, entao a 1a vez nao havia nada e
// caia na triagem (`?date=2026-09-29` levou 11,6s e voltou vazio logo apos o deploy, enquanto a
// lista e a busca respondiam em 0,4-0,9s).
const CHAVE_CATALOGO_TV = "mirror-tv-live::tv::";

async function catalogoDeTv(search, genre, data) {
  // A LISTA INTEIRA QUE JA EXISTE e a fonte da verdade — para TODO pedido, com ou sem filtro.
  //
  // MEDIDO em 30/09/2026 (isto aqui): o pedido SEM filtro nao consultava nada e ia direto
  // remontar o catalogo (triage de rede nas 3 fontes). Com o REI respondendo 429 em cascata
  // (57 linhas de log numa unica rodada), a remontagem nao aprovava ninguem e o Stremio
  // recebia `{"metas":[]}` — catalogo de TV VAZIO, com 279-284 canais numa Boa hora. O
  // mesmo servidor, no mesmo minuto, respondia 267 canais em `/api/channels` (a reserva), e
  // `?search=`/`?genre=` voltavam com a lista, porque esses ramos ja liam a lista guardada.
  // Um cache que so vale para o caminho com filtro e um cache que falha justo no caminho mais
  // usado (a primeira tela da TV, sem filtro nenhum).
  const inteira = await cacheGet(CHAVE_CATALOGO_TV, TV_CATALOG_TTL).catch(() => null);
  if (inteira && inteira.length) {
    try { return tvSources.filtraCatalogo(inteira, search || null, genre || null, data || ""); } catch (_) {}
  }
  try {
    return await tvSources.getCatalog(search, genre, data);
  } catch (e) {
    console.error(`[catalog] TV: ${e.message}`);
    return [];
  }
}

async function catalogFor(id, search, type, genre, data) {
  // A GERACAO DO MAPA DE GRUPOS ENTRA NA CHAVE. O catalogo e respondido em cache por 300s, e o mapa
  // `groups` pode mudar antes disso (a verificacao do KAK aprova ou reprova canal). Sem a
  // geracao na chave, o cliente recebia a lista velha — que prometia as fontes anteriores —
  // enquanto o player ja usava o mapa novo. Medido: 52 de 60 canais divergentes.
  const key = `${id}:${search || ""}:${type || ""}:${genre || ""}:${data || ""}`;
  const ttl = search ? SEARCH_CACHE_TTL : (id === "mirror-tv-live" ? TV_CATALOG_TTL : CACHE_TTL);
  const hit = await cacheGet(key, ttl);
  if (hit) return hit;
  // STALE-WHILE-REBUILD. A montagem do catalogo leva ~32s quando a lista do KAK muda (a
  // verificacao roda a cada 25s), e o gateway da zona corta em ~12s. Sem isto, o usuario que
  // pedisse o catalogo durante a remontagem recebia PAGINA DE ERRO em vez do catalogo.
  //
  // A solucao e a mesma que o EPG ja usava: se existe uma versao anterior (mesmo vencida) e ja
  // ha remontagem em andamento, devolve a versao anterior na hora e deixa a nova terminar
  // sozinha. O usuario sempre ve um catalogo; no maximo, um que envelheceu alguns minutos.
  // A geracao com que este catalogo foi montado. Se o mapa de grupos ja mudou, o catalogo em
  // cache e velho — mas servido mesmo assim, e a remontagem acontece POR TRAS. E o que fecha o
  // ciclo: sem isso, ou o cache nunca acerta (32s por pedido, 504), ou ele serve informacao
  // velha para sempre (medido: 46 de 60 canais com descricao e streams divergentes).
  const pendente = inflightCatalogs.get(key);
  if (pendente) {
    const velho = await cacheGetVelho(key);
    if (velho) return velho;
    return pendente;
  }
  const geracaoDoCache = geracaoPorChave.get(key);
  if (geracaoDoCache !== undefined && geracaoDoCache !== tvSources.geracao()) {
    // Velho, mas util: devolve agora e refaz em segundo plano.
    // BUG REAL (28/09/2026, achado pelo teste "nenhum modulo chama uma funcao que ele mesmo
    // nao define"): aqui estava `getCatalog(...)`, que NAO EXISTE em server.js. Por estar
    // dentro de `.catch(() => {})`, o ReferenceError era engolido e o rebuild nunca acontecia
    // — o catalogo ficava velho ate sair do cache. Era `catalogForCore`, a que grava no cache
    // e atualiza a geracao. Chamar `catalogFor` aqui daria recursao infinita: ela re-encontraria
    // a mesma geracao velha e chamaria a si mesma de novo.
    catalogForCore(key, id, search, genre, data, ttl).catch(() => {});
    const velho = await cacheGetVelho(key);
    if (velho) return velho;
  }
  const catalogPromise = catalogForCore(key, id, search, genre, data, ttl).finally(() => inflightCatalogs.delete(key));
  inflightCatalogs.set(key, catalogPromise);
  return catalogPromise;
}

async function catalogForCore(key, id, search, genre, data, ttl) {
  let value = [];

  if (id === "mirror-tv-live") {
    value = await catalogoDeTv(search, genre, data);
  }

  geracaoPorChave.set(key, tvSources.geracao());
  // GUIA COM EPG FRIO NAO PODE ENTRAR NA CACHE: se o cliente pedir `?date=` logo no boot, o
  // EPG ainda baixando e o resultado vem com 0 programas — guardado 300s, e a guia fica vazia
  // mesmo depois do EPG pronto. TTL curto nesse caso faz a correcao chegar sozinha em 15s.
  const epgPronto = !data || tvSources.epg.stats().status === "pronto";
  const ttlEfetivo = epgPronto ? ttl : 15000;
  cacheSet(key, value, value.length ? (ttlEfetivo || CACHE_TTL) : EMPTY_CACHE_TTL, MAX_CACHE_SIZE);
  return value;
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const data = extra?.date || "";
  const metas = await catalogFor(id, extra?.search, type, extra?.genre, data);
  const tipadas = metas.map(m => ({ ...m, type: m.type || type }));
  if (data) return { metasDetailed: tipadas, cacheMaxAge: 300, staleRevalidate: 900 };
  return { metas: tipadas, cacheMaxAge: 300, staleRevalidate: 900 };
});

async function resolveMeta(type, id) {
  if (type === "movie" || type === "tv") {
    if (id.startsWith("tmdb:")) {
      const tmdbId = Number(id.replace("tmdb:", ""));
      const detail = await getMovieDetail(tmdbId);
      if (!detail) return { meta: null };
      return {
        meta: {
          id, type: "movie", name: detail.title, description: detail.overview,
          poster: detail.poster, background: detail.backdrop,
          runtime: detail.runtime, releaseYear: detail.year,
          genres: detail.genres, imdbRating: detail.voteAverage,
        },
        cacheMaxAge: 1800, staleRevalidate: 7200,
      };
    }
    if (id.startsWith("tv:live:")) {
      const slug = tvSources.canalDe(id);
      let meta = await tvSources.getMeta(slug).catch(() => null);
      if (!meta) return { meta: null };
      if (tvSources.ehIdDePrograma(id)) {
        const comecou = tvSources.idDoPrograma(id);
        const alvo = (meta.videos || []).find(v => v.id === id) || (meta.videos || []).find(v => v.startTime === comecou);
        if (alvo) meta = { ...meta, ...alvo, id, type: "tv", description: alvo.title, behaviorHints: { ...(meta.behaviorHints || {}), isLive: true } };
      }
      return { meta, cacheMaxAge: 300, staleRevalidate: 600 };
    }
    if (/^tt\d+$/.test(id)) {
      const resolved = await resolveByImdb(id, "movie").catch(() => null);
      const detail = resolved ? await getMovieDetail(resolved.tmdbId).catch(() => null) : null;
      if (!detail) {
        const cm = await getCinemetaMeta(id).catch(() => null);
        if (!cm) return { meta: null };
        return {
          meta: {
            id, type: "movie", name: cm.name || cm.title || "",
            description: cm.description || cm.overview || "",
            poster: cm.poster || undefined, background: cm.background || undefined,
            releaseYear: (cm.releaseInfo || "").match(/\d{4}/)?.[0],
            genres: cm.genres || [],
          },
          cacheMaxAge: 1800, staleRevalidate: 7200,
        };
      }
      return {
        meta: {
          id, type: "movie", name: detail.title, description: detail.overview,
          poster: detail.poster, background: detail.backdrop,
          runtime: detail.runtime, releaseYear: detail.year,
          genres: detail.genres, imdbRating: detail.voteAverage,
        },
        cacheMaxAge: 1800, staleRevalidate: 7200,
      };
    }
    return { meta: null };
  }

  if (type === "series") {
    let tmdbId = null;
    if (id.startsWith("tmdb:")) {
      tmdbId = Number(id.replace("tmdb:", ""));
    } else if (/^tt\d+$/.test(id)) {
      const resolved = await resolveByImdb(id, "series").catch(() => null);
      if (resolved) tmdbId = resolved.tmdbId;
    }
    if (tmdbId) {
      const detail = await getTvDetail(tmdbId);
      if (!detail) return { meta: null };
      const videos = [];
      const seasonResults = await Promise.all(detail.seasons.map(async (season) => {
        const seasonData = await getTvSeason(tmdbId, season.number).catch((e) => { console.error(`[tmdb] season: ${e.message}`); return null; });
        return seasonData ? seasonData.episodes.map(ep => ({
          id: `${id}:${season.number}:${ep.number}`,
          title: ep.title || `T${season.number} E${ep.number}`,
          season: season.number,
          episode: ep.number,
          overview: ep.overview,
          thumbnail: ep.still,
        })) : [];
      }));
      for (const eps of seasonResults) videos.push(...eps);
      return {
        meta: {
          id, type: "series", name: detail.title, description: detail.overview,
          poster: detail.poster, background: detail.backdrop,
          releaseYear: detail.year, genres: detail.genres,
          imdbRating: detail.voteAverage, videos,
        },
        cacheMaxAge: 1800, staleRevalidate: 7200,
      };
    }

    if (/^tt\d+$/.test(id)) {
      const cm = await getCinemetaMeta(id).catch(() => null);
      if (!cm) return { meta: null };
      const videos = (cm.videos || []).map(v => ({
        id: v.id || `${id}:${v.season || 1}:${v.episode || 1}`,
        title: v.title || `T${v.season || 1} E${v.episode || 1}`,
        season: v.season || 1,
        episode: v.episode || 1,
        overview: v.overview,
        thumbnail: v.thumbnail,
      }));
      return {
        meta: {
          id, type: "series", name: cm.name || cm.title || "",
          description: cm.description || cm.overview || "",
          poster: cm.poster || undefined, background: cm.background || undefined,
          releaseYear: (cm.releaseInfo || "").match(/\d{4}/)?.[0],
          genres: cm.genres || [], videos,
        },
        cacheMaxAge: 1800, staleRevalidate: 7200,
      };
    }

    if (/^kitsu[:.]?\d+$/i.test(id)) {
      const info = await getKitsu(id, type);
      if (!info) return { meta: null };
      return {
        meta: {
          id: info.id, type: "series", name: info.title,
          description: info.description, poster: info.poster || undefined,
          background: info.background || undefined, releaseYear: info.year || undefined,
          genres: [], videos: episodeVideos(info),
        },
        cacheMaxAge: 1800, staleRevalidate: 7200,
      };
    }

    const meta = await getAnime(id);
    if (!meta) return { meta: null };
    return { meta: { ...meta, type: "series", videos: episodeVideos(meta) }, cacheMaxAge: 1800, staleRevalidate: 7200 };
  }

  return { meta: null };
}

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const chave = `meta:${type}:${id}`;
    const hit = await cacheGet(chave, META_CACHE_TTL);
    if (hit) return hit;
    const resposta = await resolveMeta(type, id);
    if (resposta && resposta.meta) cacheSet(chave, resposta, META_CACHE_TTL, 300);
    return resposta;
  } catch (e) {
    console.error(`[meta] ${e.message}`);
    return { meta: null };
  }
});

const MAX_INFLIGHT_STREAMS = 300;
const inflightStreams = new Map();
const refreshingStreams = new Set();

async function handleStreams(type, id, config, base) {
  const flightKey = `${type}|${id}|${config || ""}`;
  const pending = inflightStreams.get(flightKey);
  if (pending) return pending;
  const promise = handleStreamsCore(type, id, config, false, base).finally(() => inflightStreams.delete(flightKey));
  if (inflightStreams.size >= MAX_INFLIGHT_STREAMS) return promise;
  inflightStreams.set(flightKey, promise);
  return promise;
}

function collectSharedPtSubs(all) {
  const out = [];
  const seen = new Set();
  for (const stream of all) {
    for (const sub of (stream.subtitles || [])) {
      const subUrl = sub.url || sub.file;
      const subLang = (sub.lang || sub.label || sub.language || "").toLowerCase();
      if (!subLang.match(/pt|por|portuguese|brazil/) || !subUrl || seen.has(subUrl)) continue;
      seen.add(subUrl);
      out.push(sub);
    }
  }
  return out;
}

function filterStreamsByConfig(all, cfg, season, episode) {
  const minQuality = cfg.quality === "all" ? 0 : Number(String(normalizeQuality(cfg.quality) || "").replace("p", "")) || 0;
  const resolvedSource = cfg.sources === "all" ? null : resolveSourceId(cfg.sources);
  return all.filter(stream => {
    if (Number(stream.season) !== Number(season)) return false;
    if (stream.episode && Number(stream.episode) !== Number(episode)) return false;
    if (cfg.lang === "dubbed" && !stream.dubbed) return false;
    if (cfg.lang === "subtitled" && stream.dubbed) return false;
    if (resolvedSource && !(stream.sources || []).map(s => s.toLowerCase()).includes(resolvedSource)) return false;
    if (minQuality) {
      const numQ = Number(String(normalizeQuality(stream.quality) || "").replace("p", ""));
      if (isNaN(numQ) || numQ < minQuality) return false;
    }
    return true;
  });
}

function dedupeRankedStreams(ranked) {
  const seenUrls = new Set();
  const seenSigs = new Set();
  const out = [];
  for (const item of ranked) {
    const urlKey = item.url ? streamDedupKey(item.url) : null;
    if (urlKey) {
      if (seenUrls.has(urlKey)) continue;
      seenUrls.add(urlKey);
      const sig = `${(item.sources || []).join(",")}|${item.quality || ""}|${item.title || ""}|${item.dubbed ? 1 : 0}${item.portuguese ? 1 : 0}${item.subtitle ? 1 : 0}`;
      if (seenSigs.has(sig)) continue;
      seenSigs.add(sig);
    }
    out.push(item);
    if (out.length >= 16) break;
  }
  return out;
}

// O CAMINHO DE STREAM NAO TEM MAIS NADA QUE CLASSIFICAR.
//
// Antes aqui viviam: a sonda de resolucao real do video (`video-probe`), a mascara de URL
// (`maskTvUrls`/`cifraOrigens`/`maskStreamUrls`), a variante "sem precisar de Referer" (que
// passava pelo worker), a prova de vida do link (`prova-viva`) e a ordem de exibicao
// (`sortStreamsForResponse`, que era quem punha o REI antes das outras fontes de TV).
//
// Tudo isso existia para entregar video, e o video nao sai mais daqui (decisao 155). As libs
// continuam em `src/lib/` (`video-probe`, `quality`, `prova-viva`, `url-resolver`,
// `anime-ranking`) porque o plugin tem o mesmo problema e o mesmo codigo — o que nao acontece
// aqui e a CHAMADA delas.

function parseStreamId(id) {
  const parts = String(id).split(":");
  if (parts.length >= 3) {
    return { baseId: parts.slice(0, parts.length - 2).join(":"), season: Number(parts[parts.length - 2]) || 1, episode: Number(parts[parts.length - 1]) || 1 };
  }
  if (parts.length === 2 && !/^(tmdb|tvdb|kitsu)$/i.test(parts[0])) {
    return { baseId: parts[1], season: 1, episode: 1 };
  }
  return { baseId: id, season: 1, episode: 1 };
}

async function resolveStreamInfo(baseId, type) {
  let info;
  try {
    const rawId = String(baseId).replace(/^mirror:/, "");
    const tmdbColonMatch = rawId.match(/^tmdb:(\d+)$/);
    const tmdbNoColonMatch = !tmdbColonMatch ? rawId.match(/^tmdb(\d+)$/) : null;
    if (type === "movie" && (tmdbColonMatch || tmdbNoColonMatch)) {
      const tmdbId = Number(tmdbColonMatch ? tmdbColonMatch[1] : tmdbNoColonMatch[1]);
      const movie = await getMovieDetail(tmdbId);
      if (movie) info = { id: rawId, title: movie.title, originalTitle: movie.originalTitle, titles: [movie.title, movie.originalTitle].filter(Boolean), episodes: 0, type: "movie", year: movie.year, runtime: movie.runtime, imdbId: movie.imdbId };
    } else if (tmdbColonMatch || tmdbNoColonMatch) {
      const tmdbId = Number(tmdbColonMatch ? tmdbColonMatch[1] : tmdbNoColonMatch[1]);
      const tv = await getTvDetail(tmdbId);
      if (tv) info = { id: rawId, title: tv.title, originalTitle: tv.originalTitle, titles: [tv.title, tv.originalTitle].filter(Boolean), episodes: tv.totalEpisodes || 0, type: "series", year: tv.year, genreIds: tv.genreIds, originCountry: tv.originCountry, imdbId: tv.imdbId };
    } else if (/^tt\d+$/i.test(rawId)) {
      try {
        const resolved = await resolveByImdb(rawId, type);
        if (resolved) {
          if (resolved.type === "movie") {
            const movie = await getMovieDetail(resolved.tmdbId);
            if (movie) info = { id: `tmdb:${resolved.tmdbId}`, title: movie.title, originalTitle: movie.originalTitle, titles: [movie.title, movie.originalTitle].filter(Boolean), episodes: 0, type: "movie", year: movie.year, runtime: movie.runtime, imdbId: movie.imdbId || rawId };
          } else {
            const tv = await getTvDetail(resolved.tmdbId);
            if (tv) info = { id: `tmdb:${resolved.tmdbId}`, title: tv.title, originalTitle: tv.originalTitle, titles: [tv.title, tv.originalTitle].filter(Boolean), episodes: tv.totalEpisodes || 0, type: "series", year: tv.year, genreIds: tv.genreIds, originCountry: tv.originCountry, imdbId: tv.imdbId || rawId };
          }
        }
      } catch (_) {}
      if (!info) {
        try {
          const cinemeta = await resolveExternal(rawId);
          if (cinemeta && cinemeta.title && !cinemeta.title.startsWith("Episode")) {
            info = { id: rawId, title: cinemeta.title, titles: cinemeta.titles || [cinemeta.title], episodes: (cinemeta.videos || []).length || 0, type, year: cinemeta.year };
          }
        } catch (_) {}
      }
    } else if (/^\d+$/.test(rawId)) {
      info = await getTitles(rawId);
    } else if (/^kitsu[:.]?\d+$/i.test(rawId)) {
      info = await getKitsu(rawId, type);
    } else {
      info = await resolveExternal(rawId);
    }
  } catch (e) { console.error(`[resolve] ${e.message}`); info = null; }
  if (!info) {
    let slug = baseId.replace(/^mirror:/, "").split(":")[0];
    if (/^tmdb$/i.test(slug) || /^tvdb$/i.test(slug) || /^kitsu$/i.test(slug) || /^\d+$/.test(slug)) {
      slug = "";
    }
    if (slug && !/^(tt\d+|kitsu\d+)$/i.test(slug)) {
      const slugResults = await searchAnime(slug);
      // PORTAO DE CORRESPONDENCIA (decisao 135). Antes: `find(exato) || resultados[0]` — sem
      // casamento, servia o PRIMEIRO anime da busca como se fosse o item pedido. E a origem do
      // defeito medido: "Matrix" (tmdb:603) respondeu com `futari-wa-precure` e "Batman"
      // (tmdb:155) com "Boruto".
      const match = melhorCorrespondencia(slug, slugResults);
      if (match) {
        const name = match.name || match.title || "";
        info = { id: match.id, title: name, titles: [name, match.name].filter(Boolean), episodes: match.episodes || 0 };
      }
    }
  }
  if (!info) {
    const rawId = baseId.replace(/^mirror:/, "");
    const tmdbMatch = rawId.match(/^tmdb[:.]?(\d+)$/i);
    if (tmdbMatch) {
      const tmdbNum = Number(tmdbMatch[1]);
      info = { id: rawId, title: `TMDB ${tmdbNum}`, titles: [`TMDB ${tmdbNum}`], episodes: 0, type: type === "movie" ? "movie" : "series" };
      console.log(`[streams] tmdb fallback: using ID ${tmdbNum} without title resolution`);
    }
  }
  return info;
}

async function runAnimeScrapers(query, episode, season, sink, tmdbId) {
  const context = buildContext({ anime: true, type: "series", title: query, episode, season, tmdbId: tmdbId || 0 });
  const jobs = engine.start(context);
  const settled = await Promise.allSettled(jobs.map(j => j.promise));
  let failed = 0;
  const errors = [];
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === "rejected") {
      failed++;
      errors.push(`${jobs[i].source.id}: ${settled[i].reason && settled[i].reason.message}`);
      continue;
    }
    for (const item of settled[i].value) sink.push(item);
  }
  return { failed, errors };
}

async function runAnimeQueries(queries, episode, season, sink, tmdbId) {
  let failed = 0;
  const errors = [];
  const first = await runAnimeScrapers(queries[0], episode, season, sink, tmdbId);
  failed += first.failed;
  errors.push(...first.errors);
  if (sink.count > 0 || queries.length < 2) {
    if (failed) {
      const err = new Error(`anime scraper failed: ${errors.filter(Boolean).join("; ")}`);
      err.partialStreams = [];
      throw err;
    }
    return;
  }
  const extra = await Promise.all(queries.slice(1).map(q => runAnimeScrapers(q, episode, season, sink, tmdbId)));
  for (const r of extra) {
    failed += r.failed;
    errors.push(...r.errors);
  }
  if (failed) {
    const err = new Error(`anime scraper failed: ${errors.filter(Boolean).join("; ")}`);
    err.partialStreams = [];
    throw err;
  }
}

async function handleStreamsCore(type, id, config) {
  if (type !== "series" && type !== "movie" && type !== "tv") return { streams: [] };
  // O SERVIDOR NAO TEM FONTE NENHUMA (decisoes 154 e 155).
  //
  // O caminho de VOD foi esvaziado na 154 (as 10 fontes foram para `nuvio/src/scrapers/`) e o de
  // TV na 155 (as 4 fontes de TV tambem). Nenhuma das duas volta: o dono, "nada no servidor senao
  // catalogo, todas as fontes sao via plugin". Os players sao montados no aparelho, do IP
  // residencial de quem assiste.
  //
  // A RESPOSTA E A MESMA DE SEMPRE — `{streams: []}`, HTTP 200 — e e' ela que as tres rotas de
  // stream continuam devolvendo: `/stream/:type/:id.json`, `/api/streams/:type/:id` e
  // `/nuvio/stream/channel/:id`. O formato nao muda, entao nenhum cliente quebra: ele recebe
  // "nenhuma fonte" em vez de um link.
  //
  // O TTL e' o de resposta degradada (60s), nao o de stream (15min): e' uma resposta estavel, nao
  // um link para revalidar. E o cache evita que cada pedido va ao TMDB/AniList para descobrir
  // que nao ha o que entregar.
  const chave = `stream:${type}:${id}:${config || ""}`;
  const guardado = sqliteCache.get(chave);
  if (guardado) return guardado;
  const vazio = { streams: [] };
  sqliteCache.set(chave, vazio, DEGRADED_CACHE_TTL);
  return vazio;
}
builder.defineStreamHandler(async ({ type, id, config }) => {
  if (type !== "series" && type !== "movie" && type !== "tv") return { streams: [] };
  let cfgStr = "";
  if (typeof config === "string") cfgStr = config;
  else if (config && typeof config === "object") {
    cfgStr = Object.entries(config).map(([k, v]) => `${k}=${v}`).join("+");
  }
  return handleStreams(type, id, cfgStr);
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(compression());

// DECISAO 155: a rota de pedaco de video (`src/routes/segmentos.js`, `/seg/etc/:file`) foi
// apagada. Ela existia porque a CDN da ETC exige um `Referer` que so servidor injeta, e o
// segmento tinha de sair de um endereco nosso para o player levar o cabecalho junto. Sem a ETC
// no servidor, nao ha CDN que exija cabecalho nem segmento para reescrever.

// Cache-Control por caminho.
//
// A zona do BeamUp e da Cloudflare, e a BORDA guarda JSON sem olhar o que a gente manda —
// foi assim que o /health ficou com uptime congelado e o /api/tv/estado travou em
// "idadeSeg:72" por 8 minutos seguidos. Tudo que muda com o tempo precisa de no-store:
// stream, saude, metricas e a API interna de TV.
//
// DECISAO 155: as DUAS EXCECOES que existiam aqui sairam com o video. A `/stream/hls/` (a
// lista m3u8 do canal, servida da borda por 25s) e a `/seg/` (o segmento da ETC, com 30min
// para a borda tirar a origem do caminho da segunda pessoa). Nao ha mais nada de video para a
// borda guardar — o catalogo e' JSON estatico, que e' o que a borda gosta de guardar.
// HEADERS DE SEGURANCA (auditoria 30/09/2026: ZERO deles em producao, medido no /tv).
// Aplicados em TODO caminho, inclusive no JSON que o Stremio consome: o `nosniff` nao atrapalha
// o player e o `frame-ancestors` impede que a nossa pagina seja embutida em outro sitio.
//
// A CSP vai SO nas PAGINAS: as tres tem `<script>` inline (medido: 1 em cada) e o `/tv` ainda
// carrega hls.js e o p2p-media-loader de jsdelivr. No JSON e no video a CSP nao se aplica, e
// apertar la quebra o player.
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");
  res.set("Referrer-Policy", "no-referrer");
  const proto = String(req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http"));
  if (proto === "https") res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const ehPagina = /\.html$/i.test(req.path) || [ROTAS.tv, ROTAS.instalacao, ROTAS.painel].includes(req.path);
  if (ehPagina) {
    res.set("Content-Security-Policy", [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "media-src 'self' blob: https:",
      "connect-src 'self' https: wss:",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "));
  }
  next();
});

app.use((req, res, next) => {
  const caminho = req.path;
  if (caminho.startsWith(PREFIXOS.nuvio + "/stream/")) {
    // O CATALOGO E A META DO ADAPTER DO NUVIO LEVAM 120s DE BORDA (JSON normal, como o resto).
    // O STREAM NAO: e' a MESMA resposta de `/stream/` — lista vazia, estavel e barata, mas
    // declarada aqui para nao depender do `/stream/` aparecer no meio do caminho.
    res.set("Cache-Control", "no-store");
    res.set("CDN-Cache-Control", "no-store");
    res.set("Cloudflare-CDN-Cache-Control", "no-store");
  } else if (caminho.includes(PREFIXOS.stream) || caminho.startsWith(PREFIXOS.api)) {
    res.set("Cache-Control", "no-store");
  } else if (caminho === ROTAS.manifesto) {
    // MEDIDO 02/10/2026: o manifesto foi servido ERRADO por 4 horas depois do deploy. O
    // `Cache-Control` de 120 s e' reescrito pela zona do BeamUp para `max-age=14400` (decisao
    // 140), entao a renomeacao do addon so aparecia depois de 4 h — e um cliente que lesse o
    // manifesto velho instalava o MirrorStream a partir da URL do MirrorView. O que a Cloudflare
    // respeita para o TTL da BORDA e' `CDN-Cache-Control`, separado do TTL da origem, entao o
    // manifesto nao e' cacheavel na borda. Custo: o manifesto e' um arquivo pequeno lido na
    // instalacao e periodicamente pelo cliente, nao no caminho quente.
    res.set("Cache-Control", "public, max-age=120");
    res.set("CDN-Cache-Control", "no-store");
    res.set("Cloudflare-CDN-Cache-Control", "no-store");
  } else if (caminho === ROTAS.saude || caminho === ROTAS.metricas) {
    res.set("Cache-Control", "no-store");
  } else if (/\.json$/.test(caminho)) {
    res.set("Cache-Control", "public, max-age=120");
  }
  // ERRO NAO SE GUARDA, EM ROTA NENHUMA (decisao 140). A guarda mora em `lib/cache-erro.js`,
  // que tem teste proprio: no `finish` (como estava) o `setHeader` era sempre tarde e derrumbava o
  // processo em toda resposta >= 400. Ver a decisao 154 no AGENTS.md.
  next();
});

app.use(cacheErro.proibeCacheDeErro);

app.use(express.static(PUBLICO, { maxAge: "1d" }));

let clusterTvAssumido = false;
// AQUECIMENTO DA GUIA (a aba Channel Guide do Stremio).
//
// MEDIDO em 28/09/2026: `/catalog/tv/...json?date=HOJE` — que e o pedido da aba de guia —
// levava **18,5s na 1a chamada** de cada dia e 0,016s na seguinte. A causa e a chave: `?date=`
// entra no `extra` do handler e vira uma chave de cache PRIMEIRA, entao a primeira chamada do
// dia montava o catalogo detalhado inteiro (280 canais, cada um com a grade do dia) do zero, e
// 18,5s estoura os 12,3s do gateway. Para o usuario, a guia "nao abria".
//
// Aquecer no boot tira a montagem do caminho do primeiro clique. O cluster de TV e quem tem a
// EPG, entao este aquecimento roda no app2 — o app1 delega a rota e nao monta nada.
// Espera o EPG estar carregado. Sem isto o aquecimento da guia CORRIA ANTES do EPG: o
// `epg.start()` so e chamado quando o catalogo termina de montar (~124s) e o download do
// XMLTV leva mais uns segundos. MEDIDO em 29/09/2026, o log saiu nesta ordem:
//   [tv] guia 2026-09-29 aquecida: 277 canais, **0 com programa** (181410ms)
//   [epg] fontes BR:+107 REI:+53
//   [epg] 160 canais com programação
// Ou seja: a guia foi montada com o EPG vazio e o resultado VAZIO ficou guardado por 300s —
// a aba de programacao abria sem nenhum programa mesmo com o EPG bom (medi `grade()` direto:
// HBO 26, SBT RJ 19, Globo News 15 programas). Aqui esperamos o EPG antes de montar.
async function esperaEpg() {
  const limite = Date.now() + 300000;
  while (Date.now() < limite) {
    const s = tvSources.epg.stats();
    if (s.status === "pronto" && s.programs > 0) return true;
    if (s.status === "vazio" && s.carregadoEm) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function aqueceGuiaDeTv() {
  const pronto = await esperaEpg();
  if (!pronto) console.log("[tv] EPG nao ficou pronto a tempo; a guia esquenta mesmo assim");
  // O CATALOGO SEM DATA TAMBEM. Ele e a chave que a RESERVA do split procura quando o cluster
  // nao responde, e sem aquecê-lo o app1 nunca tinha essa entrada — a reserva devolvia lista
  // vazia mesmo com o catalogo montado para a guia (mesma triagem, mesma memoria). O custo e
  // zero: este aquecimento ja paga a triagem; aqui reaproveitamos o resultado pronto.
  try {
    const t0 = Date.now();
    const semData = await catalogFor("mirror-tv-live", null, "tv", null, "");
    console.log(`[tv] catalogo de TV (reserva) aquecido: ${semData.length} canais (${Date.now() - t0}ms)`);
  } catch (e) {
    console.error(`[tv] aquecimento do catalogo de TV falhou: ${e && e.message}`);
  }
  const dias = Number(ENV.TV_AQUECE_GUIA_DIAS || 2);
  for (let d = 0; d < dias; d++) {
    const data = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    try {
      const t0 = Date.now();
      const metas = await catalogFor("mirror-tv-live", null, "tv", null, data);
      const comGuia = metas.filter((m) => (m.videos || []).length).length;
      console.log(`[tv] guia ${data} aquecida: ${metas.length} canais, ${comGuia} com programa (${Date.now() - t0}ms)`);
    } catch (e) {
      console.error(`[tv] aquecimento da guia ${data} falhou: ${e && e.message}`);
    }
  }
}

// AS PAGINAS ANTES DO REPASSE DE TV (decisao 147).
//
// MEDIDO 01/10/2026: estas tres rotas estavam declaradas DEPOIS do `repassaTv`, e por isso uma
// pagina que nao tem nada a ver com TV pagava o preco do cluster de TV. Com o cluster fora do ar
// (o dominio do app2 perdeu o registro no DNS), o dono abriu a raiz, ela mandou para `/install`,
// e a resposta levou **12,8s** — bem no limite de 12,3s em que o gateway corta. O `/tv` dava
// **504 em 12,2s**. Para o usuario era "o addon nao entra".
//
// Medido agora, na mesma maquina: `/install.html` responde em **0,04s** e `/install` em **12,8s** —
// o mesmo arquivo, so mudando a rota. Numa pagina estatica nao ha nada que depender de TV, entao
// estas tres saem antes do repasse.
app.get(ROTAS.instalacao, (_req, res) => res.sendFile(path.join(PUBLICO, "install.html")));
app.get(ROTAS.painel, (_req, res) => res.sendFile(path.join(PUBLICO, "dashboard.html")));
// A `/tv` so e antecipada quando NAO ha canal pedido: abrir a pagina e o caso comum, e nao
// precisa de fonte nenhuma. Com `?chan=` continua valendo a rota de baixo, que escolhe o canal.
app.get(ROTAS.tv, (req, res, next) => {
  // Com `?chan=` esta rota NAO sabe escolher o canal (isso e' a rota de baixo, que consulta as
  // fontes). Passa adiante em vez de responder — um redirect para a propria URL seria laco infinito.
  if (req.query.chan) return next();
  res.set("Cache-Control", "no-store");
  return res.sendFile(path.join(PUBLICO, "tv.html"));
});

app.use((req, res, next) => {
  if (tvSplit.TV_BASE && tvSplit.ehOProprioClusterDeTv(req) && !clusterTvAssumido) {
    clusterTvAssumido = true;
    runtimeBase = tvSplit.TV_BASE;
    defineEnv("PUBLIC_BASE_URL", tvSplit.TV_BASE);
    console.log(`[split] este app e o cluster de TV: base = ${runtimeBase}`);
  }
  return tvSplit.repassaTv(req, res, next);
});

// RESERVA do catalogo de TV quando o cluster nao responde.
//
// MEDIDO 28/09/2026: a ponte caia em `next()` e o app1 MONTAVA o catalogo de TV do zero
// (127s de triagem), estourando os 12,3s do gateway — 504. Foi o sintoma "o catalogo nao
// carrega", e aparecia toda vez que o cluster estava aquecendo depois de um deploy.
//
// Aqui a resposta e sempre rapida: o catalogo velho, se houver (mesmo vencido — um catalogo de
// 5 minutos atras e melhor que nada), senao lista vazia com 200. O pedido de `?date=` (a aba de
// guia do Stremio) volta no mesmo formato que o cluster usaria, para o cliente nao cair.
tvSplit.definirFallbackTv((req) => {
  const eApi = req.path.startsWith("/api/channels");
  // A query vem do `req.url`, nao de `req.query`: este middleware roda ANTES do parser de
  // query do Express, entao `req.query` esta vazio aqui (mesma pegadinha do comQuery).
  const q = new URLSearchParams(String(req.url || "").split("?")[1] || "");
  const id = String((req.path.match(/([^/]+)\.json$/) || [])[1] || "mirror-tv-live");
  const busca = eApi ? (q.get("search") || q.get("q") || "") : (q.get("search") || "");
  const cat = eApi ? (q.get("category") || q.get("genre") || "") : (q.get("genre") || "");
  const data = q.get("date") || "";
  // A CHAVE TEM QUE SER A MESMA DO catalogFor. Estava `mirror-tv-live:` e a gravada e
  // `mirror-tv-live::tv::` — o cache nunca acertava, entao a reserva devolvia SEMPRE lista
  // vazia mesmo com o catalogo montado na memoria (medido 29/09/2026: 278 canais servidos e a
  // reserva dizendo 0).
  const chave = `${id}:${busca}:tv:${cat}:${data}`;
  // So uma lista COM conteudo vale como reserva. Uma entrada vazia e o resultado de uma
  // montagem que falhou — servi-la seria mentir da mesma forma que o 200 no canal inexistente.
  const lido = (k) => {
    const e = cache.get(k);
    return e && Array.isArray(e.value) && e.value.length ? e.value : null;
  };
  let metas = lido(chave);
  // BUSCA E CATEGORIA NUNCA SAO AQUECIDAS: o aquecimento grava so a lista INTEIRA
  // (`mirror-tv-live::tv::`), e estas chaves nao existem no cache. Antes disto a reserva
  // respondia `success:true, data:[]` em 4ms — a API dizia "nenhum canal" com o catalogo
  // inteiro na memoria, e o caminho que calculava de verdade nem chegava a rodar. Aqui o
  // corte e o MESMO que o `getCatalog` faria (genero, nome, dia da guia), so que sobre a
  // lista cheia que ja esta guardada — em vez de uma montagem de 12s que o gateway corta.
  if (!metas && (busca || cat)) {
    const cheia = lido(`${id}::tv::${data}`);
    if (cheia) metas = tvSources.filtraCatalogo(cheia, busca || null, cat || null, data);
  }
  const base = basePublica(req);

  // Sem reserva NENHUMA para esta chave: nao se responde vazio. A lista inteira e a categoria
  // sao aquecidas no boot (e renovadas em loop), entao este ramo so abre se o aquecimento
  // falhou — ai o certo e dizer que nao ha resposta, nao devolver `success:true` com nada.
  if (!metas) {
    if (!eApi) return { metas: [], cacheMaxAge: 0 };
    return { __reserva: true, status: 503, corpo: { success: false, error: "catalogo de TV sem reserva local" } };
  }

  const tipadas = () => metas.map((m) => ({ ...m, type: "tv" }));

  if (!eApi) return { metas: tipadas(), cacheMaxAge: 300, staleRevalidate: 900 };

  // /api/channels/categories vem ANTES de /api/channels/:slug no Express; aqui temos que
  // separar pelo caminho, senao "categories" seria tratado como o slug de um canal.
  if (req.path.endsWith("/api/channels/categories")) {
    const cont = new Map();
    for (const m of metas) {
      const c = (m.genres && m.genres[0]) || "Geral";
      cont.set(c, (cont.get(c) || 0) + 1);
    }
    const lista = [...cont.entries()].sort((a, b) => b[1] - a[1]).map(([nome, total]) => ({ id: tvSources.normKey(nome), name: nome, channels: total }));
    return { success: true, data: lista };
  }

  if (/\/api\/channels\/.+/.test(req.path)) {
    const slug = String(req.path.split("/").pop() || "").replace(/^tv:live:/, "");
    const achou = metas.find((m) => String(m.id || "").replace(/^tv:live:/, "") === slug);
    if (!achou) return { __reserva: true, status: 404, corpo: { success: false, error: "channel not found" } };
    return { __reserva: true, status: 200, corpo: { success: true, data: paraApiCanal(achou, base) } };
  }

  return { success: true, data: metas.map((m) => paraApiCanal(m, base)) };
});

// A RESERVA SE RENOVA COM A RESPOSTA FRESCA DO CLUSTER (o hook chamado la dentro do
// `repassaTv`). So a lista INTEIRA vale a pena guardar: busca, categoria e genero sao
// subconjuntos, e guardados aqui seriam lidos depois COMO SE fossem o catalogo inteiro — a
// reserva mentiria do mesmo jeito que o vazio que este bloco existe para corrigir.
tvSplit.definirAoRepasse((req, corpo) => {
  const m = String(req.path || "").match(/\/catalog\/tv\/([^/.]+)\.json$/);
  if (!m) return;
  const q = new URLSearchParams(String(req.url || "").split("?")[1] || "");
  if (q.get("search") || q.get("q") || q.get("genre") || q.get("category")) return;
  let recebido;
  try { recebido = JSON.parse(Buffer.from(corpo).toString("utf8")); } catch (_) { return; }
  const metas = recebido && (recebido.metas || recebido.metasDetailed);
  if (!Array.isArray(metas) || !metas.length) return;
  cacheSet(`${m[1]}::tv::${q.get("date") || ""}`, metas, TV_CATALOG_TTL, MAX_CACHE_SIZE).catch(() => {});
});

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX_KEYS = 20000;
const RATE_LIMIT_MAX = 180;
app.use(async (req, res, next) => {
  if (!runtimeBase) {
    // Auto-detect so com host que seja dominio de verdade: o gateway do BeamUp entrega o
    // `Host` reduzido ao nome do app (`c12e41ddc21b-mirror2`), e aceitar isso fazia a URL
    // publica do addon nascer sem dominio. `basePublica` e o mesmo portao.
    const detectada = basePublica(req);
    if (detectada) {
      runtimeBase = detectada;
      defineEnv("PUBLIC_BASE_URL", runtimeBase);
    }
  }
  // O tier "proxy" (6000 req/min) foi removido na decisao 155: ele existia para o relay e a
  // mascara, que sairam do servidor. Sem video passando por aqui, todo mundo e' o mesmo cliente
  // de catalogo, e o teto e' o da API.
  const maxReqs = RATE_LIMIT_MAX;
  const ip = req.ip || req.connection?.remoteAddress || "unknown";

  if (redis.isAvailable()) {
    const rlKey = `rl:api:${ip}`;
    const rl = await redis.incrRateLimit(rlKey, 60, maxReqs);
    if (!rl.allowed) {
      res.set("Retry-After", String(Math.ceil((rl.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ error: "rate limit exceeded", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) });
    }
    res.set("X-RateLimit-Remaining", String(rl.remaining));
  } else {
    const rlKey = `${ip}:api`;
    const now = Date.now();
    const entry = rateLimitMap.get(rlKey);
    if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
      if (rateLimitMap.size >= RATE_LIMIT_MAX_KEYS) rateLimitMap.clear();
      rateLimitMap.set(rlKey, { start: now, count: 1 });
    } else {
      entry.count++;
      if (entry.count > maxReqs) {
        const retryAfter = Math.ceil((entry.start + RATE_LIMIT_WINDOW - now) / 1000);
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({ error: "rate limit exceeded", retryAfter });
      }
    }
  }
  res.set("Access-Control-Allow-Origin", "*");
  next();
});

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now - val.start > RATE_LIMIT_WINDOW) rateLimitMap.delete(key);
  }
}, 60000).unref();

// O ADAPTER DO NUVIO (a peca `mirrorhub`). Fica depois do rate limit e dos cabecalhos de cache,
// entao herda `Access-Control-Allow-Origin`, o `no-store` do stream e o `public, max-age=120` do
// resto do JSON. As rotas de TV de hoje nao sao tocadas: sao 4 rotas a mais, no prefixo `/nuvio`.
nuvio.registrar(app, { basePublica, catalogoDeTv, handleStreams });

// Cartaz do canal, para quem nao tem imagem em fonte nenhuma. SVG deterministico: o mesmo
// canal sempre gera o mesmo desenho, entao a borda guarda e nao ha geracao a cada request.
app.get(ROTAS.poster, (req, res) => {
  const key = String(req.params.key || "");
  const nome = String(tvSources.nomeDeChave(key) || key).slice(0, 42);
  const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "TV";
  // cor derivada do nome: estavel por canal, sem precisar guardar nada
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  const fundo = `hsl(${h} 45% 14%)`, textura = `hsl(${h} 55% 24%)`, texto = `hsl(${h} 70% 82%)`;
  const linhas = nome.length > 26
    ? [nome.slice(0, 26), nome.slice(26, 42)]
    : [nome];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${textura}"/><stop offset="1" stop-color="${fundo}"/></linearGradient></defs>
<rect width="300" height="300" fill="url(#g)"/>
<circle cx="150" cy="118" r="46" fill="none" stroke="${texto}" stroke-width="3" opacity=".55"/>
<text x="150" y="140" font-family="Arial,Helvetica,sans-serif" font-size="44" font-weight="700"
 fill="${texto}" text-anchor="middle">${iniciais.replace(/[<>&]/g, "")}</text>
${linhas.map((l, i) => `<text x="150" y="${196 + i * 20}" font-family="Arial,Helvetica,sans-serif" font-size="15"
 fill="${texto}" fill-opacity=".8" text-anchor="middle">${l.replace(/[<>&]/g, "").slice(0, 26)}</text>`).join("")}
</svg>`;
  res.set({
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=86400",
  });
  res.send(svg);
});

app.get(ROTAS.saude, async (req, res) => {
  const redisStats = await redis.getStats().catch(() => ({ redis: false }));
  const sqliteStats = sqliteCache.stats();
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    split: {
      tvBase: tvSplit.TV_BASE,
      tvBaseHost: tvSplit.TV_BASE_HOST,
      host: String(req.get("host") || ""),
      forwardedHost: String(req.get("x-forwarded-host") || ""),
      souOClusterDeTv: tvSplit.ehOProprioClusterDeTv(req),
    },
    name: "MirrorView",
    version: defaultManifest.version,
    uptime: Math.floor(process.uptime()),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heap: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
    },
    redis: redisStats,
    sqlite: sqliteStats,
    capacity: {
      scraperSlots: SCRAPER_CONCURRENCY,
      scraperQueueTimeout: 15000,
      // ZERO, e e' o estado esperado desde a decisao 155: o servidor nao tem fonte nenhuma. O
      // motor e' o mesmo, com o mesmo disjuntor e a mesma trava de pedido — so nao ha o que
      // registrar nele.
      scraperSources: engine.size,
      scraperEngine: engine.stats(),
      epg: tvSources.epg.stats(),
      canaisEmMemoria: tvSources.quantosCanaisEmMemoria(),
      rateLimitApi: RATE_LIMIT_MAX,
      rateLimitWindow: RATE_LIMIT_WINDOW / 1000,
    },
    fontes: categoriasDasFontes(),
    // O enxame P2P, reportado pela pagina /tv (decisao 128). Sem isso nao ha como saber se o
    // motor liga: hoje ele nem completa o manifesto com o hls.js atual.
    p2p: resumoP2p(),
    // Quem esta cairdo, e ha quanto tempo a fonte entrega (decisao 129).
    fontesSaude: (() => { const s = saudeDasFontes(); avisarSeMudou(s); return s; })(),
    // Quem ainda esta no padrao do codigo (ver `credenciaisNoAr`): e o que precisa chegar a zero
    // antes de os padroes poderem sair do fonte.
    credenciais: credenciaisNoAr(),
  });
});
app.get(ROTAS.metricas, async (_req, res) => {
  const redisStats = await redis.getStats().catch(() => ({}));
  const sqliteStats = sqliteCache.stats();
  // `relay` sumiu do `/metrics` na decisao 155 junto com o `lib/stream-relay.js`. O resto do
  // formato e' o mesmo de sempre, para nao quebrar quem le estas metricas.
  res.json({ redis: redisStats, sqlite: sqliteStats, pid: process.pid, uptime: Math.floor(process.uptime()) });
});

// Pagina de TV com enxame P2P (mesmo mecanismo do site do embedtv: p2p-media-loader +
// trackers WebTorrent, cada espectador serve pedaco do video para os outros).
// IMPORTANTE: o Stremio NAO toca pagina web — o stream continua sendo o link de video.
// Esta e uma forma a mais de assistir, no navegador.
//   /tv?src=<url do canal>&swarm=<id>   -> a pagina direto
//   /tv?chan=<id do canal>               -> o SERVERS escolhe a fonte e redireciona
//
// O `?chan=` parou de resolver canal na decisao 155: escolher a fonte era `tvSources.getStreams`,
// e as 4 fontes de TV sairam do servidor. A PAGINA continua valendo com `?src=`, que e' o modo
// P2P de verdade (a URL vem do plugin, ja resolvida no aparelho). O `?chan=` responde 404 com a
// razao, em vez de fingir que achou um canal e redirecionar para um link morto.
app.get(ROTAS.tv, async (req, res) => {
  const pagina = path.join(PUBLICO, "tv.html");
  // sem cache: e player de ao vivo, e o express.static serve com maxAge 1d — o navegador
  // ficaria com uma versao antiga da pagina e o repasse da playlist pararia de funcionar
  res.set("Cache-Control", "no-store");
  if (req.query.src) return res.sendFile(pagina);
  const canal = String(req.query.chan || "").trim();
  if (!canal) return res.sendFile(pagina);
  return res.status(404).send("o player de TV vem do plugin do Nuvio; o servidor so entrega o catalogo e a guia");
});

// ── O que e' do MirrorStream responde 404 COM O NOME ──
const SO_DO_MIRRORSTREAM = [/^\/api\/vod\//, /^\/api\/streams\//, /^\/stream\//];
app.use((req, res, next) => {
  if (!SO_DO_MIRRORSTREAM.some((re) => re.test(req.path))) return next();
  res.status(404).json({
    error: "rota do MirrorStream",
    mensagem: "filmes, series e anime sao do MirrorStream, nao do MirrorView"
  });
});

app.get(ROTAS.manifesto, (req, res) => {
  const m = buildManifest(req.params.config);
  res.json({ ...m, logo: absolute("/logo.svg") });
});


// A busca de canais de TV nao pode passar por `catalogFor` do app1: o catalogo montado aqui
// sai do cache em 0,27s, mas a MONTAGEM leva 42s, e cada termo novo e uma chave nova — entao
// toda busca era um cache miss e um 504. Medido em 28/09/2026: `?search=globo`, `?search=sbt` e
// `?search=record` davam 504 no app1 enquanto o cluster de TV respondia as tres em 0,05s.
//
// O cluster e quem tem o catalogo montado e a triagem feita; a rota de busca vai direto pra
// ele, pelo mesmo caminho do catalogo. Sem isso, o app1 refaz 283 canais de triagem por termo
// digitado, e ainda leva o RSS a 330MB fazendo isso.
app.get(ROTAS.catalogoStremio, async (req, res, next) => {
  const ehTv = req.params.type === "tv";
  // `extra.date` = a aba Channel Guide do Stremio. Sem repassar aqui, o guia da TV nao abria
  // no caminho que o cliente USA (`/:config/catalog/...`): MEDIDO em 29/09/2026, a resposta
  // voltava `{metas:[...]}` sem `metasDetailed`, com 0 canais com programa — enquanto a mesma
  // URL sem o `:config` devolvia 279 canais e 131 com programa. So uma das duas rotas tratava
  // a data, e era justamente a que o Stremio nao chama.
  const data = req.query.date || "";
  const temCluster = ehTv && tvSplit.TV_BASE && !tvSplit.ehOProprioClusterDeTv(req);
  if (temCluster) {
    // Com cluster, o app1 DELEGA e nao monta. Nunca cair no `catalogFor` aqui: a montagem
    // local do catalogo de TV leva 127s (triagem de 283 canais nas 3 fontes) e estoura os
    // 12,3s do gateway, entao o cliente levava 504 — foi o sintoma "o catalogo nao carrega".
    //
    // MEDIDO: a rota tinha TRES quedas em sequencia quando o cluster ainda estava aquecendo:
    // a ponte (8s) + um segundo fetch manual (8s) + a montagem local (127s). Qualquer uma
    // delas,junta, dava 504. Agora e uma so, e se ela falhar a resposta e rapida: catalogo
    // velho se existir, senao lista vazia com 200. Vazio e honesto; 504 derruba o addon.
    const servido = await tvSplit.repassaTv(req, res, () => null);
    if (servido !== null) return servido;
    const velho = await cacheGetVelho(catalogKey(req));
    return res.json(montaCatalogo((velho || []), data, "tv"));
  }
  try {
    const search = req.query.search || null;
    const genre = req.query.genre || null;
    const metas = await catalogFor(req.params.id, search, req.params.type, genre, data);
    res.json(montaCatalogo(metas, data, req.params.type));
  } catch (e) {
    console.error(`[catalog] ${e.message}`);
    res.json(data ? { metasDetailed: [] } : { metas: [] });
  }
});

// Mesmo formato das outras duas rotas de catalogo: com `date` a resposta e `metasDetailed`
// (a guia), sem `date` e `metas` (a lista). Trocar o nome da chave quebra o cliente, que
// procura `metasDetailed` para renderizar a grade do dia.
function montaCatalogo(metas, data, tipo) {
  const tipadas = (metas || []).map((m) => ({ ...m, type: m.type || tipo }));
  const corpo = data ? { metasDetailed: tipadas } : { metas: tipadas };
  return { ...corpo, cacheMaxAge: 300, staleRevalidate: 900 };
}

function catalogKey(req) {
  return `${req.params.id}:${req.query.search || ""}:${req.params.type}:${req.query.genre || ""}:${req.query.date || ""}`;
}

app.get(ROTAS.metaStremio, async (req, res) => {
  try {
    const result = await resolveMeta(req.params.type, req.params.id);
    res.json(result);
  } catch (e) { console.error(`[meta] ${e.message}`); res.json({ meta: null }); }
});

// ZERA O CACHE DE TUDO (decisao 134). O dono pediu para resetar o cache de todas as fontes e,
// medido, NAO EXISTIA caminho: as caches vivem dentro do container, sem rota, e a unica forma de
// limpa-las era reiniciar o app — que derruba todo mundo junto.
//
// O que e' apagado, e por que cada coisa conta:
//   - `sqliteCache`: link de stream (15min), catalogo de TV (24h), EPG resolvido, e as chaves de
//     TRIAGEM (`mirror-tv:triagem*`) — e' por aqui que um canal marcado como morto volta a lista;
//   - as caches em memoria do servidor (titulo de anime, meta, geracao do catalogo, qualidade
//     ja sondada, "a origem foi alcancada");
//   - as duas travas de pedido simultaneo (`inflight`), para o proximo pedido ir na origem em vez
//     de esperar a promessa que ja esta em voo;
//   - os DISJUNTORES do motor: sem isso uma fonte que caiu continua "pulada" por 5 min e o reset
//     pareceria nao ter resolvido nada.
//
// O que NAO e' apagado, e deliberado: as caches internas de cada scraper (catalogo de painel em
// memoria). Elas nao tem chave para apagar de fora e expiram em minutos; quem quer zerar tudo de
// verdade reinicia o app, que e' o que o botao de reset nao tenta fazer sozinho.
//
// Portao: o MESMO segredo do `/stream/proxy-check` (derivado do segredo de mascaramento), porque
// isto derruba o cache quente de todo mundo e nao e' um endpoint para ficar aberto.
app.post(ROTAS.limparCache, (req, res) => {
  const exigido = tokenDoDiagnostico();
  const dado = String((req.query && req.query.token) || req.headers["x-proxy-check-token"] || "");
  if (!exigido || !dado || !timingSafeIgual(dado, exigido)) {
    return res.status(403).json({ ok: false, err: "limpar-cache exige o token de diagnostico" });
  }
  // O que o reset CONTA mudou na decisao 155: `provasDeMorte` saiu (a prova de morte da TV era
  // a triagem que chamava `getStreams` das 4 fontes; sem fontes, ninguem prova nada) e no lugar
  // dela entrou `canaisEmMemoria` — que e' o estado que agora importa, porque o `Map` `groups` e
  // o memo `completo` de `core/tv-sources.js` moram em MEMORIA e nao no disco. Zerar o disco
  // sem tocar neles dava "disco 0, memoria 0" com a lista de TV ainda servida do memo velho.
  const estado = () => ({
    disco: sqliteCache.stats(),
    canaisEmMemoria: tvSources.quantosCanaisEmMemoria(),
    emMemoria: animeTitleCache.size + cache.size + geracaoPorChave.size,
    emVoo: inflightStreams.size + inflightCatalogs.size,
    disjuntores: engine.stats().openBreakers.length,
  });
  const antes = estado();
  const apagadasNoDisco = sqliteCache.limpaTudo();
  animeTitleCache.clear();
  cache.clear();
  geracaoPorChave.clear();
  inflightStreams.clear();
  inflightCatalogs.clear();
  refreshingStreams.clear();
  engine.reset();
  // O mesmo caminho que o boot usa: limpar a resposta de catalogo em cache E o mapa de grupos
  // (que andam juntos — ver `tv-sources.js`). Sem isso o catalogo velho continuaria em cache de
  // memoria mesmo com o disco vazio.
  invalidarCatalogoTv();
  const canaisApagados = tvSources.limpaMemoria();
  res.json({
    success: true,
    apagadasNoDisco,
    canaisApagadosDaMemoria: canaisApagados,
    antes,
    depois: estado(),
    aviso: "as caches internas de cada scraper (o catalogo do REI, o XMLTV do guia) nao sao apagadas: expiram em minutos. Para zerar ate elas, reinicie o app.",
  });
});

// P2P: A PAGINA `/tv` MANDA O QUE O ENXAME ESTA FAZENDO (decisao 128). MEDIDO 30/09/2026: o
// motor de P2P da pagina esta LIGADO SO com `?p2p=1` e o comentario do codigo registra que ele
// "nao completa o manifest" com o hls.js atual (1.4/1.5/1.6) — ou seja, hoje nao ha enxame
// rodando em lugar nenhum, e ninguem tem como saber se Passa a passar.
//
// Este endpoint e a MEIRA de saber: a pagina reporta pares e quanto do video veio de peers, e o
// `/health` mostra. Sem ele, "o P2P funciona?" e opiniao. O que entra e CLAMPADO (numeros
// pequenos, nome do canal com no maximo 40 caracteres, mapa com teto) porque o endpoint e
// publico e nao pode ser usado para estourar memoria.
const p2pRelatos = new Map();
const P2P_MAX_CANAIS = 60;
const P2P_TTL_MS = 30 * 60 * 1000;

function numeroOu(v, max) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), max) : 0;
}

// O projeto nao registrava parser de JSON (ninguem usava POST antes do relato do P2P), entao
// `req.body` chegava vazio e o endpoint respondia `ok:false` SEM GUARDAR NADA — media adicionada,
// nenhuma. O limite de 16KB evita que o endpoint publico vire memoria: e o unico POST do app.
app.use(PREFIXOS.p2p, express.json({ limit: "16kb" }));

app.post(ROTAS.p2pRelato, (req, res) => {
  try {
    const corpo = req.body && typeof req.body === "object" ? req.body : {};
    const canal = String(corpo.canal || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    if (!canal) return res.status(400).json({ ok: false });
    const agora = Date.now();
    for (const [k, v] of p2pRelatos) if (agora - v.t > P2P_TTL_MS) p2pRelatos.delete(k);
    p2pRelatos.set(canal, {
      t: agora,
      pares: numeroOu(corpo.pares, 500),
      segmentos: numeroOu(corpo.segmentos, 1000000),
      dePares: numeroOu(corpo.dePares, 1000000),
      erros: numeroOu(corpo.erros, 10000),
      motor: String(corpo.motor || "").slice(0, 40),
    });
    if (p2pRelatos.size > P2P_MAX_CANAIS) {
      const velho = [...p2pRelatos.entries()].sort((a, b) => a[1].t - b[1].t)[0];
      if (velho) p2pRelatos.delete(velho[0]);
    }
    res.json({ success: true });
  } catch (_) {
    res.status(400).json({ success: false });
  }
});

// Resumo do enxame para o `/health`. Vazio = ninguem com a pagina aberta mandou relatorio.
function resumoP2p() {
  const agora = Date.now();
  const saida = [];
  let pares = 0;
  let dePares = 0;
  let segmentos = 0;
  for (const [canal, v] of p2pRelatos) {
    if (agora - v.t > P2P_TTL_MS) continue;
    saida.push({ canal, pares: v.pares, dePares: v.dePares, segmentos: v.segmentos, erros: v.erros, idade: Math.round((agora - v.t) / 1000) });
    pares += v.pares;
    dePares += v.dePares;
    segmentos += v.segmentos;
  }
  saida.sort((a, b) => b.pares - a.pares);
  return {
    canais: saida.length,
    pares,
    segmentos,
    dePares,
    pct: segmentos ? Math.round((dePares / segmentos) * 100) : 0,
    detalhe: saida.slice(0, 10),
  };
}

// AS CREDENCIAIS ESTAO NO AMBIENTE? (decisao 133). O dono pediu para rotacionar o que esta no
// git, e a rotacao e uma acao DELE (conta do painel, conta do TMDB, painel da Cloudflare) —
// nao existe caminho pelo codigo. O que existe e MEDIR o estado, para nao ser opiniao:
//
//   - o registro unico marca quais variaveis carregam credencial (`segredo: true`), e um teste
//     falha se alguem criar uma variavel com cara de credencial e nao marcar;
//   - o `/health` diz, de cada uma, `definida` ou `ausente` — NUNCA o valor, nem o começo dele.
//
// Ausente significa "o codigo esta usando o padrao que esta escrito no proprio fonte", que e o
// que mantem os paineis funcionando em producao (o Dockerfile nao tem nenhuma delas). Tirar o
// padrao so pode ser feito DEPOIS que a variavel existir no ambiente — e essa e a ordem.
function credenciaisNoAr() {
  const saida = [];
  let ausentes = 0;
  for (const [nome, meta] of Object.entries(VARIAVEIS)) {
    if (!meta || !meta.segredo) continue;
    const definida = !!String(ENV[nome] || "").trim();
    if (!definida) ausentes++;
    // "ausente no ambiente" e o que vale para TODAS. O que isso significa muda de variavel
    // para variavel, e o texto tentava mentir para as tres em que nao e verdade:
    //   - IPTV_*/XTREAM_*/TMDB_API_KEY/PROXY_SECRET: o codigo esta usando o PADRAO do fonte;
    //   - PROXY_CHECK_TOKEN: a rota de diagnostico fica FECHADA (e o token derivado continua
    //     funcionando para quem tem o segredo de mascaramento);
    //   - ALERT_WEBHOOK_URL: so existe o resumo no /health, sem aviso externo.
    saida.push({ nome, estado: definida ? "definida" : "ausente no ambiente" });
  }
  return { total: saida.length, ausentes, credenciais: saida };
}

// ALERTA DE FONTE CAIDA. MEDIDO na auditoria de 30/09/2026: o `/health` e o `/metrics`
// mostravam CONTADORES, e naohavia ninguem avisado quando uma fonte parava de entregar. O dono
// sodescobria pelo relato de quem nao achou o episodio.
//
// O motor ja guarda o necessario por fonte (`lastOk`, `lastError`, `fails`, `openUntil`), e a
// distincao que importa e esta aqui, medida pelo comportamento do motor:
//   caido      = disjuntor aberto (3 falhas -> 5 min sem ser chamada) E sem sucesso recente
//   degradado  = errou, mas ainda nao abriu o disjuntor (pode ser so uma falha)
//   ok         = entregou nos ultimos 30 min (ou ainda nunca foi chamada: nao e evidencia de
//                defeito — uma fonte que ninguem pediu nao pode ser declarada quebrada)
// `tempoEsgotado` NAO conta como queda: o motor ja trata timeout como "fonte lenta", e tratou
// como falha tirava a fonte da lista por 5 min mesmo ela entregando.
const SAUDE_OK_MS = 30 * 60 * 1000;

function estadoDaFonte(id, v) {
  const agora = Date.now();
  const abriu = !!v.open;
  const ultimoOk = Number(v.lastOk) || 0;
  const erroCausaTimeout = /timeout|tempo esgotado/i.test(String(v.lastError || ""));
  if (abriu && (!ultimoOk || agora - ultimoOk > SAUDE_OK_MS)) {
    return { estado: "caido", erro: erroCausaTimeout ? null : v.lastError || null, ultimoOk };
  }
  if (v.fails > 0 && erroCausaTimeout) return { estado: "degradado", erro: null, ultimoOk };
  if (v.fails > 0 || v.lastError) return { estado: "degradado", erro: v.lastError || null, ultimoOk };
  if (ultimoOk && agora - ultimoOk > SAUDE_OK_MS) return { estado: "parado", erro: null, ultimoOk };
  return { estado: "ok", erro: null, ultimoOk };
}

function saudeDasFontes() {
  const st = engine.stats();
  const lista = [];
  for (const [id, v] of Object.entries(st.sources || {})) {
    const e = estadoDaFonte(id, v);
    lista.push({
      fonte: id,
      estado: e.estado,
      erro: e.erro,
      ultimoOk: e.ultimoOk || 0,
      segundosDaUltimaEntrega: e.ultimoOk ? Math.round((Date.now() - e.ultimoOk) / 1000) : null,
      chamadas: v.calls || 0,
      falhas: v.failed || 0,
      disjuntorAberto: !!v.open,
    });
  }
  const ordem = { caido: 0, degradado: 1, parado: 2, ok: 3 };
  lista.sort((a, b) => ordem[a.estado] - ordem[b.estado] || (b.falhas - a.falhas));
  return {
    total: lista.length,
    caidas: lista.filter((f) => f.estado === "caido").length,
    degradadas: lista.filter((f) => f.estado === "degradado").length,
    disjuntoresAbertos: (st.openBreakers || []).length,
    fontes: lista,
  };
}

// O AVISO. Sem `ALERT_WEBHOOK_URL` no ambiente nada sai do servidor (o dono nao tem onde
// receber), mas o resumo continua no `/health`. Com a variavel, avisa so na TRANSIICAO
// (ok -> caido, e a volta), nunca a cada requisicao, e nao repete o mesmo alerta por 30 min.
const estadoAnterior = new Map();
const ALERTA_REPETIR_MS = 30 * 60 * 1000;

function avisarSeMudou(saude) {
  const url = String(ENV.ALERT_WEBHOOK_URL || "");
  if (!url) return;
  for (const f of saude.fontes) {
    const antes = estadoAnterior.get(f.fonte) || "ok";
    estadoAnterior.set(f.fonte, f.estado);
    if (f.estado === "caido" && antes !== "caido") {
      mandarAlerta(`fonte ${f.fonte} CAIDA`, f);
    } else if (f.estado === "ok" && antes === "caido") {
      mandarAlerta(`fonte ${f.fonte} voltou`, f);
    }
  }
}

function mandarAlerta(titulo, f) {
  const url = String(ENV.ALERT_WEBHOOK_URL || "");
  if (!url) return;
  const chave = `${titulo}:${f.fonte}`;
  const agora = Date.now();
  if (estadoAnterior.get("alert:" + chave) && agora - estadoAnterior.get("alert:" + chave) < ALERTA_REPETIR_MS) return;
  estadoAnterior.set("alert:" + chave, agora);
  const texto = `MirrorView — ${titulo}${f.erro ? ` (${f.erro})` : ""}`;
  browserFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: texto,
      fonte: f.fonte,
      estado: f.estado,
      erro: f.erro,
      ultimoOk: f.ultimoOk,
      chamadas: f.chamadas,
      falhas: f.falhas,
    }),
    timeout: 8000,
  }).catch(() => {});
}

// O TOKEN DO DIAGNOSTICO — o que abre o `/admin/limpar-cache` (e, antes da decisao 155, o
// `/stream/proxy-check`).
//
// MEDIDO na auditoria de 30/09/2026: em PRODUCAO o proxy era um endpoint aberto, sem credencial
// nenhuma — bloqueava IP privado (SSRF ok), mas qualquer pessoa mandava o servidor buscar
// qualquer URL e gastava a cota do dono. Por isso ele virou FERRAMENTA DE DIAGNOSTICO: sem
// token, responde 403 e nao faz nada. O token e' comparado em tempo constante.
//
// O token aceito e' o `PROXY_CHECK_TOKEN` do ambiente quando ele existe — e' o jeito de trocar
// o valor sem mexer em codigo. Sem ele, sai do `PROXY_SECRET` (mesmo segredo que assinava a
// mascara de stream, que saiu na 155) passado por SHA-256 e cortado: assim o diagnostico
// funciona em qualquer ambiente sem ninguem precisar cadastrar variavel, e o valor nunca fica
// no git.
const SEGREDO_PADRAO_DO_DIAGNOSTICO = "mirror-proxy-v1-9f4c1a7e";
function tokenDoDiagnostico() {
  if (ENV.PROXY_CHECK_TOKEN) return String(ENV.PROXY_CHECK_TOKEN);
  const segredo = ENV.PROXY_SECRET || SEGREDO_PADRAO_DO_DIAGNOSTICO;
  return crypto.createHash("sha256").update(String(segredo)).digest("hex").slice(0, 32);
}

// O QUE ESTA AQUI ANTES, E O QUE SAIU NA DECISAO 155.
//
// Tres rotas que so existiam para servir video, com os dois arquivos que elas usavam
// (`lib/proxy.js` e `lib/stream-relay.js`, ambos apagados):
//
//   * `/stream/proxy` e `/stream/proxy.m3u8` - o proxy que rebaixava o link de VOD por
//     `MASK_STREAMS` (decisao 49), com o resgate de `originReachable` (302 quando o servidor
//     nao alcanca a origem) e o worker como segunda opcao. Sem fonte de VOD no servidor
//     (decisao 154) nao havia link para rebaixar; e sem relay (decisao 155) nao havia para onde.
//   * `/stream/hls/:file` - o relay de TV: `etc:` reescrevia a playlist para o `/seg/etc/*`,
//     `rei:` buscava o `__index.txt` e o servia como `application/vnd.apple.mpegurl` com token
//     novo a cada pedido (decisao 111), e o ramo generico usava `tvSources.resolvePlaylist`
//     (decisao 139/140). As tres fontes sairam do servidor.
//   * `/stream/proxy-check` - a ferramenta de diagnostico "busque esta URL e me diga o status".
//     Ela vivia em cima de `resolveRedirects` (do `stream-relay`) e era o lugar onde se media
//     se a WAF de uma origem barrava o servidor. Sem relay, ela nao tem o que medir: o player
//     agora sai do APARELHO, do IP residencial de quem assiste, e nao deste servidor.
//
// O TOKEN do diagnostico ficou (`tokenDoDiagnostico`) porque ele e' o que protege o
// `/admin/limpar-cache`, que continua valendo.
// A VOX ORACLE SAIU DO CAMINHO (29/09/2026).
//
// Estas duas rotas (/api/tv/token e /api/tv/estado) e o `lib/tv-token.js` inteiro eram do KAK —
// o painel de live do kakito, que saiu da TV ao vivo na decisao 108. O que restava deles era
// RENOVAR O TOKEN desse painel a cada 5 minutos batendo na maquina do dono (o relay BR, que era
// o DEFAULT do codigo). Medido na producao antes de remover: `/api/tv/estado` respondia
// `token:true, idadeSeg:196, listasNoCache:0, verificados:{ok:0, total:0}` — ou seja, a VPS
// era chamada sem nenhuma troca util, e o proprio modulo confirmava que nao tinha lista nem
// canal verificado. O RTD nao usa a VPS (verificado no `redetoons.js`), entao ela nao servia
// para mais nada.
//
// O dono pediu para ficar so com BeamUp + Cloudflare (worker). A VPS foi desligada no mesmo dia.
// Um teste em `test/timers.test.js` falha se o endereco, o nome do relay ou a pasta dele voltarem.

// --- API publica de catalogo (decisao 110) -----------------------------------
// Mesmo formato do /api/channels do reidosembeds, que eu medi: catalogo SEPARADO do video,
// em JSON estatico e barato, e o video so e procurado por quem abre um canal. Eles listam
// 327 canais assim e o catalogo custa quase nada para servir.
//
// A diferenca de la para ca e a origem do "no ar agora": o deles vem da API deles, o nosso
// vem da EPG que a gente ja baixa (epg.pw + guia do reidosembeds, decisoes 55/56 e 64). Entao
// o now_playing_progress e um PERCENTUAL REAL, calculado do epoch do programa, nao estimado.
function agoraDeEpg(nome) {
  try {
    const lista = tvSources.epg.buscarPorChave(nome);
    if (!lista || !lista.length) return null;
    const agora = Math.floor(Date.now() / 1000);
    for (const p of lista) {
      if (p[1] <= agora && agora < p[2]) {
        const total = Math.max(1, p[2] - p[1]);
        return { titulo: p[0], progresso: Math.min(100, Math.round(((agora - p[1]) / total) * 100)) };
      }
    }
  } catch (_) { return null; }
  return null;
}

function paraApiCanal(meta, base) {
  const id = String(meta.id || "").replace(/^tv:live:/, "");
  const noAr = agoraDeEpg(meta.name);
  const logo = meta.poster || "";
  const previa = meta.background || "";
  return {
    id,
    name: meta.name || id,
    description: String(meta.description || "").split("\n")[0] || "",
    logo_url: logo,
    preview_url: previa,
    category: (meta.genres && meta.genres[0]) || "Geral",
    is_active: true,
    now_playing_title: noAr ? noAr.titulo : "",
    now_playing_progress: noAr ? noAr.progresso : 0,
    now_playing_has_gui: !!noAr,
    stream_url: `${base}/stream/tv/tv:live:${encodeURIComponent(id)}.json`,
  };
}

// As rotas de catalogo de TV vao direto para o cluster pelo mesmo motivo do catalogo: montar
// aqui custa 42s por termo de busca e leva o RSS a 330MB. `/api/channels` e
// `/api/channels/categories` leem do catalogo montado, entao valem o mesmo desvio.
function tvComConsulta(req) {
  if (req.path.startsWith("/api/channels")) return true;
  if (req.path.includes("/catalog/tv/")) {
    return !!(req.query.search || req.query.genre);
  }
  return false;
}

app.get(ROTAS.api.canaisCategorias, async (req, res, next) => {
  if (tvSplit.TV_BASE && tvComConsulta(req) && !tvSplit.ehOProprioClusterDeTv(req)) {
    return tvSplit.repassaTv(req, res, next);
  }
  try {
    const metas = await catalogFor("mirror-tv-live", null, "tv", null, "");
    const cont = new Map();
    for (const m of metas) {
      const c = (m.genres && m.genres[0]) || "Geral";
      cont.set(c, (cont.get(c) || 0) + 1);
    }
    const data = [...cont.entries()].sort((a, b) => b[1] - a[1]).map(([nome, total]) => ({ id: tvSources.normKey(nome), name: nome, channels: total }));
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get(ROTAS.api.canais, async (req, res, next) => {
  if (tvSplit.TV_BASE && tvComConsulta(req) && !tvSplit.ehOProprioClusterDeTv(req)) {
    return tvSplit.repassaTv(req, res, next);
  }
  try {
    const base = basePublica(req);
    const busca = req.query.search || req.query.q || null;
    const cat = req.query.category || req.query.genre || null;
    const metas = await catalogFor("mirror-tv-live", busca, "tv", cat, "");
    res.json({ success: true, data: metas.map((m) => paraApiCanal(m, base)) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get(ROTAS.api.canal, async (req, res) => {
  try {
    const base = basePublica(req);
    const id = String(req.params.slug || "").replace(/^tv:live:/, "");
    const metas = await catalogFor("mirror-tv-live", null, "tv", null, "");
    const achou = metas.find((m) => String(m.id || "").replace(/^tv:live:/, "") === id);
    if (!achou) return res.status(404).json({ success: false, error: "channel not found" });
    res.json({ success: true, data: paraApiCanal(achou, base) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============ API de VOD (filmes e séries) ============
// Mesmo formato da de TV ({success, data}) para o chamador tratar tudo igual. A de TV ja
// existia (decisao 110); esta completa o lado de VOD — antes nao havia nenhuma forma de
// buscar filme/série no Mirror sem falar com o TMDB direto.



// Detalhe: `type` = movie | series | tv. A série ja vem com TODOS os episódios em `videos`,
// com o id já no formato que a rota de stream aceita (`tmdb:<id>:<temp>:<ep>`).

// Streams UNIFICADOS: um endpoint só para filme, série e TV ao vivo — é o que simplifica as
// chamadas (antes cada tipo tinha o seu formato de id e o seu caminho).

// `/stream/hls/:file` — O RELAY DE TV. SAIU NA DECISAO 155.
//
// Esta rota entregava a playlist do canal (decisao 111): o ramo `etc:` reescrevia cada
// segmento para `/seg/etc/*` porque a CDN da ETC exige um `Referer` que so servidor injeta,
// o ramo `rei:` buscava o `__index.txt` e o servia como `application/vnd.apple.mpegurl` (o
// player nao reconhece `text/plain`, e o token deles vale 300s — cada ida do player passava
// por aqui de novo para ganhar token novo), e o ramo generico escolhia a fonte que
// PROVAVA a playlist, nao a que so existia (decisao 139).
//
// Nenhuma dessas tres fontes esta mais no servidor. O player de TV agora e' do plugin,
// e ele resolve a playlist no aparelho.

app.get(ROTAS.redireciona, async (req, res) => {
  const url = String(req.query.url || "");
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    const probe = new URL(url);
    if (/^127\.|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^0\.|^169\.254\.|^localhost$|^\[::1\]$/i.test(probe.hostname)) {
      return res.status(403).json({ error: "private ip blocked" });
    }
  } catch (_) {
    return res.status(400).json({ error: "invalid url" });
  }
  try {
    const resolved = await resolveMultiUrl(url);
    if (resolved) {
      res.json({ url: resolved, original: url });
    } else {
      res.status(404).json({ error: "could not resolve", url });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

process.on("uncaughtException", (e) => { console.error(`[fatal] uncaughtException: ${e.message}`); setTimeout(() => process.exit(1), 1000); });
process.on("unhandledRejection", (e) => { console.error(`[fatal] unhandledRejection: ${e?.message || e}`); });

const sdkRouter = getRouter(builder.getInterface());
app.get(ROTAS.raiz, (_req, res) => res.redirect(301, "/install"));

app.get(ROTAS.catalogoRaiz, async (req, res) => {
  try {
    const search = req.query.search || null;
    const genre = req.query.genre || null;
    const data = req.query.date || "";
    const metas = await catalogFor(req.params.id, search, req.params.type, genre, data);
    const tipadas = metas.map(m => ({ ...m, type: m.type || req.params.type }));
    if (data) return res.json({ metasDetailed: tipadas, cacheMaxAge: 300, staleRevalidate: 900 });
    res.json({ metas: tipadas, cacheMaxAge: 300, staleRevalidate: 900 });
  } catch (e) { console.error(`[catalog] ${e.message}`); res.json({ metas: [] }); }
});

app.use(ROTAS.raiz, sdkRouter);

app.use((err, _req, res, _next) => {
  console.error(`[express] ${err.message}`);
  if (!res.headersSent) res.status(500).json({ streams: [], error: err.message });
});

// O AQUECIMENTO DE STREAMS DE TV SAIU NA DECISAO 155.
//
// Ele existia (decisao 111) porque o stream era o caminho caro: ~10s por canal, porque a EMB
// nao tem cache proprio, a ETC guardava so a playlist e o REI so a URL. Aquecer 70 canais por
// FAMILIA (Globo/SBT/Record/Band, Sportv/ESPN, CNN, HBO/Star/TNT) fazia o primeiro clique ser
// instantaneo — e rodava tambem no app1 de proposito, porque era a cache dele que o
// `repassaTv` usava quando o cluster de TV nao respondia a tempo.
//
// Nao ha mais o que aquecer: o servidor nao resolve stream de TV. `handleStreams` responde
// `{streams: []}` sem tocar em origem nenhuma, e o player vem do plugin, no aparelho.
// O que continua aquecido e' o CATALOGO (uma leitura de 256KB na API do REI) e o GUIA.
//

// TEMPOS DE SOCKET. O padrao do Node (5s de keep-alive, 0 requisicoes por socket) segura
// conexoes vivas e buffers de socket na RAM, e RSS alto foi o que matou o processo tres vezes
// num dia (medido 28/09/2026, ver o guard de memoria no fim). Um teto de requisicoes por
// socket devolve o buffer ao SO em vez de reaproveitar a conexao para sempre.
const KEEPALIVE_MS = Number(ENV.HTTP_KEEPALIVE_MS || 5000);
const HEADERS_MS = Number(ENV.HTTP_HEADERS_TIMEOUT_MS || 10000);
const REQ_POR_SOCKET = Number(ENV.HTTP_MAX_REQS_PER_SOCKET || 200);

const httpServer = app.listen(PORT, "0.0.0.0", () => {
  httpServer.keepAliveTimeout = KEEPALIVE_MS;
  httpServer.headersTimeout = HEADERS_MS;
  httpServer.requestTimeout = Math.max(HEADERS_MS, 20000);
  httpServer.maxRequestsPerSocket = REQ_POR_SOCKET;
  if (tvSplit.TV_BASE) console.log(`[split] TV vai para: ${tvSplit.TV_BASE}`);
  console.log(`[Mirror] listening on :${PORT}`);
  // O catalogo e o mapa de grupos andam juntos: quando a lista muda, o cache do servidor
  // precisa repropagar. E' o gancho que a 125 introduced para a triagem; depois da 155 ele
  // avisa so quando a COMPOSICAO da lista muda.
  tvSources.setCacheInvalidator(invalidarCatalogoTv);
  aqueceTv();
  aqueceGuiaDeTv();
  // DECISAO 155: o aquecimento de STREAMS saiu (ele chamava `handleStreams("tv", ...)`), e o de
  // VOD saiu na 154 (`kakito.preloadPlaylist` + `xtream.preloadLists`). O que fica e' o
  // catalogo (uma leitura de 256KB na API do REI) e o guia (o XMLTV).
  console.log(`[split] catalogo e guia: ${engine.size} fonte(s) de player no motor — os players vem do plugin`);

  // ============ GUARD DE MEMORIA (RSS, nao heap) ============
  // Medido em 28/09/2026 na prod: `rss=295MB, heap=77MB, external=27MB` no app1 e
  // `[memory] HIGH: 60MB heap, 222MB RSS` no cluster de TV. O processo morria com
  // `FATAL ERROR: Reached heap limit` TRES vezes num dia (10:59, 12:20, 13:41) — e o
  // sintoma era o oposto do que a mensagem sugere: o heap tinha folga e o RSS nao.
  //
  // Por que: o Node segura memoria FORA do heap (buffers de rede, sockets, o `external`),
  // e `global.gc()` nao devolve isso ao sistema — ele recolhe o que o coletor de lixo
  // alcança, e buffers de socket so somem quando a conexao fecha. Entao o `cleanup`
  // antigo (que so agia com `heapUsed > 128`) nunca disparava: o heap ficava em 77MB e
  // o container estourava em 222MB. Duas correcoes: (1) o gatilho passa a ser o RSS, que
  // e o numero que estoura o container; (2) o intervalo cai de 60s para 10s, porque entre
  // duas passagens o servidor aceita muitas conexcoes e nao dava tempo de recuperar.
  //
  // O que o `gc` resolve de verdade: puxa o heap para baixo para o proximo `fetch` ter
  // folga. O que NAO resolve: RSS alto por sockets abertos. Por isso o aviso mantem o
  // numero — e ver o RSS subindo e o sinal de que o gargalo esta na concorrencia, nao no
  // cache (ver `/health -> memory`).
  // REGRA QUE A PRIMEIRA VERSAO QUEBROU: sob pressao de memoria, NUNCA descartar a entrada
  // cara. O catalogo de TV era apagado a cada 10s porque o RSS ficava acima do teto (RSS alto
  // vem de socket e do `heapTotal` do V8, que o `gc` nao devolve) — e como o catalogo levava
  // 127s para remontar, dava cache zerada em ciclo (`[memory] HIGH: 330MB RSS, 0 entradas`) e
  // catalogo nunca pronto, com 504 no cliente. O despejo nao baixava a pressao, entao repetia
  // a cada rodada sem ajudar. Agora: gc sempre, despejo de pressao so 1/4 da cache e sem as
  // entradas caras (`chaveCara`).
  const cleanup = () => {
    // `global.gc` NUNCA EXISTE em producao (medido 01/10/2026): `--expose-gc` nao e permitido em
    // NODE_OPTIONS, entao a linha antiga era decoracao — o cleanup rodava a cada 30s sem coletar
    // nada. Agora a coleta e real (`lib/memoria.js`).
    memoria.gcSeForcar();
    const mem = process.memoryUsage();
    const usedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    if (rssMB > LIMITE_RSS_MB) {
      const antes = cache.size;
      const removidos = cacheEvictIfNeeded(true);
      console.warn(`[memory] HIGH: ${usedMB}MB heap, ${rssMB}MB RSS, ${antes} entradas, ${removidos} descartadas (${cache.size} restantes)`);
      memoria.gcSeForcar();
    }
    const removed = sqliteCache.cleanup();
    const st = sqliteCache.stats();
    if (removed > 0) console.log(`[cache] cleaned ${removed} (${st.total} remaining, ${usedMB}MB heap)`);
  };

  setInterval(cleanup, 30 * 1000).unref();
  cleanup();
});
function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} received, draining...`);
  const finish = () => {
    try { sqliteCache.close(); } catch (e) {}
    process.exit(0);
  };
  httpServer.close(finish);
  setTimeout(finish, 60000).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
