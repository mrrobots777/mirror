// REGISTRO ÚNICO DE NOMES DO PROJETO.
//
// Aqui vive todo "nome" que o código usa: as FONTES (apelido, rótulo, tipo,
// prioridade), as ROTAS da API e as VARIÁVEIS DE AMBIENTE. O resto do código
// importa daqui — nenhum rótulo, caminho ou nome de env é escrito em dois
// lugares.
//
// Regras de nomenclatura (o padrão que vale para tudo):
//   * chave de fonte  = 3-4 letras minúsculas, sem acento ("blz", "rei")
//   * apelido/sigla   = a MESMA chave em maiúsculas ("BLZ") — nunca inventado
//   * rótulo exibido  = "<grupo> | <sigla>" ("CDN VOD | BLZ")
//   * rota            = minúsculas, plural no coletivo, sem verbo
//                       (/api/channels, /api/vod/search)
//   * env var         = MAIÚSCULAS com sublinhado, prefixo do dono do valor
//                       (XTREAM_*, KAKITO_*, TV_*, REI_*, BR_*)
//   * arquivo         = kebab-case ("reidosembeds.js")
//   * função          = verbo + substantivo, em português ou inglês conforme
//                       o arquivo (o arquivo escolhe o idioma e mantém)
//
// Para mudar o nome de qualquer coisa: muda AQUI e só aqui.

/* ============================ FONTES ============================ */

// Grupo define o prefixo do rótulo exibido ao usuário.
const GRUPOS = {
  vod: "CDN VOD",
  tv: "CDN TV",
  http: "CDN RSL",
};

// tipo    -> grupo de exibição (vira o rótulo "CDN VOD | BLZ")
// motor   -> bucket do scraper-engine ("anime" | "vod" | "tv" | "http")
// prio    -> ordem de exibição (menor aparece primeiro; 9 = fim da fila)
// cred    -> a URL da origem traz credencial (esconde o link cru)
// prefixo -> como o provedor de TV sinaliza o dono do canal no id
// `conteudos` = o que a fonte ENTREGA (categoria de conteúdo). É o que separa
// "fonte de anime" de "fonte de série/filme" e de "fonte de TV": o `motor`
// diz em qual BALDE ela é chamada, os conteúdos dizem o que ela serve. Um
// pode listar vários (BLZ serve filme e série), `cas` não entrega nada (é o
// nome de reserva de quem não veio de nenhuma fonte).
const CONTEUDOS = ["anime", "serie", "filme", "dorama", "tv"];

const FONTES = {
  shg: { sigla: "SHG", tipo: "vod", motor: ["anime"], prio: 2, conteudos: ["anime"] },
  ron: { sigla: "RON", tipo: "vod", motor: ["anime"], prio: 2, conteudos: ["anime"] },
  aon: { sigla: "AON", tipo: "vod", motor: ["anime"], prio: 2, conteudos: ["anime"] },
  atb: { sigla: "ATB", tipo: "vod", motor: ["anime"], prio: 2, conteudos: ["anime"] },
  spt: { sigla: "SPT", tipo: "vod", motor: ["vod"], prio: 1, conteudos: ["filme", "serie"] },
  blz: { sigla: "BLZ", tipo: "vod", motor: ["vod"], prio: 0, cred: true, conteudos: ["filme", "serie"] },
  spc: { sigla: "SPC", tipo: "vod", motor: ["vod"], prio: 0, cred: true, conteudos: ["filme", "serie"] },
  ato: { sigla: "ATO", tipo: "vod", motor: ["vod"], prio: 1, cred: true, conteudos: ["filme", "serie"] },
  kkt: { sigla: "KKT", tipo: "vod", motor: ["vod"], prio: 0, conteudos: ["filme", "serie"] },
  rtd: { sigla: "RTD", tipo: "vod", motor: ["vod", "anime"], prio: 1, conteudos: ["anime", "filme", "serie"] },
  dgo: { sigla: "DGO", tipo: "vod", motor: ["vod"], prio: 2, conteudos: ["dorama"] },
  vzr: { sigla: "VZR", tipo: "vod", motor: ["vod"], prio: 2, conteudos: ["filme", "serie"] },
  emb: { sigla: "EMB", tipo: "tv", motor: ["tv"], prio: 0, prefixo: "", conteudos: ["tv"] },
  etc: { sigla: "ETC", tipo: "tv", motor: ["tv"], prio: 0, prefixo: "etc:", conteudos: ["tv"] },
  rei: { sigla: "REI", tipo: "tv", motor: ["tv"], prio: 9, prefixo: "rei:", conteudos: ["tv"] },
  // A QUARTA FONTE DE TV (decisao 153). MEDIDO 01/10/2026 na origem: `api.reidoscanais.st/channels`
  // devolve 110 canais com `logo_url`, `category`, `embeds[]` e o `epg` JA PRONTO dentro do JSON
  // (programa atual com titulo, descricao e horario) — nao ha XMLTV para baixar. O video tem tres
  // saltos: `embed_url` -> iframe -> a pagina do player traz o `.m3u8` (achado pelo `lib/extrator.js`).
  rcd: { sigla: "RCD", tipo: "tv", motor: ["tv"], prio: 8, prefixo: "rcd:", conteudos: ["tv"] },
  cas: { sigla: "CAS", tipo: "http", motor: ["http"], prio: 4, conteudos: [] },
};

// Índice derivado: categoria -> chaves das fontes, na ordem do FONTES.
// Nunca escreva essa lista à mão — o teste de registro falha se divergir.
function fontesDe(conteudo) {
  return Object.keys(FONTES).filter(chave => (FONTES[chave].conteudos || []).includes(conteudo));
}

function categoriasDasFontes() {
  const saida = {};
  for (const c of CONTEUDOS) saida[c] = fontesDe(c);
  return saida;
}

// Rótulo completo exibido no Stremio: "CDN VOD | BLZ".
function rotulo(chave) {
  const f = FONTES[chave];
  if (!f) return "CDN Torrent";
  return `${GRUPOS[f.tipo]} | ${f.sigla}`;
}

// Sigla ("BLZ"). Reaproveitada pelo scraper-engine como rótulo de erro/timeout.
function sigla(chave) {
  const f = FONTES[chave];
  return f ? f.sigla : String(chave || "").toUpperCase();
}

// Prefixo do provedor de TV no id do canal ("" | "etc:" | "rei:").
function prefixo(chave) {
  const f = FONTES[chave];
  return f && f.prefixo !== undefined ? f.prefixo : `${chave}:`;
}

/* ============================ WORKERS (borda por fonte) ============================ */

// DECISAO 124 (30/09/2026) — UM WORKER POR FONTE. Pedido do dono: "crie um worker para
// cada fonte" para isolar cota. O plano gratis da Cloudflare da cota POR WORKER, entao com
// um worker so (`mirror-cdn`) uma fonte que estoura o limite derruba as outras 15. Segundo
// ganho: cada worker passa a falar com uma origem so, que e o que permite a Cloudflare
// puxar cada um para perto do backend dele (Smart Placement) — foi o que destravou o RTD,
// que so responde para quem chama do Brasil.
//
// A URL e DERIVADA do nome (`https://<nome>.<WORKER_SUFIXO>`), nunca escrita a mao. `padrao`
// e o worker generico: entra quando a fonte nao tem worker proprio (e quando `CDN_PROXY` esta
// ligado, que ai manda em tudo — e assim que o dev local aponta para o worker proprio dele).
const WORKER_SUFIXO = "dev-avmirror.workers.dev";

const WORKERS = {
  padrao: "mirror-cdn",
  shg: "mirror-shg",
  ron: "mirror-ron",
  aon: "mirror-aon",
  atb: "mirror-atb",
  spt: "mirror-spt",
  blz: "mirror-blz",
  spc: "mirror-spc",
  ato: "mirror-ato",
  kkt: "mirror-kkt",
  rtd: "mirror-rtd",
  dgo: "mirror-dgo",
  vzr: "mirror-vzr",
  emb: "mirror-emb",
  etc: "mirror-etc",
  rei: "mirror-rei",
  rcd: "mirror-rcd",
};

// Worker que atende a fonte. `fonte` unknown/vazio cai no generico — e o que mantem
// funcionando qualquer caminho que ainda nao passou a fonte.
function workerDe(fonte) {
  const chave = WORKERS[fonte] ? fonte : "padrao";
  if (chave === "padrao" && ENV.CDN_PROXY) return String(ENV.CDN_PROXY).replace(/\/+$/, "");
  return `https://${WORKERS[chave]}.${WORKER_SUFIXO}`;
}

/* ============================= ROTAS ============================= */

// Todos os caminhos que o servidor atende. Registrados por estes nomes —
// mudar uma URL é mudar uma linha aqui.
const ROTAS = {
  raiz: "/",
  saude: "/health",
  metricas: "/metrics",
  instalacao: "/install",
  painel: "/dashboard",
  tv: "/tv",
  poster: "/poster/:key.svg",
  redireciona: "/resolve",

  manifesto: "/:config/manifest.json",
  streamsStremio: "/:config/stream/:type/:id.json",
  catalogoStremio: "/:config/catalog/:type/:id.json",
  metaStremio: "/:config/meta/:type/:id.json",
  catalogoRaiz: "/catalog/:type/:id.json",

  p2pRelato: "/p2p/report",
  limparCache: "/admin/limpar-cache",

  // ADAPTER DO NUVIO. O Nuvio nao trata `tv` como vivo: `tv` = serie, e canal ao vivo e' do tipo
  // `channel` do Stremio. Estas sao as 4 rotas do `mirrorhub` — o addon que o Nuvio instala colando
  // a URL (ele anexa `/manifest.json` sozinho). O `id` do canal aqui e' NUMERICO, porque o
  // NuvioTV so deixa o plugin rodar em id numerico; o mapa numero -> slug e' o mesmo que o
  // plugin usa (`nuvio/src/lib/canais.js`), importado por `lib/nuvio-canais.js`.
  //
  // DECISAO 155: `stream` SAI DO RECURSO DECLARADO no manifesto (o servidor nao tem player), mas a
  // ROTA CONTINUA REGISTRADA e responde `{streams: []}` — ver o bloco em `routes/nuvio.js`.
  nuvio: {
    manifesto: "/nuvio/manifest.json",
    catalogo: "/nuvio/catalog/channel/tv.json",
    meta: "/nuvio/meta/channel/:id.json",
    stream: "/nuvio/stream/channel/:id.json",
  },

  api: {
    canais: "/api/channels",
    canaisCategorias: "/api/channels/categories",
    canal: "/api/channels/:slug",
    vodBusca: "/api/vod/search",
    vodGeneros: "/api/vod/genres",
    vodDetalhe: "/api/vod/:type/:id",
    streams: "/api/streams/:type/:id",
  },
};

// Trechos de caminho usados no MEIO de uma URL (middleware de cache, separacao
// de video por app). Não são rotas — são as marcas de território. Sem a barra
// final de propósito: quem precisa dela escreve `PREFIXOS.stream + "/"`, e quem
// só quer saber se é JSON usa o prefixo cru.
//
// DECISAO 155: `proxy`, `hls` e `segmentoEtc` saíram daqui junto com as rotas que
// marcavam. Eles existiam para decidir o TTL da borda e o tier de rate limit do
// relay e do proxy — o que não existe mais. Um `PREFIXOS` que aponta para uma rota
// apagada é pior do que um ausente: o middleware casa com ele e não faz nada.
const PREFIXOS = {
  api: "/api/",
  stream: "/stream/",
  p2p: "/p2p/",
  admin: "/admin/",
  nuvio: "/nuvio",
};

/* =================== VARIÁVEIS DE AMBIENTE =================== */

// O QUE cada env var significa e de QUEM é o nome. O valor continua vindo de
// process.env no momento do uso (nada é congelado na carga do módulo), porque
// os testes alteram env em tempo de execução.
//   -> o padrão (quando existe) continua junto do uso, ex.: `|| "3000"`
//   -> prefixo do nome diz quem cuida: XTREAM_*, KAKITO_*, TV_*, REI_*, BR_*
const VARIAVEIS = {
  // ---------- aplicação ----------
  PORT: { grupo: "app", desc: "Porta HTTP (o Dokku injeta; local = 7000)" },
  PUBLIC_BASE_URL: { grupo: "app", desc: "URL pública HTTPS do app — sem ela as URLs saem relativas e a TV quebra" },
  DATA_DIR: { grupo: "app", desc: "Diretório de dados (iptv.db, caches)" },
  TMDB_API_KEY: { grupo: "app", desc: "Chave da API do TMDB (metadados de filme/série)" , segredo: true },
  REDIS_URL: { grupo: "app", desc: "Redis opcional para cache compartilhado" },
  PROXY_SECRET: { grupo: "app", desc: "Segredo HMAC do /stream/proxy" , segredo: true },
  CDN_PROXY: { grupo: "app", desc: "Máscara de stream ligada/desligada (on/off)" },
  PROXY_CHECK_TOKEN: { grupo: "app", desc: "Token da rota de diagnostico /stream/proxy-check (vazio = rota fechada)" , segredo: true },
  ALERT_WEBHOOK_URL: { grupo: "app", desc: "Webhook que recebe o alerta de fonte caida (vazio = so no /health, sem aviso)" , segredo: true },
  MASK_STREAMS: { grupo: "app", desc: "Força a máscara de URL nos streams (sem uso desde a decisao 155: a máscara saiu do servidor)" },
  RELAY_BASE_URL: { grupo: "app", desc: "Base do relay de anime HLS (sem uso desde a decisao 155)" },
  CUSTOM_DNS: { grupo: "app", desc: "DNS sob medida para as buscas" },
  BLAZE_PROXY: { grupo: "app", desc: "Proxy do painel Blaze" },
  SPACE_PROXY: { grupo: "app", desc: "Proxy do painel Space" },
  MAX_CATALOG_BYTES: { grupo: "app", desc: "Teto do catálogo montado, em bytes" },
  MEM_RSS_LIMIT_MB: { grupo: "app", desc: "Teto de memória (MB) que o app se auto impõe" },
  MEM_CACHE_MAX: { grupo: "app", desc: "Teto de entradas do cache em memória (todas as rotas juntas)" },
  MEM_CACHE_BIG_MAX: { grupo: "app", desc: "Teto de entradas grandes (>200KB, o catálogo de TV) antes de descartar" },
  TV_BUSCA_TTL_MS: { grupo: "app", desc: "Prazo que o catálogo completo fica em memória para a busca filtrar sem refazer a triagem" },
  HTTP_KEEPALIVE_MS: { grupo: "app", desc: "Tempo que a conexão fica viva depois da resposta (RSS por socket)" },
  HTTP_HEADERS_TIMEOUT_MS: { grupo: "app", desc: "Tempo que uma conexão aberta pode esperar os headers" },
  HTTP_MAX_REQS_PER_SOCKET: { grupo: "app", desc: "Pedidos por conexão antes de fechá-la (devolve buffer de socket ao SO)" },
  EPG_DIAS_FUTURO: { grupo: "app", desc: "Dias de programação do EPG mantidos em memória (cada dia ≈ 6MB)" },
  TV_AQUECE_GUIA_DIAS: { grupo: "app", desc: "Dias de guia (aba Channel Guide) aquecidos no boot, para o 1o clique não montar 18s" },
  TV_ONLY: { grupo: "app", desc: "Roda só a parte de TV ao vivo" },
  SCRAPER_TIMEOUT_MS: { grupo: "app", desc: "Orçamento total de uma busca de streams (prod = 9000)" },
  SCRAPER_CONCURRENCY: { grupo: "app", desc: "Quantos scrapers rodam ao mesmo tempo" },

  // ---------- IPTV / KKT ----------
  IPTV_SERVER: { grupo: "iptv", desc: "Servidor do painel IPTV" },
  IPTV_PORT: { grupo: "iptv", desc: "Porta do painel IPTV" },
  IPTV_USERNAME: { grupo: "iptv", desc: "Usuário do painel IPTV" , segredo: true },
  IPTV_PASSWORD: { grupo: "iptv", desc: "Senha do painel IPTV" , segredo: true },
  IPTV_SOURCES: { grupo: "iptv", desc: "Listas M3U próprias, separadas por |" },
  IPTV_PROXY: { grupo: "iptv", desc: "Proxy do painel IPTV" , segredo: true },

  // ---------- painéis Xtream ----------
  XTREAM_SPACE_SERVER: { grupo: "xtream", desc: "Painel Space: endereço" },
  XTREAM_SPACE_PORT: { grupo: "xtream", desc: "Painel Space: porta" },
  XTREAM_SPACE_USER: { grupo: "xtream", desc: "Painel Space: usuário" , segredo: true },
  XTREAM_SPACE_PASS: { grupo: "xtream", desc: "Painel Space: senha" , segredo: true },
  XTREAM_AUTOS_SERVER: { grupo: "xtream", desc: "Painel Autos: endereço" },
  XTREAM_AUTOS_PORT: { grupo: "xtream", desc: "Painel Autos: porta" },
  XTREAM_AUTOS_USER: { grupo: "xtream", desc: "Painel Autos: usuário" , segredo: true },
  XTREAM_AUTOS_PASS: { grupo: "xtream", desc: "Painel Autos: senha" , segredo: true },
  XTREAM_AUTOS_PROXY: { grupo: "xtream", desc: "Painel Autos: embrulho de vídeo" , segredo: true },
  XTREAM_AUTOS_SEMPRE: { grupo: "xtream", desc: "Painel Autos: embrulhar sempre" },
  XTREAM_EXTRA1_NAME: { grupo: "xtream", desc: "Painel extra 1: nome curto" },
  XTREAM_EXTRA1_SERVER: { grupo: "xtream", desc: "Painel extra 1: endereço" },
  XTREAM_EXTRA1_PORT: { grupo: "xtream", desc: "Painel extra 1: porta" },
  XTREAM_EXTRA1_USER: { grupo: "xtream", desc: "Painel extra 1: usuário" , segredo: true },
  XTREAM_EXTRA1_PASS: { grupo: "xtream", desc: "Painel extra 1: senha" , segredo: true },
  XTREAM_EXTRA1_SOURCE: { grupo: "xtream", desc: "Painel extra 1: chave da fonte que ele finge ser" },
  XTREAM_EXTRA1_PROXY: { grupo: "xtream", desc: "Painel extra 1: embrulho de vídeo" },
  XTREAM_EXTRA1_EPISODES: { grupo: "xtream", desc: "Painel extra 1: serve episódios de série" },
  XTREAM_EXTRA2_NAME: { grupo: "xtream", desc: "Painel extra 2: nome curto" },
  XTREAM_EXTRA2_SERVER: { grupo: "xtream", desc: "Painel extra 2: endereço" },
  XTREAM_EXTRA2_PORT: { grupo: "xtream", desc: "Painel extra 2: porta" },
  XTREAM_EXTRA2_USER: { grupo: "xtream", desc: "Painel extra 2: usuário" , segredo: true },
  XTREAM_EXTRA2_PASS: { grupo: "xtream", desc: "Painel extra 2: senha" , segredo: true },
  XTREAM_EXTRA2_SOURCE: { grupo: "xtream", desc: "Painel extra 2: chave da fonte que ele finge ser" },
  XTREAM_EXTRA2_PROXY: { grupo: "xtream", desc: "Painel extra 2: embrulho de vídeo" },
  XTREAM_EXTRA2_EPISODES: { grupo: "xtream", desc: "Painel extra 2: serve episódios de série" },
  XTREAM_PANEL_BUDGET_MS: { grupo: "xtream", desc: "Orçamento de uma consulta a um painel" },

  // ---------- KKT (kakito) ----------
  KAKITO_VERIF_TTL: { grupo: "kakito", desc: "Validade da checagem de token" },
  KAKITO_VERIF_LOTE: { grupo: "kakito", desc: "Tamanho do lote da checagem" },
  KAKITO_VERIF_ESPACO: { grupo: "kakito", desc: "Intervalo entre lotes" },
  KAKITO_PRIO_TTL: { grupo: "kakito", desc: "Validade da ordem de prioridade dos canais" },
  KAKITO_PLAYLIST_VELHO: { grupo: "kakito", desc: "Idade em que a playlist conta como velha" },
  KAKITO_PLAYLIST_TENTATIVAS: { grupo: "kakito", desc: "Tentativas para baixar a playlist" },
  KAKITO_ORCAMENTO_MS: { grupo: "kakito", desc: "Orçamento de tempo do KKT" },
  KAKITO_MORTO_TTL: { grupo: "kakito", desc: "Por quanto tempo um link morto fica enterrado" },

  // ---------- TV ao vivo ----------
  TV_BASE_URL: { grupo: "tv", desc: "Endereço do cluster que cuida da TV (split)" },
  TV_PROXY_TIMEOUT_MS: { grupo: "tv", desc: "Tempo que o app1 espera o cluster de TV" },
  TV_TRIAGEM_CONC: { grupo: "tv", desc: "Canais triados ao mesmo tempo no catálogo" },
  TV_TRIAGEM_FATIA: { grupo: "tv", desc: "Canais por fatia da triagem de TV (decisao 125: ela roda em segundo plano)" },
  TV_MORTES_PARA_TIRAR: { grupo: "tv", desc: "Quantas confirmacoes o canal precisa ter sem stream para sair da lista (2 = so depois da segunda; 1 = comportamento antigo)" },
  XTREAM_CATALOGO_MS: { grupo: "xtream", desc: "Idade maxima do catalogo de painel em disco antes de regravar (padrao 6h)" },
  TV_PROVA_PLAYLIST_MS: { grupo: "tv", desc: "Teto da prova de que a playlist do canal responde antes de escolher a fonte do relay (padrao 4000)" },
  TV_RESOLUCAO_PLAYLIST_MS: { grupo: "tv", desc: "Teto para uma fonte de TV resolver a URL da playlist antes do relay desistir dela (padrao 7000)" },
  TV_RELAY_CACHE_NEG_MS: { grupo: "tv", desc: "Quanto o relay de TV guarda o 'nenhuma fonte deu' antes de tentar de novo (padrao 15000)" },
  XTREAM_ESPERA_CATALOGO_MS: { grupo: "xtream", desc: "Quanto o pedido espera o catalogo do painel ser gravado no boot antes de cair para a memoria (padrao 3000)" },
  XTREAM_CATALOGO: { grupo: "xtream", desc: "Botao de emergencia: `memoria` ignora o catalogo em disco e volta a guardar na RAM (mais RSS, mesma funcionalidade)" },
  TV_MS_POR_FONTE: { grupo: "tv", desc: "Orcamento por fonte de TV em ms (medido: quem entrega leva ate 3,4s; o que trava leva 23s e o gateway corta em 12,3s)" },
  TV_SEED_TTL: { grupo: "tv", desc: "Validade do catálogo semeado" },
  ETC_CACHE_TTL: { grupo: "tv", desc: "Validade do cache do ETC" },
  ETC_UA: { grupo: "tv", desc: "User-Agent do canal ETC" },
  ETC_REFERER: { grupo: "tv", desc: "Referer exigido pelo canal ETC" },
  EMBEDCANAIS_API: { grupo: "tv", desc: "API do provedor de canais" },
  EMBEDCANAIS_PLAYER: { grupo: "tv", desc: "Endereço do player do provedor de canais" },
  EMBEDCANAIS_PORTAS: { grupo: "tv", desc: "Portas tentadas na ordem" },
  EMBEDCANAIS_PORTA_NOVA: { grupo: "tv", desc: "Porta nova do fornecedor: abre o canal pelo HTML do player em vez de /{id}.m3u8 (decisao 143)" },
  EMBEDCANAIS_LISTA_NOVA: { grupo: "tv", desc: "Site que publica a lista de nome/slug da porta nova do ETC" },
  ETC_CDN_TIMEOUT_MS: { grupo: "etc", desc: "Teto de cada CDN antigo do ETC na rota relay (padrao 4000, para nao gastar 100s com portas fora do ar)" },

  // ---------- fonte REI ----------
  REI_API: { grupo: "rei", desc: "Base da API do reidosembeds" },
  REI_URL_TTL_MS: { grupo: "rei", desc: "Validade da URL da playlist (o JWT vale 300s)" },
  REI_REFRESH_MS: { grupo: "rei", desc: "A partir de que idade a URL é trocada em segundo plano" },
  REI_CAT_TTL_MS: { grupo: "rei", desc: "Validade do catálogo do REI" },
  EPG_REI_URL: { grupo: "rei", desc: "Guia XMLTV da API do reidosembeds" },

  // ---------- relay BR + segmentos ----------
  SEGMENTOS_EDGE_CACHE: { grupo: "br", desc: "Segmentos com cache na borda" },
  SEGMENTOS_CACHE_TTL: { grupo: "br", desc: "Validade do cache de segmentos" },
  SEGMENTOS_ORIGEM_CONC: { grupo: "br", desc: "Idas simultâneas à origem dos segmentos" },
  PREVIA_TIMEOUT_MS: { grupo: "br", desc: "Tempo máximo de gerar a prévia de um canal" },
  PREVIA_CONC: { grupo: "br", desc: "Prévias geradas ao mesmo tempo" },
  PREVIA_FATIA: { grupo: "tv", desc: "Canais por fatia da sonda de previa (decisao 125: a previa nao segura a resposta)" },

  // ---------- embrulho de vídeo ----------
  PANEL_MAX_CHUNKS: { grupo: "video", desc: "Blocos de vídeo mantidos na memória" },
  PANEL_CHUNK_TTL: { grupo: "video", desc: "Validade de um bloco" },
  PANEL_CHUNK_TIMEOUT: { grupo: "video", desc: "Tempo para montar um bloco" },
  PANEL_CHUNK_SIZE: { grupo: "video", desc: "Tamanho de cada bloco" },

  // ---------- fonte VZR ----------
  VIZER_HOST: { grupo: "vizer", desc: "Host do nixplay (fonte VZR)" },
  VIZER_PATH: { grupo: "vizer", desc: "Caminho/tokn derivado da URL do vídeo" },
};

// Acesso ao valor: lê process.env NO MOMENTO do uso (não congela na carga),
// para os testes continuarem podendo trocar env em execução.
const ENV = {};
for (const nome of Object.keys(VARIAVEIS)) {
  Object.defineProperty(ENV, nome, {
    enumerable: true,
    get: () => process.env[nome],
  });
}

// Escrita: passa pelo registro também, para nenhum nome de env ser digitado
// fora de VARIAVEIS (mesma proteção de leitura).
function defineEnv(nome, valor) {
  if (!VARIAVEIS[nome]) throw new Error(`variavel de ambiente fora do registro: ${nome}`);
  process.env[nome] = valor;
}

module.exports = { FONTES, CONTEUDOS, fontesDe, categoriasDasFontes, WORKERS, WORKER_SUFIXO, workerDe, GRUPOS, ROTAS, PREFIXOS, VARIAVEIS, ENV, defineEnv, rotulo, sigla, prefixo };
