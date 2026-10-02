const { ENV } = require("../core/nomes");
const crypto = require("crypto");

const CHUNK_SIZE = Number(ENV.PANEL_CHUNK_SIZE || 2 * 1024 * 1024);
const CHUNK_TTL = Number(ENV.PANEL_CHUNK_TTL || 30 * 60 * 1000);
const MAX_CHUNKS = Number(ENV.PANEL_MAX_CHUNKS || 600);
const TIMEOUT = Number(ENV.PANEL_CHUNK_TIMEOUT || 20000);

const store = new Map();
const emVoo = new Map();
const stats = { requesicoes: 0, trechosDoCache: 0, trechosDoPainel: 0, bytesPainel: 0, erros: 0 };

function chaveDe(origem, indice) {
  return `${crypto.createHash("sha1").update(origem).digest("hex").slice(0, 16)}:${indice}`;
}

function arrumar() {
  const agora = Date.now();
  for (const [k, v] of store) {
    if (agora - v.ts > CHUNK_TTL) store.delete(k);
  }
  while (store.size > MAX_CHUNKS) {
    const maisVelho = store.keys().next().value;
    if (maisVelho === undefined) break;
    store.delete(maisVelho);
  }
}

function headersDoPainel(url) {
  return {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
}

async function buscaTrecho(origem, indice) {
  const inicio = indice * CHUNK_SIZE;
  const fim = inicio + CHUNK_SIZE - 1;
  const chave = chaveDe(origem, indice);
  if (emVoo.has(chave)) return emVoo.get(chave);
  const trabalho = (async () => {
    arrumar();
    const guardado = store.get(chave);
    if (guardado) {
      stats.trechosDoCache++;
      return guardado;
    }
    const r = await fetch(origem, {
      headers: { ...headersDoPainel(origem), Range: `bytes=${inicio}-${fim}` },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok && r.status !== 206) throw new Error(`painel http ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) throw new Error("trecho vazio");
    const cr = String(r.headers.get("content-range") || "");
    const total = cr.includes("/") ? cr.split("/")[1] : "";
    if (total && /^\d+$/.test(total)) tamanhos.set(chaveRaiz(origem), Number(total));
    store.set(chave, { buf, ts: Date.now(), fimDoArquivo: /^\d+$/.test(total) ? Number(total) : null });
    stats.trechosDoPainel++;
    stats.bytesPainel += buf.length;
    return store.get(chave);
  })();
  emVoo.set(chave, trabalho);
  try {
    return await trabalho;
  } finally {
    emVoo.delete(chave);
  }
}

const tamanhos = new Map();

function tamanhoTotal(origem) {
  return tamanhos.get(chaveRaiz(origem)) || null;
}

function chaveRaiz(origem) {
  return crypto.createHash("sha1").update(origem).digest("hex").slice(0, 16);
}

function parseRange(header, totalConhecido) {
  if (!header) return null;
  const m = /bytes=(\d*)-(\d*)/.exec(String(header));
  if (!m) return null;
  const inicio = m[1] === "" ? 0 : Number(m[1]);
  const fim = m[2] === "" ? null : Number(m[2]);
  return { inicio, fim: fim === null ? (totalConhecido ? totalConhecido - 1 : null) : fim };
}

async function serveTrechos(origem, rangeHeader, res) {
  stats.requesicoes++;
  const total = tamanhoTotal(origem);
  const range = parseRange(rangeHeader, total);

  if (!range || range.inicio === 0) {
    // sem Range (ou do inicio): responde o primeiro trecho e anuncia o tamanho conhecido
    const primeiro = await buscaTrecho(origem, 0).catch((e) => {
      stats.erros++;
      throw e;
    });
    const fim = primeiro.fimDoArquivo || primeiro.buf.length;
    res.status(200);
    res.set("content-type", "video/mp4");
    res.set("accept-ranges", "bytes");
    if (primeiro.fimDoArquivo) res.set("content-length", String(primeiro.fimDoArquivo));
    res.set("access-control-allow-origin", "*");
    if (range && range.fim !== null) res.set("content-range", `bytes ${range.inicio}-${range.fim}/${primeiro.fimDoArquivo || "?"}`);
    res.end(primeiro.buf);
    return;
  }

  const fim = range.fim === null ? Math.min(range.inicio + CHUNK_SIZE - 1, (total || Infinity) - 1) : range.fim;
  const partes = [];
  for (let inicio = range.inicio; inicio <= fim; inicio += CHUNK_SIZE) {
    const indice = Math.floor(inicio / CHUNK_SIZE);
    const t = await buscaTrecho(origem, indice);
    partes.push(t.buf);
  }
  const corpo = partes.length === 1 ? partes[0] : Buffer.concat(partes);
  const totalFinal = total || tamanhoTotal(origem) || range.inicio + corpo.length;
  res.status(206);
  res.set("content-type", "video/mp4");
  res.set("accept-ranges", "bytes");
  res.set("content-range", `bytes ${range.inicio}-${fim}/${totalFinal}`);
  res.set("content-length", String(corpo.length));
  res.set("access-control-allow-origin", "*");
  res.end(corpo);
}

function estatisticas() {
  return { ...stats, trechosGuardados: store.size, emVoo: emVoo.size, tamanhoTrecho: CHUNK_SIZE };
}

function limpar() {
  store.clear();
  emVoo.clear();
  tamanhos.clear();
}

module.exports = { serveTrechos, buscaTrecho, estatisticas, limpar, CHUNK_SIZE, chaveDe };
