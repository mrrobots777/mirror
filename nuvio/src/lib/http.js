const { TEMPO_FETCH_PADRAO_MS, TEMPO_FETCH_MAX_MS } = require("../core/sandbox");
async function pegar(url, opcoes) {
  const o = opcoes || {};
  const alvo = String(url || "");
  const ms = Math.max(1, Math.min(Number(o.ms || TEMPO_FETCH_PADRAO_MS) || TEMPO_FETCH_PADRAO_MS, TEMPO_FETCH_MAX_MS));
  const controle = new AbortController();
  const init = { method: String(o.metodo || "GET"), headers: Object.assign({}, o.headers || {}), signal: controle.signal };
  if (o.corpo !== void 0 && o.corpo !== null) init.body = o.corpo;
  if (o.redirect) init.redirect = o.redirect;
  let relogio = null;
  let motivo = null;
  try {
    const tarefa = fetch(alvo, init);
    tarefa.catch(() => {
    });
    const estouro = new Promise((_, recusa) => {
      relogio = setTimeout(() => {
        motivo = "timeout";
        try {
          controle.abort();
        } catch (_2) {
        }
        recusa(new Error(`timeout de ${ms}ms em ${alvo}`));
      }, ms);
    });
    return await Promise.race([tarefa, estouro]);
  } catch (e) {
    if (motivo === "timeout") throw e;
    if (controle.signal.aborted) throw new Error(`timeout de ${ms}ms em ${alvo}`);
    throw new Error(`falha de rede em ${alvo}: ${e && e.message ? e.message : String(e)}`);
  } finally {
    clearTimeout(relogio);
  }
}
async function pegarTexto(url, opcoes) {
  const res = await pegar(url, opcoes);
  const texto = await res.text();
  return { ok: !!res.ok, status: res.status, texto, url: String(res.url || url) };
}
async function pegarJson(url, opcoes) {
  const r = await pegarTexto(url, opcoes);
  const cru = String(r.texto || "").trim();
  if (!cru) return { ok: r.ok, status: r.status, dados: null };
  try {
    return { ok: r.ok, status: r.status, dados: JSON.parse(cru) };
  } catch (e) {
    if (r.ok) throw new Error(`JSON invalido em ${url}: ${e && e.message ? e.message : String(e)}`);
    return { ok: false, status: r.status, dados: null };
  }
}
module.exports = { pegar, pegarTexto, pegarJson };
