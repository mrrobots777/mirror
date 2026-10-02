// O PORTAO DE CORRESPONDENCIA (decisão 135).
//
// O defeito que este arquivo trava é o mais grave já medido no projeto, e ele foi encontrado
// por MEDIR e não por ler: em produção, `movie/tmdb:603` (Matrix) respondeu com
// `otakulogia:futari-wa-precure:1x1` e `movie/tmdb:155` (Batman) respondeu com **Boruto**.
//
// A causa: `searchItems.find(i => i.slug === query) || searchItems[0]`. Sem casamento exato, o
// código aceitava o **PRIMEIRO** resultado da busca — qualquer que fosse — e devolvia o
// episódio 1 daquele anime. Como o motor chama as fontes com variantes de título, quase toda
// variante caía nesse caminho.
//
// A regra: se nada casar com o pedido, devolve `[]`. Conteúdo errado é pior que nenhum conteúdo,
// porque a pessoa assiste achando que é o que pediu.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { melhorCorrespondencia, corresponde, titulosDoCandidato } = require("../src/lib/portao-correspondencia");

const raiz = path.join(__dirname, "..");

test("portão: o anime errado é barrado (o defeito medido em produção)", () => {
  // Estes são os pares REAIS que saíram da produção às 01/10/2026.
  assert.equal(
    melhorCorrespondencia("Matrix", [{ slug: "futari-wa-precure", name: "Futari wa Pretty Cure" }]),
    null,
    "Matrix não pode virar Pretty Cure"
  );
  assert.equal(
    melhorCorrespondencia("Batman: O Cavaleiro das Trevas", [{ slug: "boruto", name: "Boruto: Naruto Next Generations" }]),
    null,
    "Batman não pode virar Boruto"
  );
  assert.equal(
    melhorCorrespondencia("The Walking Dead", [{ slug: "one-piece", name: "One Piece" }]),
    null,
    "qualquer conteúdo não relacionado é barrado"
  );
});

test("portão: o item certo passa, mesmo com caixa, acento e slug diferentes", () => {
  assert.ok(melhorCorrespondencia("Naruto", [{ slug: "naruto", name: "Naruto" }]), "nome igual");
  assert.ok(melhorCorrespondencia("one piece", [{ slug: "one-piece", name: "ONE PIECE" }]), "só a caixa difere");
  assert.ok(melhorCorrespondencia("Death Note", [{ slug: "death-note", name: "Death Note" }]), "nome com espaço");
  assert.ok(melhorCorrespondencia("Bleach", [{ slug: "bleach", name: "Bleach" }]), "nome curto");
  // Vários candidatos: tem que escolher o que casa, não o primeiro.
  const escolhido = melhorCorrespondencia("Naruto", [
    { slug: "one-piece", name: "One Piece" },
    { slug: "naruto", name: "Naruto" },
  ]);
  assert.ok(escolhido && escolhido.slug === "naruto", "escolhe o que casa entre vários");
  // Título em outro idioma serve, se for o mesmo item.
  assert.ok(melhorCorrespondencia("Parasita", [{ slug: "parasite", name: "parasite", titles: ["Parasita"] }]),
    "alias na lista de títulos conta");
  assert.ok(melhorCorrespondencia("Death Note", [{ title: { romaji: "Death Note", english: "Death Note" } }]),
    "formato de título do AniList (objeto) é lido");
});

test("portão: continuação não passa por título (a regra do projeto)", () => {
  // `matchVodTitle` já reprova sequel: "Naruto" não pode ser servido com "Naruto Shippuden".
  assert.equal(melhorCorrespondencia("Naruto", [{ slug: "naruto-shippuden", name: "Naruto Shippuden" }]), null);
  // E "Harada no causative" também não.
  assert.equal(melhorCorrespondencia("Naruto", [{ name: "Naruto: Shippuden" }]), null,
    "com dois-pontos o matchVodTitle deixava passar (medido): o portao barra pela continuacao");
  assert.equal(melhorCorrespondencia("Naruto", [{ name: "Naruto Season 2" }]), null);
  assert.equal(melhorCorrespondencia("Naruto", [{ name: "Naruto S2" }]), null);
  // E quando os DOIS lados marcam a mesma temporada, passa: e o mesmo item.
  assert.ok(melhorCorrespondencia("Naruto S2", [{ name: "Naruto Season 2" }]), "mesma temporada, mesmo item");
});

test("portão: entrada vazia nunca vira conteúdo", () => {
  assert.equal(melhorCorrespondencia("", [{ name: "Naruto" }]), null, "sem pedido não há resposta");
  assert.equal(melhorCorrespondencia("Naruto", []), null, "sem resultado não há resposta");
  assert.equal(melhorCorrespondencia("Naruto", null), null, "resultado nulo não vira conteúdo");
  assert.equal(melhorCorrespondencia("Naruto", undefined), null);
  assert.equal(corresponde("Naruto", undefined), false);
  assert.equal(corresponde("", null), false);
});

test("portão: nenhuma fonte aceita 'primeiro resultado' sem casar", () => {
  // Trava por texto no codigo, porque o defeito voltou uma vez ja e o padrao e pequeno.
  // DECISAO 155: o `server.js` tinha DOIS portoes. O segundo estava no caminho de stream de
  // VOD (que escolhia o melhor resultado entre os candidatos das fontes), e esse caminho foi
  // junto com as 10 fontes (decisao 154). O que resta e' o portao da resolucao de id de anime por
  // slug (`resolveStreamInfo`), que continua vivo. A garantia de que o portao nao volta a
  // afrouxar e' a lista de ARQUIVOS abaixo, que e' conferida arquivo por arquivo.
  const arquivos = [
    ["src/scrapers/otakulogia.js", 2],
    ["src/server.js", 1],
  ];
  for (const [arq, minimo] of arquivos) {
    const texto = fs.readFileSync(path.join(raiz, arq), "utf8");
    assert.ok(texto.includes("melhorCorrespondencia"), `${arq} tem que usar o portão`);
    const usos = (texto.match(/melhorCorrespondencia\(/g) || []).length;
    assert.ok(usos >= minimo, `${arq}: esperado ${minimo} usos do portão, achei ${usos}`);
    // E o padrao do defeito nao pode existir mais: aceitar o primeiro resultado de uma BUSCA.
    const semComentario = texto.replace(/\/\/[^\n]*/g, "");
    assert.ok(!/(searchItems|slugResults|anilistResults|busca|encontrados|resultados)\s*\[0\]/.test(semComentario),
      `${arq} ainda aceita o primeiro resultado da busca sem casar`);
  }
  // Os dois pontos do SHG (o que busca o id da fonte e o que monta o stream).
  const shg = fs.readFileSync(path.join(raiz, "src", "scrapers", "otakulogia.js"), "utf8");
  assert.match(shg, /const match = melhorCorrespondencia\(slug, searchItems\);/);
  assert.match(shg, /const bestMatch = melhorCorrespondencia\(query, searchItems\);/);
  // E o detalhe tem que ser do mesmo item (slug casa, conteudo nao).
  assert.match(shg, /melhorCorrespondencia\(query, \[\{ slug: bestMatch\.slug, name: detail\.name \}\]\)/,
    "o detalhe devolvido precisa ser do mesmo item do pedido");
});

test("portão: os títulos lidos cobrem os formatos que as fontes usam", () => {
  assert.deepEqual(titulosDoCandidato("Sao Tome"), ["Sao Tome"], "string solta");
  assert.deepEqual(titulosDoCandidato({ name: "A", title: { romaji: "B", english: "C" } }).sort(), ["A", "B", "C"],
    "campo name + objeto de titulo");
  assert.deepEqual(titulosDoCandidato({ titles: ["X", { title: "Y" }] }).sort(), ["X", "Y"], "lista de titulos");
  assert.deepEqual(titulosDoCandidato(null), [], "nada é nada");
});