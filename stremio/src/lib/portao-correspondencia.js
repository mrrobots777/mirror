// O PORTAO DE CORRESPONDENCIA: nenhuma fonte devolve um item que nao e o que foi pedido.
//
// MEDIDO 01/10/2026, em PRODUCAO, e o pior defeito ja encontrado no projeto: pedido de
// `movie/tmdb:603` (Matrix) respondeu com `otakulogia:futari-wa-precure:1x1` — um anime sem
// relacao — e pedido de `movie/tmdb:155` (Batman) respondeu com **Boruto**. A pessoa pede Matrix e
// da de cara com um desenho japones, sem nenhum aviso.
//
// A busca nao e o problema; e o que se faz com o resultado da busca. No SHG era
// `searchItems.find(exato) || searchItems[0]`: sem casamento exato, aceitava o **PRIMEIRO**
// resultado, qualquer que fosse, e devolvia o episodio 1 dele. Como o motor chama as fontes com
// VARIANTES de titulo, quase toda variante caia nesse caminho.
//
// A REGRA usa `matchVodTitle`, que ja e a regra do projeto para paineis (ignora qualificador,
// reprova sequela). Medido com ela: "Naruto" para "Naruto Shippuden" reprova, "Pretty Cure"
// para "Matrix" reprova, "Boruto" para "Batman" reprova, e o nome proprio passa.
//
// Se nada casar, a fonte devolve **[]**. Sem stream e honesto; stream do item errado e pior que
// stream nenhum, porque a pessoa assiste a coisa errada sem perceber.

const { matchVodTitle } = require("./match");
const { normalizeLoose } = require("./text");

// O `slug` e identificador da FONTE, nao titulo: no SHG ele ja é o slug do anime, entao
// igualdade exata com ele (normalizada) e um sinal forte e seguro.
function titulosDoCandidato(c) {
  const saida = [];
  if (!c) return saida;
  if (typeof c === "string") { saida.push(c); return saida; }
  for (const campo of ["name", "title", "originalTitle", "englishTitle", "romajiTitle", "nativeTitle"]) {
    const v = c[campo];
    if (typeof v === "string" && v.trim()) saida.push(v.trim());
  }
  if (c.title && typeof c.title === "object") {
    for (const k of ["romaji", "english", "native"]) {
      const v = c.title[k];
      if (typeof v === "string" && v.trim()) saida.push(v.trim());
    }
  }
  if (Array.isArray(c.titles)) {
    for (const t of c.titles) {
      if (typeof t === "string" && t.trim()) saida.push(t.trim());
      else if (t && typeof t.title === "string" && t.title.trim()) saida.push(t.title.trim());
    }
  }
  return [...new Set(saida)];
}

// MARCADOR DE CONTINUACAO. MEDIDO: `matchVodTitle` reprova "Naruto Shippuden" para "Naruto",
// mas DEIXA PASSAR "Naruto: Shippuden" (com dois-pontos o caminho de comparacao acha o resto
// "vazio" depois de normalizar). Servir a continuacao no lugar do primeiro anime tambem e
// conteudo errado, entao o portao barra os dois jeitos.
//
// So entram marcadores inequivocos: "Shippuden", "2nd/3rd season", "Season N", "S2" (a letra
// S colada no numero e como o projeto escreve temporada). Nao entra nada que possa fazer parte de
// um titulo legitimo ("II" ou "2" soltos podem ser).
const MARCADOR_CONTINUACAO = /\b(shippuden|\d(?:st|nd|rd|th)\s+season|season\s*\d|s\d{1,2}\b|temporada\s*\d)/i;

// O que importa e o NUMERO da temporada, nao a forma como ela foi escrita: "Naruto S2" e
// "Naruto Season 2" sao o mesmo item, e "Naruto S2" para "Naruto" e continuacao.
function numeroDaTemporada(texto) {
  const m = String(texto || "").match(/(?:season|temporada)\s*(\d{1,2})|\bs(\d{1,2})\b/i);
  return m ? Number(m[1] || m[2]) : 0;
}

function tituloTemContinuacaoQueOPedidoNaoTem(titulo, pedido) {
  if (!MARCADOR_CONTINUACAO.test(String(titulo || ""))) return false;
  const doTitulo = numeroDaTemporada(titulo);
  const doPedido = numeroDaTemporada(pedido);
  if (doTitulo && doPedido) return doTitulo !== doPedido;
  return !MARCADOR_CONTINUACAO.test(String(pedido || ""));
}

// "Naruto Season 2" e "Naruto S2" sao o MESMO item: o casamento do projeto nao equipara as duas
// escritas (medido: `matchVodTitle("Naruto Season 2", "Naruto S2")` = false), entao o portao
// compara tambem sem o marcador de temporada. Isso NAO afrouxa a regra de continuacao, porque o
// bloqueio acima ja descartou "Naruto Season 2" para "Naruto" — so sobra aqui o caso em que os
// dois lados falam da MESMA temporada.
const semMarcadorDeTemporada = (t) =>
  normalizeLoose(String(t || "").replace(/(?:season|temporada)\s*\d{1,2}|\bs\d{1,2}\b/gi, " "));

function mesmaTemporadaEMesmoNome(titulo, pedido) {
  const a = semMarcadorDeTemporada(titulo);
  const b = semMarcadorDeTemporada(pedido);
  return !!a && !!b && a === b;
}

function slugIgual(consulta, candidato) {
  if (!candidato || typeof candidato.slug !== "string") return false;
  return normalizeLoose(candidato.slug) === normalizeLoose(consulta);
}

// Escolhe o MELHOR entre os resultados e devolve `null` quando nenhum passa do portao.
function melhorCorrespondencia(consulta, resultados) {
  const lista = Array.isArray(resultados) ? resultados : [];
  if (!lista.length) return null;
  const pedido = String(consulta || "").trim();
  if (!pedido) return null;
  for (const item of lista) {
    if (slugIgual(pedido, item)) return item;
    for (const titulo of titulosDoCandidato(item)) {
      if (tituloTemContinuacaoQueOPedidoNaoTem(titulo, pedido)) continue;
      if (normalizeLoose(titulo) && normalizeLoose(titulo) === normalizeLoose(pedido)) return item;
      if (mesmaTemporadaEMesmoNome(titulo, pedido)) return item;
      if (matchVodTitle(titulo, pedido, true)) return item;
    }
  }
  return null;
}

function corresponde(consulta, resultado) {
  return melhorCorrespondencia(consulta, resultado ? [resultado] : []) !== null;
}

module.exports = { melhorCorrespondencia, corresponde, titulosDoCandidato, tituloTemContinuacaoQueOPedidoNaoTem };