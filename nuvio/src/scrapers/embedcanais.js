const { pegar, pegarTexto } = require("../lib/http");
const { de } = require("../lib/canal");
const { novo } = require("../core/sandbox");
const { UA } = require("../lib/ua");
const { provaPlaylist, sinaliza } = require("../lib/hls");
const { aoVivo: streamDeTv } = require("../lib/apresentacao");

const FONTE = "etc";
const SIGLA = "ETC";
const MS = 8e3;
const TETO_MS = 16e3;
const PORTA = "https://embedcanaisdetv.xyz/e/index.php";
const LISTA = "https://embedcanais.online/";
const PLAYER = "https://sinaldvd.github.io/tv/player.html";
const CDNS = [
  "https://m8q2v7r4k1-cloudflare-net.vercel.app",
  "https://t5r4e3w2q1y0-cloudflare-net.vercel.app",
  "https://a9b8c7d6e5f4-cloudflare-net.vercel.app"
];

function semAcento(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function erroDeRede(e) {
  return /socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted|timeout|fetch failed|network|HTTP 5\d\d/i.test(String((e && e.message) || e));
}

function blocoLista(html) {
  const i = html.indexOf("const CHANNELS=");
  if (i < 0) return null;
  const abre = html.indexOf("[", i);
  if (abre < 0) return null;
  let fim = -1;
  let prof = 0;
  for (let k = abre; k < html.length; k++) {
    if (html[k] === "[") prof++;
    else if (html[k] === "]") {
      prof--;
      if (!prof) { fim = k; break; }
    }
  }
  return fim < 0 ? null : html.slice(abre, fim + 1);
}

async function slugNaPortaNova(nome, p) {
  const alvo = semAcento(nome);
  if (!alvo) return "";
  const r = await pegarTexto(LISTA, { ms: Math.min(MS, p.ms()), headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!r.ok) throw new Error(`etc lista HTTP ${r.status}`);
  const bruto = blocoLista(r.texto);
  if (!bruto) return "";
  for (const c of JSON.parse(bruto)) {
    if (c && c.slug && semAcento(c.name) === alvo) return String(c.slug);
  }
  return "";
}

function origemDe(url) {
  try {
    return new URL(String(url || "")).origin;
  } catch (_) {
    return "";
  }
}

async function testaPlaylist(url, p, refererPreferido) {
  const origem = String(refererPreferido || origemDe(url) || LISTA);
  const r = await pegarTexto(url, { ms: Math.min(MS, p.ms()), headers: { Referer: origem, "User-Agent": UA } });
  const prova = provaPlaylist(r.status, r.texto);
  if (prova === "morta") return null;
  if (prova === "indeciso") console.log(`[ETC] ${String(r.url || url).slice(0, 60)} respondeu HTTP ${r.status} a este IP — o canal entra na lista mesmo assim`);
  return { url: String(r.url || url), referer: origem };
}

module.exports.getStreams = async (id, mediaType) => {
  if (String(mediaType || "").toLowerCase() !== "channel") return [];
  const canal = de(id, FONTE);
  if (!canal || !canal.tem) return [];
  const p = novo(TETO_MS);
  let rede = null;
  try {
    const slugNovo = await slugNaPortaNova(canal.nome, p);
    if (slugNovo) {
      const pg = await pegarTexto(`${PORTA}?canal=${encodeURIComponent(slugNovo)}`, { ms: Math.min(MS, p.ms()), headers: { Referer: LISTA, "User-Agent": UA, Accept: "text/html" } });
      if (pg.ok) {
        const m = pg.texto.match(/https?:\/\/[^"'\s]+\.m3u8/i);
        if (m) {
          const prova = await testaPlaylist(m[0], p, origemDe(pg.url));
          if (prova) {
            return [streamDeTv({
              sigla: SIGLA,
              titulo: canal.nome,
              url: sinaliza(prova.url),
              headers: { Referer: prova.referer, "User-Agent": UA }
            })];
          }
        }
      }
    }
  } catch (e) {
    if (erroDeRede(e)) rede = e;
  }
  const referer = `${PLAYER}?id=${canal.slug}`;
  for (const cdn of CDNS) {
    if (p.passou()) break;
    const entrada = `${cdn}/${canal.slug}.m3u8`;
    const prova = await testaPlaylist(entrada, p, origemDe(referer));
    if (!prova) continue;
    return [streamDeTv({
      sigla: SIGLA,
      titulo: canal.nome,
      url: sinaliza(prova.url),
      headers: { Referer: prova.referer, "User-Agent": UA }
    })];
  }
  if (rede && !p.passou()) throw rede;
  return [];
};
