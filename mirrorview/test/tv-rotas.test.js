// As rotas de TV do MIRRORVIEW: pagina, p2p, generos, EPG, relay e split.
//
// MEDIDO 02/10/2026: estes 6 testes viviam em `mirror.test.js`, que e' a barreira do
// MirrorStream. Ele NAO tem TV — o catalogo de canal, o guia e a pagina /tv sao do
// MirrorView (decisao do dono: VOD e TV em produtos separados). Ler o arquivo do produto
// errado so passava porque as duas metades eram o mesmo arquivo; depois da divisao cada
// uma virou o seu, e o teste tem de ler o seu.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const tvServer = fs.readFileSync(path.join(RAIZ, "src", "server.js"), "utf8");
test("P2P: a página reporta o enxame e o /health mostra (decisão 128)", () => {
  const fs = require("fs");
  const path = require("path");
  const raiz = path.join(__dirname, "..");
  
  // Sem o relato nao ha como responder "o P2P funciona?": o motor fica atras de ?p2p=1 e o
  // codigo antigo registra que ele nem completa o manifesto com o hls.js atual.
  assert.match(tvServer, /app\.post\(ROTAS\.p2pRelato/, "a rota de relato do P2P tem que existir");
  assert.match(tvServer, /p2p: resumoP2p\(\)/, "o /health tem que mostrar o enxame");
  // O que entra e clampado: o endpoint e publico e nao pode estourar memoria.
  assert.match(tvServer, /const P2P_MAX_CANAIS = \d+/, "teto de canais no relato");
  assert.match(tvServer, /function numeroOu\(v, max\)/, "os numeros do relato precisam de teto");
  const nomes = require("../src/core/nomes");
  assert.equal(nomes.ROTAS.p2pRelato, "/p2p/report");

  const pagina = fs.readFileSync(path.join(raiz, "public", "tv.html"), "utf8");
  assert.match(pagina, /function relatar\(\)/, "a pagina precisa relatar o enxame");
  assert.match(pagina, /setInterval\(relatar, 5000\)/, "e de tempos em tempos, nao so no load");
  // So o tracker que responde (medido: 2 dos 3 estao mortos).
  assert.ok(pagina.includes("wss://tracker.webtorrent.dev/announce"), "o tracker vivo tem que estar na lista");
  assert.ok(!pagina.includes("wss://tracker.novage.com.ua/announce"), "tracker morto fora da lista");
});

// DECISAO 155: `/stream/proxy-check` foi apagada (ela media uma URL contra uma WAF, o que so
// fazia sentido com relay). A garantia de PORTAO nao enfraqueceu: ela continua valendo, e agora
// cobre a rota que sobrou, o `/admin/limpar-cache` — que derruba o cache quente de todo mundo.

test("segurança: o reset de cache continua fechado sem token (o proxy-check saiu na 155)", () => {
  const fs = require("fs");
  const path = require("path");
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  // A rota do diagnostico sumiu...
  const { ROTAS } = require("../src/core/nomes");
  assert.equal(ROTAS.proxyCheck, undefined, "/stream/proxy-check nao pode voltar");
  // ...e a que ficou e' a que exige token.
  assert.ok(ROTAS.limparCache, "/admin/limpar-cache continua de pe");
  assert.match(server, /function tokenDoDiagnostico\(\)/, "o token do diagnostico continua");
  assert.match(server, /timingSafeIgual\(dado, exigido\)/, "comparado em tempo constante");
  // O segredo do token vem do ambiente (PROXY_CHECK_TOKEN > PROXY_SECRET), nunca escrito no codigo.
  assert.match(server, /ENV\.PROXY_CHECK_TOKEN/);
  assert.match(server, /ENV\.PROXY_SECRET/);
  // Os headers de seguranca do servidor continuam todos.
  assert.match(server, /"X-Content-Type-Options", "nosniff"/);
  assert.match(server, /"X-Frame-Options", "SAMEORIGIN"/);
  assert.match(server, /"Referrer-Policy", "no-referrer"/);
  // E o bloqueio de IP privado continua no `/resolve`, que sobrou.
  assert.match(server, /private ip blocked/);
});

test("gêneros de TV: 19 nomes crus caem nos 7 baldes, e o menu usa a mesma lista (decisão 126)", () => {
  // MEDIDO 30/09: o menu tinha 10 opcoes escritas a mao e as metas traziam 19 generos crus, com
  // 6 opcoes quebradas ("Abertos" devolvia 10 e escondia os 40 "Canais Abertos"). O filtro casa
  // por nome exato, entao genero cru e menu escrito a mao nao podem ser duas listas.
  const tv = require("../../mirrorview/src/core/tv-sources");
  const casos = {
    "Notícias": "Noticias", "Noticias": "Noticias",
    "Canais Abertos": "Abertos", "Abertos": "Abertos",
    "Filmes": "Filmes e Séries", "Séries": "Filmes e Séries", "Filmes e Séries": "Filmes e Séries",
    "Documentários": "Documentarios", "Documentarios": "Documentarios",
    "Esportes": "Esportes", "Desenhos": "Infantil", "Infantil": "Infantil",
    "Realitys": "Variedades", "24 Horas": "Variedades", "MiamiTV": "Variedades",
    "Geral": "Variedades", "Inglês": "Variedades", "Adulto": "Variedades",
  };
  for (const [cru, balde] of Object.entries(casos)) assert.equal(tv.normalizaGenero(cru), balde, cru);
  // Todo balde tem que ser alcancavel e a lista nao pode ter acento diferente do menu
  for (const b of tv.BUCKETS) assert.equal(tv.normalizaGenero(b), b, `balde ${b} nao fecha`);
  assert.deepEqual(tv.generosNosBaldes(["Notícias", "Canais Abertos", "Filmes"]),
    ["Noticias", "Abertos", "Filmes e Séries"]);
  assert.deepEqual(tv.generosNosBaldes([]), ["Variedades"], "sem genero, cai em Variedades");

  const fs = require("fs");
  const path = require("path");
  const tvServer = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  assert.match(tvServer, /options: \["Todos", \.\.\.tvSources\.BUCKETS\]/,
    "o menu do Stremio tem que vir dos mesmos baldes do filtro");
});

// DECISAO 155: a segunda metade deste teste (`membersOf`, "o canal abre com as tres
// fontes") foi embora com as fontes. A PRIMEIRA metade — a lista e' do REI — continua valendo e
// agora e' a unica: o servidor tem uma fonte de metadado, e o filtro por ela virou no-op.
//
// E o efeito no dono e' MELHOR, nao pior. A regra dele era "nao retirar canal", e ela era
// garantida por duas coisas: a lista nunca saia do REI, e a prova de morte (a triagem) so tirava
// na 2a confirmacao. As DUAS sairam. Agora ninguem no servidor pode retirar canal: a lista e'
// exatamente o que o REI declara, ponto.

test("borda: NENHUM erro e o relay podem ficar guardados 4h na CDN (decisão 140)", () => {
  const fs = require("fs");
  const path = require("path");
  const tvServer = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");

  // MEDIDO 01/10/2026, e foi o defeito que o dono viu como "todos os players de live TV pararam,
  // fica um icone quadrado de interrogacao": o relay respondia
  //     HTTP/2 404 | cache-control: public, max-age=14400 | age: 77 | cf-cache-status: UPDATING
  // Ou seja, a BORDA guardava o 404 por 4 horas (a zona do BeamUp reescreve o Cache-Control do
  // origin) e continuava servindo depois de a origem voltar. O servidor estava bom; o cache nao.
  //
  // O relay manda `max-age=25` (cacheavel, de proposito, para o cache local), entao precisa de um
  // cabecalho que o CLOUDFLARE respeita para o TTL DA BORDA, separado do TTL da origem.
  assert.match(tvServer, /res\.set\("CDN-Cache-Control", "no-store"\)/,
    "o relay diz a borda para nao guardar (CDN-Cache-Control e o cabecalho do Cloudflare)");
  assert.match(tvServer, /res\.set\("Cloudflare-CDN-Cache-Control", "no-store"\)/,
    "e tambem na forma especifica do Cloudflare");

  // E NENHUM erro, em rota nenhuma, pode ser guardado: um 404/502 guardado por 4h continua
  // sendo servido depois de a origem voltar, e para o usuario e indistinguivel de addon quebrado.
  //
  // MEDIDO 02/10/2026 (decisao 154): o guarda vivia num `res.on("finish")` e a assertacao abaixo
  // travava o CODIGO QUE NAO FUNCIONAVA. O `finish` dispara depois dos headers irem, entao todo
  // `setHeader` ali levantava ERR_HTTP_HEADERS_SENT, e o `uncaughtException` do servidor chama
  // `process.exit(1)` — um 404 derrubava o addon inteiro. A guarda agora entra no `writeHead`, que
  // e o ultimo ponto em que o cabecalho ainda e' nosso, e o comportamento de verdade (header no
  // fio + processo vivo depois do erro) esta em `test/cache-erro.test.js`.
  assert.doesNotMatch(tvServer, /res\.on\(\s*["']finish["']/,
    "o finish dispara depois dos headers irem — o setHeader la dentro e' sempre tarde");
  assert.match(tvServer, /proibeCacheDeErro/, "o servidor usa a guarda de cache de erro");
});

// DECISAO 155: este teste cobria o `agregaPorCanal` — o codigo que juntava "A Fazenda" (REI),
// "A Fazenda 18 - 1" (EMB) e "A FAZENDA 1" (ETC) num canal so, com a salvaguarda de palavra em
// comum. Ele existia para 4 fontes; com uma, nao ha o que casar, e a chave passou a ser o
// `normKey` do nome que o REI declara.
//
// O QUE SOBREVIVE e' a parte que o dono vai sentir: o nome normalizado continua sendo a
// identidade do canal, e e' por ele que o `/nuvio` cruza o id numerico. Testado aqui e, na
// integra, em `test/nuvio-catalogo.test.js` (ida e volta numero -> chave -> numero).
// DECISAO 155: este teste cobria o agrupamento de 4 fontes — o codigo que juntava "A Fazenda"
// (REI), "A Fazenda 18 - 1" (EMB) e "A FAZENDA 1" (ETC) num canal so, com a salvaguarda de
// palavra em comum. Ele existia para 4 fontes; com uma, nao ha o que casar, e a chave passou a
// ser o `normKey` do nome que o REI declara.
//
// O QUE SOBREVIVE e' a parte que o dono vai sentir: o nome normalizado continua sendo a
// identidade do canal, e e' por ele que o `/nuvio` cruza o id numerico. Testado aqui e, na
// integra, em `test/nuvio-catalogo.test.js` (ida e volta numero -> chave -> numero).

test("EPG nativo do Stremio: manifesto, grade por dia e videos no meta", () => {
  const fs = require("fs");
  const src = tvServer;
  assert.ok(src.includes("epgProvider: true"), "manifesto precisa declarar epgProvider para o Stremio mostrar a aba Channel Guide");
  const bloco = src.slice(src.indexOf("mirror-tv-live"), src.indexOf("mirror-tv-live") + 400);
  assert.ok(/name: "date"/.test(bloco), "o catalogo de TV precisa declarar o extra 'date'");
  assert.ok(/name: "skip"/.test(bloco), "o catalogo de TV precisa declarar o extra 'skip'");

  const epg = require("../../mirrorview/src/lib/epg");
  const dia = epg.dataDe(Math.floor(Date.now() / 1000));
  const lista = epg.grade("History 2", "tv:live:history2", dia);
  assert.ok(Array.isArray(lista), "grade precisa devolver uma lista mesmo sem dados");
  for (const v of lista) {
    assert.ok(v.id.startsWith("tv:live:history2:epg:"), "id do programa precisa prefixar o canal");
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v.startTime), "startTime tem que ser ISO");
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v.endTime), "endTime tem que ser ISO");
    assert.ok(new Date(v.endTime) > new Date(v.startTime), "o programa tem que terminar depois de comecar");
    assert.ok(typeof v.title === "string" && v.title.length > 0, "programa precisa de titulo");
    assert.ok(/^\d+ min$/.test(v.runtime), "runtime em minutos");
  }
  assert.equal(epg.grade("History", "tv:live:history", "2099-01-01").length, 0, "dia sem programacao devolve lista vazia, nao erro");
});

// DECISAO 155: o cluster de TV foi ESTREITADO. Ele repassa o catalogo (`/catalog/tv/*`,
// `/api/channels*`) e a meta do canal; as rotas de STREAM (`/stream/tv/*`, `/api/streams/tv`)
// sairam do repasse, porque nao ha mais trabalho nelas para delegar — elas respondem
// `{streams: []}` sem tocar em origem nenhuma, entao a ponte seria mais lenta E mais um ponto
// de falha. A razao de o cluster existir (montar o catalogo no app1 custava 127s, acima dos
// 12,3s do gateway) MEDIU-se falsa depois da 155: o catalogo frio no app1 leva 1,17s.

test("decisao 155: o split repassa catalogo e meta, e NAO repassa mais stream", () => {
  const fs = require("fs");
  const antigo = process.env.TV_BASE_URL;
  process.env.TV_BASE_URL = "https://exemplo.baby-beamup.club";
  delete require.cache[require.resolve("../src/lib/tv-split")];
  const m = require("../../mirrorview/src/lib/tv-split");
  const req = (path, host) => ({
    path,
    originalUrl: path,
    protocol: "https",
    headers: {},
    get(h) { return h === "host" ? host : undefined; },
  });
  try {
    assert.equal(m.TV_BASE, "https://exemplo.baby-beamup.club");
    // ENTRA: o catalogo e a meta do canal.
    assert.equal(m.ehRequisicaoDeTv(req("/catalog/tv/mirror-tv-live.json", "a")), true);
    assert.equal(m.ehRequisicaoDeTv(req("/api/channels", "a")), true);
    assert.equal(m.ehRequisicaoDeTv(req("/api/channels/categories", "a")), true);
    assert.equal(m.ehRequisicaoDeTv(req("/meta/tv/tv%3Alive%3Ahbo.json", "a")), true, "id com : codificado ainda e TV ao vivo");
    // SAIU: stream. Nao ha fonte de TV no servidor, entao delegar seria desperdicio de rede.
    assert.equal(m.ehRequisicaoDeTv(req("/stream/tv/tv:live:hbo.json", "a")), false, "stream de TV nao e mais repassado");
    assert.equal(m.ehRequisicaoDeTv(req("/api/streams/tv/hbo", "a")), false, "o /api/streams de TV nao e mais repassado");
    // Continua fora: VOD nao passa pelo cluster de TV.
    assert.equal(m.ehRequisicaoDeTv(req("/meta/tv/tmdb%3A1396.json", "a")), false, "meta de serie e VOD");
    assert.equal(m.ehRequisicaoDeTv(req("/stream/movie/tmdb:603.json", "a")), false);
    assert.equal(m.ehRequisicaoDeTv(req("/catalog/series/mirror-series.json", "a")), false);
    // A identificacao do proprio cluster segue igual (o Dokku manda so o primeiro rotulo).
    assert.equal(m.ehOProprioClusterDeTv(req("/catalog/tv/mirror-tv-live.json", "exemplo.baby-beamup.club")), true);
    assert.equal(m.ehOProprioClusterDeTv(req("/catalog/tv/mirror-tv-live.json", "exemplo")), true, "Dokku manda so o nome do app");
    assert.equal(m.ehOProprioClusterDeTv(req("/catalog/tv/mirror-tv-live.json", "exemplo-outro")), false, "o app de VOD nao se confunde com o de TV");
  } finally {
    if (antigo === undefined) delete process.env.TV_BASE_URL; else process.env.TV_BASE_URL = antigo;
  }
});
