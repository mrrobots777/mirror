const { pegarJson, pegarTexto } = require("../lib/http");
const { de } = require("../lib/canal");
const { novo } = require("../core/sandbox");
const { UA } = require("../lib/ua");
const { provaPlaylist: veredito, sinaliza } = require("../lib/hls");
const { aoVivo: streamDeTv } = require("../lib/apresentacao");

const FONTE = "emb";
const SIGLA = "EMB";
const MS = 8e3;
const TETO_MS = 16e3;
const CATALOGO = "https://embedtv.lat/api/channels";
const CHUTE = "https://52d080a3e172c33fd6886a37e7.s23-cloudfront-net.lat/8e8e8b142192ea65/";

function erroDeRede(e) {
  return /socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted|timeout|fetch failed|network|HTTP 5\d\d/i.test(String((e && e.message) || e));
}

async function paginaDoCanal(canalId, p) {
  const r = await pegarJson(CATALOGO, { ms: Math.min(MS, p.ms()), headers: { Accept: "application/json", "User-Agent": UA } });
  if (!r.ok || !r.dados) throw new Error(`emb catalogo HTTP ${r.status}`);
  const achado = ((r.dados && r.dados.channels) || []).find((c) => c && c.id === canalId);
  return achado && achado.url ? String(achado.url) : "";
}

async function provaPlaylist(url, p) {
  const r = await pegarTexto(url, { ms: Math.min(MS, p.ms()), headers: { Range: "bytes=0-4095", "User-Agent": UA } });
  const prova = veredito(r.status, r.texto);
  if (prova === "viva") return true;
  if (prova === "indeciso") {
    console.log(`[EMB] ${url.slice(0, 60)} respondeu HTTP ${r.status} a este IP — o canal entra na lista mesmo assim`);
    return true;
  }
  // "morta": a origem respondeu 2xx e nao ha manifesto nem segmento. Some uma vez
  // (o Range pode ter cortado a playlist) e desiste.
  const inteiro = await pegarTexto(url, { ms: Math.min(MS, p.ms()), headers: { "User-Agent": UA } });
  return veredito(inteiro.status, inteiro.texto) === "viva";
}

module.exports.getStreams = async (id, mediaType) => {
  if (String(mediaType || "").toLowerCase() !== "channel") return [];
  const canal = de(id, FONTE);
  if (!canal || !canal.tem) return [];
  const p = novo(TETO_MS);
  const candidatos = [];
  try {
    const pagina = await paginaDoCanal(canal.slug, p);
    if (pagina) {
      const r = await pegarTexto(pagina, { ms: Math.min(MS, p.ms()), headers: { "User-Agent": UA, Accept: "text/html" } });
      if (r.ok) {
        const m = r.texto.match(/https?:\/\/[a-z0-9-]+\.s23-cloudfront-net\.lat\/[a-f0-9]+\/[a-z0-9_-]+\.txt/i);
        if (m) candidatos.push(m[0]);
      }
    }
  } catch (e) {
    if (erroDeRede(e)) throw e;
  }
  const chute = `${CHUTE}${canal.slug}.txt`;
  if (!candidatos.includes(chute)) candidatos.push(chute);
  for (const url of candidatos) {
    if (p.passou()) break;
    if (await provaPlaylist(url, p)) return [streamDeTv({ sigla: SIGLA, titulo: canal.nome, url: sinaliza(url) })];
  }
  return [];
};
