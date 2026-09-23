const { pegarTexto } = require("../lib/http");
const { de } = require("../lib/canal");
const { novo } = require("../core/sandbox");
const { UA } = require("../lib/ua");
const { sinaliza } = require("../lib/hls");

const FONTE = "rei";
const SIGLA = "REI";
const MS = 8e3;
const MS_PLAYLIST = 13e3;
const TETO_MS = 20e3;
const JOGO = "https://v2.rdembed.sbs/";
const PLAY = "https://reidosembeds.online/";

function contaSegmentos(texto) {
  if (!texto.includes("#EXTM3U")) return 0;
  return texto.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
}

function erroDeRede(e) {
  return /socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted|timeout|fetch failed|network|HTTP 5\d\d|ref HTTP 404/i.test(String((e && e.message) || e));
}

function restante(p, teto) {
  return Math.max(1, Math.min(teto, p.limite - Date.now()));
}

async function pegaEmbed(slug, p) {
  const r = await pegarTexto(`${JOGO}${encodeURIComponent(slug)}`, { ms: Math.min(MS, p.ms()), headers: { Referer: PLAY, "User-Agent": UA, Accept: "text/html" } });
  if (!r.ok) throw new Error(`rei embed HTTP ${r.status}`);
  const m = r.texto.match(/src="(https:\/\/[^"]*\/__play\/[^"]+)"/);
  if (!m) throw new Error("rei sem /__play/");
  return m[1].replace(/&amp;/g, "&");
}

async function pegaIframe(play, slug, p) {
  const r = await pegarTexto(play, { ms: Math.min(MS, p.ms()), headers: { Referer: `${JOGO}${slug}`, "User-Agent": UA, Accept: "text/html" } });
  if (!r.ok) throw new Error(`rei __play HTTP ${r.status}`);
  const m = r.texto.match(/<iframe[^>]*src="([^"]+)"/);
  if (!m) throw new Error("rei sem iframe");
  return m[1].replace(/&amp;/g, "&");
}

function fonteDaPagina(html) {
  const i = html.indexOf("var sources = ");
  if (i < 0) throw new Error("rei sem 'var sources'");
  const abre = html.indexOf("[", i);
  if (abre < 0) throw new Error("rei sources malformado");
  let fim = -1;
  let prof = 0;
  for (let k = abre; k < html.length; k++) {
    if (html[k] === "[") prof++;
    else if (html[k] === "]") {
      prof--;
      if (!prof) { fim = k; break; }
    }
  }
  if (fim < 0) throw new Error("rei sources sem fechamento");
  const lista = JSON.parse(html.slice(abre, fim + 1));
  return (lista && lista[0]) || {};
}

async function montaSrc(slug, p) {
  const play = await pegaEmbed(slug, p);
  const iframe = await pegaIframe(play, slug, p);
  const pagina = await pegarTexto(iframe, { ms: Math.min(MS, p.ms()), headers: { Referer: `${JOGO}__play/${slug}`, "User-Agent": UA, Accept: "text/html" } });
  if (!pagina.ok) throw new Error(`rei player HTTP ${pagina.status}`);
  const fonte = fonteDaPagina(pagina.texto);
  if (fonte.src) return { src: fonte.src, referer: iframe };
  if (!fonte.ref) throw new Error("rei sem ref nem src");
  const alvo = new URL(fonte.ref, iframe).href;
  const r = await pegarTexto(alvo, {
    ms: Math.min(MS, p.ms()),
    metodo: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Referer: iframe, "User-Agent": UA }
  });
  if (!r.ok) throw new Error(`rei ref HTTP ${r.status}`);
  const j = JSON.parse(r.texto);
  if (!j || !j.src) throw new Error("rei ref sem src");
  return { src: j.src, referer: iframe };
}

async function resolveSrc(slug, p) {
  let ultima = null;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      return await montaSrc(slug, p);
    } catch (e) {
      ultima = e;
      if (tentativa === 1 || !erroDeRede(e) || p.passou()) break;
    }
  }
  throw ultima || new Error("rei cadeia falhou");
}

async function temSegmentos(src, referer, p) {
  const r = await pegarTexto(src, { ms: restante(p, MS_PLAYLIST), headers: { Referer: referer, "User-Agent": UA } });
  if (r.status === 429 || r.status >= 500) throw new Error(`rei playlist HTTP ${r.status} (nao e prova)`);
  if (!r.ok) return false;
  return contaSegmentos(r.texto) > 0;
}

module.exports.getStreams = async (id, mediaType) => {
  if (String(mediaType || "").toLowerCase() !== "channel") return [];
  const canal = de(id, FONTE);
  if (!canal || !canal.tem) return [];
  const p = novo(TETO_MS);
  let primeiro = null;
  try {
    primeiro = await resolveSrc(canal.slug, p);
  } catch (e) {
    if (erroDeRede(e)) throw e;
    return [];
  }
  if (await temSegmentos(primeiro.src, primeiro.referer, p)) {
    return [{ name: SIGLA, title: `📺 ${canal.nome} · ${SIGLA}`, url: sinaliza(primeiro.src) }];
  }
  if (p.limite - Date.now() < MS_PLAYLIST) return [];
  try {
    const outro = await resolveSrc(canal.slug, p);
    if (outro.src && (await temSegmentos(outro.src, outro.referer, p))) {
      return [{ name: SIGLA, title: `📺 ${canal.nome} · ${SIGLA}`, url: sinaliza(outro.src) }];
    }
  } catch (e) {
    return [];
  }
  return [];
};
