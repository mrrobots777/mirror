// A PONTE ENTRE O ID NUMERICO DO NUVIO E O SLUG DO CANAL.
//
// POR QUE EXISTE: o NuvioTV so deixa o plugin `mirror` rodar em id NUMERICO
// (`ensureTmdbId`, `TmdbService.kt:227-229`), entao o addon precisa publicar o canal com `id: 1001`
// em vez de `tv:live:ae`. O numero -> slug mora no proprio plugin (`nuvio/src/lib/canais.js`, o
// mapa gerado por `nuvio/tools/gerar-canais.js`), e este arquivo e' o unico lugar do addon que
// le esse mapa. O mapa NAO e' copiado aqui: se os dois lados tivessem uma copia, mudar o gerador
// quebraria o addon em silencio — o canal abriria, o plugin nao acharia o slug, e o sintoma seria
// "fonte sem player" em um canal so.
//
// A CHAVE DO CANAL NO CATALOGO E' `normKey(nome)` (decisao 138), e nao o slug do REI: os dois
// divergem em 79 dos 327 canais medidos (`argentinanewses` no catalogo, `argentinanews` no REI).
// Por isso a traducao passa pelo NOME do REI, e nao pelo slug — e o slug continua sendo o valor que
// as fontes de TV entendem.
const tvSources = require("../core/tv-sources");

// `require` ATRASADO e tolerante: se o diretorio `nuvio/` nao vier na imagem (o Dockerfile faz
// `COPY . .`, mas uma build enxuta pode nao), as 4 rotas do adapter respondem 503 e TODO O RESTO
// DO ADDON continua funcionando. Um `require` no topo derrubaria o processo no boot.
const ARQUIVO_DO_MAPA = "../../nuvio/src/lib/canais";

let mapa = undefined;
let indice = null;

function mapaDe() {
  if (mapa !== undefined) return mapa;
  try {
    const carregado = require(ARQUIVO_DO_MAPA);
    mapa = carregado && carregado.porNumero && carregado.porSlug ? carregado : null;
  } catch (_) {
    mapa = null;
  }
  return mapa;
}

function temMapa() {
  return !!mapaDe();
}

// Monta os tres indices de uma vez. `porChave` so aceita o que o REI declara, porque a lista do
// addon E' a do REI (decisao 138) e o que so existe na EMB/ETC/RCD nao aparece no catalogo — se
// uma dessas grafias dividisse a chave normalizada com um canal do REI, o REI tem que ganhar.
function indiceDe() {
  if (indice) return indice;
  const m = mapaDe();
  const porNumero = new Map();
  const porChave = new Map();
  const porSlug = new Map();
  const numeroPorSlug = new Map();
  if (m) {
    for (const [chave, item] of Object.entries(m.porNumero || {})) {
      if (!item || !item.slug) continue;
      numeroPorSlug.set(item.slug, Number(chave));
    }
    for (const [slug, item] of Object.entries(m.porSlug || {})) {
      if (!item) continue;
      const numero = numeroPorSlug.get(slug);
      if (!numero) continue;
      const chaveCanal = tvSources.normKey(item.nome) || tvSources.normKey(slug);
      if (!chaveCanal) continue;
      const reg = { numero, slug, nome: item.nome || "", chave: chaveCanal, rei: !!item.rei };
      porNumero.set(numero, reg);
      porSlug.set(slug, reg);
      if (reg.rei || !porChave.has(chaveCanal)) porChave.set(chaveCanal, reg);
    }
  }
  indice = { porNumero, porChave, porSlug, numeroPorSlug };
  return indice;
}

// NUMERO -> CANAL. `id` chega como texto da rota; aceita o sufixo `:epg:<inicio>` porque e' assim
// que o cliente pede o stream de um programa da grade.
function registroDeNumero(id) {
  const limpo = String(id == null ? "" : id).replace(/:epg:[\dTZ:.\-]+$/i, "");
  if (!/^\d+$/.test(limpo)) return null;
  return indiceDe().porNumero.get(Number(limpo)) || null;
}

// META DO CATALOGO -> CANAL.
//
// A ORDEM IMPORTA, e o NOME vem primeiro. O `id` do catalogo e' `tv:live:<normKey(nome)>` (decisao
// 138) — medido: os 327 canais batem, sem um so. Entao o nome e' a identidade do canal, e procurar
// por ele primeiro e' o certo. O contrario da defeito: o id `tv:live:premiere` (slug do REI) e' a
// chave de `normKey("Premiere")`, que e' OUTRO canal (o 1392, da RCD) — e por id ele ganharia o
// numero do canal vizinho. O slug fica como reserva, para quando o nome nao casar com nada.
function registroDeCatalogo(meta) {
  if (!meta) return null;
  const idx = indiceDe();
  const peloNome = tvSources.normKey(meta.name);
  if (peloNome && idx.porChave.has(peloNome)) return idx.porChave.get(peloNome);
  const chave = tvSources.canalDe(String(meta.id || ""));
  if (chave && idx.porChave.has(chave)) return idx.porChave.get(chave);
  if (chave && idx.porSlug.has(chave)) return idx.porSlug.get(chave);
  return null;
}

// O MAPA INTEIRO, em numero crescente. E' o que o teste de contrato cruza com o catalogo: um
// `id` do catalogo sem numero aqui, ou um numero aqui sem canal no catalogo, e' orfao.
function todos() {
  return [...indiceDe().porNumero.values()].sort((a, b) => a.numero - b.numero);
}

module.exports = { temMapa, registroDeNumero, registroDeCatalogo, todos };
