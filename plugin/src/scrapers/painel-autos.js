const { criaFonte } = require("../lib/fonte-painel");

// Mesmos credenciais/defaults de `src/scrapers/xtream.js` no repo do Mirror (painel "Autos").
// `node tools/gerar-indice.js` compara este bloco com o do addon e falha alto se divergirem.
//
// MEDIDO 01/10/2026 deste servidor (IP de datacenter): o painel responde 200 com uma
// pagina "Welcome to nginx!" de 235 B e o link do video devolve 200 com 235 B de stub.
// No addon por isso o ATO vai sempre embrulhado no `/stream/proxy` do app — que no plugin
// Nuvio nao existe. Aqui o link vai direto, e a prova de vida e o proprio
// `get_vod_info`/`get_series_info` (o painel tem de responder para o stream existir).
// Do IP residencial de quem assiste o caminho nao pode ser provado daqui.
const PAINEL = {
  sigla: "ATO",
  idx: "ato",
  servidor: "4x4u29c.autos",
  porta: "80",
  usuario: "216873",
  senha: "epvnNH"
};

module.exports.getStreams = criaFonte(PAINEL, { catalogo: false });