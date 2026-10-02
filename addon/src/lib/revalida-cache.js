// Revalida em segundo plano a lista de links que veio do CACHE.
//
// O BURACO (medido em 29/09/2026, producao): a prova de vida roda quando a lista e MONTADA. Mas
// o cache de stream vive 15 minutos, e um link que morreu aos 3 minutos continuava sendo entregue
// por 12 minutos. Foi assim que o VZR apareceu com 2 links mortos na auditoria (`Dark` e
// `Round 6`): o scraper JA se protege (lanca `vizer nao entrega o arquivo (HTTP 403)`), mas o
// cache reentregava a URL antiga. A auditoria usava `?cb=` para furar o cache e nao furou — o
// `cacheKey` e montado do tipo/id/temporada/episodio e ignora a query extra.
//
// A CORRECAO nao e diminuir o TTL (15min foi medida como o certo: 50 pessoas no mesmo filme = 5
// chamadas de scraper). E revalidar o que ja esta guardado: quando a lista do cache passa de
// `REVALIDAR_APOS`, dispara uma sondagem dos links em segundo plano e, se UM estiver morto
// confirmado, apaga a entrada para o proximo pedido remontar.
//
// O pedido que chega NUNCA espera por isso — devolve o cache na hora e a checagem roda depois.
// E o custo e minimo: um Range de 1KB por link, uma vez a cada 3 minutos por obra, sem tocar em
// nenhum scraper.

// Chamado pelo objeto (e nao destruturado) para o teste poder substituir a sonda.
const pv = require("./prova-viva");

const REVALIDAR_APOS_MS = 3 * 60 * 1000;
const TEMPO_MINIMO_ENTRE_CHECAGENS_MS = 2 * 60 * 1000;

const emVoo = new Set();
const ultimaChecagem = new Map();

let contador = { checagens: 0, entradasInvalidadas: 0, linksMortos: 0 };

function refererDe(s) {
  const ph = s && s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request;
  return ph ? ph.Referer : undefined;
}

// `invalidar` recebe a funcao que apaga a chave do cache (o `sqliteCache` injeta para nao criar
// dependencia circular com o server).
function agendaRevalidacao(cacheKey, cached, invalidar) {
  if (!cached || !Array.isArray(cached.streams) || !cached.streams.length) return;
  if (emVoo.has(cacheKey)) return;
  const agora = Date.now();
  const ultima = ultimaChecagem.get(cacheKey) || 0;
  if (agora - ultima < TEMPO_MINIMO_ENTRE_CHECAGENS_MS) return;
  ultimaChecagem.set(cacheKey, agora);
  emVoo.add(cacheKey);

  // Fora do caminho da resposta: nao segura o pedido.
  Promise.resolve().then(async () => {
    const links = cached.streams.filter((s) => s && /^https?:/i.test(s.url || ""));
    if (!links.length) return;
    contador.checagens++;
    const vereditos = await Promise.all(links.map((s) => {
      const t0 = Date.now();
      return pv.provaDe(s.url, { timeoutMs: 2500, referer: refererDe(s) }).then((v) => ({ v, ms: Date.now() - t0 }));
    }));
    const mortos = vereditos.filter((x) => x.v && x.v.vivo === false);
    if (!mortos.length) return;
    contador.linksMortos += mortos.length;
    contador.entradasInvalidadas++;
    console.error(`[revalida] ${cacheKey.slice(0, 60)}: ${mortos.length} link(s) morto(s) (${mortos.slice(0, 2).map((m) => m.v.motivo).join(", ")}) — cache invalido`);
    try { invalidar(cacheKey); } catch (_) {}
  }).catch(() => {}).finally(() => emVoo.delete(cacheKey));
}

function stats() {
  return { ...contador, emVoo: emVoo.size, chaves: ultimaChecagem.size };
}

module.exports = { agendaRevalidacao, stats, REVALIDAR_APOS_MS };
