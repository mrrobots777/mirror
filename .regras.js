// Regras de excisao: o que pertence ao OUTRO produto.
//
//   mirrorstream  tira a TV   (catalogo de canal, EPG, split de cluster, /nuvio/*, /tv, p2p, /api/channels*)
//   mirrorview    tira o VOD  (catalogo e meta de filme/serie, /api/vod/*, /api/streams/*, catalogo de painel)
module.exports = {
  mirrorstream: [
    { linha: true, re: /^const tvSources = require\("\.\/core\/tv-sources"\);$/, rotulo: "require tv-sources" },
    { linha: true, re: /^const tvSplit = require\("\.\/lib\/tv-split"\);$/, rotulo: "require tv-split" },
    { linha: true, re: /^const nuvio = require\("\.\/routes\/nuvio"\);$/, rotulo: "require routes/nuvio" },
    { re: /^async function esperaEpg\(\) \{/, rotulo: "esperaEpg (so TV)" },
    { re: /^tvSplit\.definirFallbackTv\(\(req\) => \{/, rotulo: "fallback do catalogo de TV" },
    { re: /^tvSplit\.definirAoRepasse\(\(req, corpo\) => \{/, rotulo: "hook de repasse" },
    { re: /^function paginaDeTv\(/, rotulo: "paginaDeTv" }
  ],
  mirrorview: []
};