// O CATALOGO E A META DE TV. NADA MAIS (decisao 155).
//
// O QUE ISTO ERA: o registro das 4 fontes de TV (`rei emb etc rcd`), o agrupamento de canal, a
// triagem que provava quem entregava stream, `getStreams` e o `resolvePlaylist` do relay. Tudo
// isso era PLAYER, e o dono tirou do servidor: *"nada no servidor senao catalogo, todas as
// fontes sao via plugin"* (02/10/2026). As 4 fontes continuam existindo — em
// `nuvio/src/scrapers/`, rodando no aparelho do usuario, do IP residencial dele.
//
// O QUE FICOU, e por que o servidor ainda existe:
//
//   1. A LISTA DE CANAIS. O Nuvio nao tem lista de canal nativo: ela sempre veio de um addon.
//      Sao as 4 rotas `/nuvio/*` (formato `channel`, id numerico) e `/catalog/tv/*` +
//      `/meta/tv/*` (formato Stremio, `tv:live:<chave>`). Mesmo catalogo, mesmo cache; so o
//      `id` muda na entrada e na saida.
//   2. O LOGO. O `/api/channels` do REI tem logo em 100% dos 327 canais (medido), e e' o que
//      preenche o cartaz. Sem isso a lista abre com 82% de buraco (medido na decisao 125).
//   3. O GUIA. `src/lib/epg.js` baixa o XMLTV do REI (`/api/guia`, 1,2MB, ~3.900 programas),
//      parseia por stream e guarda so os canais que batem com o catalogo. A grade do dia sai
//      em `videos` da meta. Decisoes 55/56/121 — e o Nuvio nao tem onde buscar isso.
//
// E O REI, SO. A lista JA ERA SO DO REI antes desta decisao — a 138 confirmou na mao do dono:
// *"o catalogo e apenas do REI dos embeds"*. A 137 (listar a uniao das 4 = 388 canais) tinha sido
// revertida no mesmo dia, e o filtro `chavesDaLista` ja descartava tudo que o REI nao declarava.
// Entao tirar a EMB/ETC/RCD do caminho de metadado NAO muda a lista: ela continua sendo o
// catalogo do REI, canal por canal, com o mesmo nome e a mesma chave.
//
// O QUE SAIU E POR QUE (medido, ver AGENTS.md):
//   * `PROVIDERS` com 4 modulos -> `METADADOS` com 1 (o REI). O registro de fonte continua
//     em `core/nomes.js`; aqui so fica quem entrega METADADO.
//   * A TRIAGEM (`agendaTriagem`, `provadosMortos`, `contagemDeProvas`, `TV_MS_POR_FONTE`,
//     `comOrcamento`, `setCargaDeUsuario`). Ela existia para o servidor NAO listar canal que
//     nao tocava — e ela custava 131s (medido: 284 canais x 3 fontes, conc 48) contra os
//     12,3s em que o gateway corta. Sem player, a pergunta "este canal toca?" nao tem mais a
//     quem ser feita aqui: quem responde e' o plugin, no aparelho, com o player real.
//     E o efeito na lista e MELHOR, nao pior: a regra do dono era *"nao retirar canal"*, e
//     agora NINGUEM no servidor pode retirar — a lista e exatamente o que o REI declara.
//   * `getStreams`, `resolvePlaylist`, `membersOf`, `ownerOf`, `provaPlaylist`, `comTempo`,
//     `relayCache` e o cache negativo do relay (decisao 139/140).
//   * A PRVIA (frame de video, decisao 63) e a sondagem de `existePreview`: a previa vinha da
//     EMB/ETC (o `preview_url` do REI responde 403 nos 327 canais, medido), e elas sairam. Sem
//     fonte de frame, o fundo do canal e o logo — e o `epg.logoDe` ainda entra como reserva.
//
// O QUE FICOU DE `agregaPorCanal`: nada. A montagem por nome normalizado existia para JUNTAR o
// mesmo canal escrito de formas diferentes pelas 4 fontes (decisao 138: "A Fazenda" / "A Fazenda
// 18 - 1" / "A FAZENDA 1"). Com uma fonte so, a chave e o `normKey` do nome que ela declara, e
// nao ha o que casar. O codigo do agrupamento saiu junto com as fontes que ele agrupava.
const { lower } = require("../lib/text");
const epg = require("../lib/epg");
const sqliteCache = require("../lib/sqlite-cache");
const { FONTES, ENV } = require("./nomes");

// A FONTE DE METADADO. Identidade (id, sigla) vem do registro unico — `core/nomes.js`.
//
// A LISTA E A DO REI, e so a do REI (decisao 126, confirmada na 138). Antes desta decisao o
// REI era a primeira de quatro e a lista era filtrada por ele; hoje ele e a unica, e a
// filtragem virou o que ela sempre esteve fazendo: nada. Ver `chavesDaLista`.
const MODULOS = { rei: require("../scrapers/reidosembeds") };

const METADADOS = Object.keys(MODULOS).map((id) => {
  const fonte = FONTES[id];
  if (!fonte) throw new Error(`fonte de metadado de TV fora do registro (src/core/nomes.js): ${id}`);
  return { id, label: fonte.sigla, module: MODULOS[id], prefix: fonte.prefixo };
});

const groups = new Map();

// Memo do catalogo completo, para busca e categoria nao refazerem a montagem. Ver o bloco no
// inicio de `getCatalog`.
//
// MEDIDO em 29/09/2026: o prazo era de 60s e foi o que tirou a TV do ar. Passados 60s o memo
// vencia, e como CADA TERMO DIGITADO e uma chave nova de cache (nunca um cache hit), toda
// busca voltava a pagar a montagem inteira. O prazo e de 5 min: renovar a lista custa uma ida
// a API do REI (256KB), e a mudanca na composicao entra pelo `cacheInvalidated`/`geracao()`,
// que e' o caminho que rebaixa o catalogo no cliente.
const BUSCA_TTL = Number(ENV.TV_BUSCA_TTL_MS || 5 * 60 * 1000);
let completo = [];
let completoEm = 0;

// O ultimo catalogo bom da fonte (decisao 144). 30 dias: e' o prazo da "prova de morte", e um
// catalogo de TV muda devagar — o objetivo e sobreviver a queda, nao guardar para sempre.
const CATALOGO_FONTE_TTL = 30 * 24 * 60 * 60 * 1000;

function normKey(name) {
  return lower(String(name || ""))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

// A chave do slug, sem o prefixo que o id carrega (`tv:live:` e `rei:`). Tira os DOUS aqui de
// proposito: quem chama pode ter ou nao ter ja feito o `stripMeta`, e uma funcao que so
// funciona com o chamador certo e armadilha.
function chaveDoSlug(slug) {
  return normKey(String(slug || "").replace(/^tv:live:/, "").replace(/^rei:/, ""));
}

function stripMeta(id) {
  return String(id || "").replace(/^tv:live:/, "");
}

function ehIdDePrograma(id) {
  return /:epg:\d{4}-\d{2}-\d{2}T/.test(String(id || ""));
}

function idDoPrograma(id) {
  const m = String(id || "").match(/:epg:(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)$/);
  return m ? m[1] : null;
}

function canalDe(id) {
  let bruto = String(id || "").replace(/^tv:live:/, "");
  bruto = bruto.replace(/:epg:\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/, "");
  return bruto;
}

// GENEROS: UM BALDE POR CANAL (decisao 126). O menu de categoria do Stremio e uma lista
// FECHADA (esta), e o filtro casa por nome exato — entao o genero cru da fonte tinha que cair
// dentro de um destes.
//
// MEDIDO 30/09/2026, antes: as metas carregavam **19 generos crus** ("Noticias" E "Notícias",
// "Abertos" E "Canais Abertos", ...) e o menu tinha 10 opcoes. Resultado: **6 das 10 opcoes
// estavam quebradas** — "Abertos" devolvia 10 canais e escondia os 40 "Canais Abertos";
// "Filmes e Séries" devolvia 1 e escondia 137; "Eventos" e "Portugal" devolviam 0.
const BUCKETS = ["Esportes", "Variedades", "Noticias", "Abertos", "Filmes e Séries", "Infantil", "Documentarios"];

const MAPA_GENERO = {
  esportes: "Esportes", futebol: "Esportes", jogo: "Esportes", eventos: "Esportes", corrida: "Esportes",
  variedades: "Variedades", reality: "Variedades", realitys: "Variedades", miamitv: "Variedades",
  geral: "Variedades", adulto: "Variedades", erotica: "Variedades", "24 horas": "Variedades",
  "24h": "Variedades", hunt: "Variedades",
  noticias: "Noticias", jornal: "Noticias", informacao: "Noticias",
  "canais abertos": "Abertos", abertos: "Abertos", aberto: "Abertos", free: "Abertos", evt: "Abertos",
  filmes: "Filmes e Séries", series: "Filmes e Séries", cinema: "Filmes e Séries",
  infantil: "Infantil", desenhos: "Infantil", kids: "Infantil", infantis: "Infantil",
  documentarios: "Documentarios", documenta: "Documentarios", docs: "Documentarios",
};

function normalizaGenero(genero) {
  const cru = String(genero || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!cru) return "";
  if (MAPA_GENERO[cru]) return MAPA_GENERO[cru];
  for (const [de, para] of Object.entries(MAPA_GENERO)) {
    if (cru.includes(de)) return para;
  }
  return "Variedades";
}

// Generos do grupo, ja nos baldes e sem repeticao. Sem `generos`, cai em Variedades: e melhor
// um canal classificado errado do que um canal sem categoria nenhuma no menu.
function generosNosBaldes(lista) {
  const out = [];
  for (const g of Array.isArray(lista) ? lista : []) {
    const b = normalizaGenero(g);
    if (b && !out.includes(b)) out.push(b);
  }
  return out.length ? out : ["Variedades"];
}

// A LISTA E O QUE A FONTE DECLARA (decisao 138 confirmada na 155).
//
// Antes a lista passava por `chavesDaLista(chavesDoRei, todas)`, que descartava tudo que o REI
// nao declarasse e tudo com prova de morte. Com uma fonte so, as duas regras viraram o que
// elas sempre foram: nada. A funcao continua aqui porque e' ela que documenta a regra — e porque
// a lista de canais e' a coisa que o dono mais pediu para nao encolher ("nao retirar canais").
// Se uma fonte de metadado voltar, e' aqui que a lista e' filtrada.
function chavesDaLista(chavesDeclaradas) {
  const saida = new Set();
  for (const key of chavesDeclaradas) saida.add(key);
  return saida;
}

function buildGroup(key, seed) {
  const group = {
    key,
    name: seed.name,
    logo: seed.logo || "",
    preview: seed.preview || "",
    genres: seed.genres || [],
    slug: seed.slug || "",
  };
  groups.set(key, group);
  return group;
}

// Nome de exibicao a partir da chave normalizada. A rota do cartaz usa: a chave e o nome
// sem acento e sem maiuscula, e um cartaz com "a fazenda cam 1" fica feio.
function nomeDeChave(key) {
  const g = groups.get(String(key));
  return g ? g.name : String(key);
}

function nomeDe(slug) {
  const g = groups.get(canalDe(slug));
  return g ? g.name : null;
}

function metaOf(group, data) {
  const guia = epg.linhaGuia(group.name);
  const id = `tv:live:${group.key}`;
  const meta = {
    id,
    type: "tv",
    name: group.name,
    description: [`📡 ${group.genres[0] || "Eventos"} • Ao Vivo`, guia].filter(Boolean).join("\n") + `\n🔴 ${group.name}`,
    poster: group.logo || group.preview,
    background: group.preview || group.logo,
    posterShape: "square",
    genres: group.genres,
    runtime: "🔴 Live",
    behaviorHints: { live: true },
  };
  if (data) {
    const videos = epg.grade(group.name, id, data);
    if (videos.length) {
      meta.videos = videos;
      meta.behaviorHints.hasScheduledVideos = true;
    }
  }
  return meta;
}

async function getCatalog(search, genre, data) {
  // BUSCA E CATEGORIA FILTRAM o catalogo que ja existe — elas nao remontam nada.
  //
  // MEDIDO em 28/09/2026: `?search=globo` dava 504 no app1. A causa era a triagem das 3 fontes
  // rodando inteira ANTES do filtro, todas as vezes. E `genre=Todos` caia fora do corte de
  // "precisa filtrar" — sendo que "Todos" SIGNIFICA "sem filtro" — entao a opcao padrao do menu
  // do Stremio desmontava o catalogo do zero (medido: 11,3s no app1 e 504 no cluster).
  if (completo.length && Date.now() - completoEm < BUSCA_TTL) {
    return filtraCompleto(completo, search, genre, data);
  }

  // O QUE ATRAVESSA RESTART E A COMPOSICAO DA LISTA.
  try {
    const selo = await Promise.resolve(sqliteCache.get(CHAVE_VERSAO, 365 * 24 * 3600 * 1000));
    if (selo !== VERSAO_CATALOGO) {
      await Promise.resolve(sqliteCache.set(CHAVE_VERSAO, VERSAO_CATALOGO, 365 * 24 * 3600 * 1000));
      catalogoInvalido = true;
    }
  } catch (_) {}

  // FONTE NAO MORRE (decisao 144). O dono: "deixe as fontes robustas para que elas nao morram
  // nunca". MEDIDO: quando `getCatalog` de um provedor LANCAVA, o codigo devolvia lista vazia e o
  // canal sumia — bastava uma oscilacao de 30 segundos para a lista aparecer sem 60 canais, sem
  // o usuario ter feito nada. Cada fonte guarda o ULTIMO catalogo bom (SQLite, 30 dias, sobrevive
  // a restart) e uma falha passa a servir esse. A fonte so sai do catalogo quando o fornecedor
  // APAGA o canal de verdade.
  const chunks = await Promise.all(METADADOS.map(async (p) => {
    const chaveCat = `mirror-tv:catalogo:${p.id}`;
    try {
      const cat = await p.module.getCatalog();
      if (cat && cat.length) sqliteCache.set(chaveCat, cat, CATALOGO_FONTE_TTL);
      return cat || [];
    } catch (e) {
      const anterior = sqliteCache.get(chaveCat, CATALOGO_FONTE_TTL);
      if (anterior && anterior.length) {
        console.error(`[tv] catalogo ${p.id} falhou (${e.message}): servindo o ultimo bom, ${anterior.length} canais`);
        return anterior;
      }
      console.error(`[tv] catalogo ${p.id}: ${e.message} (sem catalogo anterior guardado)`);
      return [];
    }
  }));

  // O MAPA `groups` E A RESPOSTA DO CATALOGO PRECISAM ANDAR JUNTOS: o `getMeta` le o grupo para
  // saber a imagem, e a meta do catalogo foi montada a partir dele. Por isso `groups` e
  // reconstruido aqui, sempre, e a geracao so sobe quando o CONJUNTO DE CANAIS muda.
  const fresh = new Map();
  for (let i = 0; i < chunks.length; i++) {
    for (const meta of chunks[i] || []) {
      if (!meta || !meta.name) continue;
      const key = normKey(meta.name);
      if (!key || fresh.has(key)) continue;
      fresh.set(key, {
        key,
        name: meta.name,
        logo: meta.poster || "",
        preview: meta.background && meta.background !== meta.poster ? meta.background : "",
        genres: generosNosBaldes(meta.genres),
        // O SLUG DO REI, sem o prefixo `rei:`. A chave do catalogo e' `normKey(nome)` e o slug
        // do REI e' outro: `argentinanewses` no catalogo, `argentinanews` no REI (medido em 79 dos
        // 327). O REI so e' consultado por `getMeta`, e ele so entende o slug — entao o par
        // viaja guardado no grupo. Sem isto, abrir um canal pelo id do catalogo ("Globo News")
        // virava `canal not found` porque o REI nao conhece a chave normalizada.
        slug: String(meta.id || "").replace(/^tv:live:/, ""),
      });
    }
  }

  groups.clear();
  if (catalogoInvalido) { catalogoInvalido = false; cacheInvalidado(); }

  // A LISTA = o que a fonte declara. Sem triagem, sem prova de morte e sem espera: nada aqui
  // segura a resposta, porque aqui nao ha nada para provar.
  const chavesBoas = chavesDaLista(fresh.keys());
  for (const seed of fresh.values()) buildGroup(seed.key, seed);

  const grupos = [...fresh.values()]
    .filter((seed) => chavesBoas.has(seed.key))
    .map((seed) => {
      const grupo = groups.get(seed.key);
      if (!grupo) return null;
      if (!grupo.logo) grupo.logo = epg.logoDe(grupo.name) || grupo.logo;
      return grupo;
    })
    .filter(Boolean);

  // Ultimo recurso de imagem. MEDIDO: 82% dos canais do catalogo chegavam ao Stremio sem imagem
  // nenhuma, e a lista ficava com buracos visiveis. Um cartaz com o nome do canal e melhor que
  // nada e custa zero banda: e' um SVG gerado aqui, servido pela borda, sempre igual.
  for (const grupo of grupos) {
    if (!grupo.logo) grupo.logo = `/poster/${encodeURIComponent(grupo.key)}.svg`;
  }

  // A GERACAO sobe quando a LISTA DE CANAIS muda — nao a cada montagem. Se subisse a cada
  // `getCatalog`, a chave de cache mudaria sempre, o catalogo nunca seria servido do cache e a
  // montagem rodaria a cada request. Medido antes: 34s, muito acima dos 12s do gateway.
  //
  // MEDIDO em 28/09/2026: a assinatura chegou a incluir QUAIS provedores cada canal tinha
  // (`key|emb,etc,rei`). Uma fonte que falhava por 30s fazia um canal perder um provedor, a
  // assinatura mudava, a geracao subia — e a geracao faz parte da chave de cache, entao TODO o
  // cache era invalidado. Aqui a assinatura e' SO o conjunto de canais.
  let assinatura = "";
  for (const grupo of grupos) assinatura += grupo.key + "\n";
  if (assinatura !== ultimaAssinatura) {
    ultimaAssinatura = assinatura;
    ultimaGeracao++;
  }

  const out = grupos.map((grupo) => {
    if (!grupo.preview) grupo.preview = epg.logoDe(grupo.name) || grupo.preview;
    return metaOf(grupo, data);
  });

  // Memo do catalogo COMPLETO: e' o que a busca e a categoria filtram.
  completo = out;
  completoEm = Date.now();

  const q = search ? lower(search) : null;
  let list = out;
  if (genre && genre !== "Todos") list = list.filter(m => (m.genres || []).includes(genre));
  if (q) list = list.filter(m => lower(m.name).includes(q));
  return list;
}

// Filtra o memo do catalogo completo.
//
// `data` (o `extra.date` do Stremio) ENTRA aqui. Ele nao muda o filtro, muda o formato da meta:
// acrescenta `videos` com a programacao do dia. No caminho da montagem isso e' `metaOf` que
// chama `epg.grade(nome, id, data)` — uma varredura em memoria, sem rede — entao da para refazer
// por meta a partir do memo sem pagar a montagem.
//
// Sem este passo o caminho do memo devolvia a meta SEM programacao: a aba de guia do Stremio
// (`?date=`) abria com os canais e **0 com programa**, que parece guia quebrada.
function filtraCompleto(lista, search, genre, data) {
  let list = lista;
  if (genre && genre !== "Todos") list = list.filter(m => (m.genres || []).includes(genre));
  const q = search ? lower(search) : null;
  if (q) list = list.filter(m => lower(m.name).includes(q));
  if (!data) return list;
  return list.map((m) => {
    const videos = epg.grade(m.name, m.id, data);
    if (!videos.length) return m;
    return { ...m, videos, behaviorHints: { ...m.behaviorHints, hasScheduledVideos: true } };
  });
}

async function getMeta(slug, data) {
  const chave = canalDe(slug);
  // O pedido chega de dois jeitos: pelo id do catalogo (`tv:live:<normKey(nome)>`) ou pelo slug
  // cru do REI (`tv:live:rei:<id>`), e o REI so entende o segundo. O grupo carrega o par.
  const grupo = groups.get(chave);
  const paraORei = grupo && grupo.slug ? grupo.slug : chave;
  let meta = null;
  for (const p of METADADOS) {
    try {
      meta = await p.module.getMeta(paraORei);
    } catch (e) {
      console.error(`[tv] meta ${p.id}: ${e.message}`);
    }
    if (meta) break;
  }
  if (!meta) return null;
  const id = `tv:live:${chave}`;
  const out = { ...meta, id };
  // IMAGEM DO MESMO JEITO QUE O CATALOGO (decisao 121): o grupo manda, que e' exatamente o que
  // o catalogo serviu. Sem isso o canal abria com uma imagem e a lista mostrava outra.
  if (grupo) {
    if (grupo.logo) out.poster = grupo.logo;
    out.background = grupo.preview || grupo.logo || out.poster;
  }
  const partes = [];
  if (meta.description) partes.push(meta.description);
  partes.push("📺 REI");
  const guia = epg.linhaGuia(meta.name);
  if (guia) partes.push(guia);
  out.description = partes.join("\n");
  const videos = epg.grade(meta.name, id, data);
  if (videos.length) {
    out.videos = videos;
    out.behaviorHints = { ...(out.behaviorHints || {}), hasScheduledVideos: true };
  }
  return out;
}

function genres() {
  const all = new Set();
  for (const p of METADADOS) {
    for (const g of p.module.STABLE_GENRES || []) all.add(g);
  }
  return [...all];
}

let invalidarCache = null;
function cacheInvalidado() {
  if (typeof invalidarCache === "function") invalidarCache();
}

function setCacheInvalidator(fn) {
  invalidarCache = fn;
}

let ultimaGeracao = 0;
let ultimaAssinatura = "";

// Forca a reconstrucao do mapa de grupos na proxima chamada de getCatalog. Quem tem a varredura
// de verificacao chama isto depois de reprovar/aprovar um canal.
function geracao() {
  return ultimaGeracao;
}

// Apaga o memo do catalogo e o mapa de grupos. O reset de cache (decisao 134) precisa disso:
// o `Map` `groups` e o `completo` sao estado que NAO mora no SQLite, entao zerar o disco
// deixaria a lista de TV servindo o memo velho — o reset responderia "disco 0, memoria 0" e o
// catalogo continuaria o mesmo.
function limpaMemoria() {
  const quantos = groups.size;
  groups.clear();
  completo = [];
  completoEm = 0;
  ultimaAssinatura = "";
  cacheInvalidado();
  return quantos;
}

function quantosCanaisEmMemoria() {
  return groups.size;
}

// SELO DE VERSAO DO CATALOGO. MEDIDO em 30/09/2026: o catalogo de TV vive num cache de 24h e
// NADA o invalidava no deploy, entao uma fonte nova subia no codigo e so aparecia 24 horas
// depois. Bump deste selo quando entrar, sair ou mudar a fonte de METADADO de TV.
const VERSAO_CATALOGO = "2026-10-02-somente-catalogo";
const CHAVE_VERSAO = "mirror-tv:vercatalogo";

let catalogoInvalido = false;
function warmup() {
  for (const p of METADADOS) {
    if (typeof p.module.getCatalog === "function") Promise.resolve(p.module.getCatalog()).catch(() => {});
  }
  // Monta o catalogo (so o que a fonte declara: uma leitura de 256KB, sem rede contra origens de
  // video) e comeca a baixar o guia. Antes disto a montagem pagava a triagem de 4 fontes.
  Promise.resolve().then(() => getCatalog()).catch(() => {});
  Promise.resolve(getCatalog())
    .then(cat => epg.start(cat.map(m => m.name)))
    .catch(() => epg.start());
}

// `filtraCatalogo` e o MESMO corte que o `getCatalog` aplica ao catalogo completo (genero,
// nome, dia da guia). A reserva do split tambem o usa: ela so guarda a lista INTEIRA, e sem este
// filtro a busca com o cluster fora devolvia [] mesmo com os canais na memoria.
module.exports = { METADADOS, BUCKETS, normalizaGenero, generosNosBaldes, chavesDaLista, getCatalog, filtraCatalogo: filtraCompleto, geracao, nomeDeChave, getMeta, genres, warmup, normKey, chaveDoSlug, epg, setCacheInvalidator, nomeDe, canalDe, ehIdDePrograma, idDoPrograma, limpaMemoria, quantosCanaisEmMemoria };
