const { criaFonte } = require("../lib/fonte-painel");

// Mesmos credenciais/defaults de `src/scrapers/xtream.js` no repo do Mirror (painel "Space").
// `node tools/gerar-indice.js` compara este bloco com o do addon e falha alto se divergirem.
const PAINEL = {
  sigla: "SPC",
  idx: "spc",
  servidor: "telaplay93.top",
  porta: "80",
  usuario: "LuizDavi@",
  senha: "fBkvnKe5Mq"
};

module.exports.getStreams = criaFonte(PAINEL, { catalogo: false });