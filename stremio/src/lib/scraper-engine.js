const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_FAILS = 3;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function normalizeKind(kind) {
  if (Array.isArray(kind)) return new Set(kind.map(k => String(k).toLowerCase()));
  return new Set([String(kind || "vod").toLowerCase()]);
}

function defineSource(def) {
  if (!def || typeof def.run !== "function") throw new Error("defineSource: run obrigatorio");
  if (!def.id) throw new Error("defineSource: id obrigatorio");
  return {
    id: String(def.id),
    label: String(def.label || def.id).toUpperCase(),
    kinds: normalizeKind(def.kind),
    timeoutMs: toPositiveInt(def.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxFails: toPositiveInt(def.maxFails, DEFAULT_MAX_FAILS),
    cooldownMs: toPositiveInt(def.cooldownMs, DEFAULT_COOLDOWN_MS),
    optional: def.optional === true,
    when: typeof def.when === "function" ? def.when : null,
    warm: typeof def.warm === "function" ? def.warm : null,
    run: def.run,
  };
}

// SEGUNDA CHANCE. Uma fonte que tem o item e mesmo assim nao devolve o player quase sempre e
// caso de rede: o servidor do site subiu uma resposta 502, o socket caiu, o request estourou.
// Refazer a chamada custa ~200-800ms e devolve o Stream que a pessoa ia ver.
//
// O que NAO se refaz (e por que):
// - `timeout`: ja consumiu o orcamento do pedido. Refazer e esperar o mesmo estourar de novo
//   gasta os 9s do gateway sem chance nenhuma de dar certo.
// - "nao encontrou o titulo": e resposta legitima. Refazer martela o site e nao muda nada.
// - 404: o item nao existe mesmo.
//
// MEDIDO em 29/09/2026: 45 pedidos identicos em 9 fontes que tem o item -> 45 devolveram (100%),
// mas a OSCILACAO e grande (RON 3442ms, BLZ 6023ms de diferenca entre o mais rapido e o mais
// lento). Oscilacao assim e o que faz uma request fria passar do orcamento do gateway; a
// segunda chance e justamente para o caso em que a segunda vez vem mais rapida.
const TRANSITORIO = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|premature|network|aborted|too many hosts|host queue full|HTTP (?:429|50\d)|502|503|504|bad status|status 0/i;

function erroTransitorio(e) {
  if (!e) return false;
  if (e.timeout) return false;
  if (e.semRetry) return false;
  return TRANSITORIO.test(String(e.message || e));
}

function dormir(ms) {
  // SEM `unref()` de proposito: com ele, se a unica coisa pendente no event loop fosse a pausa da
  // segunda tentativa, o node encerraria o processo achando que o trabalho acabou — o que quebra o
  // teste e, no meio de um shutdown, derrubaria requests em andamento. 120ms nao custam nada.
  return new Promise(r => { setTimeout(r, ms); });
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      const e = new Error(`${label}: timeout ${ms}ms`);
      e.timeout = true;
      reject(e);
    }, ms);
    if (timer.unref) timer.unref();
    promise.then(
      value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function normalizeStream(raw, source, context) {
  if (!raw || typeof raw !== "object") return null;
  const url = typeof raw.url === "string" ? raw.url : "";
  if (!url) return null;
  const isMovie = context.type === "movie";
  const season = toPositiveInt(raw.season, toPositiveInt(context.season, isMovie ? 0 : 1));
  const episode = raw.episode === 0 ? 0 : toPositiveInt(raw.episode, toPositiveInt(context.episode, 1));
  const sources = Array.isArray(raw.sources) && raw.sources.length ? raw.sources.map(s => String(s).toLowerCase()) : [source.id];
  const headers = raw.headers || (raw.behaviorHints && raw.behaviorHints.proxyHeaders && raw.behaviorHints.proxyHeaders.request) || null;
  const quality = raw.quality && raw.quality !== "none" ? String(raw.quality) : "unknown";
  const stream = {
    ...raw,
    id: String(raw.id || `${source.id}:${context.type}:${context.key || ""}`),
    type: raw.type || context.type,
    name: raw.name || `Mirror ${quality}`,
    url,
    season,
    episode,
    quality,
    size: toPositiveInt(raw.size, 0),
    sources,
    dubbed: raw.dubbed === true,
    portuguese: raw.portuguese === true,
    subtitle: raw.subtitle === true,
    subtitles: Array.isArray(raw.subtitles) ? raw.subtitles : [],
    behaviorHints: {
      notWebReady: raw.behaviorHints && raw.behaviorHints.notWebReady !== undefined
        ? raw.behaviorHints.notWebReady === true
        : !!headers,
      bingeGroup: (raw.behaviorHints && raw.behaviorHints.bingeGroup) || "mirror",
      ...(headers ? { proxyHeaders: { request: { ...headers } } } : {}),
      ...(raw.behaviorHints && raw.behaviorHints.live ? { live: true } : {}),
    },
  };
  if (raw.live) {
    stream.behaviorHints.live = true;
    stream.isLive = true;
  }
  if (raw.poster) stream.poster = raw.poster;
  if (raw.audioUnknown) stream.audioUnknown = true;
  return stream;
}

function createEngine(options = {}) {
  const sources = new Map();
  const state = new Map();
  const inflight = new Map();
  const limits = { started: 0, ok: 0, failed: 0, timeout: 0, skipped: 0, streams: 0, empty: 0, retries: 0, bySource: {} };

  function stat(id) {
    if (!state.has(id)) state.set(id, { fails: 0, openUntil: 0, lastError: null, lastOk: 0, calls: 0 });
    return state.get(id);
  }

  function use(def) {
    const source = defineSource(def);
    sources.set(source.id, source);
    stat(source.id);
    limits.bySource[source.id] = { calls: 0, ok: 0, failed: 0, timeout: 0, skipped: 0, streams: 0, retries: 0 };
    return source;
  }

  function accepts(source, context) {
    if (context.kind && !source.kinds.has(String(context.kind).toLowerCase())) return false;
    if (source.when) {
      try { if (source.when(context) !== true) return false; } catch (_) { return false; }
    }
    return true;
  }

  function breakerOpen(source) {
    const s = stat(source.id);
    if (s.openUntil > Date.now()) return s;
    if (s.openUntil && s.openUntil <= Date.now()) {
      s.openUntil = 0;
      s.fails = 0;
    }
    return s;
  }

  function recordSuccess(source, count) {
    const s = stat(source.id);
    s.fails = 0;
    s.openUntil = 0;
    s.lastOk = Date.now();
    s.lastError = null;
    limits.bySource[source.id].ok++;
  }

  function recordFailure(source, error) {
    const s = stat(source.id);
    if (error && error.timeout) {
      // tempo esgotado NAO e fonte quebrada: e fonte lenta. Abrir o disjuntor aqui
      // tirava a fonte da lista por 5 minutos mesmo ela estando entregando.
      limits.bySource[source.id].timeout++;
      limits.timeout++;
      s.lastError = String((error && error.message) || error || "erro").slice(0, 160);
      s.fails = 0;
      return;
    }
    s.fails++;
    s.lastError = String((error && error.message) || error || "erro").slice(0, 160);
    if (s.fails >= source.maxFails) s.openUntil = Date.now() + source.cooldownMs;
    limits.bySource[source.id].failed++;
  }

  async function invoke(source, context, jaTentou) {
    const chamada = Date.now();
    limits.started++;
    limits.bySource[source.id].calls++;
    stat(source.id).calls++;
    try {
      const raw = await withTimeout(Promise.resolve(source.run(context)), source.timeoutMs, source.id);
      let list = Array.isArray(raw) ? raw : [];
      const variantes = Array.isArray(context.titles) ? context.titles : [];
      if (!list.length && variantes.length > 1) {
        for (let i = 1; i < variantes.length && !list.length; i++) {
          const alt = { ...context, title: variantes[i], key: `${context.key}|a${i}` };
          const rawAlt = await withTimeout(Promise.resolve(source.run(alt)), source.timeoutMs, `${source.id}:alt`);
          if (Array.isArray(rawAlt) && rawAlt.length) list = rawAlt;
        }
      }
      const streams = list.map(item => normalizeStream(item, source, context)).filter(Boolean);
      limits.streams += streams.length;
      limits.bySource[source.id].streams += streams.length;
      if (!streams.length) limits.empty++;
      recordSuccess(source, streams.length);
      return streams;
    } catch (e) {
      // Segunda chance so em tropeço de rede E se a chamada voltou rapido (ou seja, sobrou
      // orcamento). `jaTentou` impede a repeticao infinita.
      const passou = Date.now() - chamada;
      if (!jaTentou && erroTransitorio(e) && passou < source.timeoutMs * 0.5) {
        limits.retries++;
        limits.bySource[source.id].retries++;
        await dormir(120);
        return invoke(source, context, true);
      }
      recordFailure(source, e);
      throw e;
    }
  }

  function runOne(source, context) {
    const chave = `${source.id}:${context.key || context.title || ""}:${context.episode || 1}:${context.season || 0}`;
    if (inflight.has(chave)) return inflight.get(chave);
    const s = breakerOpen(source);
    if (s.openUntil > Date.now()) {
      limits.skipped++;
      limits.bySource[source.id].skipped++;
      return Promise.resolve([]);
    }
    const promise = invoke(source, context).finally(() => inflight.delete(chave));
    inflight.set(chave, promise);
    return promise;
  }

  function pick(context) {
    return [...sources.values()].filter(src => accepts(src, context));
  }

  function start(context) {
    return pick(context).map(source => ({
      source,
      promise: runOne(source, context).catch(e => {
        const partial = e && Array.isArray(e.partialStreams) ? e.partialStreams : null;
        if (partial) return partial.map(item => normalizeStream(item, source, context)).filter(Boolean);
        throw e;
      }),
    }));
  }

  function fanOut(context) {
    const list = pick(context);
    const results = [];
    const failures = [];
    for (const source of list) {
      if (!accepts(source, context)) continue;
      results.push(
        runOne(source, context).catch(e => {
          failures.push({ id: source.id, error: e });
          const partial = e && Array.isArray(e.partialStreams) ? e.partialStreams : null;
          if (partial) return partial.map(item => normalizeStream(item, source, context)).filter(Boolean);
          return [];
        })
      );
    }
    return Promise.all(results).then(chunks => ({ streams: chunks.flat(), failures, total: list.length, running: results.length }));
  }

  function warmup() {
    for (const source of sources.values()) {
      if (!source.warm) continue;
      try { Promise.resolve(source.warm()).catch(() => {}); } catch (_) {}
    }
  }

  function reset() {
    for (const s of state.values()) {
      s.fails = 0;
      s.openUntil = 0;
    }
  }

  function stats() {
    return {
      ...limits,
      registered: sources.size,
      openBreakers: [...state.entries()].filter(([, s]) => s.openUntil > Date.now()).map(([id]) => id),
      sources: Object.fromEntries(Object.entries(limits.bySource).map(([id, v]) => {
        // O estado interno (ultimo OK, ultimo erro, falhas seguidas) e o que permite dizer
        // "caida" em vez de "chamou e deu timeout uma vez". Medido 30/09: o /health mostrava
        // so contadores, e nao dava para saber se uma fonte estava quebrando ha horas.
        const s = state.get(id) || { fails: 0, openUntil: 0, lastError: null, lastOk: 0 };
        return [id, {
          ...v,
          open: s.openUntil > Date.now(),
          fails: s.fails,
          lastOk: s.lastOk,
          lastError: s.lastError,
        }];
      })),
    };
  }

  return { use, start, fanOut, runOne, pick, warmup, reset, stats, get size() { return sources.size; } };
}

module.exports = { createEngine, normalizeStream, erroTransitorio };
