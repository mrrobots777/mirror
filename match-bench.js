require("dotenv").config();
const { matchVodTitle, matchScore, bestMatchScore } = require("./src/lib/match");

const CASOS = [
  // [nome no catalogo, consulta, ehSerie, ano, esperado(true/false), porque]
  ["Matrix", "Matrix", false, 1999, true, "exato"],
  ["Matrix (1999)", "Matrix", false, 1999, true, "com ano no nome"],
  ["Matrix", "Matrix 1999", false, 1999, true, "ano na consulta"],
  ["Matrix Reloaded", "Matrix", false, 1999, false, "sequela nao pode servir"],
  ["Matrix Revolutions", "Matrix", false, 1999, false, "prequela nao pode servir"],
  ["Matrix", "The Matrix", false, 1999, true, "article no inicio"],
  ["Senhora do Destino", "senhora do destino", false, 2002, true, "caixa diferente"],
  ["Senhora-do-Destino", "Senhora do Destino", false, 2002, true, "hifen"],
  ["S.O.S. Mes Del", "S.O.S Mes Del", false, 0, true, "pontos (sinal)"],
  ["Batman 2022", "Batman", false, 2022, true, "remake com ano"],
  ["Batman 1989", "Batman", false, 2022, false, "ano errado reprova"],
  ["Batman Returns", "Batman", false, 2022, false, "sequela nao pode servir"],
  ["Naruto Shippuden", "Naruto", true, 0, false, "spinoff com mesmo prefixo"],
  ["Dragon Ball Super", "Dragon Ball", true, 0, false, "spinoff mesmo prefixo"],
  ["Naruto", "Naruto", true, 0, true, "exato serie"],
  ["One Piece", "One Piece", true, 0, true, "exato serie"],
  ["Breaking Bad", "Breaking Bad", true, 0, true, "exato serie"],
  ["CSI Miami", "CSI: Miami", true, 0, true, "dois pontos"],
  ["The Office (US)", "The Office", true, 0, true, "sufixo de regiao"],
  ["The Walking Dead", "The Walking Dead", true, 0, true, "article"],
  ["Walking Dead", "The Walking Dead", true, 0, true, "article so no catalogo"],
  ["Friends", "Friends 1994", true, 0, true, "ano na consulta"],
  ["Game of Thrones", "Game of Thrones", true, 0, true, "varias palavras"],
  ["A Faleca", "A Faleca", false, 0, true, "article em portugues"],
  ["O Poderoso Chefão", "Poderoso Chefão", false, 1972, true, "article em portugues"],
  ["Previa", "Prévia", false, 0, true, "acento so na consulta"],
  ["JoJo's Bizarre Adventure", "JoJo Bizarre Adventure", true, 0, true, "apostrofo"],
  ["Spider-Man", "Spider Man", false, 0, true, "hifen"],
  ["Amélie", "Amelie", false, 0, true, "acento no catalogo"],
  ["Avengers: Endgame", "Avengers Endgame", false, 0, true, "dois pontos"],
  ["Osternd", "Osternd", false, 0, true, "palavra parecida com palavra reservada"],
  ["Dune", "Dune", false, 2021, true, "palavra curta"],
  ["Dune 2021", "Dune", false, 2021, true, "ano junto"],
  ["Dune 1984", "Dune", false, 2021, false, "outra epoca do mesmo nome"],
  ["Pantera Negra", "Black Panther", false, 2018, true, "traducao (deve casar via titulo alternativo)"],
  ["A Origem", "Inception", false, 2010, true, "titulo br x en (deve casar via titulo alternativo)"],
  ["Interestelar", "Interstellar", false, 2014, true, "titulo br x en"],
];

let ok = 0;
let falhas = [];
for (const [nome, consulta, serie, ano, esperado, porque] of CASOS) {
  const got = matchVodTitle(nome, consulta, serie, ano);
  if (got === esperado) ok++;
  else falhas.push({ nome, consulta, serie, ano, esperado, got, porque });
}
console.log(`\n=== BANCO DE CASAMENTO DE TITULO (${CASOS.length}) ===`);
console.log(`  acertos: ${ok}/${CASOS.length}`);
if (falhas.length) {
  console.log(`\n  --- FALHAS (${falhas.length}) ---`);
  for (const f of falhas) {
    console.log(`  "${f.nome}" vs consulta "${f.consulta}"${f.ano ? " (" + f.ano + ")" : ""} [${f.serie ? "serie" : "filme"}]`);
    console.log(`      esperado ${f.esperado} | obtido ${f.got}  (${f.porque})`);
  }
}

console.log(`\n=== PONTUACAO (matchScore) ===`);
for (const [a, b] of [["Naruto", "Naruto Shippuden"], ["Matrix", "Matrix Reloaded"], ["Matrix", "Matrix"], ["Batman", "Batman Returns"], ["HBO", "HBO 2"]]) {
  console.log(`  "${a}" vs "${b}" -> ${matchScore(a, b)}`);
}
process.exit(0);
