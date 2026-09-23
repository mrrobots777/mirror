const http = require("http");
const https = require("https");
const { URL } = require("url");
const express = require("express");

const PORT = process.env.PORT || 3000;

const relayHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 100, maxFreeSockets: 20, timeout: 30000 });
const relayHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100, maxFreeSockets: 20, timeout: 30000 });
const kakitoHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 100, timeout: 10000, keepAliveMsecs: 5000 });
const kakitoHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100, timeout: 10000, keepAliveMsecs: 5000 });

function getRelayAgents() {
  return { httpAgent: relayHttpAgent, httpsAgent: relayHttpsAgent };
}

function getKakitoAgents() {
  return { httpAgent: kakitoHttpAgent, httpsAgent: kakitoHttpsAgent };
}

const hostQueues = new Map();
const HOST_RATE_LIMIT_MS = 1100;

function enqueue(host, fn) {
  if (!hostQueues.has(host)) {
    hostQueues.set(host, { queue: [], lastRun: 0 });
  }
  const q = hostQueues.get(host);
  if (q.queue.length >= MAX_QUEUE_PER_HOST) {
    return Promise.reject(new Error(`host queue full: ${host}`));
  }
  return new Promise((resolve, reject) => {
    q.queue.push({ fn, resolve, reject });
    if (!q.processing) processQueue(host);
  });
}

function processQueue(host) {
  const q = hostQueues.get(host);
  if (!q || q.processing) return;
  q.processing = true;

  function next() {
    if (q.queue.length === 0) { q.processing = false; return; }
    const now = Date.now();
    const wait = Math.max(0, HOST_RATE_LIMIT_MS - (now - q.lastRun));
    setTimeout(() => {
      const item = q.queue.shift();
      q.lastRun = Date.now();
      item.fn().then(item.resolve).catch(item.reject).finally(next);
    }, wait);
  }
  next();
}

const M3U8_CACHE_TTL = 1500;
const MAX_CACHED_SEGMENTS = 30;
const MAX_RELAY_STREAMS = 500;
const STREAM_SHARE_TTL = 60000;
const UPSTREAM_IDLE_TIMEOUT = 45000;
const MAX_PER_HOST = 100;
const MAX_QUEUE_PER_HOST = 500;

const m3u8Cache = new Map();
const activeFetches = new Map();
let activeRelayCount = 0;
const hostConnections = new Map();

function getHostConcurrency(host) {
  if (!hostConnections.has(host)) hostConnections.set(host, 0);
  return hostConnections.get(host);
}
function incHostConcurrency(host) {
  hostConnections.set(host, getHostConcurrency(host) + 1);
}
function decHostConcurrency(host) {
  const cur = getHostConcurrency(host);
  if (cur <= 1) hostConnections.delete(host);
  else hostConnections.set(host, cur - 1);
}

function cleanupOldEntries() {
  const now = Date.now();
  for (const [key, entry] of m3u8Cache) {
    if (now - entry.ts > M3U8_CACHE_TTL * 3) m3u8Cache.delete(key);
  }
}
setInterval(cleanupOldEntries, 10000);

function resolveRedirects(url, maxRedirects = 5, extraHeaders) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("too many redirects"));
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new Error("unsupported protocol"));
    if (/^127\.|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^0\.|^169\.254\.|^localhost$|^\[::1\]$/i.test(u.hostname)) return reject(new Error("private ip blocked"));
    const mod = u.protocol === "https:" ? https : http;
    const isKakito = /kakito\.xyz/i.test(u.hostname);
    const agents = isKakito ? getKakitoAgents() : getRelayAgents();
    const agent = u.protocol === "https:" ? agents.httpsAgent : agents.httpAgent;
    const baseHeaders = {
      "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
      "Accept": "*/*",
      "Accept-Language": "*",
    };
    const reqOpts = {
      method: "GET",
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      timeout: 10000,
      agent,
      headers: extraHeaders ? { ...baseHeaders, ...extraHeaders } : baseHeaders,
    };
    const req = mod.request(reqOpts, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        resolveRedirects(next, maxRedirects - 1, extraHeaders).then(resolve, reject);
        return;
      }
      resolve({ statusCode: res.statusCode, headers: res.headers, stream: res, finalUrl: url });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

async function cachedFetch(url, cacheMap, ttl, extraHeaders) {
  const cached = cacheMap.get(url);
  if (cached && Date.now() - cached.ts < ttl) {
    return { body: cached.body, headers: cached.headers, fromCache: true, finalUrl: cached.finalUrl || url };
  }
  if (activeFetches.has(url)) {
    return activeFetches.get(url);
  }
  const promise = (async () => {
    try {
      const { statusCode, headers, stream, finalUrl } = await resolveRedirects(url, 5, extraHeaders);
      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`upstream ${statusCode}`);
      }
      const chunks = [];
      let totalSize = 0;
      const MAX_BUFFER_SIZE = 1024 * 1024;
      for await (const chunk of stream) {
        totalSize += chunk.length;
        if (totalSize > MAX_BUFFER_SIZE) {
          stream.destroy();
          return { body: null, headers: {}, fromCache: false, finalUrl, tooLarge: true };
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const respHeaders = {
        contentType: headers["content-type"] || "",
        contentLength: headers["content-length"] || "",
      };
      const entry = { body, headers: respHeaders, ts: Date.now(), finalUrl };
      cacheMap.set(url, entry);
      if (cacheMap.size > MAX_CACHED_SEGMENTS) {
        cacheMap.delete(cacheMap.keys().next().value);
      }
      return { body, headers: respHeaders, fromCache: false, finalUrl };
    } finally {
      activeFetches.delete(url);
    }
  })();
  activeFetches.set(url, promise);
  return promise;
}

function rewriteM3u8(content, proxyBase, targetUrl) {
  const text = content.toString("utf-8");
  const baseUrl = targetUrl && targetUrl.includes("/") ? targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1) : "";
  const proxied = (value) => {
    try {
      const full = /^https?:\/\//i.test(value) ? value : new URL(value, baseUrl || undefined).href;
      return `${proxyBase}/stream/proxy?url=${encodeURIComponent(full)}`;
    } catch (_) {
      return value;
    }
  };
  const lines = text.split("\n");
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      if (trimmed.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (m, p) => `URI="${proxied(p)}"`);
      }
      return line;
    }
    return proxied(trimmed);
  }).join("\n");
}

async function proxyStream(targetUrl, proxyBase, clientRes, extraHeaders) {
  const isM3u8 = targetUrl.includes(".m3u8") || /\.txt(\?|$)/.test(targetUrl);

  if (isM3u8) {
    try {
      const { body, fromCache, finalUrl } = await cachedFetch(targetUrl, m3u8Cache, M3U8_CACHE_TTL, extraHeaders);
      const baseUrl = finalUrl || targetUrl;
      if (clientRes.destroyed) return;
      const rewritten = rewriteM3u8(body, proxyBase, baseUrl);
      clientRes.set({
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "public, max-age=2",
        "X-Cache": fromCache ? "HIT" : "MISS",
      });
      clientRes.send(rewritten);
      return;
    } catch (e) {
      console.error(`[relay] m3u8 error: ${e.message}`);
      if (!clientRes.destroyed && !clientRes.headersSent) clientRes.status(502).send("upstream error");
      return;
    }
  }

  if (activeRelayCount >= MAX_RELAY_STREAMS) {
    clientRes.status(503).send("too many streams");
    return;
  }

  const u = new URL(targetUrl);
  const host = u.hostname;
  if (getHostConcurrency(host) >= MAX_PER_HOST) {
    if (!clientRes.headersSent) clientRes.status(503).send(`too many connections to ${host}`);
    return;
  }

  const isKakitoVod2 = /kakito\.xyz.*\.mp4/i.test(targetUrl);
  const connectFn2 = () => resolveRedirects(targetUrl, 5, extraHeaders);
  const doConnect2 = isKakitoVod2 ? () => enqueue(host, connectFn2) : connectFn2;

  try {
    const { statusCode, headers, stream } = await doConnect2();
    if (clientRes.destroyed || clientRes.writableEnded) {
      if (stream) stream.destroy();
      return;
    }
    if (statusCode < 200 || statusCode >= 300) {
      if (!clientRes.headersSent) clientRes.status(502).send(`upstream ${statusCode}`);
      stream.resume();
      return;
    }

    incHostConcurrency(host);
    activeRelayCount++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeRelayCount = Math.max(0, activeRelayCount - 1);
      decHostConcurrency(host);
    };

    const contentType = headers["content-type"] || "video/mp2t";
    const contentLength = headers["content-length"];
    clientRes.status(statusCode);
    clientRes.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=2",
      "X-Relay-Mode": "direct",
    });
    if (contentLength) clientRes.set("Content-Length", contentLength);
    if (headers["content-range"]) clientRes.set("Content-Range", headers["content-range"]);
    if (headers["accept-ranges"]) clientRes.set("Accept-Ranges", headers["accept-ranges"]);

    stream.on("error", (e) => {
      console.error(`[relay] direct pipe error: ${e.message}`);
      release();
      if (!clientRes.destroyed) clientRes.destroy();
    });

    clientRes.on("close", () => {
      release();
      if (!stream.destroyed) stream.destroy();
    });

    stream.pipe(clientRes);
  } catch (e) {
    console.error(`[relay] direct connect error: ${e.message}`);
    if (!clientRes.destroyed && !clientRes.headersSent) clientRes.status(502).send("relay error");
  }
}

const app = express();
app.set("trust proxy", true);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    activeStreams: activeRelayCount,
    maxStreams: MAX_RELAY_STREAMS,
    perHost: Object.fromEntries(hostConnections),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

app.get("/test", async (req, res) => {
  const url = String(req.query.url || "");
  if (!url) return res.status(400).send("missing url param");
  try {
    const { statusCode, headers } = await resolveRedirects(url, 3);
    res.json({ status: statusCode, contentType: headers["content-type"], finalUrl: url });
  } catch (e) {
    res.json({ error: e.message, url });
  }
});

app.get("/stream/proxy", async (req, res) => {
  const targetUrl = String(req.query.url || "");
  if (!targetUrl || !targetUrl.startsWith("http")) return res.status(400).send("invalid url");
  const u = new URL(targetUrl);
  if (/^127\.|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^0\.|^169\.254\.|^localhost$|^\[::1\]$/i.test(u.hostname)) {
    return res.status(403).send("private ip blocked");
  }
  console.log(`[proxy] ${u.hostname} → ${targetUrl.substring(0, 80)}...`);

  let extraHeaders = null;
  const isIptvSource = /biturl|clarotv|calpine|drivetek|praiavip|splossantos|tvtop|ferradura|flowclb|topchannel|visuallives|mixtop|barao|appbraga|jrtv|clubvaivai|bystream|nt4tch|muqq|yz523|znap|grcsgh|g6sdk|h8n7|uk75er|9318|bfcmgy|mep9c/i.test(u.hostname);
  if (isIptvSource) {
    extraHeaders = {
      "Referer": `https://${u.hostname}/`,
      "Origin": `https://${u.hostname}`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    };
  }

  if (req.headers.range) extraHeaders = { ...(extraHeaders || {}), Range: req.headers.range };
  const proxyBase = process.env.RELAY_BASE_URL || `https://${req.headers.host || `localhost:${PORT}`}`;
  try {
    res.set("Connection", "keep-alive");
    await proxyStream(targetUrl, proxyBase, res, extraHeaders);
  } catch (e) {
    console.error(`[stream-proxy] ERROR ${u.hostname}: ${e.message}`);
    if (!res.headersSent) res.status(502).send("proxy error");
  }
});

const httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[relay] Mirror Relay Server rodando na porta ${PORT}`);
  console.log(`[relay] Endpoints:`);
  console.log(`  GET /health`);
  console.log(`  GET /stream/proxy?url=ENCODED_URL`);
});

function shutdown(signal) {
  console.log(`[relay] ${signal} received, draining...`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 60000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
