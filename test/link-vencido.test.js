// Link que vence dentro do cache = o usuario clica e leva "nao reproduce".
// MEDIDO em 29/09/2026: a assinatura do SPT vale 15min — o MESMO numero do TTL do cache de
// stream. Com a checagem antiga (30s de folga), o cache guardava o link e o devolvia achando
// que ainda valia, e o player's mao levava 410 Gone. Aqui a regra esta trancada.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { hasExpiredSignedUrl } = require(path.join(__dirname, "..", "src/lib/stream.js"));

const expiraEm = (ms) => Math.floor((Date.now() + ms) / 1000);
const b64 = (u) => Buffer.from(u).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("a folga e de 5min: um link que vence em 4min ja e dado como vencido", () => {
  // Com a folga antiga de 30s, este link PASSAVA como valido e morria na mao do usuario.
  const u = `https://vid.hclod.qzz.io/st/x/playlist.m3u8?md5=a&expires=${expiraEm(4 * 60 * 1000)}`;
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: u }] }), true, "vence em 4min e precisa ser tratado como vencido");
});

test("a assinatura dentro do base64 do relay tambem e vista (era invisivel)", () => {
  // O relay do worker esconde a assinatura: `/relay/m/<base64>.m3u8`. Sem decodificar, a
  // checagem nao achava `expires=` e o link morto passava. Este e o caso do SPT.
  const morre = `https://vid.hclod.qzz.io/st/x/p.m3u8?md5=a&expires=${expiraEm(2 * 60 * 1000)}`;
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: `https://w.dev/relay/m/${b64(morre)}.m3u8` }] }), true, "morre em 2min dentro do base64");

  // E a cifra `/p/<token>.mp4` (BLZ, SPC, KKT, ATO, VZR)
  const morreP = `https://kakito.xyz/movie/x.mp4?expires=${expiraEm(2 * 60 * 1000)}`;
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: `https://w.dev/p/${b64(morreP)}.mp4` }] }), true, "morre em 2min dentro da cifra /p/");
});

test("link com folga de sobra continua valendo", () => {
  const u = `https://vid.hclod.qzz.io/st/x/p.m3u8?md5=a&expires=${expiraEm(30 * 60 * 1000)}`;
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: u }] }), false, "30min de folga = vale");
  const w = `https://w.dev/relay/m/${b64(u)}.m3u8`;
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: w }] }), false, "30min dentro do base64 = vale");
});

test("link SEM assinatura nunca e considerado vencido (kakito, blz, etc)", () => {
  // Estas fontes nao assinam por tempo; cortar elas por engano seria o pior defeito possivel.
  for (const u of [
    "https://kakito.xyz/movie/MirrorPrincipal/ditj7j1h/11197.mp4",
    "https://t5r4e3w2q1y0ty.s23-cloudfront-net.lat/sinalpublico/x/file.txt",
    "https://c12e41ddc21b-mirror2.baby-beamup.club/stream/hls/hbo.m3u8",
  ]) {
    assert.equal(hasExpiredSignedUrl({ streams: [{ url: u }] }), false, u);
  }
});

test("o parametro 'exp' (curto) tambem conta", () => {
  const u = `https://rtd.ex/x.mp4?exp=${expiraEm(1 * 60 * 1000)}`;
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: u }] }), true, "vence em 1min");
});

test("varios streams: basta um vencido para o cache inteiro ser recusado", () => {
  // O cache e da RESPOSTA inteira, entao um link morto estraga a lista toda.
  const bom = `https://kakito.xyz/a.mp4`;
  const morto = `https://vid.hclod.qzz.io/p.m3u8?expires=${expiraEm(60 * 1000)}`;
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: bom }, { url: morto }] }), true);
});

test("base64 invalido nao estoura (devolve false, nao lanca)", () => {
  assert.doesNotThrow(() => hasExpiredSignedUrl({ streams: [{ url: "https://w.dev/relay/m/!!!!.m3u8" }] }));
});
