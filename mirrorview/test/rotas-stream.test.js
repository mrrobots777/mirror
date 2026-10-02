// AS TRES ROTAS DE STREAM — e por que tem que ser tres.
//
// MEDIDO 02/10/2026, dois defeitos que a barreira nao via:
//
// 1. O guard `SO_DO_MIRRORSTREAM` era `[..., /^\\/api\\/streams\\//, /^\\/stream\\//]` — largo
//    demais. Ele interceptava a PROPRIA rota de TV do MirrorView:
//
//      GET /stream/tv/tv:live:hbo.json  ->  404 {"error":"rota do MirrorStream"}
//
//    O addon de TV dizendo "isso e' do MirrorStream" para o pedido de TV de um canal e' o
//    pior dos dois erros: o cliente le "este addon nao tem canais" em vez de "nenhuma
//    fonte", e a causa fica invisivel. Quem achou foi o dono, clicando play no Stremio.
//
// 2. Das TRES rotas que a decisao 155 manda responder `{"streams":[]}` em 200, a excisao de
//    TV levou DUAS: `/api/streams/*` e `/nuvio/stream/*` respondiam 404 com uma PAGINA HTML
//    de erro do SDK. HTML na tela do Stremio e' lido como "o addon quebrou" — e o dono
//    installou, testou, e viu exatamente isso.
//
// A regra que este arquivo trava: **no addon de TV, `tv` nunca e' barrado e as tres rotas de
// stream respondem 200 com `{"streams":[]}`.** So `movie` e `series` sao do outro produto.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const server = fs.readFileSync(path.join(RAIZ, "mirrorview", "src", "server.js"), "utf8");

// O guard, tal como esta no arquivo.
function guard() {
  const i = server.indexOf("const SO_DO_MIRRORSTREAM = [");
  assert.ok(i > 0, "o guard nao achado");
  const bloco = server.slice(i, server.indexOf("];", i) + 2);
  return bloco;
}

test("o guard nao barra o tipo tv", () => {
  const bloco = guard();
  assert.ok(
    /\(movie\|series\)/.test(bloco),
    `o guard precisa casar movie|series explicitamente — \`/^\\/stream\\//\` sozinho tambem pegava ` +
      `\`/stream/tv/\`, que e' a rota DO PROPRO MirrorView:\n' + '  ' + bloco.replace(/\n\s*/g, ' ').slice(0, 160)`
  );
  assert.equal(
    /\/\^\\\/api\\\/streams\\\/\//.test(bloco),
    false,
    "`/^\\/api\\/streams\\//` sem tipo barra o `/api/streams/tv`, que e' do MirrorView"
  );
});

test("as tres rotas de stream do MirrorView existem no arquivo", () => {
  // 1. `/stream/tv/...` vem do defineStreamHandler do SDK
  assert.match(server, /builder\.defineStreamHandler\(/, "o defineStreamHandler do SDK sumiu");

  // 2. `/api/streams/:type/:id`
  assert.match(server, /app\.get\(ROTAS\.api\.streams,/, "falta a rota /api/streams/:type/:id");

  // 3. `/nuvio/stream/channel/:id`
  assert.match(
    server,
    /app\.get\(PREFIXOS\.nuvio \+ "\/stream\/channel\/:id"/,
    "falta a rota /nuvio/stream/channel/:id — ela vivia em routes/nuvio.js, que foi para o " +
      "MirrorStream (que tambem nao tem stream), entao NENHUM dos dois a tinha"
  );
});

test("as tres respondem {streams: []} e nao uma pagina de erro", () => {
  // O que importa nao e' o texto do codigo: e' que nenhuma delas pode responder HTML. Um 404
  // com HTML e' lido como addon quebrado; `{streams: []}` com 200 e' lido como "nenhuma fonte".
  for (const frag of ['{ streams: [] }', "VAZIO", "streamsVazios"]) {
    assert.ok(server.includes(frag), `o payload de stream vazio sumiu: ${frag}`);
  }
  // E o cache: a resposta e' estavel, nao um link para revalidar. Sem cache, cada pedido ia
  // ao REI/TMDB para descobrir que nao ha o que entregar.
  assert.match(server, /sqliteCache\.set\(chave, VAZIO/, "o payload vazio nao e' cacheado");
});

test("o MirrorStream tambem responde {streams: []} nas tres (decisao 154/155)", () => {
  const ms = fs.readFileSync(path.join(RAIZ, "mirrorstream", "src", "server.js"), "utf8");
  assert.match(ms, /builder\.defineStreamHandler\(/, "falta o defineStreamHandler");
  assert.match(ms, /app\.get\(ROTAS\.api\.streams,/, "falta /api/streams/:type/:id");
  // E ele nao registra fonte nenhuma — e' o que mantem a resposta vazia. Se alguem registrar
  // uma, este teste tem que falhar de proposito, porque a camada de player do servidor e'
  // etapa 2 e nao estava no historico do repositorio.
  const fontes = ms.match(/engine\.use\(/g) || [];
  assert.strictEqual(
    fontes.length,
    0,
    `o MirrorStream tem ${fontes.length} engine.use() — o servidor e' SO CATALOGO (decisao 154). ` +
      "Se voce quer players no Stremio, isso e' a etapa 2, nao um registro esquecido."
  );
});
test("`stream` e' obrigatorio em `resources` porque o handler existe — e a SDK exige", () => {
  // MEDIDO 02/10/2026: tentei tirar o `stream` do `resources` dos dois addons, com a intencao
  // de nao anunciar um recurso que nao se entrega. O processo MORREU no boot:
  //
  //     [fatal] uncaughtException: manifest.resources does not contain: stream
  //
  // A regra da SDK e' nos DOIS sentidos (node_modules/stremio-addon-sdk/src/builder.js,
  // funcao `validate`):
  //
  //   1. todo handler DEFINIDO tem que estar em `resources`
  //   2. todo item de `resources` tem que ter um handler definido
  //
  // A rota de stream PRECISA continuar definida (a decisao 155: o manifesto vive em cache na
  // borda, um cliente antigo ainda pede, e `{streams: []}` com 200 e' lido como "nenhuma
  // fonte", enquanto 404 e' lido como "erro do addon"). Logo o handler existe, logo `stream`
  // e' obrigatorio. **Nao ha como anunciar "nao entrego stream" no manifesto do Stremio.**
  for (const [p, nome] of [["mirrorstream", "MirrorStream"], ["mirrorview", "MirrorView"]]) {
    const src = fs.readFileSync(path.join(RAIZ, p, "src", "server.js"), "utf8");
    assert.match(
      src,
      /resources:\s*\["catalog",\s*"meta",\s*"stream"\]/,
      `${nome}: o \`stream\` tem que estar em \`resources\` — a SDK mata o processo se faltar`
    );
    assert.match(src, /builder\.defineStreamHandler\(/, `${nome}: o handler tem que existir`);
  }

  // E a regra da SDK precisa continuar valendo: se algum dia ela deixar de exigir, este
  // teste avisa, porque a decisao muda de forma.
  const builder = fs.readFileSync(
    path.join(RAIZ, "node_modules", "stremio-addon-sdk", "src", "builder.js"),
    "utf8"
  );
  assert.ok(
    builder.includes("manifest.resources does not contain"),
    "a SDK mudou: `resources` sem handler definido talvez agora seja permitido, e a decisao 155 precisa ser revista"
  );
});
