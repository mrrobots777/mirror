const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ALVO = path.join(__dirname, "..", "worker-simple.js");

function fonte() {
  return fs.readFileSync(ALVO, "utf8");
}

test("o cache de video do worker guarda a resposta INTEIRA, nunca uma fatia de Range", () => {
  const src = fonte();
  // A leitura do cache so pode acontecer quando o pedido NAO tem Range. Se o `if (!range)`
  // sumisse, um seek receberia o inicio do arquivo de novo.
  const leitura = src.match(/if \(!range\) \{\s*const guardado = await edge\.match\(chave\);/);
  assert.ok(leitura, "a consulta ao cache precisa estar protegida por `if (!range)`");
});

test("so grava no cache resposta completa de midia, nunca 206 nem erro", () => {
  const src = fonte();
  assert.match(src, /const inteira = !range && upstream\.status === 200;/,
    "o guard de gravacao precisa exigir `!range` e status 200");
  assert.match(src, /if \(inteira && \/\^\(audio\|video/,
    "o guard de gravacao precisa exigir content-type de midia");
});

test("o TTL do cache depende do tipo: segmento longo, playlist curto", () => {
  const src = fonte();
  const fn = src.match(/function ttlDoAlvo\(parsed\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, "ttlDoAlvo precisa existir");
  const corpo = fn[1];
  assert.match(corpo, /\\.\(ts\|m4s\|cmfv\|cmfa\|aac\|vtt\|webp\)\$[\s\S]*?TTL_SEGMENTO/,
    "pedaco (.ts/.m4s) tem hash de conteudo: TTL longo");
  assert.match(corpo, /\\\.m3u8\?\$[\s\S]*?TTL_PLAYLIST/,
    "playlist muda: TTL curto");
  assert.match(corpo, /return TTL_ARQUIVO/,
    "o resto (mp4) usa o TTL de arquivo, abaixo do prazo da URL assinada mais curta");

  // O padrao no codigo e uma expressao ("4 * 3600"), entao converte em vez de Number().
  const segundos = (nome) => {
    const m = src.match(new RegExp(`const ${nome} = [^;]*?\\|\\| ([\\d ]+(?:\\* *3600)?)`));
    if (!m) return NaN;
    return m[1].includes("*") ? Number(m[1].split("*")[0].trim()) * 3600 : Number(m[1].trim());
  };
  const seg = segundos("TTL_SEGMENTO");
  const pl = segundos("TTL_PLAYLIST");
  const arq = segundos("TTL_ARQUIVO");
  assert.ok(seg && pl && arq, "os tres TTLs precisam ter padrao no codigo");
  assert.ok(seg > pl, `segmento (${seg}s) > playlist (${pl}s): pedaco tem hash, playlist muda`);
  assert.ok(arq < seg, `mp4 (${arq}s) < segmento (${seg}s): URL assinada expira antes`);
  // O mp4 precisa ficar abaixo do prazo de assinatura mais curto que conhecemos: o VZR vale 5h.
  assert.ok(arq <= 5 * 3600,
    `o TTL do arquivo (${arq}s) precisa ser <= 5h (prazao da URL assinada do VZR), senao serve link vencido`);
});

test("a chave do cache nao carrega o Range (senao o seek abre uma entrada nova e vazia)", () => {
  const src = fonte();
  const chave = src.match(/const chave = new Request\(`\$\{urlOrigin\(request\)\}\/p\/\$\{token\}`/);
  assert.ok(chave, "a chave precisa ser so origem + token");
  assert.ok(!chave[0].includes("range"), "a chave nao pode incluir o header Range");
});

test("toda resposta do cache de video diz de onde veio (HIT ou MISS)", () => {
  const src = fonte();
  assert.match(src, /h\.set\("x-mirror-cache", "HIT"\)/, "o HIT precisa ser observavel para medir");
  assert.match(src, /h\.set\("x-mirror-cache", "MISS"\)/, "o MISS precisa ser observavel");
});
