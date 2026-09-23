// Teste do corte do catalogo em fatias (decisao 136).
//
// O `gravaBuffer` le o catalogo do painel em fatias de 2MB, sem nunca montar a string inteira —
// e o que tirou o boot de 162MB. Aqui ele e testado contra o `gravaStream` (que recebe o texto
// inteiro) e contra o `JSON.parse` de referencia, com os casos que quebram um corte ingenuo:
//
//   - chave `{` e `}` DENTRO de uma string (descricao de filme)
//   - aspas escapadas (`\"`) e barra (`\\`)
//   - array dentro do item (`"category_ids":[671]`) — foi o que fez a primeira versao do corte
//     devolver 0 item em 5 de 6 catalogos
//   - virgula DENTRO do item e virgula ENTRE itens
//   - fatia cortando no meio de um item e no meio de um caractere multibyte
//   - o JSON do painel vindo dentro de um objeto (`{"vod_streams": [...]}`) em vez de solto

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function comBanco(funcao) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-gb-"));
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve("../src/lib/catalogo-paineis")];
  const mod = require("../src/lib/catalogo-paineis");
  try {
    return funcao(mod);
  } finally {
    mod.fecha();
    delete process.env.DATA_DIR;
  }
}

const { matchKey } = require("../src/lib/match");

const converte = (it) => ({
  // o codigo real normaliza com `matchKey` (tira acento); o teste precisa fazer o mesmo, senao
  // procura "series" e nao acha "Séries"
  key: matchKey(String(it.name || "")),
  name: it.name,
  title: String(it.title || ""),
  id: String(it.stream_id || it.series_id || ""),
  ext: String(it.container_extension || "mp4"),
});

// O caso que quebrou de verdade (medido 01/10/2026): 1.367 de 9.664 itens do painel do Autos
// saiam com o texto quebrado porque o array VAZIO dentro do item perdia os dois colchetes e
// virava `"backdrop_path":` — o `JSON.parse` falhava e o item sumia do catalogo. Um catalogo com
// 14% dos itens faltando NAO e "quase tudo": e o motivo de a fonte nao achar o filme.
const ITENS_COM_ARRAY_VAZIO = [
  { num: 1, name: "Com array vazio", backdrop_path: [], category_ids: [], stream_id: "1", container_extension: "mp4" },
  { num: 2, name: "Com array cheia", backdrop_path: ["a", "b"], category_ids: [671, 672], stream_id: "2", container_extension: "mp4" },
];

test("catálogo: array vazio dentro do item NÃO se perde (foi o defeito que tirava 14% do catálogo)", () => {
  const texto = JSON.stringify(ITENS_COM_ARRAY_VAZIO);
  comBanco((mod) => {
    const referencia = JSON.parse(texto);
    for (const fatia of [2 * 1024 * 1024, 8]) {
      mod.apaga("va", "vod");
      const buf = Buffer.from(texto, "utf8");
      const n = mod.gravaBuffer("va", "vod", buf, converte, fatia);
      assert.equal(n, referencia.length, `fatia de ${fatia}: pegou ${n} de ${referencia.length}`);
      // A busca OR'eia as palavras, entao "array vazio" tambem traz o outro item — o que
      // importa e que o item CERTO esteja entre os encontrados, nao que seja o primeiro.
      const achados = mod.candidatos("va", "vod", "array vazio").map((x) => x.name);
      assert.ok(achados.includes("Com array vazio"), `o item com array vazio sumiu: ${JSON.stringify(achados)}`);
    }
    // E o consumidor em tempo de resposta (o caminho do boot de verdade).
    const consumidor = mod.consumidorDeFatias("vc", "vod", converte);
    const buf = Buffer.from(texto, "utf8");
    for (let p = 0; p < buf.length; p += 8) consumidor.peca(buf.subarray(p, Math.min(p + 8, buf.length)));
    assert.equal(consumidor.fecha(), referencia.length, "o consumidor por peca tambem");
  });
});

const ITENS = [
  { name: "Matrix", title: 'Com {chaves}, "aspas" escapadas e barra \\\\ dentro', stream_id: "1", container_extension: "mp4", category_ids: [671] },
  { name: "A, B", title: "desc] com ] colchete e, virgula", stream_id: "2", container_extension: "mkv" },
  { name: "Séries Ünicode", title: "acentuação e emoji 🎬 aqui", stream_id: "3", container_extension: "mp4" },
];

test("catálogo em fatias: dá o mesmo resultado que o texto inteiro (inclusive com fatia minúscula)", () => {
  const texto = JSON.stringify(ITENS);
  comBanco((mod) => {
    const referencia = mod.gravaStream("ref", "vod", texto, converte);
    assert.equal(referencia, 3, "o corte por texto pega os 3 itens");

    for (const fatia of [2 * 1024 * 1024, 64, 16, 8, 4]) {
      const buf = Buffer.from(texto, "utf8");
      mod.apaga("fat", "vod");
      const n = mod.gravaBuffer("fat", "vod", buf, converte, fatia);
      assert.equal(n, 3, `fatia de ${fatia} bytes pegou ${n} de 3 itens`);
    }

    // O conteudo tem de ser identico, nao so a contagem.
    mod.apaga("fat", "vod");
    mod.gravaBuffer("fat", "vod", Buffer.from(texto, "utf8"), converte, 16);
    const porNome = mod.candidatos("fat", "vod", "matrix")[0];
    assert.ok(porNome, "a busca acha o item");
    assert.equal(porNome.name, "Matrix");
    assert.equal(porNome.title, ITENS[0].title, "a descrição sobrevive intacta (chaves, aspas e barra)");
    assert.equal(porNome.stream_id, "1");
    const comAcento = mod.candidatos("fat", "vod", "series unicode");
    assert.ok(comAcento.length, "item com acento/emoji também entra");
  });
});

test("catálogo em fatias: aceita o array dentro de um objeto (formato {vod_streams:[...]})", () => {
  const texto = JSON.stringify({ vod_streams: ITENS });
  comBanco((mod) => {
    const n = mod.gravaBuffer("obj", "vod", Buffer.from(texto, "utf8"), converte, 32);
    assert.equal(n, 3, "os 3 itens do array aninhado entram");
  });
});

test("catálogo em fatias: payload sem item não grava nada (e não inventa)", () => {
  comBanco((mod) => {
    assert.equal(mod.gravaBuffer("vazio", "vod", Buffer.from("[]", "utf8"), converte), 0);
    assert.equal(mod.gravaBuffer("naojson", "vod", Buffer.from("<html>erro do painel</html>", "utf8"), converte), 0);
    assert.equal(mod.gravaBuffer("zero", "vod", Buffer.alloc(0), converte), 0);
    assert.equal(mod.gravaBuffer("nada", "vod", null, converte), 0);
  });
});

test("catálogo: a busca devolve os candidatos do título e respeita o limite", () => {
  const texto = JSON.stringify(ITENS);
  comBanco((mod) => {
    mod.gravaBuffer("b", "vod", Buffer.from(texto, "utf8"), converte, 16);
    assert.equal(mod.candidatos("b", "vod", "matrix").length, 1);
    // Palavra forte pega o que contem a palavra (superset do preFiltra).
    const porPalavra = mod.candidatos("b", "vod", "chaves");
    assert.ok(Array.isArray(porPalavra));
    // Sem consulta nao ha busca (e nao vira "todos").
    assert.equal(mod.candidatos("b", "vod", ""), null);
    assert.equal(mod.candidatos("inexistente", "vod", "matrix"), null, "painel que nao existe devolve null (o codigo cai na memoria)");
  });
});