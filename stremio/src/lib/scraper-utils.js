const { ENV } = require("../core/nomes");
const https = require("https");
const http = require("http");
const zlib = require("zlib");
const { normalizeQuality, extractQuality, stripQuality, resolutionToQuality } = require("./quality");
const { UA, uaFor } = require("./ua");

const CUSTOM_DNS = ENV.CUSTOM_DNS || "1.1.1.1,1.0.0.1";
{
  const dns = require("dns");
  const servers = CUSTOM_DNS.split(",").map(s => s.trim()).filter(Boolean);
  dns.setServers(servers);
  console.log(`[dns] Cloudflare DNS ativo: ${servers.join(", ")}`);
}

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 60, maxFreeSockets: 10, timeout: 30000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 60, maxFreeSockets: 10, timeout: 30000 });
const relayHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 60, maxFreeSockets: 10, timeout: 30000 });
const relayHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 60, maxFreeSockets: 10, timeout: 30000 });
const kakitoHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 60, timeout: 30000, keepAliveMsecs: 5000 });
const kakitoHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 60, timeout: 30000, keepAliveMsecs: 5000 });

function getRelayAgents() {
  return { httpAgent: relayHttpAgent, httpsAgent: relayHttpsAgent };
}

function getKakitoAgents() {
  return { httpAgent: kakitoHttpAgent, httpsAgent: kakitoHttpsAgent };
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CATALOG_BYTES = Number(ENV.MAX_CATALOG_BYTES || 64 * 1024 * 1024);
const MAX_QUEUE_HOSTS = 2000;
const hostQueues = new Map();
const HOST_RATE_LIMIT_MS = 1100;
const MAX_CONCURRENT_PER_HOST = 2;
const MAX_QUEUE_PER_HOST = 500;

setInterval(() => {
  for (const [host, q] of hostQueues) {
    if (q.active === 0 && q.queue.length === 0) hostQueues.delete(host);
  }
}, 60000).unref();

function enqueue(host, fn, rateMs = HOST_RATE_LIMIT_MS) {
  if (!hostQueues.has(host)) {
    if (hostQueues.size >= MAX_QUEUE_HOSTS) return Promise.reject(new Error("too many hosts"));
    hostQueues.set(host, { queue: [], active: 0, lastRun: 0, timer: null });
  }
  const q = hostQueues.get(host);
  if (q.queue.length >= MAX_QUEUE_PER_HOST) {
    return Promise.reject(new Error(`host queue full: ${host}`));
  }
  return new Promise((resolve, reject) => {
    q.queue.push({ fn, resolve, reject, rateMs });
    drainQueue(host);
  });
}

function drainQueue(host) {
  const q = hostQueues.get(host);
  if (!q) return;
  while (q.active < MAX_CONCURRENT_PER_HOST && q.queue.length > 0) {
    const head = q.queue[0];
    const rate = Number.isFinite(head.rateMs) ? head.rateMs : HOST_RATE_LIMIT_MS;
    const wait = Math.max(0, rate - (Date.now() - q.lastRun));
    if (wait > 0) {
      if (!q.timer) q.timer = setTimeout(() => { q.timer = null; drainQueue(host); }, wait);
      return;
    }
    q.active++;
    q.queue.shift();
    q.lastRun = Date.now();
    head.fn().then(head.resolve).catch(head.reject).finally(() => {
      q.active = Math.max(0, q.active - 1);
      drainQueue(host);
    });
  }
}

function makeCache(maxSize = 150, ttlMs = 5 * 60 * 1000) {
  const cache = new Map();
  function get(url) {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > Date.now()) {
      cache.delete(url);
      cache.set(url, hit);
      return hit.html;
    }
    if (hit) cache.delete(url);
    return null;
  }
  function set(url, html, ttl) {
    cache.delete(url);
    cache.set(url, { html, expiresAt: Date.now() + (Number.isFinite(ttl) ? ttl : ttlMs) });
    while (cache.size > maxSize) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }
  // MEDIDO 01/10/2026: `xtream.js` chamava `seriesCache.delete(key)` no CAMINHO DE EMERGENCIA
  // (quando o SQLite falha, o codigo cai para o catalogo na RAM) e o `makeCache` so devolvia
  // `{ get, set }`. Resultado: um `TypeError` que derrubava justamente o botao de emergencia —
  // o dono perdia a economia E a funcionalidade, que e o oposto do combinado. Reproduzido em 2/2.
  function del(url) {
    return cache.delete(url);
  }
  return { get, set, delete: del };
}

function browserFetch(url, opts = {}, _redirectCount = 0) {
  if (_redirectCount > 5) throw new Error("too many redirects");
  const referer = opts.referer || new URL(url).origin + "/";
  const headers = {
    "User-Agent": uaFor(url),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    Referer: referer,
    ...(opts.headers || {}),
  };
  const timeout = opts.timeout || 15000;
  const method = opts.method || "GET";
  const body = opts.body || null;

  const parsedUrl = new URL(url);
  const mod = parsedUrl.protocol === "https:" ? https : http;

  const requestFn = () => new Promise((resolve, reject) => {
    if (opts.signal && opts.signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const reqOpts = {
      method,
      headers,
      timeout,
      agent: parsedUrl.protocol === "https:" ? httpsAgent : httpAgent,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
    };
    const req = mod.request(reqOpts, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        res.resume();
        resolve({ redirect: new URL(res.headers.location, url).href });
        return;
      }
      const encoding = res.headers["content-encoding"] || "";
      let stream = res;
      if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());

      const responseHeaders = new Map();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v) responseHeaders.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
      let cachedBody = null;
      const getBody = () => {
        if (cachedBody) return Promise.resolve(cachedBody);
        return new Promise((resResolve, resReject) => {
          const chunks = [];
          let total = 0;
          let aborted = false;
          const cap = opts.maxBody || MAX_BODY_BYTES;
          // `peekBytes`: ler SO o inicio de um arquivo enorme e desligar. MEDIDO em 29/09/2026:
          // o painel kakito (BLZ) IGNORA `Range` e devolve 200 com o arquivo inteiro (1,3GB),
          // entao a sonda que dependia de `206` nunca tinha o cabecalho para ler — e sem cabecalho
          // nao da para saber a duracao nem o codec. Com o peek, a mesma sonda le os 256KB do
          // comeco do painel que devolve o arquivo inteiro, e custa o mesmo que antes.
          const peek = Number(opts.peekBytes || 0);
          const declared = Number(res.headers["content-length"] || 0);
          if (declared > cap && !(peek > 0)) {
            stream.destroy();
            resReject(new Error(`body too large: ${declared}`));
            return;
          }
          // `porPeca`: entregar cada pedaco ao chamador e NAO juntar nada (decisao 136). Sem
          // isto, o catalogo de 30MB do painel virava um Buffer de 30MB na RAM so para ser
          // cortado em pedacos depois. Com o callback, o pedaco e processado e solto.
          const porPeca = typeof opts.porPeca === "function" ? opts.porPeca : null;
          if (porPeca && !opts.peekBytes) {
            const capPeca = opts.maxBody || MAX_BODY_BYTES;
            stream.on("data", chunk => {
              total += chunk.length;
              if (total > capPeca) {
                try { stream.destroy(); } catch (_) {}
                resReject(new Error(`body too large: >${capPeca}`));
                return;
              }
              try { porPeca(chunk); } catch (e) { resReject(e); }
            });
            stream.on("end", () => { cachedBody = Buffer.alloc(0); resResolve(cachedBody); });
            stream.on("error", err => resReject(err));
            return;
          }
          const onData = chunk => {
            if (aborted) return;
            total += chunk.length;
            if (peek > 0 && total >= peek) {
              // Ja basta: guarda o que veio, fecha a conexao e entrega o prefixo.
              aborted = true;
              try { stream.destroy(); } catch (_) {}
              resResolve(Buffer.concat(chunks));
              return;
            }
            if (total > cap) {
              aborted = true;
              stream.destroy();
              resReject(new Error(`body too large: >${cap}`));
              return;
            }
            chunks.push(chunk);
          };
          stream.on("data", onData);
          stream.on("end", () => { if (!aborted) { cachedBody = Buffer.concat(chunks); resResolve(cachedBody); } });
          stream.on("error", err => { if (!aborted) resReject(err); });
        });
      };
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        statusText: res.statusMessage,
        url,
        headers: {
          get: (key) => responseHeaders.get(key.toLowerCase()),
          entries: () => responseHeaders.entries(),
        },
        text: async () => (await getBody()).toString("utf-8"),
        json: async () => JSON.parse((await getBody()).toString("utf-8")),
        arrayBuffer: async () => (await getBody()).buffer,
        buffer: async () => await getBody(),
        clone: () => { throw new Error("not implemented"); },
      });
    });
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    }
    if (body) req.write(body);
    req.end();
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });

  return enqueue(parsedUrl.hostname, requestFn, 0).then((result) => {
    if (result && result.redirect) return browserFetch(result.redirect, opts, _redirectCount + 1);
    return result;
  });
}

const hlsQualityCache = makeCache(200, 30 * 60 * 1000);

function parseMasterPlaylist(text) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
    const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const nextLine = (lines[i + 1] || "").trim();
    if (!nextLine || nextLine.startsWith("#")) continue;
    variants.push({
      bandwidth: bandwidthMatch ? Number(bandwidthMatch[1]) : 0,
      width: resolutionMatch ? Number(resolutionMatch[1]) : 0,
      height: resolutionMatch ? Number(resolutionMatch[2]) : 0,
      url: nextLine,
    });
  }
  return variants;
}

async function probeHlsQuality(url, timeout = 5000) {
  if (!url || !/\.m3u8(\?|$)/i.test(url)) return null;
  const cached = hlsQualityCache.get(url);
  if (cached !== null) return cached || null;
  try {
    const res = await browserFetch(url, { timeout });
    if (!res.ok) {
      hlsQualityCache.set(url, false);
      return null;
    }
    const text = await res.text();
    const variants = parseMasterPlaylist(text);
    if (!variants.length) {
      hlsQualityCache.set(url, false);
      return null;
    }
    const best = variants.reduce((a, b) => {
      if (b.height !== a.height) return b.height > a.height ? b : a;
      return b.bandwidth > a.bandwidth ? b : a;
    });
    const quality = resolutionToQuality(best.width, best.height);
    hlsQualityCache.set(url, quality);
    return quality;
  } catch {
    return null;
  }
}


// MEDIDO em 29/09/2026: este era o UNICO fetch do projeto que nao passava pelo `browserFetch`, e
// ele VAZAVA rejeicao. No `timeout` o undici larga a resposta com
// `TypeError [ERR_INVALID_STATE]: Invalid state: Controller is already closed`, e como ninguem
// segurava aquela promessa ela virava `unhandledRejection` (medido no VZR, 2 fugas em 5 pedidos).
// O servidor so registra e segue (`server.js`), entao NAO derrubava o addon — mas o erro do log
// era do undici, nao dizia de onde veio, e o EPG (que roda em segundo plano) podia perder o dia
// inteiro sem ninguem perceber.
//
// Unificar no `browserFetch` resolve os dois: o cliente proprio sempre rejeita com erro limpo, e
// ganha de graca a fila por host, a rotacao de User-Agent, a descompressao e o teto de corpo.
async function getText(url, opts) {
  const o = opts || {};
  const maxBytes = Number(o.maxBytes || 8 * 1024 * 1024);
  const res = await browserFetch(url, {
    timeout: Number(o.timeout || 25000),
    referer: o.referer,
    maxBody: maxBytes,
    headers: Object.assign(
      o.userAgent ? { "User-Agent": o.userAgent } : {},
      o.headers || {}
    ),
  });
  if (!res.ok) throw new Error(`http ${res.status} em ${url}`);
  if (!o.raw) {
    const txt = await res.text();
    if (txt.length > maxBytes) throw new Error(`corpo grande demais: >${maxBytes}`);
    return txt;
  }
  return await res.buffer();
}

async function getGzText(url, opts) {
  const bruto = await getText(url, { ...(opts || {}), raw: true });
  const b = Buffer.isBuffer(bruto) ? bruto : Buffer.from(String(bruto));
  const gz = b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
  return gz ? zlib.gunzipSync(b).toString("utf8") : b.toString("utf8");
}

async function firstSuccessful(candidatos, fn, opts) {
  const o = opts || {};
  const erros = [];
  const lista = Array.isArray(candidatos) ? candidatos : [candidatos];
  for (const item of lista) {
    try {
      const valor = await fn(item, erros.length);
      if (valor) return { valor, usado: item, erros };
    } catch (e) {
      erros.push(`${rotuloDe(item)}: ${e.message}`.slice(0, 120));
    }
  }
  if (o.lancar) throw new Error(erros.join("; ") || "nenhum candidato serviu");
  return { valor: null, usado: null, erros };
}

function rotuloDe(item) {
  if (typeof item === "string") {
    try { return new URL(item).host; } catch (_) { return item.slice(0, 40); }
  }
  return String(item && (item.name || item.id || item.url) || "candidato");
}

module.exports = { MAX_CATALOG_BYTES, getGzText, firstSuccessful, makeCache, browserFetch, getRelayAgents, getKakitoAgents, enqueue, extractQuality, stripQuality, normalizeQuality, probeHlsQuality, UA };
