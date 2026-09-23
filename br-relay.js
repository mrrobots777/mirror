const express = require("express");
const https = require("https");
const { proxyStream } = require("./src/lib/stream-relay");

const PORT = Number(process.env.BR_RELAY_PORT || 8443);
const TOKEN = String(process.env.BR_RELAY_TOKEN || "mr-rtd-7f3c9a2b");
const ALLOWED_HOST = /^(cnn\.radiogaucha\.fun|kakito\.xyz)$/i;
const REFERERS = {
  "cnn.radiogaucha.fun": "https://redetoons.win/",
  "kakito.xyz": "https://kakito.xyz/",
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const RATE_WINDOW = 10 * 1000;
const RATE_MAX = 60;
const FETCH_MAX_BYTES = 4 * 1024 * 1024;

const app = express();
app.disable("x-powered-by");

const hits = new Map();
function allow(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < RATE_WINDOW);
  if (arr.length >= RATE_MAX) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, arr] of hits) {
    if (!arr.length || arr.every((t) => now - t >= RATE_WINDOW)) hits.delete(key);
  }
}, RATE_WINDOW).unref();

// Token do live do KAK. Esta maquina e o unico IP que o WAF do painel aceita (medido: a
// prod, a borda da Cloudflare e o GitHub Actions levam 403; aqui da 200). O token e o mesmo
// para TODOS os canais (medido) e dura — entao o addon busca aqui uma vez por janela e se
// sustenta sozinho ate ele vencer. Nao passa video: e um POST de ~2KB.
const KAKITO_WAF = "https://kakito.xyz:443/live/MirrorPrincipal/ditj7j1h/2252.m3u8";
// Base do WAF (sem o id do canal), para montar a URL de qualquer canal.
const WAF_BASE = KAKITO_WAF.replace(/\/\d+\.m3u8$/, "") + "/";
const TOKEN_TTL = Number(process.env.BR_TOKEN_TTL || 600000);
let tokenCache = { token: "", em: 0 };
let tokenBusy = null;

// So o redirect interessa: e nele que mora o token. fetchDocument segue o redirect, entao
// aqui vai um GET que para no 3xx e devolve o Location.
function pegaLocation(target) {
  return new Promise((resolve) => {
    const req = https.request({
      method: "GET",
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      timeout: 15000,
      headers: { "User-Agent": UA, Accept: "*/*", "Accept-Encoding": "identity" },
    }, (res) => {
      res.resume();
      resolve(res.headers.location || "");
    });
    req.on("error", () => resolve(""));
    req.on("timeout", () => { req.destroy(); resolve(""); });
    req.end();
  });
}

const KAKITO_USER = process.env.IPTV_USERNAME || "MirrorPrincipal";
const KAKITO_PASS = process.env.IPTV_PASSWORD || "ditj7j1h";

async function tokenDoPainel() {
  const agora = Date.now();
  if (tokenCache.token && agora - tokenCache.em < TOKEN_TTL) return tokenCache;
  if (tokenBusy) return tokenBusy;
  tokenBusy = (async () => {
    try {
      const loc = await pegaLocation(new URL(KAKITO_WAF));
      const m = String(loc).match(/token=([^&]+)/);
      if (!m) return tokenCache;
      const t = decodeURIComponent(m[1]);
      if (t) tokenCache = { token: t, em: Date.now() };
      return tokenCache;
    } catch (_) {
      return tokenCache;
    } finally {
      tokenBusy = null;
    }
  })();
  return tokenBusy;
}

app.get("/token", async (_req, res) => {
  const t = await tokenDoPainel();
  res.set("Cache-Control", "no-store");
  if (!t.token) return res.status(503).json({ ok: false, err: "painel nao liberou token" });
  res.json({ token: t.token, idadeSeg: Math.round((Date.now() - t.em) / 1000) });
});

// A LISTA do canal (a "informacao de qual segmento tocar").
//
// POR QUE ISTO AQUI E NAO NO ADDON: o painel (kakito.xyz) so aceita IP residencial, e a
// producao e datacenter — medido, o WAF devolve 403 para a producao. Esta maquina e
// residencial, entao e a unica que consegue. E 2,8 KB de TEXTO por canal a cada 25s: o
// VIDEO nunca passa aqui, continua saindo direto da origem (206.109.57.195) e sendo
// guardado pela borda pelo hash do conteudo. Medido: 4,3 KB por requisicao, 4,2 GB por mes
// com 10 canais — 0,002% do que o video custaria.
//
// E a mesma ideia da ETC: o video nunca depende do dono da fonte, so da lista.
const listaCache = new Map();
const LISTA_TTL = Number(process.env.KAK_LISTA_TTL || 25000);
const listaBusy = new Map();
const STATS_LISTA = { pedidos: 0, servidos: 0, erros: 0, bytes: 0 };
const STATS_VERIF = { sweeps: 0, canais: 0, ok: 0, msTotal: 0 };
let filaLista = [];
const prioridadeLista = [];   // pedido do usuario entra na frente da verificacao
let ativasLista = 0;
const MAX_LISTA = 2;

// Abaixo disso a lista e considerada POBRE: o player fica sem reserva e um unico segmento
// que ja sumiu da origem mata o canal. A origem entrega 5-6; o WAF as vezes entrega 1.
const MIN_SEGMENTOS = 3;
const contaSegmentos = (t) => t.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;

async function listaDoCanal(id) {
  const agora = Date.now();
  const guardado = listaCache.get(id);
  if (guardado && agora - guardado.em < LISTA_TTL) return guardado;
  if (listaBusy.has(id)) return listaBusy.get(id);

  const p = (async () => {
    // 1) WAF: precisa do Referer do player, e devolve 302 com um tokennovo.
    // 2) Origem com o token do relay: mesma coisa que a producao faz.
    const tentativas = [
      { url: `${WAF_BASE}${id}.m3u8`, ref: "https://sinaldvd.github.io/tv/player.html" },
      { url: `http://206.109.57.195:80/live/${KAKITO_USER}/${KAKITO_PASS}/${id}.m3u8?token=${encodeURIComponent((await tokenDoPainel()).token || "")}` },
    ];
    let melhor = null;
    for (const alvo of tentativas) {
      try {
        const headers = { "User-Agent": UA };
        if (alvo.ref) headers.Referer = alvo.ref;
        const r = await fetch(alvo.url, { headers, signal: AbortSignal.timeout(20000) });
        if (!r.ok) continue;
        const t = await r.text();
        if (!t.startsWith("#EXTM3U")) continue;
        const n = contaSegmentos(t);
        const cand = { texto: absolutiza(t, r.url), final: r.url, em: Date.now(), n, fonte: alvo.ref ? "waf" : "origem" };
        if (!melhor || n > melhor.n) melhor = cand;
        // A PRIMEIRA fonte que responde quase sempre basta. So se ela vier pobre (1
        // segmento, sem folga) vale pagar a segunda, porque e a origem que entrega a
        // lista completa. MEDIDO: o WAF devolvia 1 segmento e a origem 6, para o MESMO
        // canal 4065, e o relay ficava com o primeiro. Lista de 1 segmento nao da
        // reserva (buffer) no player, e o ffmpeg dava "Invalid data found".
        if (n >= MIN_SEGMENTOS) break;
      } catch (_) { /* proxxima fonte */ }
    }
    if (melhor) {
      listaCache.set(id, melhor);
      STATS_LISTA.bytes += melhor.texto.length;
      STATS_LISTA.pobres = (STATS_LISTA.pobres || 0) + (melhor.n < MIN_SEGMENTOS ? 1 : 0);
      return melhor;
    }
    STATS_LISTA.erros++;
    return guardado || null;
  })().finally(() => listaBusy.delete(id));

  listaBusy.set(id, p);
  return p;
}

// A URL do segmento no WAF e relativa a pagina que redirecionou; o addon precisa do
// endereco completo, entao resolvemos contra a base que o WAF devolveu.
function absolutiza(texto, base) {
  if (!base) return texto;
  try {
    return texto.split("\n").map((l) => {
      const t = l.trim();
      if (!t || t.startsWith("#")) return l;
      if (/^https?:/i.test(t)) return l;
      return new URL(t, base).href;
    }).join("\n");
  } catch (_) { return texto; }
}

// O QUE O USUARIO ESTA ABRINDO VEM PRIMEIRO.
//
// MEDIDO: com a varredura de verificacao disputando as ~2 conexoes que o painel libera, o
// playlist de quem abria um canal ficava na fila e o gateway cortava em 12s. A verificacao e
// trabalho de fundo: ela espera.
function agendaLista(id, prioridade) {
  if (ativasLista >= MAX_LISTA) {
    return new Promise((resolve) => {
      const item = { id, resolve };
      if (prioridade) prioridadeLista.unshift(item);
      else filaLista.push(item);
      // nao deixa a fila crescer sem limite: o que sobra e descartado, nao a espera toda
      if (filaLista.length + prioridadeLista.length > 400) {
        const v = filaLista.shift();
        if (v) v.resolve(null);
      }
    }).then(() => listaDoCanal(id));
  }
  ativasLista++;
  return listaDoCanal(id).finally(() => {
    ativasLista--;
    // sempre da proxima vez a da frente: quem esta esperando um canal para assistir
    const prox = prioridadeLista.shift() || filaLista.shift();
    if (prox) prox.resolve(null);
  });
}

app.get("/pl/:id", async (req, res) => {
  const id = String(req.params.id || "").replace(/\.m3u8$/i, "");
  if (!/^\d{1,8}$/.test(id)) return res.status(400).send("bad id");
  STATS_LISTA.pedidos++;
  const r = await agendaLista(id, true);
  if (!r) {
    res.set("Cache-Control", "no-store");
    return res.status(503).send("painel ocupado");
  }
  res.set({
    "Content-Type": "application/vnd.apple.mpegurl",
    "Cache-Control": "no-store",
    "X-Relay-Fonte": r.fonte,
    "X-Relay-Idade": String(Math.round((Date.now() - r.em) / 1000)),
  });
  res.send(r.texto);
});

// Cache de listas expira por TTL; a limpeza so existe para nao deixar o mapa crescer com
// canais que nunca voltam.
setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of listaCache) if (agora - v.em > LISTA_TTL * 8) listaCache.delete(k);
}, 60000).unref();

app.get("/healthz", (_req, res) => {
  res.type("text").send("ok");
});

// VERIFICACAO DE CANAIS.
//
// A regra do dono: "fonte que nao toca no 1o play nao entra". O catalogo do KAK anuncia 733
// canais, mas o painel so entrega ~26 Mbps de video (medido), o que da ~8 canais diferentes
// ao mesmo tempo — e boa parte das 733 entradas esta quebrada. Entao a oferta tem de ser
// verificada, nao creditada.
//
// Aqui a verificacao e BARATA e honesta: pede a lista (2,8 KB) e um pedaco minimo do
// primeiro segmento. Se os dois vierem, o canal toca. Custa ~1,5 KB de banda por canal
// verificado — um sweep completo de 733 canais gasta cerca de 1,1 MB.
//
// Feito aqui, e nao no addon, porque o WAF so aceita IP residencial.
app.post("/pl/verificar", async (req, res) => {
  let bruto = "";
  let grande = false;
  req.on("data", (c) => {
    bruto += c;
    if (bruto.length > 32 * 1024) { grande = true; req.destroy(); }
  });
  req.on("end", async () => {
    if (grande) return res.status(413).send("payload grande");
    let ids;
    try { ids = JSON.parse(bruto || "{}").ids; } catch (_) { ids = null; }
    if (!Array.isArray(ids)) return res.status(400).json({ erro: "mande { ids: [...] }" });
    const limpos = ids.map((x) => String(x)).filter((x) => /^\d{1,8}$/.test(x)).slice(0, 40);
    if (!limpos.length) return res.status(400).json({ erro: "nenhum id valido" });

    const resultados = [];
    // 2 por vez: e o limite do painel, medido.
    // UMA POR VEZ, com intervalo. A verificacao e trabalho de fundo e nao pode roubar a
    // conexao de quem esta abrindo um canal. MEDIDO a 2 por vez: 47% de recusa do painel
    // (10159 de 21630 pedidos) e 504 no playlist de quem assistia.
    // 4 por vezada, e com mais espacamento, porque agora o nginx tambem fala com o painel e
    // os dois disputam o mesmo teto de ~2 conexoes. A varredura e saude de fundo: nao pode
    // custar banda de quem esta abrindo um canal. Uma passada completa pelos 733 canais
    // leva cerca de 1 h com estes numeros, e isso e aceitavel para um trabalho de fundo.
    const espera = Number(process.env.KAK_VERIF_ESPACO || 2500);
    for (const id of limpos.slice(0, 4)) {
      resultados.push(await verificaUm(id));
      if (espera) await new Promise((r) => setTimeout(r, espera));
    }

    const ok = resultados.filter((r) => r.ok).map((r) => r.id);
    STATS_VERIF.sweeps++;
    STATS_VERIF.canais += resultados.length;
    STATS_VERIF.ok += ok.length;
    STATS_VERIF.msTotal += Date.now() - (Date.now() - resultados.reduce((m, r) => Math.max(m, r.ms), 0));
    STATS_LISTA.pedidos += resultados.length;
    STATS_LISTA.servidos += ok.length;
    STATS_LISTA.erros += resultados.length - ok.length;
    res.set("Cache-Control", "no-store");
    res.json({ verificados: resultados, ok, ruins: resultados.filter((r) => !r.ok).map((r) => r.id), em: Date.now() });
  });
});

async function verificaUm(id) {
  const t0 = Date.now();
  // 1) a lista
  const pl = await listaDoCanal(id);
  if (!pl) return { id, ok: false, motivo: "sem lista", ms: Date.now() - t0 };
  const segs = pl.texto.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  if (!segs.length) return { id, ok: false, motivo: "lista sem segmento", ms: Date.now() - t0 };
  const abs = /^https?:/i.test(segs[0]) ? segs[0] : new URL(segs[0], pl.final || WAF_BASE).href;

  // 2) o pedaco do primeiro segmento.
  //
  // MEDIDO: a origem IGNORA o cabecalho Range e devolve o arquivo inteiro (4,6 MB). Ler o
  // corpo todo custaria 733 x 4,6 MB = 3,4 GB por varredura. Entao le o primeiro bloco e
  // CANCELA o resto — baixa ~64 KB por canal e para. O que importa e o cabecalho do
  // MPEG-TS: 0x47 a cada 188 bytes.
  let r;
  try {
    r = await fetch(abs, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  } catch (_) {
    return { id, ok: false, motivo: "origem travou", ms: Date.now() - t0 };
  }
  if (!r.ok) {
    return { id, ok: false, motivo: "origem " + r.status, ms: Date.now() - t0 };
  }

  let bloco = null;
  try {
    const leitor = r.body.getReader();
    const primeira = await leitor.read();
    bloco = primeira.value || null;
    await leitor.cancel();          // para o download aqui
  } catch (_) { /* cai no teste abaixo */ }

  if (!bloco || bloco.byteLength < 188) {
    return { id, ok: false, motivo: "segmento vazio", ms: Date.now() - t0, lidos: bloco ? bloco.byteLength : 0 };
  }
  // MPEG-TS: byte de sincronise 0x47 no inicio e a cada 188. Conferir os tres primeiros
  // pontos pega pagina de erro, HTML e JSON no lugar do video.
  const v = new Uint8Array(bloco);
  if (v[0] !== 0x47) return { id, ok: false, motivo: "comeca com 0x" + v[0].toString(16) + ", nao 0x47", ms: Date.now() - t0 };
  if (v[188] !== undefined && v[188] !== 0x47) return { id, ok: false, motivo: "sem sincronise em 188", ms: Date.now() - t0 };
  if (v[376] !== undefined && v[376] !== 0x47) return { id, ok: false, motivo: "sem sincronise em 376", ms: Date.now() - t0 };

  STATS_VERIF.bytes = (STATS_VERIF.bytes || 0) + v.byteLength;
  return { id, ok: true, motivo: "ok", fonte: pl.fonte, ms: Date.now() - t0, lidos: v.byteLength };
}

app.get("/pl-stats", (_req, res) => {
  res.json({
    listas: { ...STATS_LISTA, ativas: ativasLista, esperando: filaLista.length, noCache: listaCache.size, max: MAX_LISTA },
    verificacao: STATS_VERIF,
    tokenIdadeSeg: Math.round((Date.now() - tokenCache.em) / 1000),
  });
});

app.get("/play", async (req, res) => {
  const ip = String(req.ip || "unknown");
  if (!allow(ip)) return res.status(429).send("rate limited");
  const k = String(req.query.k || "");
  if (k !== TOKEN) return res.status(404).send("not found");
  let target;
  try {
    target = new URL(String(req.query.u || ""));
  } catch (_) {
    return res.status(400).send("bad url");
  }
  if (!/^https:$/i.test(target.protocol) || !ALLOWED_HOST.test(target.hostname)) {
    return res.status(404).send("not found");
  }
  const extraHeaders = { "User-Agent": UA };
  const ref = REFERERS[target.hostname.toLowerCase()];
  if (ref) extraHeaders.Referer = ref;
  if (req.headers.range) extraHeaders.Range = req.headers.range;
  try {
    res.set("Connection", "keep-alive");
    await proxyStream(target.href, `http://127.0.0.1:${PORT}`, res, extraHeaders);
  } catch (e) {
    console.error(`[br-relay] ${e.message}`);
    if (!res.headersSent) res.status(502).send("relay error");
  }
});

function fetchDocument(target, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: "GET",
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      timeout: 15000,
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "identity",
        "Referer": target.origin + "/",
      },
    }, (res) => {
      const status = res.statusCode || 502;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        if (redirects >= 5) return reject(new Error("too many redirects"));
        let next;
        try {
          next = new URL(location, target.href);
        } catch (_) {
          return reject(new Error("bad redirect"));
        }
        if (next.protocol !== "https:") return reject(new Error("redirect protocol"));
        return fetchDocument(next, redirects + 1).then(resolve, reject);
      }
      const chunks = [];
      let total = 0;
      let aborted = false;
      res.on("data", (c) => {
        if (aborted) return;
        total += c.length;
        if (total > FETCH_MAX_BYTES) {
          aborted = true;
          res.destroy();
          reject(new Error("response too large"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        if (aborted) return;
        resolve({ status, headers: res.headers, body: Buffer.concat(chunks) });
      });
      res.on("error", (e) => {
        if (!aborted) reject(e);
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("fetch timeout")));
    req.end();
  });
}

app.get("/fetch", async (req, res) => {
  const ip = String(req.ip || "unknown");
  if (!allow(ip)) return res.status(429).send("rate limited");
  const k = String(req.query.k || "");
  if (k !== TOKEN) return res.status(404).send("not found");
  let target;
  try {
    target = new URL(String(req.query.u || ""));
  } catch (_) {
    return res.status(400).send("bad url");
  }
  if (!/^https:$/i.test(target.protocol) || !ALLOWED_HOST.test(target.hostname)) {
    return res.status(404).send("not found");
  }
  try {
    const out = await fetchDocument(target);
    res.status(out.status);
    const ct = out.headers["content-type"];
    if (ct) res.set("Content-Type", ct);
    if (out.headers["content-range"]) res.set("Content-Range", out.headers["content-range"]);
    if (out.headers["accept-ranges"]) res.set("Accept-Ranges", out.headers["accept-ranges"]);
    if (out.headers["content-encoding"]) res.set("Content-Encoding", out.headers["content-encoding"]);
    res.set("Cache-Control", "no-store");
    res.send(out.body);
  } catch (e) {
    console.error(`[br-relay] fetch ${e.message}`);
    if (!res.headersSent) res.status(502).send("relay error");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[br-relay] listening on :${PORT}`);
});
