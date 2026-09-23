const { pegarJson, pegarTexto } = require("../lib/http");
const { de } = require("../lib/canal");
const { novo } = require("../core/sandbox");
const { UA } = require("../lib/ua");
const { sinaliza } = require("../lib/hls");

const FONTE = "emb";
const SIGLA = "EMB";
const MS = 8e3;
const TETO_MS = 16e3;
const CATALOGO = "https://embedtv.lat/api/channels";
const CHUTE = "https://52d080a3e172c33fd6886a37e7.s23-cloudfront-net.lat/8e8e8b142192ea65/";

function contaSegmentos(texto) {
  if (!texto.includes("#EXTM3U")) return 0;
  return texto.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
}

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
  if (r.status === 404 || r.status === 410 || r.status === 451) return false;
  if (r.status === 429 || r.status >= 500) throw new Error(`emb playlist HTTP ${r.status} (nao e prova)`);
  if (!r.ok) return false;
  if (contaSegmentos(r.texto) > 0) return true;
  const inteiro = await pegarTexto(url, { ms: Math.min(MS, p.ms()), headers: { "User-Agent": UA } });
  return inteiro.ok && contaSegmentos(inteiro.texto) > 0;
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
    if (await provaPlaylist(url, p)) return [{ name: SIGLA, title: `☁️ ${canal.nome} · ${SIGLA}`, url: sinaliza(url) }];
  }
  return [];
};
