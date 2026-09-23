const assert = require("node:assert");
const test = require("node:test");

const { parseMp4Codec } = require("../src/lib/mp4-codec");

// Monta um cabecalho MP4 minimo com uma entrada de video: [stsd][size(4)][formato(4)][corpo 70]
function cabecalho(formatos) {
  const partes = [];
  for (const [formato, tamanhoCorpo] of formatos) {
    const entrada = Buffer.alloc(8 + tamanhoCorpo);
    entrada.writeUInt32BE(8 + tamanhoCorpo, 0);
    entrada.write(formato, 4, "ascii");
    partes.push(entrada);
  }
  const corpo = Buffer.concat(partes);
  const stsd = Buffer.alloc(16 + corpo.length);
  stsd.write("stsd", 4, "ascii");
  stsd.writeUInt32BE(16 + corpo.length, 0);
  stsd.writeUInt32BE(formatos.length, 12);
  corpo.copy(stsd, 16);
  const ftyp = Buffer.alloc(24);
  ftyp.write("ftyp", 4, "ascii");
  return Buffer.concat([ftyp, stsd]);
}

test("mp4-codec: reconhece H.264 (o que todo celular toca)", () => {
  const buf = cabecalho([["avc1", 70]]);
  const r = parseMp4Codec(buf);
  assert.strictEqual(r.codec, "h264");
  assert.strictEqual(r.tag, "avc1");
});

test("mp4-codec: reconhece H.265, que e a causa da tela branca com barulho", () => {
  for (const tag of ["hvc1", "hev1"]) {
    const r = parseMp4Codec(cabecalho([[tag, 70]]));
    assert.strictEqual(r.codec, "hevc", `${tag} deveria ser hevc`);
  }
});

test("mp4-codec: video vem antes do audio e o audio nao atrapalha", () => {
  const buf = cabecalho([["hvc1", 70], ["mp4a", 36]]);
  assert.strictEqual(parseMp4Codec(buf).codec, "hevc");
  const so = cabecalho([["avc1", 70], ["mp4a", 36]]);
  assert.strictEqual(parseMp4Codec(so).codec, "h264");
});

test("mp4-codec: VP9 e AV1 sao reconhecidos como nao universais", () => {
  assert.strictEqual(parseMp4Codec(cabecalho([["vp09", 70]])).codec, "vp9");
  assert.strictEqual(parseMp4Codec(cabecalho([["av01", 70]])).codec, "av1");
});

test("mp4-codec: sem prova devolve null, e null NAO e h265", () => {
  assert.strictEqual(parseMp4Codec(Buffer.alloc(300)), null, "lixo nao vira codec");
  assert.strictEqual(parseMp4Codec(cabecalho([["mp4a", 36]])), null, "so audio nao vira codec");
  assert.strictEqual(parseMp4Codec(null), null);
  assert.strictEqual(parseMp4Codec(Buffer.alloc(4)), null, "curto demais");
});

test("mp4-codec: bytes que so parecem tag nao sao aceitos", () => {
  // 'hvc1' solto no meio do arquivo, sem o tamanho de entrada antes: tem que ser ignorado.
  const buf = Buffer.alloc(200);
  buf.write("hvc1", 100, "ascii");
  assert.strictEqual(parseMp4Codec(buf), null, "tag solta nao entra como codec");
});
