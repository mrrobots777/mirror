const { lower } = require("./text");
const mapa = require("./canais");

const VIVO = /^tv:live:/i;
const PREFIXOS = /^(rei|emb|etc|rcd|reidoscanais|reidosembeds|embedtv|embedcanais):/i;

function normKey(valor) {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function limpa(valor) {
  const bruto = String(valor == null ? "" : valor).trim();
  if (!bruto) return "";
  return bruto.replace(/^tmdb:/i, "").replace(VIVO, "").replace(PREFIXOS, "").toLowerCase();
}

function itemDe(limpo) {
  if (!limpo) return null;
  const direto = mapa.porSlug[limpo];
  if (direto) return direto;
  if (/^\d+$/.test(limpo)) {
    const porNumero = mapa.porNumero[Number(limpo)];
    return porNumero ? mapa.porSlug[porNumero.slug] : null;
  }
  const chave = normKey(limpo);
  if (!chave) return null;
  for (const item of Object.values(mapa.porSlug)) {
    if (normKey(item.nome) === chave || normKey(item.slug) === chave) return item;
  }
  return null;
}

function de(id, fonte) {
  const item = itemDe(limpa(id));
  if (!item) return null;
  if (fonte === "rei") return { slug: item.rei ? item.slug : "", nome: item.nome, tem: !!item.rei };
  const slug = item[fonte] || "";
  return { slug, nome: item.nome, tem: !!slug };
}

module.exports = { de, limpa, normKey, lower };
