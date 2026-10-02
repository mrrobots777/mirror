const { pegarJson, pegarTexto } = require("../lib/http");
const { coletar } = require("../lib/extrator");
const { de } = require("../lib/canal");
const { novo } = require("../core/sandbox");
const { UA } = require("../lib/ua");
const { provaPlaylist, sinaliza } = require("../lib/hls");
const { aoVivo: streamDeTv } = require("../lib/apresentacao");

const FONTE = "rcd";
const SIGLA = "RCD";
const MS = 8e3;
const TETO_MS = 16e3;
const MAX_EMBEDS = 6;
const RODADAS = 2;
const API = "https://api.reidoscanais.st/channels";
const SITE = "https://reidoscanais.st/";

function erroDeRede(e) {
  return /socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted|timeout|fetch failed|network|HTTP 429|HTTP 5\d\d/i.test(String((e && e.message) || e));
}

async function catalogo(p) {
  const r = await pegarJson(API, { ms: Math.min(MS, p.ms()), headers: { Accept: "application/json", "User-Agent": UA } });
  if (!r.ok || !r.dados) throw new Error(`rcd catalogo HTTP ${r.status}`);
  const lista = (r.dados && (r.dados.data || r.dados.channels || r.dados.items)) || [];
  if (!Array.isArray(lista)) throw new Error("rcd catalogo invalido");
  return lista;
}

function noAr(canal) {
  const epg = canal && canal.epg;
  const atual = epg && epg.current;
  if (!atual || !atual.title) return "";
  // Sem emoji: o 📺 ja abre a linha 1 (o nome do canal), e dois no mesmo card
  // enchem a tela sem dizer nada novo.
  const partes = [String(atual.title)];
  if (atual.formatted_time) partes.push(atual.formatted_time);
  if (epg && epg.next && epg.next.title) partes.push(`A seguir: ${epg.next.title}`);
  return partes.join(" · ");
}

async function tentaEmbed(embed, p) {
  const alvo = String(embed.embed_url || "");
  if (!alvo) return { erro: "embed sem url" };
  const r1 = await pegarTexto(alvo, { ms: Math.min(MS, p.ms()), headers: { Referer: SITE, "User-Agent": UA, Accept: "text/html" } });
  if (!r1.ok) return { erro: `embed HTTP ${r1.status}` };
  const ifr = r1.texto.match(/<iframe[^>]*src=["']([^"']+)["']/);
  if (!ifr) return { erro: "embed sem iframe" };
  const player = ifr[1].replace(/&amp;/g, "&");
  const r2 = await pegarTexto(player, { ms: Math.min(MS, p.ms()), headers: { Referer: alvo, "User-Agent": UA, Accept: "text/html" } });
  if (!r2.ok) return { erro: `player HTTP ${r2.status}` };
  const hls = coletar(r2.texto, { base: player }).find((c) => /\.m3u8/i.test(String(c.url || "")));
  if (!hls) return { erro: "player sem m3u8" };
  const pl = await pegarTexto(hls.url, { ms: Math.min(MS, p.ms()), headers: { Referer: player, "User-Agent": UA } });
  const prova = provaPlaylist(pl.status, pl.texto);
  if (prova === "morta") return { erro: `playlist HTTP ${pl.status}` };
  // "indeciso": a origem recusou ESTE IP, e a cadeia achou um token de verdade. O
  // aparelho do usuario baixa do IP residencial dele, entao entrega-se o link.
  if (prova === "indeciso") console.log(`[RCD] ${hls.url.slice(0, 60)} respondeu HTTP ${pl.status} a este IP — o canal entra na lista mesmo assim`);
  return { url: hls.url, referer: player };
}

async function cadeia(canal, p) {
  const embeds = (Array.isArray(canal.embeds) ? canal.embeds : []).slice(0, MAX_EMBEDS);
  if (!embeds.length) return null;
  let erro = "sem embed";
  for (let rodada = 0; rodada < RODADAS; rodada++) {
    for (const embed of embeds) {
      if (p.passou()) return null;
      try {
        const r = await tentaEmbed(embed, p);
        if (r.url) return r;
        erro = r.erro;
      } catch (e) {
        if (erroDeRede(e)) throw e;
        erro = String((e && e.message) || e).slice(0, 60);
      }
    }
  }
  throw new Error(`rcd cadeia: ${erro}`);
}

module.exports.getStreams = async (id, mediaType) => {
  if (String(mediaType || "").toLowerCase() !== "channel") return [];
  const alvo = de(id, FONTE);
  if (!alvo || !alvo.tem) return [];
  const p = novo(TETO_MS);
  const lista = await catalogo(p);
  const bruto = lista.find((c) => c && String(c.id) === alvo.slug);
  if (!bruto) return [];
  let src = null;
  try {
    src = await cadeia(bruto, p);
  } catch (e) {
    if (erroDeRede(e)) throw e;
    return [];
  }
  if (!src) return [];
  return [streamDeTv({
    sigla: SIGLA,
    titulo: alvo.nome,
    // O guia que a propria origem entrega no JSON do canal entra na linha 2, que
    // no app e o `title` do stream (a `description` so existiria se mandassemos
    // `size`/`language`, e o plugin nao manda nenhum dos dois).
    detalhe: noAr(bruto),
    url: sinaliza(src.url),
    headers: { Referer: src.referer, "User-Agent": UA }
  })];
};
