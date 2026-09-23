// PROVA DE VIDA: antes de entregar um link, descobrir se ele ainda existe.
//
// O BURACO QUE ELE FECHA (medido em 29/09/2026, producao): de 53 links devolvidos por 8 obras,
// **4 estavam mortos** — VZR 2/4 (a cadeia de serie termina em 403 no 3o host deles), BLZ 1/7
// (arquivo morto no painel) e RON 1/4. Ou seja, 92% de acerto: em 1 a cada 13 vezes que a pessoa
// clicava, nao tocava.
//
// O projeto JA sondava esses enderecos (`fillMissingHlsQuality` -> `probeHlsQuality` e
// `probeStreamQuality`) e mesmo assim nao tirava o link morto da lista, porque a sonda devolvia
// `null` tanto para "morreu" quanto para "nao deu para saber" — as duas coisas viravam a mesma
// resposta e o stream seguia para o cliente. Aqui a sonda devolve um VEREDITO com motivo, e so o
// que e morte confirmada sai da lista.
//
// A ASIMETRIA IMPORTANTE (e o que impede este modulo de piorar as coisas): o que NAO e prova de
// morte e MANTIDO. Um timeout NAO mata o link (a origem pode estar lenta, e o link em geral
// funciona quando a pessoa clica); so e descartado o que responde 403/404/410/451, 5xx, ou
// 200 com `text/html` (pagina de erro do origin), ou playlist sem segmento nenhum.

const { browserFetch, makeCache } = require("./scraper-utils");
const { resolutionToQuality } = require("./quality");

// 5 minutos: o mesmo link volta em quase todo pedido (a cache de stream e de 15min), entao o
// calorico de um clique e a seguinte request repetida e o preco cai a zero.
const cache = makeCache(400, 5 * 60 * 1000);

let contador = { proved: 0, mortos: 0, mantidosSemProva: 0, cacheHit: 0 };

const MORTO = new Set([403, 404, 410, 451]);

function variantesDe(texto) {
  const linhas = texto.split(/\r?\n/);
  const variantes = [];
  for (let i = 0; i < linhas.length; i++) {
    if (!linhas[i].trim().startsWith("#EXT-X-STREAM-INF:")) continue;
    const w = /RESOLUTION=(\d+)x(\d+)/i.exec(linhas[i]);
    const prox = (linhas[i + 1] || "").trim();
    if (!prox || prox.startsWith("#")) continue;
    variantes.push({ largura: w ? Number(w[1]) : 0, altura: w ? Number(w[2]) : 0 });
  }
  return variantes;
}

// Devolve `{vivo: true|false|null, qualidade}`. `null` = nao deu para provar (mantem o link).
async function provaDe(url, opcoes) {
  const o = opcoes || {};
  const ehHls = /\.m3u8(\?|#|$)/i.test(url);
  const headers = { ...(o.headers || {}) };
  try {
    if (ehHls) {
      const res = await browserFetch(url, {
        headers,
        timeout: Number(o.timeoutMs || 3000),
        referer: o.referer,
        maxBody: 1024 * 1024,
      });
      if (MORTO.has(res.status) || res.status >= 500) return { vivo: false, motivo: `HTTP ${res.status}` };
      if (!res.ok) return { vivo: null, motivo: `HTTP ${res.status}` };
      const tipo = (res.headers.get("content-type") || "").toLowerCase();
      if (tipo.includes("text/html")) return { vivo: false, motivo: "devolveu pagina de erro" };
      const texto = await res.text();
      if (!/#EXTM3U/i.test(texto)) return { vivo: false, motivo: "nao e playlist" };
      // DEFATO achado pelo teste do caminho do byte (30/09/2026): a condicao era "tem alguma
      // linha que NAO e comentario", o que condemna a PLAYLIST MESTRE — que, por definicao, tem
      // `#EXT-X-STREAM-INF` e as variantes, e nao tem segmento proprio. Ate ai, qualquer fonte
      // que devolvesse um master playlist tinha o link TIRADO DA LISTA por esta prova, sendo que
      // era exatamente um link bom: o REI e a SPT devolvem master, e o problema e o oposto
      // (ligar demais), nunca tirar demais.
      //
      // O que condena continua sendo a playlist que nao aponta para NADA: e o que faz o player
      // trocar de player em laco (medido no REI, que devolvia 200 com arquivo sem segmento).
      const linhas = texto.split(/\r?\n/);
      const variantes = variantesDe(texto);
      const temReferencia = linhas.some(l => l.trim() && !l.startsWith("#"));
      if (!temReferencia) return { vivo: false, motivo: "playlist sem segmento" };
      let qualidade = null;
      if (variantes.length) {
        const melhor = variantes.reduce((a, b) => (b.altura !== a.altura ? (b.altura > a.altura ? b : a) : b));
        qualidade = resolutionToQuality(melhor.largura, melhor.altura);
      }
      return { vivo: true, qualidade };
    }
    const res = await browserFetch(url, {
      headers: { ...headers, Range: "bytes=0-1023" },
      timeout: Number(o.timeoutMs || 3000),
      referer: o.referer,
      maxBody: 2048,
    });
    if (MORTO.has(res.status) || res.status >= 500) return { vivo: false, motivo: `HTTP ${res.status}` };
    if (res.status !== 200 && res.status !== 206) return { vivo: null, motivo: `HTTP ${res.status}` };
    const tipo = (res.headers.get("content-type") || "").toLowerCase();
    if (tipo.includes("text/html")) return { vivo: false, motivo: "devolveu pagina de erro" };
    return { vivo: true };
  } catch (e) {
    // Abort/timeout/rede: NAO e prova de morte. Mantem o link — a origem pode estar lenta e o
    // player da pessoa aguenta. Descartar aqui custaria cobertura de graca.
    return { vivo: null, motivo: String((e && e.message) || e).slice(0, 40) };
  }
}

// Sondar os streams e tirar da lista os que responderam morreu. Em paralelo e com teto de tempo:
// o pedido inteiro tem 9s e a sonda e um extra, nao o motivo do pedido estourar.
async function descartaMortos(streams, opcoes) {
  const o = opcoes || {};
  const teto = Number(o.ms || 3200);
  const inicio = Date.now();
  const candidatos = [];
  for (const s of streams) {
    if (!s || !/^https?:/i.test(s.url || "")) continue;
    if (/mirror-cdn\.|\/stream\/proxy|\/stream\/hls\/|workers\.dev/i.test(s.url)) continue; // ja e relay
    candidatos.push(s);
  }
  if (!candidatos.length) return { removidos: 0, mortos: [], probed: contador.proved };

  const vereditos = await Promise.all(candidatos.map(async (s) => {
    const chave = `${s.url}|${(s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request && s.behaviorHints.proxyHeaders.request.Referer) || ""}`;
    const guardado = cache.get(chave);
    if (guardado !== null) { contador.cacheHit++; return guardado; }
    if (Date.now() - inicio > teto) return { vivo: null, motivo: "sem orcamento" };
    const v = await provaDe(s.url, {
      timeoutMs: Math.max(1200, Math.min(3000, teto - (Date.now() - inicio))),
      referer: s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request
        ? s.behaviorHints.proxyHeaders.request.Referer
        : undefined,
    });
    contador.proved++;
    cache.set(chave, v);
    return v;
  }));

  const mortos = [];
  const vivos = [];
  for (let i = 0; i < candidatos.length; i++) {
    const v = vereditos[i];
    if (v && v.qualidade) {
      const s = candidatos[i];
      if (!s.quality || s.quality === "unknown") {
        s.quality = v.qualidade;
        if (typeof s.name === "string") s.name = `Mirror ${v.qualidade}`;
      }
    }
    if (v && v.vivo === false) { mortos.push({ fonte: (candidatos[i].sources || []).join("+"), motivo: v.motivo, url: candidatos[i].url.slice(0, 90) }); contador.mortos++; }
    else { if (!v || v.vivo === null) contador.mantidosSemProva++; vivos.push(candidatos[i]); }
  }

  if (!mortos.length) return { removidos: 0, mortos: [], probed: contador.proved };

  // Tira da lista de verdade (o array chega por referencia e e o que o servidor devolve).
  const mortosSet = new Set();
  for (let i = 0; i < candidatos.length; i++) {
    if (vereditos[i] && vereditos[i].vivo === false) mortosSet.add(candidatos[i]);
  }
  for (let i = streams.length - 1; i >= 0; i--) if (mortosSet.has(streams[i])) streams.splice(i, 1);
  console.error(`[prova] ${mortosSet.size} link(s) fora: ` + mortos.slice(0, 4).map(m => `${m.fonte}(${m.motivo})`).join(", "));
  return { removidos: mortosSet.size, mortos, probed: contador.proved };
}

function stats() {
  return { ...contador };
}

module.exports = { provaDe, descartaMortos, stats };
