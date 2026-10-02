// Preenche a qualidade REAL dos streams que a fonte entregou sem ela.
//
// POR QUE EXISTE — medido no app do Nuvio: quando o scraper nao manda `quality`, o
// app escreve na linha 1 o rotulo de localizacao `stream_quality_unknown`, que em
// pt-BR e "Desconhecido". MEDIDO nas 15 fontes antes deste modulo: 13 das 15
// devolviam stream sem `quality`, entao quase toda linha da tela dizia "Desconhecido"
// — inclusive as fontes que sabiam a resolucao pelo nome do item do catalogo.
//
// POR QUE NAO INVENTAR — o projeto ja tem essa regra (decisao 36 do addon): a
// qualidade e a RESOLUCAO REAL lida do video. Aqui nao existe rotulo padrao. Se a
// leitura falhar, o campo continua vazio e a linha repete o que o app escreve —
// honesto, e igual ao que era antes deste modulo. Por isso tambem NAO se propaga a
// resolucao de um stream para os outros da mesma fonte: um painel pode ter 720p e
// 1080p do mesmo filme, e preencher os dois com uma leitura seria inventar.
//
// CUSTO — uma leitura de 160 KB por stream, em paralelo, com teto. O runtime corta
// corpo em 1 MB e a leitura pede 160 KB, entao sobra. O teto de sondas evita que uma
// fonte com 12 streams pague 12 leituras: as 3 primeiras definem o que a lista mostra
// e o resto vai sem rotulo, como ia antes.
//
// O teto de 3 s e medido, nao arbitrario. MEDIDO: a leitura no SPC leva 358-514 ms e
// entrega 1920x800 (1080p); no BLZ a origem demora 20 s ate responder um Range e a
// sonda estourava 8 s sem resultado. Se uma origem precisa de mais de 3 s para
// devolver 160 KB, o video dela tambem vai demorar para o usuario — e nao vale
// pagar esse atraso no `getStreams` para ganhar um rotulo.
//
// O `ms` e o que SOBRA do orcamento da invocacao, nunca um numero fixo: quem chama
// ja pode ter gasto 20 s num painel lento e nao pode perder mais 3 s aqui.

const { novo } = require("../core/sandbox");
const { videoResolutionToQuality } = require("./quality");
const { probeResolution } = require("./video-probe");

// 3 sondas x 160 KB = 480 KB. Abaixo do teto de 1 MB do runtime, e em paralelo.
const MAX_SONDAS = 3;
const MS_SONDA = 3e3;
const TETO_MS = 4e3;
const MIN_MS = 1500;

const cache = new Map();
const CACHE_MAX = 120;

// A chave inclui os cabecalhos: a mesma URL com e sem `Referer` pode servir codigos
// diferentes, e o RTD e exatamente esse caso.
function chaveDe(stream) {
  const h = (stream && stream.headers) || {};
  const partes = Object.keys(h).sort().map((k) => `${k}=${h[k]}`);
  return partes.length ? `${stream.url}|${partes.join("&")}` : String(stream.url);
}

function modo() {
  const bruto = globalThis.MIRROR_QUALIDADE;
  const v = bruto === null || bruto === void 0 ? "auto" : String(bruto).trim().toLowerCase();
  return ["auto", "nunca", "sempre"].includes(v) ? v : "auto";
}

async function qualidadeDe(stream, ms) {
  const chave = chaveDe(stream);
  if (cache.has(chave)) return cache.get(chave);
  let qualidade = null;
  try {
    const r = await probeResolution(stream.url, {
      headers: stream.headers || {},
      maxTargets: 1,
      ms
    });
    qualidade = r ? videoResolutionToQuality(r.width, r.height) : null;
  } catch (_) {
    qualidade = null;
  }
  if (qualidade) {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(chave, qualidade);
  }
  return qualidade;
}

/**
 * Roda a fonte e preenche a qualidade dos streams que sairam sem ela.
 * `chamar` e o `getStreams` original: nada aqui muda a DECISAO da fonte sobre
 * entregar ou nao link, so completa o rotulo depois.
 */
async function qualifica(chamar, ...args) {
  const lista = await chamar(...args);
  const modoAtual = modo();
  if (modoAtual === "nunca" || !Array.isArray(lista) || !lista.length) return lista;

  const semQualidade = lista.filter(
    (s) => s && typeof s.url === "string" && /^https?:/i.test(s.url) && !s.quality
  );
  if (!semQualidade.length) return lista;

  const teto = modoAtual === "sempre" ? lista.length : MAX_SONDAS;
  const p = novo(TETO_MS);
  const resultados = await Promise.all(
    semQualidade.slice(0, teto).map(async (s) => {
      const sobra = Math.min(MS_SONDA, p.sobra());
      if (sobra < MIN_MS) return null;
      return qualidadeDe(s, sobra);
    })
  );
  semQualidade.slice(0, teto).forEach((s, i) => {
    if (resultados[i]) s.quality = resultados[i];
  });
  return lista;
}

module.exports = { MAX_SONDAS, MS_SONDA, TETO_MS, cache, chaveDe, qualidadeDe, qualifica };