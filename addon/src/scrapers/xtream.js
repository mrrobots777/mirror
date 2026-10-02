const { ENV, workerDe } = require("../core/nomes");
const { browserFetch, makeCache, extractQuality, MAX_CATALOG_BYTES } = require("../lib/scraper-utils");
const { matchKey, matchScore, matchVodTitle, preFiltra, adjustScoreForYear, extractYear } = require("../lib/match");
const catalogoPaineis = require("../lib/catalogo-paineis");
const memoria = require("../lib/memoria");
const { stripYear } = require("../lib/text");
const { makeHttpStream, vodTitle } = require("../lib/stream");
const { UA } = require("../lib/ua");
const { parseMp4Codec } = require("../lib/mp4-codec");

function getPanels() {
  const panels = [];
  // decisao 124: o worker e POR FONTE. O `proxy` de cada painel e o worker da fonte dele
  // (BLZ -> mirror-blz, SPC -> mirror-spc, ATO -> mirror-ato), com o generico como reserva.
  // `workerDe` vem do registro unico (`core/nomes.js`) — antes passava pelo `getCdnProxy` do
  // `lib/proxy.js`, que foi apagado na decisao 155; a expressao e' a mesma.
  const base = (fonte) => workerDe(fonte);

  panels.push({
    name: "Blaze",
    sourceKey: "blz",
    fantasyName: "Blaze",
    server: ENV.IPTV_SERVER || "kakito.xyz",
    username: ENV.IPTV_USERNAME || "MirrorPrincipal",
    password: ENV.IPTV_PASSWORD || "ditj7j1h",
    port: ENV.IPTV_PORT || "443",
    hasEpisodes: true,
    proxy: ENV.BLAZE_PROXY || base("blz"),
  });

  panels.push({
    name: "Space",
    sourceKey: "spc",
    fantasyName: "Space",
    server: ENV.XTREAM_SPACE_SERVER || "telaplay93.top",
    username: ENV.XTREAM_SPACE_USER || "LuizDavi@",
    password: ENV.XTREAM_SPACE_PASS || "fBkvnKe5Mq",
    port: ENV.XTREAM_SPACE_PORT || "80",
    hasEpisodes: true,
    proxy: ENV.SPACE_PROXY || base("spc"),
  });

  panels.push({
    name: "Autos",
    sourceKey: "ato",
    fantasyName: "Autos",
    server: ENV.XTREAM_AUTOS_SERVER || "4x4u29c.autos",
    username: ENV.XTREAM_AUTOS_USER || "216873",
    password: ENV.XTREAM_AUTOS_PASS || "epvnNH",
    port: ENV.XTREAM_AUTOS_PORT || "80",
    hasEpisodes: true,
    proxy: ENV.XTREAM_AUTOS_PROXY || base("ato"),
    wrapVideo: true,
    // O link direto nao funciona neste painel: ele barra a origem do worker e devolve 0 bytes
    // para quem tenta pelo link cru. Vai sempre pelo proxy do app.
    sempreEmbrulhar: ENV.XTREAM_AUTOS_SEMPRE !== "0",
  });

  if (ENV.XTREAM_EXTRA1_USER) {
    panels.push({
      name: ENV.XTREAM_EXTRA1_NAME || "Extra1",
      sourceKey: ENV.XTREAM_EXTRA1_SOURCE || "blz",
      fantasyName: ENV.XTREAM_EXTRA1_NAME || "Extra1",
      server: ENV.XTREAM_EXTRA1_SERVER || "localhost",
      username: ENV.XTREAM_EXTRA1_USER,
      password: ENV.XTREAM_EXTRA1_PASS || "",
      port: ENV.XTREAM_EXTRA1_PORT || "80",
      hasEpisodes: ENV.XTREAM_EXTRA1_EPISODES === "true",
      proxy: ENV.XTREAM_EXTRA1_PROXY || base(ENV.XTREAM_EXTRA1_SOURCE || "blz"),
    });
  }

  if (ENV.XTREAM_EXTRA2_USER) {
    panels.push({
      name: ENV.XTREAM_EXTRA2_NAME || "Extra2",
      sourceKey: ENV.XTREAM_EXTRA2_SOURCE || "blz",
      fantasyName: ENV.XTREAM_EXTRA2_NAME || "Extra2",
      server: ENV.XTREAM_EXTRA2_SERVER || "localhost",
      username: ENV.XTREAM_EXTRA2_USER,
      password: ENV.XTREAM_EXTRA2_PASS || "",
      port: ENV.XTREAM_EXTRA2_PORT || "80",
      hasEpisodes: ENV.XTREAM_EXTRA2_EPISODES === "true",
      proxy: ENV.XTREAM_EXTRA2_PROXY || base(ENV.XTREAM_EXTRA2_SOURCE || "blz"),
    });
  }

  return panels;
}

const vodCache = makeCache(20, 60 * 60 * 1000);
const seriesCache = makeCache(20, 60 * 60 * 1000);
const episodesCache = makeCache(100, 30 * 60 * 1000);
const inflightLists = new Map();

function singleFlight(key, fn) {
  if (inflightLists.has(key)) return inflightLists.get(key);
  const p = fn().finally(() => inflightLists.delete(key));
  inflightLists.set(key, p);
  return p;
}

function filterConfirmedYear(scored, title, year) {
  const y = Number(year) || 0;
  if (!y) return scored;
  const confirmed = scored.filter(s => extractYear(s.item.name, title) === y);
  return confirmed.length ? confirmed : scored;
}

const probeCache = makeCache(300, 10 * 60 * 1000);
const PROBE_UNKNOWN = { unknown: true };
const PROBE_MAYBE = { unknown: "series" };
const seriesProbeCache = makeCache(300, 5 * 60 * 1000);

function parseMp4Duration(buf) {
  if (!buf || buf.length < 64) return 0;
  const moovAt = buf.indexOf("moov");
  if (moovAt < 4) return 0;
  let idx = buf.indexOf("mvhd", moovAt + 4);
  while (idx !== -1) {
    if (idx >= 4 && idx + 28 <= buf.length) {
      const boxSize = buf.readUInt32BE(idx - 4);
      if (boxSize >= 32 && boxSize <= 4096) {
        const version = buf[idx + 4];
        let timescale = 0;
        let duration = 0;
        if (version === 1 && idx + 36 <= buf.length) {
          timescale = buf.readUInt32BE(idx + 24);
          duration = Number(buf.readBigUInt64BE(idx + 28));
        } else if (version === 0) {
          timescale = buf.readUInt32BE(idx + 16);
          duration = buf.readUInt32BE(idx + 20);
        }
        if (timescale > 0 && timescale <= 1000000 && duration > 0) {
          const seconds = duration / timescale;
          if (seconds >= 60 && seconds <= 72000) return seconds;
        }
      }
    }
    idx = buf.indexOf("mvhd", idx + 4);
  }
  return 0;
}

async function probeOnce(url, needDuration) {
  try {
    const res = await browserFetch(url, { timeout: 3000, headers: { Range: "bytes=0-262143" }, maxBody: 1024 * 1024, peekBytes: 262144 });
    if (res.status === 400 || res.status === 403 || res.status === 404 || res.status === 410) return { alive: false, size: 0, durationSec: 0 };
    if (res.status !== 206 && res.status !== 200) return null;
    if (/text\/html/i.test(String(res.headers.get("content-type") || ""))) return { alive: false, size: 0, durationSec: 0 };
    let size = 0;
    const contentRange = res.headers.get("content-range") || "";
    const totalMatch = contentRange.match(/\/(\d+)\s*$/);
    if (totalMatch) size = Number(totalMatch[1]);
    const contentLength = Number(res.headers.get("content-length")) || 0;
    let durationSec = 0;
    let codec = null;
    // O `peekBytes` resolve o caso medido do painel que ignora `Range`: mesmo devolvendo 200 com
    // o arquivo inteiro, lemos os 256KB do comeco e pegamos duracao E codec. Sem isso, nos
    // arquivos de 1GB a sonda nunca tinha cabecalho — e sem cabecalho nao ha como saber que o
    // video e H.265 (a causa da tela branca com barulho, medida em 3 de 23 arquivos).
    if (res.status === 206 || (res.status === 200 && contentLength <= 524288) || contentLength > 524288) {
      const buf = await res.buffer();
      if (res.status === 200 && !size) size = buf.length;
      durationSec = parseMp4Duration(buf);
      codec = parseMp4Codec(buf);
      if (codec) codec = codec.codec;
      if (!durationSec && needDuration && res.status === 206 && size > 262144 && /\.mp4(\?|$)/i.test(url)) {
        const start = Math.max(0, size - 524288);
        try {
          const tail = await browserFetch(url, { timeout: 3000, headers: { Range: `bytes=${start}-${size - 1}` } });
          const tailLength = Number(tail.headers.get("content-length")) || 0;
          if ((tail.status === 206 || tail.status === 200) && tailLength > 0 && tailLength <= 524288) {
            durationSec = parseMp4Duration(await tail.buffer());
          }
        } catch (_) {}
      }
    } else if (res.status === 200 && contentLength > 0) {
      size = contentLength;
    }
    return { alive: true, size, durationSec, codec };
  } catch (_) {
    return null;
  }
}

async function probeVodFile(url, needDuration) {
  const key = `${needDuration ? "d" : "s"}:${url}`;
  const cached = probeCache.get(key);
  if (cached !== null) return cached === PROBE_UNKNOWN ? { alive: null, size: 0, durationSec: 0 } : cached;
  return singleFlight(`probe_${key}`, async () => {
    let out = await probeOnce(url, needDuration);
    if (out && out.alive === false) {
      await new Promise(resolve => setTimeout(resolve, 400));
      out = await probeOnce(url, needDuration);
    }
    if (out) probeCache.set(key, out);
    else {
      probeCache.set(key, PROBE_UNKNOWN, 60 * 1000);
      out = { alive: null, size: 0, durationSec: 0 };
    }
    return out;
  });
}

function applyProbeFilters(candidates, runtimeSec) {
  if (!candidates.length) return candidates;
  const vivos = candidates.filter(c => !c.probe || c.probe.alive !== false);
  if (!vivos.length) {
    // Todos os candidatos foram julgados EXPLICITAMENTE mortos. Antes o codigo mantinha os
    // mortos de proposito (o painel pode recusar Range e a sonda se enganar), mas o preco era
    // link quebrado na lista: em 29/09/2026 o ffmpeg confirmou 0 frames em links que a sonda
    // ja tinha marcado `alive:false`. A regra do dono: fonte que nao toca no 1o play nao entra.
    //
    // A distincao que importa: "a sonda NAO soube" (probe === null, painel sem Range) e
    // diferente de "a sonda disse que morreu". Sem prova nao ha como condenar, entao mantemos.
    const todosCondenados = candidates.every(c => c.probe && c.probe.alive === false);
    if (todosCondenados) return [];
    return candidates;
  }
  let list = vivos;
  // CODEC: nem todo arquivo toca em todo aparelho. H.265 (HEVC), VP9 e AV1 sao Codec que o
  // celular/TV antigo NAO decodifica — e o sintoma e exatamente o que o dono reportou: TELA
  // BRANCA e um BARULHO ENSURDECEDOR (a tela some porque o video nao abre e o audio continua,
  // reinterpretado na taxa errada). MEDIDO em 29/09/2026: 3 de 23 arquivos de painel eram
  // H.265. O codec e lido do MESMO buffer que a sonda ja usava para a duracao
  // (`lib/mp4-codec.js`), entao nao custa uma requisicao a mais.
  //
  // A regra e simples e previsivel: havendo UM H.264 na lista, e ele que fica. Se TODOS forem de
  // codec fechado, todos ficam — aparelho novo decodifica, e melhor um link que funciona na
  // maioria do que nenhum link. Codec desconhecido NAO e letrao (seria condenar sem prova).
  const comH264 = list.some((c) => c.probe && c.probe.codec === "h264");
  if (comH264) {
    const soH264 = list.filter((c) => !c.probe || !c.probe.codec || c.probe.codec === "h264");
    if (soH264.length) {
      for (const c of list) {
        if (c.probe && c.probe.codec && c.probe.codec !== "h264") c.descartado = `codec ${c.probe.codec}`;
      }
      list = soH264;
    }
  }

  const seen = new Set();
  list = list.filter(c => {
    const size = c.probe && c.probe.size;
    if (!size || size < 1048576) return true;
    if (seen.has(size)) return false;
    seen.add(size);
    return true;
  });
  if (runtimeSec > 0) {
    const tolerance = Math.max(300, runtimeSec * 0.08);
    const matched = list.filter(c => c.probe && c.probe.durationSec > 0 && Math.abs(c.probe.durationSec - runtimeSec) <= tolerance);
    if (matched.length) list = matched;
  }
  return list;
}

function buildApiBase(panel) {
  const proto = String(panel.port) === "80" ? "http" : "https";
  return `${proto}://${panel.server}:${panel.port}`;
}

function buildMovieUrl(panel, streamId, ext) {
  return `${buildApiBase(panel)}/movie/${panel.username}/${panel.password}/${streamId}.${ext || "mp4"}`;
}

function buildSeriesUrl(panel, episodeId, ext) {
  return `${buildApiBase(panel)}/series/${panel.username}/${panel.password}/${episodeId}.${ext || "mp4"}`;
}

// O SPLIT DE VIDEO (`VIDEO_BASE_URL`, round-robin app1/app2) foi removido na decisao 155.
//
// Ele existia para a rota `/stream/proxy`: o video do painel ATO saia embrulhado em
// `/stream/proxy?url=`, e com dois apps o servidor dividia o embrulho entre eles. Sem proxy
// nao ha o que dividir. A env saiu do registro (`core/nomes.js`), do `Dockerfile` e do
// `ecosystem.config.js`, e o `videoBases()` foi junto — ele nao tinha outro consumidor: o
// unico caller era `panelVideoUrl`, que hoje devolve a URL crua. Quem faz o embrulho agora e'
// o plugin, no aparelho (`nuvio/src/scrapers/xtream.js`), que tem a sua propria base.
function panelVideoUrl(panel, url) {
  // `wrapVideo` respeitava o link-direto-por-padrao do projeto (decisao 49). Na decisao 155 a
  // mascara de stream saiu do servidor: o `/stream/proxy` que receberia este embrulho nao
  // existe mais, entao o servidor NAO embrulha nada.
  return url;
}

function panelStreamVariants(panel, url) {
  if (!panel.wrapVideo) return [{ url }];
  const direct = {
    url,
    headers: { "Referer": `http://${panel.server}:${panel.port}/`, "User-Agent": UA },
  };
  const wrapped = panelVideoUrl(panel, url);
  if (wrapped === url) return [direct];
  return [direct, { url: wrapped, proxy: true }];
}

function isLegendadoName(...parts) {
  return /\[l\]|legendad/i.test(parts.filter(Boolean).join(" "));
}

async function probeSeriesEpisode(url) {
  const cached = seriesProbeCache.get(url);
  if (cached !== null) return cached === PROBE_MAYBE ? null : cached;
  try {
    const res = await browserFetch(url, { headers: { Range: "bytes=0-1023" }, timeout: 4000 });
    if (!res || res.status >= 400) {
      seriesProbeCache.set(url, false);
      return false;
    }
    const ct = String(res.headers.get("content-type") || "");
    if (/text\/html/i.test(ct)) {
      seriesProbeCache.set(url, false);
      return false;
    }
    seriesProbeCache.set(url, true);
    return true;
  } catch (e) {
    seriesProbeCache.set(url, PROBE_MAYBE, 60 * 1000);
    return null;
  }
}

async function filterAliveEpisodes(panel, eps) {
  const capped = eps.slice(0, 4);
  const checks = await Promise.all(capped.map(e =>
    probeSeriesEpisode(buildSeriesUrl(panel, e.id, e.container_extension || "mp4"))
  ));
  if (checks.some(c => c === true)) return capped.filter((_, i) => checks[i] !== false);
  if (checks.some(c => c === null)) return eps;
  return [];
}

// HOST DO PAINEL, sem `split("//")`: esse caminho e' usado por toda chamada que fala com o
// painel, e a forma com aspas duplas quebrava o teste de "nenhuma funcao chamada sem estar
// definida" (o `//` dentro da string e' lido como inicio de comentario pela limpeza do teste, e
// sobra uma aspa desbalanceada que engole a definicao da funcao seguinte).
function hostDoPainel(server) {
  return String(server || "").replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
}

// CATALOGO PEC A PEC, sem juntar nada (decisao 136). O `browserFetch` ganha `porPeca`: cada
// pedaco da resposta e entregue aqui e solto, entao um catalogo de 30MB nunca existe inteiro na
// RAM — nem como Buffer, nem como string.
async function fetchEmPecas(url, panel, timeout, maxBody, porPeca) {
  // O embrulho pelo worker saiu na decisao 155 (`proxyHttpUrl`, do `lib/proxy.js` apagado). No
  // servidor nao ha mais player para embrulhar, e o que trava a leitura de catalogo e' o
  // painel, nao a mascara: o `panel.proxy` continua valendo como destino do proprio painel.
  let alvo = url;
  if (panel && panel.proxy && url.includes(hostDoPainel(panel.server))) {
    alvo = url.replace(/^https?:\/\/[^/]+/, panel.proxy);
  }
  const res = await browserFetch(alvo, { timeout, maxBody, porPeca });
  if (!res.ok) throw new Error(`xtream HTTP ${res.status}`);
  await res.buffer();
  return true;
}

// JSON DO PAINEL, para o caminho de RESERVA (quando o disco nao esta disponivel) e para a
// consulta de serie. No caminho normal do boot o catalogo NAO passa por aqui: e lido pedaco a
// pedaco por `fetchEmPecas` (decisao 136).
async function fetchJson(url, panel, timeout = 15000, maxBody) {
  let alvo = url;
  if (panel && panel.proxy && url.includes(hostDoPainel(panel.server))) {
    alvo = url.replace(/^https?:\/\/[^/]+/, panel.proxy);
  }
  const res = await browserFetch(alvo, { timeout, maxBody });
  if (!res.ok) throw new Error(`xtream HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

// `key` (o titulo normalizado) PRECISA ficar: o `preFiltra` do `match.js` le `item.key`, e sem
// ele o codigo recalcula `matchKey` de TODOS os itens do catalogo a cada pedido — 93 mil itens x 3
// paineis por clique. (Eu tinha removido achando que era peso morto; o grep nao olhou o `match.js`.)
//
// A DESCRICAO DO ITEM (`title` na API do painel) e o maior volume de texto do catalogo, e ela
// aqui so serve para CASAMENTO: e usada em `matchScore(title, item.title)` e
// `matchVodTitle(item.title, ...)`, nunca e mostrada para ninguem (medido: `grep item.title` nao
// acha nenhum outro uso). 160 caracteres bastam para o titulo aparecer no comeco da descricao —
// que e onde ele esta.
//
// MEDIDO 01/10/2026 (a meta do dono: 150MB, nunca passar de 300MB): manter a descricao inteira
// custava ~35MB de heap so nela. E o campo `key` (o titulo normalizado) era escrito em TODO item
// e NUNCA lido — 180 mil strings de peso morto.
const DESCRICAO_MAX = 160;

function toCompactVod(item) {
  if (!item || typeof item !== "object") return null;
  const name = String(item.name || "");
  return {
    name,
    key: matchKey(name),
    title: String(item.title || "").slice(0, DESCRICAO_MAX),
    stream_id: String(item.stream_id || ""),
    container_extension: String(item.container_extension || "mp4"),
  };
}

function toCompactSeries(item) {
  if (!item || typeof item !== "object") return null;
  const name = String(item.name || "");
  return {
    name,
    key: matchKey(name),
    title: String(item.title || "").slice(0, DESCRICAO_MAX),
    series_id: String(item.series_id || ""),
    container_extension: String(item.container_extension || "mp4"),
  };
}

// DECISAO 54: o painel as vezes responde VAZIO sem errar. Era isso que fazia os 4K
// "desaparecerem" do catalogo de um dia para o outro — nao era filtro nosso, era o painel
// respondendo nada naquela consulta. Por isso a repeticao acontece em DOIS casos: quando da
// excecao E quando a lista volta vazia. Tres tentativas, esperando 250ms e 500ms.
//
// ESTA FUNCAO ESTAVA DOCUMENTADA E NAO EXISTIA (decisao 54 citava o nome dela ha semanas).
// A serie chamava `fetchListWithRetry` na linha 362 e o arquivo nao tinha a definicao: media
// hora depois do uso, um ReferenceError quebrava os TRES paineis (Blaze, Space, Autos) na
// serie, e o addon devolvia "panel failed: fetchListWithRetry is not defined".
async function fetchListWithRetry(url, panel, maxBody) {
  const esperas = [0, 250, 500];
  let ultimo = null;
  for (let i = 0; i < esperas.length; i++) {
    if (esperas[i]) await new Promise((r) => setTimeout(r, esperas[i]));
    try {
      const data = await fetchJson(url, panel, 30000, maxBody);
      let list = null;
      if (Array.isArray(data)) list = data;
      else if (data && Array.isArray(data.vod_streams)) list = data.vod_streams;
      else if (data && Array.isArray(data.series)) list = data.series;
      if (list && list.length) return { list, tentativas: i + 1 };
      ultimo = new Error("lista vazia");
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo || new Error("xtream lista");
}

async function getVodList(panel, force, chave) {
  // RAM ANTES DE TUDO (decisao 136): se o catalogo esta em disco, a busca e um SELECT com os
  // candidatos do titulo. Sem isso o processo carregava os 3 catalogos inteiros na memoria
  // (medido: 206MB) so para percorrer 93 mil itens por pedido.
  if (chave && !CATALOGO_EM_MEMORIA) {
    // Antes de desistir para a memoria, espera a gravacao em andamento terminar (decisao 136).
    if (!catalogoPaineis.temCatalogo(panel.name, "vod")) await esperaCatalogoPronto(panel, "vod");
    const candidatos = catalogoPaineis.candidatos(panel.name, "vod", chave);
    if (candidatos) return candidatos;
  }
  const key = `vod_${panel.name}`;
  if (!force) {
    const cached = vodCache.get(key);
    if (cached) return cached;
  }
  return singleFlight(key, async () => {
    const base = buildApiBase(panel);
    const url = `${base}/player_api.php?username=${encodeURIComponent(panel.username)}&password=${encodeURIComponent(panel.password)}&action=get_vod_streams`;
    const out = await fetchListWithRetry(url, panel, MAX_CATALOG_BYTES);
    const compact = out.list.map(toCompactVod);
    vodCache.set(key, compact);
    return compact;
  });
}

async function getSeriesList(panel, force, chave) {
  if (chave && !CATALOGO_EM_MEMORIA) {
    if (!catalogoPaineis.temCatalogo(panel.name, "series")) await esperaCatalogoPronto(panel, "series");
    const candidatos = catalogoPaineis.candidatos(panel.name, "series", chave);
    if (candidatos) return candidatos;
  }
  const key = `series_${panel.name}`;
  if (!force) {
    const cached = seriesCache.get(key);
    if (cached) return cached;
  }
  return singleFlight(key, async () => {
  const base = buildApiBase(panel);
  const url = `${base}/player_api.php?username=${encodeURIComponent(panel.username)}&password=${encodeURIComponent(panel.password)}&action=get_series`;
  const out = await fetchListWithRetry(url, panel, MAX_CATALOG_BYTES);
  if (!out.list) throw new Error("xtream series list fetch failed");
  const list = out.list;
  const compact = list.map(toCompactSeries);
  seriesCache.set(key, compact);
  return compact;
  });
}

async function getSeriesInfo(panel, seriesId) {
  const key = `info_${panel.name}_${seriesId}`;
  const cached = episodesCache.get(key);
  if (cached) return cached;

  const base = buildApiBase(panel);
  const url = `${base}/player_api.php?username=${encodeURIComponent(panel.username)}&password=${encodeURIComponent(panel.password)}&action=get_series_info&series_id=${seriesId}`;
  const data = await fetchJson(url, panel);
  if (data == null) throw new Error("xtream series info fetch failed");
  episodesCache.set(key, data);
  return data;
}


// CATALOGO EM DISCO (decisao 136). Antes: `preloadLists` guardava o catalogo inteiro dos 3
// paineis na RAM — medido, 206MB. Agora ele BAIXA, GRAVA no SQLite e solta a lista; o pedido
// depois busca so os candidatos do titulo. Se o banco nao estiver disponivel, o caminho antigo
// (lista na RAM) continua valendo: perde-se a economia, nao a funcabilidade.
const CATALOGO_MAX_AGE = Number(ENV.XTREAM_CATALOGO_MS || 6 * 60 * 60 * 1000);

// O PEDIDO ESPERA O CATALOGO FICAR PRONTO (decisao 136).
//
// MEDIDO 01/10/2026 em producao: no boot o catalogo leva ~25s para ser gravado (6 gravuras), e um
// pedido que chega nesse intervalo caia no caminho de memoria — que ainda funciona, mas devolve
// MENOS fonte. E o detalhe que machuca: a resposta fraca entra no cache de stream por 15min, e o
// primeiro clique depois do deploy ficava com 2-3 streams enquanto o segundo clique ja trazia 9.
// Medido na producao: 2 streams, depois 3, depois 9 no mesmo item.
//
// Entao: enquanto a gravacao do painel esta em andamento, o pedido ESPERA ela (com teto), em vez de
// sair com o catalogo pela metade. O teto existe para nunca passar do orcamento do gateway.
const GRAVACAO_EM_ANDAMENTO = new Map();
const ESPERA_CATALOGO_MS = Number(ENV.XTREAM_ESPERA_CATALOGO_MS || 3000);

async function esperaCatalogoPronto(painel, tipo) {
  const chave = `${painel.name}:${tipo}`;
  const promessa = GRAVACAO_EM_ANDAMENTO.get(chave);
  if (!promessa) return true;
  let vivo = true;
  const t = setTimeout(() => { vivo = false; }, ESPERA_CATALOGO_MS);
  try {
    await promessa;
  } catch (_) {}
  clearTimeout(t);
  return vivo;
}
// BOTAO DE EMERGENCIA: com `XTREAM_CATALOGO=on` o projeto volta a guardar o catalogo na RAM e
// ignora o SQLite (medido: 250-330MB de RSS contra 60-130MB). Existe para o caso do disco
// falhar na hospedagem — ai se perde a economia, nao a funcionalidade.
const CATALOGO_EM_MEMORIA = String(ENV.XTREAM_CATALOGO || "").toLowerCase() === "memoria";

async function ensureCatalog(panel, tipo) {
  const chave = `${panel.name}:${tipo}`;
  if (GRAVACAO_EM_ANDAMENTO.has(chave)) return GRAVACAO_EM_ANDAMENTO.get(chave);
  const trabalho = (async () => {
  if (CATALOGO_EM_MEMORIA) {
    const serie0 = tipo === "series";
    await (serie0 ? getSeriesList(panel, true) : getVodList(panel, true)).catch(() => {});
    return true;
  }
  const tem = catalogoPaineis.temCatalogo(panel.name, tipo);
  if (tem) {
    const st = catalogoPaineis.stats();
    const marca = (st.marcas || []).find((m) => m.painel === panel.name && m.tipo === tipo);
    if (marca && Date.now() - (marca.quando || 0) < CATALOGO_MAX_AGE) return true;
  }
  const serie = tipo === "series";
  const key = serie ? `series_${panel.name}` : `vod_${panel.name}`;
  const base = buildApiBase(panel);
  const acao = serie ? "get_series" : "get_vod_streams";
  const url = `${base}/player_api.php?username=${encodeURIComponent(panel.username)}&password=${encodeURIComponent(panel.password)}&action=${acao}`;

  // CAMINHO 1 (o de verdade): texto -> SQLite, sem montar a lista.
  //
  // O RSS e' medido e logado em cada etapa (decisao 136): e a unica forma de saber se um boot
  // esta no caminho de memoria ou no de disco, e onde o pico acontece. Medido antes: 342MB de
  // pico e 97MB de heap depois; o alvo do dono e 150MB.
  const mb = () => Math.round((process.memoryUsage().rss || 0) / (1024 * 1024));
  const rssAntes = mb();
  const converte = (it) => {
    const nome = String(it.name || "");
    if (!nome) return null;
    return {
      key: matchKey(nome),
      name: nome,
      title: String(it.title || "").slice(0, DESCRICAO_MAX),
      id: String(serie ? it.series_id : it.stream_id || ""),
      ext: String(it.container_extension || "mp4"),
    };
  };
  try {
    // PECA A PECA, sem juntar nada (decisao 136): o catalogo de 30MB do painel entra no
    // cortador em pedacos da resposta e cada pedaco e solto. Nada de 30MB existe na RAM.
    const consumidor = catalogoPaineis.consumidorDeFatias(panel.name, tipo, converte);
    if (!consumidor) throw new Error("banco indisponivel");
    await fetchEmPecas(url, panel, 30000, MAX_CATALOG_BYTES, (pedaco) => { consumidor.peca(pedaco); });
    const gravados = consumidor.fecha();
    const rssComTexto = mb();
    if (gravados > 0) {
      console.error(`[paineis] ${panel.name}/${tipo}: ${gravados} itens | rss ${rssAntes} -> ${rssComTexto} (gravado)`);
      return true;
    }
    console.error(`[paineis] ${panel.name}/${tipo}: a resposta nao virou item nenhum`);
  } catch (e) {
    console.error(`[paineis] ${panel.name}/${tipo}: disco falhou (${e.message.slice(0, 40)}), indo para memoria`);
  }
  // CAMINHO 2 (reserva): se o disco nao deu, volta o catalogo na RAM. Perde a economia, nao a
  // funcionalidade.
  const emRam = serie ? await getSeriesList(panel, true) : await getVodList(panel, true);
  if (!emRam || !emRam.length) return false;
  catalogoPaineis.apaga(panel.name, tipo);
  const gravados = catalogoPaineis.grava(panel.name, tipo, emRam.map((it) => ({
    key: it.key,
    name: it.name,
    title: it.title,
    id: it.stream_id || it.series_id,
    ext: it.container_extension,
  })));
  if (key.startsWith("series_")) seriesCache.delete(key);
  else vodCache.delete(key);
  return gravados > 0;
  })();
  GRAVACAO_EM_ANDAMENTO.set(chave, trabalho);
  trabalho.finally(() => GRAVACAO_EM_ANDAMENTO.delete(chave));
  return trabalho;
}

// O AQUECIMENTO E' SEQUENCIAL DE NOVO (decisao 146). A nota de antes dizia que o paralelo ja nao
// custava memoria "porque cada pedaco e cortado e solto" — e isso estava ERRADO, medido: em
// producao os 6 catalogos em paralelo levaram o RSS de **113MB para 272MB** durante o
// aquecimento (`[paineis] Autos/vod: 31509 itens | rss 113 -> 272 (gravado)`). Cortar em pedacos
// evita que o ITEM fique, mas nao evita que os 6 arquivos de origem (o maior tem 33 mil itens)
// fiquem abertos ao mesmo tempo — e o Node mantem os 6 Buffers e as 6 arvores de parse vivos ate
// o fim das 6 gravuras.
//
// O dono: "nunca 300MB mesmo com milhares de usuarios". 272MB no aquecimento e o caminho mais
// perto de estourar isso: e logo depois de um deploy, que e quando o catalogo inteiro e rebaixado.
//
// O preco do sequencial e' TEMPO, e ele e' pequeno: medido 6,9s em paralelo contra 13,6s
// sequencial (uma vez so, sem cache). O aquecimento roda em segundo plano, e o pedido que chegar
// no meio espera a gravacao do painel dele (`ESPERA_CATALOGO_MS`), nao a dos outros cinco.
//
// O tempo e o que importa agora: medido, sequencial levava ~25s para gravar os 6 catalogos, e
// nesse intervalo o primeiro clique caia no caminho de memoria (medido: 298MB e 6 streams de 3
// fontes). Em paralelo o boot fecha em poucos segundos e o pedido espera so o que falta.
async function preloadLists() {
  // UM DE CADA VEZ (decisao 146). Cada `await` solta o Buffer e a arvore de parse do catalogo
  // anterior antes do proximo download comecar.
  for (const panel of getPanels()) {
    if (panel.hasEpisodes) {
      await ensureCatalog(panel, "series").catch(() => {});
      memoria.gcSeForcar();
    }
    await ensureCatalog(panel, "vod").catch(() => {});
    memoria.gcSeForcar();
  }
  // O boot que baixa o catalogo e o pico de RAM do processo (medido: 226MB de pico, contra 342MB
  // antes de gravar direto em disco). Coletando no fim, o processo ja entra em regime perto do
  // que o segundo boot mede (60MB) em vez de ficar no lixo do parse.
  memoria.coletarSePreciso(Number(ENV.MEM_RSS_LIMIT_MB || 150), "depois do catalogo em disco");
}

const panelBreakers = new Map();
const BREAKER_MAX_FAILS = 2;
const BREAKER_OPEN_MS = 5 * 60 * 1000;
const PANEL_BUDGET_MS = Number(ENV.XTREAM_PANEL_BUDGET_MS) || 8000;

function isPanelOpen(server) {
  const b = panelBreakers.get(server);
  return !!b && b.openUntil > Date.now();
}

function recordPanelFailure(server) {
  const b = panelBreakers.get(server) || { fails: 0, openUntil: 0 };
  b.fails += 1;
  if (b.fails >= BREAKER_MAX_FAILS) b.openUntil = Date.now() + BREAKER_OPEN_MS;
  panelBreakers.set(server, b);
}

function recordPanelSuccess(server) {
  const b = panelBreakers.get(server);
  if (b) {
    b.fails = 0;
    b.openUntil = 0;
  }
}

function withPanelBudget(ms, message) {
  return (fn) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(message);
      err.budgetTimeout = true;
      reject(err);
    }, ms);
    if (timer.unref) timer.unref();
    Promise.resolve()
      .then(fn)
      .then(
        v => { clearTimeout(timer); resolve(v); },
        e => { clearTimeout(timer); reject(e); }
      );
  });
}

async function streamsFor(title, episode, type, tmdbId, season, year, runtime) {
  if (!title) return [];

  const panels = getPanels();
  const runnable = panels.filter(p => !isPanelOpen(p.server));
  if (!runnable.length) {
    const err = new Error(`xtream breaker open: ${panels.map(p => p.name).join(", ")}`);
    err.partialStreams = [];
    throw err;
  }
  const settled = await Promise.allSettled(runnable.map(async (panel) => {
    const guard = withPanelBudget(PANEL_BUDGET_MS, `${panel.name} estourou ${PANEL_BUDGET_MS}ms`);
    if (type === "series") {
      if (!panel.hasEpisodes) return [];
      return await guard(() => streamsForSeries(panel, title, episode, season, year));
    }
    return await guard(() => streamsForMovie(panel, title, year, runtime));
  }));

  const results = [];
  const failures = [];
  const slow = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      recordPanelSuccess(runnable[i].server);
      if (Array.isArray(s.value)) results.push(...s.value);
    } else if (s.reason && s.reason.budgetTimeout) {
      slow.push(runnable[i].name);
    } else {
      recordPanelFailure(runnable[i].server);
      failures.push(`${runnable[i].name}: ${s.reason && s.reason.message}`);
    }
  }
  if (slow.length) console.error(`[xtream] budget: ${slow.join(", ")}`);
  if (failures.length) {
    const err = new Error(`xtream panel failed: ${failures.join("; ")}`);
    err.partialStreams = results.slice(0, 20);
    throw err;
  }
  return results.slice(0, 20);
}

async function streamsForMovie(panel, title, year, runtime) {
  const items = await getVodList(panel, false, matchKey(title));
  if (!items.length) return [];

  let scored = preFiltra(items, title)
    .map(item => ({
      item,
      score: adjustScoreForYear(
        Math.max(
          matchScore(title, item.name),
          matchScore(title, stripYear(item.name)),
          matchScore(title, item.title || "")
        ),
        item.name,
        title,
        year
      ),
    }))
    .filter(s => s.score >= 90)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 1) {
    const runtimeSec = (Number(runtime) || 0) * 60;
    const probes = await Promise.all(scored.slice(0, 6).map(c =>
      probeVodFile(buildMovieUrl(panel, c.item.stream_id, c.item.container_extension), runtimeSec > 0).catch(() => null)
    ));
    for (let i = 0; i < probes.length; i++) scored[i].probe = probes[i];
    scored = applyProbeFilters(scored, runtimeSec);
  }
  scored = filterConfirmedYear(scored, title, year);

  const results = [];
  for (const { item } of scored) {
    const quality = extractQuality(item.name) || "720p";
    const legendado = isLegendadoName(item.name, item.title);
    const rawUrl = buildMovieUrl(panel, item.stream_id, item.container_extension);
    for (const v of panelStreamVariants(panel, rawUrl)) {
      results.push(makeHttpStream({
        id: `xtream:${panel.name}:${item.stream_id}:${v.proxy ? "prx" : "1"}`,
        type: "movie",
        title: vodTitle({ name: item.name, year: year || extractYear(item.name, title), type: "movie", quality, source: v.proxy ? `PROXY · ${panel.sourceKey || "blz"}` : (panel.sourceKey || "blz") }),
        url: v.url,
        headers: v.headers || null,
        episode: 1,
        season: 1,
        quality,
        source: panel.sourceKey || "blz",
        dubbed: !legendado,
        portuguese: true,
        subtitle: legendado,
        bingeGroup: `xtream-${panel.name}${v.proxy ? "-prx" : ""}`,
      }));
    }
  }
  return results;
}

async function streamsForSeries(panel, title, episode, season, year) {
  const items = await getSeriesList(panel, false, matchKey(title));
  if (!items.length) return [];

  const scored = filterConfirmedYear(preFiltra(items, title)
    .map(item => ({
      item,
      score: adjustScoreForYear(
        Math.max(
          matchScore(title, item.name),
          matchScore(title, stripYear(item.name)),
          matchScore(title, item.title || "")
        ),
        item.name,
        title,
        year
      ),
    }))
    .filter(s => s.score >= 70 && (matchVodTitle(s.item.name, title, true) || matchVodTitle(s.item.title, title, true)))
    .sort((a, b) => b.score - a.score), title, year);

  if (!scored.length) return [];

  const ep = Number(episode) || 1;
  const sn = Number(season) || 0;

  let picked = null;
  let fallback = null;
  for (const cand of scored.slice(0, 3)) {
    const info = await getSeriesInfo(panel, cand.item.series_id);
    if (!info || !info.episodes) continue;
    const allEps = [];
    for (const [seasonNum, eps] of Object.entries(info.episodes)) {
      if (!Array.isArray(eps)) continue;
      for (const e of eps) {
        allEps.push({ ...e, season: Number(seasonNum) });
      }
    }
    let targetEps = allEps.filter(e => Number(e.episode_num || e.episode) === ep);
    if (sn > 0) {
      targetEps = targetEps.filter(e => e.season === sn);
    }
    if (targetEps.length) {
      if (!fallback) fallback = { series: cand.item, targetEps };
      const alive = await filterAliveEpisodes(panel, targetEps);
      if (alive.length) {
        picked = { series: cand.item, targetEps: alive };
        break;
      }
    }
  }
  if (!picked) picked = fallback;
  if (!picked) return [];

  const { series, targetEps } = picked;

  const results = [];
  for (const e of targetEps) {
    const epNum = Number(e.episode_num || e.episode) || ep;
    const quality = extractQuality(e.name || series.name) || "720p";
    const legendado = isLegendadoName(series.name, e.name);
    const rawUrl = buildSeriesUrl(panel, e.id, e.container_extension || "mp4");
    for (const v of panelStreamVariants(panel, rawUrl)) {
      results.push(makeHttpStream({
        id: `xtream:${panel.name}:${series.series_id}:${e.id}${v.proxy ? ":prx" : ""}`,
        type: "series",
        title: vodTitle({ name: series.name, type: "series", season: e.season, episode: epNum, quality, source: v.proxy ? `PROXY · ${panel.sourceKey || "blz"}` : (panel.sourceKey || "blz") }),
        url: v.url,
        headers: v.headers || null,
        episode: epNum,
        season: e.season,
        quality,
        source: panel.sourceKey || "blz",
        dubbed: !legendado,
        portuguese: true,
        subtitle: legendado,
        bingeGroup: `xtream-${panel.name}-${series.series_id}${v.proxy ? "-prx" : ""}`,
      }));
    }
  }
  return results;
}

module.exports = { streamsFor, catalogoPaineis, matchScore, isPanelOpen, recordPanelFailure, recordPanelSuccess, filterConfirmedYear, parseMp4Duration, applyProbeFilters, preloadLists, panelStreamVariants, fetchListWithRetry };
