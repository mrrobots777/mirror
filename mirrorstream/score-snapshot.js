require("dotenv").config();

const aon = require("./src/scrapers/aon");
const ron = require("./src/scrapers/animesdigital");
const atb = require("./src/scrapers/anitube");
const dgo = require("./src/scrapers/doramogo");

const TITULOS = [
  "Naruto",
  "Naruto Clássico",
  "Naruto Shippuden",
  "Naruto Shippuden - O Último Arco",
  "One Piece",
  "One Piece Film Red",
  "Bleach",
  "Bleach: Thousand-Year Blood War",
  "Attack on Titan",
  "Attack on Titan - Temporada Final",
  "Jujutsu Kaisen",
  "Death Note",
  "Boruto: Naruto Next Generations",
  "Hunter x Hunter",
  "Demon Slayer",
  "Fullmetal Alchemist",
  "My Hero Academia",
  "Spy x Family",
  "Vinland Saga",
  "Chainsaw Man",
  "Dune",
  "O Poderoso Chefão",
  "Round 6",
  "Itaewon Class",
  "Cidade Invisível",
  "Meu Amor",
  "Cavaleiros do Zodíaco",
  "Naruto SD",
  "Boruto - episodes",
  "Naruto Temporada 2",
  "Naruto - Episódio 10",
  "Naruto Clássico Episódio 5 Dublado",
  "One Piece Episódio 1030",
  "Naruto Movie",
  "Blood Prison",
  "Tokyo Revengers",
  "Fruits Basket",
];

const CONSULTAS = ["Naruto", "One Piece", "Bleach", "Attack on Titan", "Boruto", "Dune", "O Poderoso Chefão", "Round 6", "Itaewon Class", "Cidade Invisível", "Meu Amor", "Jujutsu Kaisen"];

const linhas = [];
for (const q of CONSULTAS) {
  for (const t of TITULOS) {
    linhas.push(`aon|${q}|${t}|${aon.scoreSerie(q, t)}`);
    linhas.push(`ron|${q}|${t}|${ron.scoreSeries(t, q, 1)}`);
    linhas.push(`ron2|${q}|${t}|${ron.scoreSeries(t, q, 2)}`);
    linhas.push(`atb|${q}|${t}|${atb.scoreSeries(t, q, 1)}`);
    linhas.push(`dgo|${q}|${t}|${dgo.scoreSeries(t, q)}`);
  }
}
for (const q of CONSULTAS) {
  for (const t of ["Naruto", "Naruto Dublado", "Naruto Legendado", "Boruto Naruto", "Naruto Clássico"]) {
    linhas.push(`cat|${q}|${t}|${atb.scoreCategory(t, q)}`);
  }
}

process.stdout.write(linhas.join("\n") + "\n");
