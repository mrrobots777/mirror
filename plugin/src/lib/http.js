const { TEMPO_FETCH_PADRAO_MS, TEMPO_FETCH_MAX_MS } = require("../core/sandbox");

// O `ms` de uma chamada cobre OS CABECALHOS E O CORPO — nao so a promessa do `fetch`.
//
// MEDIDO 02/10/2026 no DGO (`forks-doramas.madfirebox.shop`): os headers chegam em
// 0,23 s e o corpo (24 KB de playlist) so fica pronto em 15,1 s. A versao anterior
// resolvia o `Promise.race` no `fetch` e limpava o relogio no `finally`, entao o
// `res.text()` ficava SEM TEMPO LIMITE: a fonte do DGO levava 15,6 s e um `getStreams`
// podia passar do orcamento do Nuvio sem que o teto percebesse.
//
// Por isso o relogio continua armedado ate o corpo terminar, e os metodos de corpo da
// resposta sao embrulhados para estourar no mesmo prazo.
function comPrazo(res, controle, alvo, ms, relogio) {
  const estouroDoCorpo = () => new Error(`timeout de ${ms}ms em ${alvo}`);
  const corpo = (fn) => (...args) => {
    // O corpo passa a contar daqui: o tempo do cabecalho ja foi gasto.
    clearTimeout(relogio.t);
    relogio.t = setTimeout(() => {
      try {
        controle.abort();
      } catch (_) {
      }
    }, ms);
    // O `abort` faz a leitura do corpo rejeitar com "aborted"/AbortError, e isso
    // chega antes do relogio de recusa. Traduzir para a mensagem de tempo e' o que
    // mantem a mensagem util — quem classifica erro olha `erroDeRede()`, que ja
    // conhece "aborted", mas o log do dono precisa dizer QUE deu errado.
    const leitura = fn.apply(res, args).catch((e) => {
      if (controle.signal.aborted) throw estouroDoCorpo();
      throw e;
    });
    const estouro = new Promise((_, recusa) => {
      relogio.aviso = setTimeout(() => recusa(estouroDoCorpo()), ms);
    });
    return Promise.race([leitura, estouro]).finally(() => {
      clearTimeout(relogio.t);
      clearTimeout(relogio.aviso);
    });
  };
  // So os metodos que a resposta realmente tem sao embrulhados: um duplo de teste
  // (e um `fetch` parcial de runtime) pode nao ter `json`/`blob`, e exigir `.bind`
  // no que nao existe estoura a chamada inteira.
  const metodo = (nome) => (typeof res[nome] === "function" ? corpo(res[nome].bind(res)) : undefined);
  return {
    get ok() { return res.ok; },
    get status() { return res.status; },
    get statusText() { return res.statusText; },
    get url() { return res.url; },
    get redirected() { return res.redirected; },
    get type() { return res.type; },
    headers: res.headers,
    body: res.body,
    text: metodo("text"),
    json: metodo("json"),
    arrayBuffer: metodo("arrayBuffer"),
    blob: metodo("blob")
  };
}

async function pegar(url, opcoes) {
  const o = opcoes || {};
  const alvo = String(url || "");
  const ms = Math.max(1, Math.min(Number(o.ms || TEMPO_FETCH_PADRAO_MS) || TEMPO_FETCH_PADRAO_MS, TEMPO_FETCH_MAX_MS));
  const controle = new AbortController();
  const init = { method: String(o.metodo || "GET"), headers: Object.assign({}, o.headers || {}), signal: controle.signal };
  if (o.corpo !== void 0 && o.corpo !== null) init.body = o.corpo;
  if (o.redirect) init.redirect = o.redirect;
  const relogio = { t: null, aviso: null };
  let motivo = null;
  try {
    const tarefa = fetch(alvo, init);
    tarefa.catch(() => {
    });
    const estouro = new Promise((_, recusa) => {
      relogio.t = setTimeout(() => {
        motivo = "timeout";
        try {
          controle.abort();
        } catch (_2) {
        }
      }, ms);
      relogio.aviso = setTimeout(() => recusa(new Error(`timeout de ${ms}ms em ${alvo}`)), ms);
    });
    const res = await Promise.race([tarefa, estouro]);
    return comPrazo(res, controle, alvo, ms, relogio);
  } catch (e) {
    if (motivo === "timeout") throw e;
    if (controle.signal.aborted) throw new Error(`timeout de ${ms}ms em ${alvo}`);
    throw new Error(`falha de rede em ${alvo}: ${e && e.message ? e.message : String(e)}`);
  } finally {
    clearTimeout(relogio.t);
    clearTimeout(relogio.aviso);
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
