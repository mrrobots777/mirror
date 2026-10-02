const { ENV } = require("../core/nomes");
const { getGzText } = require("./scraper-utils");
const reiApi = require("../scrapers/reidosembeds");

// FONTE UNICA DO EPG: a API do Rei dos Embeds (decisao 121). O dono pediu que a guia venha
// de lá porque é o site que já tem a API de EPG — e ela entrega XMLTV pronto, com
// `cache-control: max-age=86400, public` na borda do Cloudflare. Medido em 30/09/2026:
// 1,25MB, 327 canais declarados, 3.972 programas na janela de 143 canais, cobrindo de ontem
// 19h até amanhã 03:20 (o HTML de `/guia`, que era o que raspávamos, tinha 1.679 blocos e só
// metade do dia).
//
// O que saiu: o `epg_BR.xml.gz` do epg.pw (570KB gz). Era o maior consumidor isolado de
// memoria do processo — +17MB de heap e +75MB de RSS, 18.459 programas na janela. O XMLTV do
// REI tem 4x menos programas, entao a guia passa a custar ~4MB em vez de ~17MB, que numa
// servidora que sobe em 226MB e a diferenca entre caber e nao caber no teto de 300MB.
const SOURCES = [
  { url: ENV.EPG_REI_URL || "https://reidosembeds.online/api/guia", region: "REI" },
];

const REFRESH_MS = 30 * 60 * 1000;
// Janela do EPG em dias. Medido em 28/09/2026 com 300 usuarios: o EPG sozinho consumia
// **+17MB de heap e +75MB de RSS** (rss 48->123MB), e era o maior consumidor isolado do
// processo — o catalogo de TV inteiro (283 canais) pesa 14MB e 120 canais de stream, 7MB.
// Num servidor que ja sobe em 226MB, 17MB nao e ruido: sao ~6% do teto do dono.
//
// O que o EPG guarda por programa e a tupla minima `[titulo, inicioEpoch, fimEpoch]` (ver
// `porNome`) — ja enxuta de proposito. O custo esta na QUANTIDADE: 18.459 programas na
// janela. Cada dia a mais sao ~6.000 programas e ~6MB.
//
// 1 dia em vez de 2 (eram 3 dias: ontem, hoje e os 2 seguintes): a aba Channel Guide do
// Stremio mostra o dia inteiro, e o `extra.date` do catalogo pede o dia que a pessoa
// selecionou. Quem navega para amanha ainda tem a aba, porque `dataDe` recalcula a partir
// do epoch — mas o programa de amanha so existe se estiver na janela. Trocar 2 por 1 segura
// ~6MB e NAO muda o que o veiculo ve hoje, que e onde a guia importa.
const DIAS_FUTURO = Number(ENV.EPG_DIAS_FUTURO || 1);
const MAX_BYTES = 24 * 1024 * 1024;

const state = {
  status: "vazio",
  carregadoEm: 0,
  porNome: new Map(),
  lastError: null,
};

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function interessa(chave, filtro) {
  if (filtro.has(chave)) return true;
  for (const alvo of filtro) {
    if (!alvo || alvo.length < 4) continue;
    if (chave.includes(alvo) || alvo.includes(chave)) return true;
  }
  return false;
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(hd|sd|fhd|uhd|4k|ao vivo|live|br)\b/g, " ")
    .replace(/^24h/, "24horas")
    .replace(/[^a-z0-9]+/g, "")
    .trim()
    .replace(/^24horas/, "");
}

function fmtHora(epochSeg) {
  try {
    const d = new Date(epochSeg * 1000);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  } catch (_) {
    return "";
  }
}

const EPG_TZ_OFFSET = 3 * 3600;

function epochDe(stamp) {
  const d = String(stamp || "").trim().match(/(\d{4})(\d{2})(\d{2})\D?(\d{2})(\d{2})(\d{2})/);
  if (!d) return NaN;
  return Math.floor((Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(d[4]), Number(d[5]), Number(d[6])) + EPG_TZ_OFFSET * 1000) / 1000);
}

function dataDe(epochSeg) {
  return new Date(epochSeg * 1000).toISOString().slice(0, 10);
}

function meiaNoite(epochSeg, diasAdiante) {
  const d = new Date(epochSeg * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (diasAdiante || 0)) / 1000);
}

function parse(xml, filtro) {
  const agora = Math.floor(Date.now() / 1000);
  // Janela da guia: de ontem 00:00 ate o dia seguinte (o `DIAS_FUTURO` por cima).
  // MEDIDO em 29/09/2026 (tentativa, revertida, quando a guia ainda era o `epg_BR.xml.gz`):
  // estreitar para "so hoje e amanha" nao comprava economia — 12.533 programas na janela de
  // 3 dias contra 13.341 na de 2, ou seja, mexer no piso nao tira nada e empurra o teto para
  // o fim (3h de programas de amanha entram e o total sobe). A janela fica como estava, que
  // e o caminho validado.
  // Com a guia do REI a janela inteira sao 3.972 programas (era 18.459), entao o tamanho
  // deixou de ser o problema. O que derruba RSS de verdade e o `MALLOC_ARENA_MAX=2` do Dockerfile.
  const piso = meiaNoite(agora, -1);
  const teto = meiaNoite(agora, DIAS_FUTURO + 1);
  const canais = new Map();
  const chanRe = /<channel id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g;
  let m;
  while ((m = chanRe.exec(xml))) {
    const d = /<display-name[^>]*>([^<]*)<\/display-name>/.exec(m[2]);
    if (!d) continue;
    // DECODIFICA A ENTIDADE. Medido em 30/09/2026 na API do REI: `A&E` vem escrito `A&amp;E`
    // (igual Discovery Home &amp; Health e Film&amp;Arts) — sem decodificar, `norm` produz
    // `aetampe`, o filtro de nomes nao casa e o canal inteiro fica fora do guia (3 de 327).
    const nome = decodeEntities(d[1]).trim();
    if (!nome) continue;
    const chave = norm(nome);
    if (!chave) continue;
    if (filtro && !interessa(chave, filtro)) continue;
    if (!canais.has(chave)) canais.set(chave, { nome, ids: new Set() });
    canais.get(chave).ids.add(m[1]);
  }
  const chaveDoId = new Map();
  for (const [chave, info] of canais) {
    for (const id of info.ids) chaveDoId.set(id, chave);
  }

  const porNome = new Map();
  const progRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  while ((m = progRe.exec(xml))) {
    const attrs = m[1];
    const canal = /\bchannel="([^"]+)"/.exec(attrs);
    const start = /\bstart="([^"]+)"/.exec(attrs);
    const stop = /\bstop="([^"]+)"/.exec(attrs);
    if (!canal || !start || !stop) continue;
    const inicioEpoch = epochDe(start[1]);
    const fimEpoch = epochDe(stop[1]);
    if (!Number.isFinite(inicioEpoch) || !Number.isFinite(fimEpoch)) continue;
    if (fimEpoch < piso || inicioEpoch >= teto) continue;
    const t = /<title[^>]*>([^<]*)<\/title>/.exec(m[2]);
    const titulo = t ? decodeEntities(t[1].trim()) : "";
    if (!titulo) continue;
    const chave = chaveDoId.get(canal[1]);
    if (!chave) continue;
    if (!porNome.has(chave)) porNome.set(chave, []);
    porNome.get(chave).push([titulo, inicioEpoch, fimEpoch]);
  }
  for (const lista of porNome.values()) lista.sort((a, b) => a[1] - b[1]);
  return porNome;
}

function pontuacao(chaveNossa, chaveGuia) {
  if (chaveNossa === chaveGuia) return 1000;
  const sobreposicao = Math.min(chaveGuia.length, chaveNossa.length);
  if (sobreposicao < 3) return 0;
  if (chaveGuia.startsWith(chaveNossa) || chaveNossa.startsWith(chaveGuia)) return 100 + sobreposicao;
  if (chaveGuia.endsWith(chaveNossa) || chaveNossa.endsWith(chaveGuia)) return 90 + sobreposicao;
  if (chaveGuia.includes(chaveNossa) || chaveNossa.includes(chaveGuia)) return 60 + sobreposicao;
  return 0;
}

function buscarPorChave(nomeCanal) {
  const chave = norm(nomeCanal);
  if (!chave) return null;
  const direto = state.porNome.get(chave);
  if (direto && direto.length) return direto;
  let melhor = null;
  let melhorPonto = 0;
  for (const [k, lista] of state.porNome) {
    if (!lista.length) continue;
    const ponto = pontuacao(chave, k);
    if (ponto > melhorPonto) { melhor = lista; melhorPonto = ponto; }
  }
  return melhor;
}

function programFor(nomeCanal) {
  const lista = buscarPorChave(nomeCanal);
  if (!lista) return null;
  const agora = Math.floor(Date.now() / 1000);
  let atual = null;
  let proximo = null;
  for (const p of lista) {
    if (p[2] <= agora) continue;
    if (p[1] <= agora) atual = p;
    else if (!proximo) { proximo = p; break; }
  }
  if (!atual && !proximo) return null;
  return {
    now: atual ? { titulo: atual[0], ate: fmtHora(atual[2]) } : null,
    next: proximo ? { titulo: proximo[0], as: fmtHora(proximo[1]) } : null,
  };
}

function linhaGuia(nomeCanal) {
  const p = programFor(nomeCanal);
  if (!p) return "";
  const partes = [];
  if (p.now) partes.push(`📺 ${p.now.titulo}${p.now.ate ? ` até ${p.now.ate}` : ""}`);
  if (p.next) partes.push(`⏭️ A seguir: ${p.next.titulo}${p.next.as ? ` (${p.next.as})` : ""}`);
  return partes.join("\n");
}

function grade(nomeCanal, canalId, dataISO) {
  const lista = buscarPorChave(nomeCanal);
  if (!lista || !lista.length) return [];
  const alvo = /^\d{4}-\d{2}-\d{2}$/.test(String(dataISO || "")) ? dataISO : dataDe(Math.floor(Date.now() / 1000));
  const out = [];
  for (const item of lista) {
    if (dataDe(item[1]) !== alvo) continue;
    const startTime = new Date(item[1] * 1000).toISOString();
    const endTime = new Date(item[2] * 1000).toISOString();
    const minutos = Math.max(1, Math.round((item[2] - item[1]) / 60));
    out.push({
      id: `${canalId}:epg:${startTime}`,
      title: item[0],
      overview: item[0],
      released: startTime,
      startTime,
      endTime,
      runtime: `${minutos} min`,
      releaseInfo: alvo.slice(0, 4),
    });
  }
  return out;
}

function baixo(src) {
  return getGzText(src.url, { maxBytes: MAX_BYTES, timeout: 25000 });
}

async function carregar(nomes) {
  if (state.status === "carregando") return;
  state.status = "carregando";
  const juncao = new Map();
  const filtro = nomes && nomes.length ? new Set(nomes.map(norm).filter(Boolean)) : null;
  const detalhado = [];
  for (const src of SOURCES) {
    try {
      const xml = await baixo(src);
      const parte = parse(xml, filtro);
      let novos = 0;
      for (const [k, v] of parte) {
        if (juncao.has(k)) {
          const atual = juncao.get(k);
          for (const item of v) if (!atual.some(x => x[1] === item[1])) atual.push(item);
          atual.sort((a, b) => a[1] - b[1]);
        } else {
          juncao.set(k, v);
          novos++;
        }
      }
      detalhado.push(`${src.region}:+${novos}`);
    } catch (e) {
      state.lastError = `${src.region}: ${e.message}`;
      detalhado.push(`${src.region}:falhou`);
    }
  }
  // LOGOS VEM DA MESMA API DE CANAIS DO CATALOGO (decisao 121). `reiApi.loadCatalog()` é o
  // `/api/channels` com cache de 30min — o catalogo de TV ja paga esse pedido, entao aqui nao
  // ha ida nova na pratica. O XMLTV nao traz `<icon>` (medido: 0), entao o logo e o unico
  // motivo de ainda falarmos com a API de canais aqui.
  try {
    const canais = await reiApi.loadCatalog();
    const logos = new Map();
    for (const ch of canais) if (ch && ch.name && ch.logo_url) logos.set(ch.name, ch.logo_url);
    if (logos.size) state.logos = logos;
    detalhado.push(logos.size ? `logos:${logos.size}` : "logos:vazio");
  } catch (e) {
    state.lastError = `logos: ${e.message}`;
    detalhado.push("logos:falhou");
  }
  console.log(`[epg] fontes ${detalhado.join(" ")}`);
  if (juncao.size) {
    state.porNome = juncao;
    state.carregadoEm = Date.now();
    state.status = "pronto";
    state.lastError = null;
    if (typeof state.aoCarregar === "function") state.aoCarregar(juncao.size);
    console.log(`[epg] ${juncao.size} canais com programação (${Math.round(state.porNome.size ? [...juncao.values()].reduce((a, b) => a + b.length, 0) : 0)} programas na janela)`);
  } else {
    state.status = state.porNome.size ? "pronto" : "vazio";
  }
}
function start(nomes) {
  if (state.timers) return;
  const rodar = () => {
    carregar(nomes).catch(e => { state.lastError = e.message; });
  };
  state.timers = {
    boot: setTimeout(rodar, 2500),
    refresh: setInterval(() => {
      if (Date.now() - state.carregadoEm > REFRESH_MS) rodar();
    }, 15 * 60 * 1000),
  };
  if (state.timers.boot.unref) state.timers.boot.unref();
  if (state.timers.refresh.unref) state.timers.refresh.unref();
}

function indiceLogos() {
  if (!state.logos) return new Map();
  if (!state.logosNorm || state.logosNormDe !== state.logos) {
    const out = new Map();
    for (const [nome, url] of state.logos) {
      const k = norm(nome);
      if (k && !out.has(k)) out.set(k, url);
    }
    state.logosNorm = out;
    state.logosNormDe = state.logos;
  }
  return state.logosNorm;
}

function logoDe(nomeCanal) {
  if (!state.logos) return "";
  const direto = state.logos.get(nomeCanal);
  if (direto) return direto;
  return indiceLogos().get(norm(nomeCanal)) || "";
}
function chaves() {
  const out = [];
  for (const [chave, lista] of state.porNome) out.push({ chave, programas: lista.length });
  return out;
}

function stats() {
  if (state.statsCache && Date.now() - state.statsCache.ts < 5000) return state.statsCache.value;
  let total = 0;
  for (const lista of state.porNome.values()) total += lista.length;
  const value = {
    status: state.status,
    canais: state.porNome.size,
    programs: total,
    carregadoEm: state.carregadoEm,
    erro: state.lastError,
  };
  state.statsCache = { ts: Date.now(), value };
  return value;
}

module.exports = { start, carregar, parse, programFor, linhaGuia, grade, dataDe, chaves, buscarPorChave, logoDe, stats, norm };
