// Deriva tudo a partir de src/core/nomes.js — o registro único. Este arquivo só
// guarda a LÓGICA (como resolver um id, como montar o rótulo); nenhum nome,
// sigla, prioridade ou grupo está escrito aqui. Para mudar uma fonte, mexa em
// `FONTES` (src/core/nomes.js).
const { FONTES, rotulo, sigla } = require("../core/nomes");

const SOURCES = {};
const SOURCE_PRIORITY = {};
const EXPOE_CREDENCIAL = new Set();

for (const [chave, fonte] of Object.entries(FONTES)) {
  SOURCES[chave] = {
    label: rotulo(chave),
    id: chave,
    type: fonte.tipo,
    code: fonte.sigla,
    name: fonte.sigla,
  };
  SOURCE_PRIORITY[chave] = fonte.prio;
  if (fonte.cred) EXPOE_CREDENCIAL.add(chave);
}
function getSourceDisplayName(internalId) {
  const src = SOURCES[internalId];
  if (src) return src.label;
  return "CDN Torrent";
}

function getSourceCodename(internalId) {
  const src = SOURCES[internalId];
  if (src) return src.name || src.label;
  return "Torrent";
}

function resolveSourceId(value) {
  if (!value || value === "all") return "all";
  const lower = value.toLowerCase();
  if (SOURCES[lower]) return lower;
  for (const [key, val] of Object.entries(SOURCES)) {
    if (val.label.toLowerCase() === lower || val.name?.toLowerCase() === lower || val.code?.toLowerCase() === lower) return key;
  }
  return lower;
}

module.exports = { SOURCES, SOURCE_PRIORITY, getSourceDisplayName, getSourceCodename, resolveSourceId };
