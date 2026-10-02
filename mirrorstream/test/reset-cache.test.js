// O RESET DE CACHE (decisão 134): o dono pediu "resete o cache de todas as fontes" e, medido,
// não existia caminho — as caches vivem dentro do container, sem rota, e a única forma de
// limpá-las era reiniciar o app (que derruba todo mundo junto).
//
// Estes testes travam DUAS coisas:
//   1. a rotina de apagar no disco funciona mesmo (com um diretório de dados temporário, para não
//      tocar no cache de quem está rodando);
//   2. a rota NÃO pode apagar nada sem o token — porque zerar o cache quente é, por definição,
//      uma operação que derruba o serviço de todo mundo.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const raiz = path.join(__dirname, "..");
// O reset de TV (mapa de grupos e memo do catalogo) e' do MIRRORVIEW: e' ele que tem
// catalogo de canal. As duas entradas de TV da lista sao lidas do arquivo dele.
const tvServer = fs.readFileSync(path.join(raiz, "..", "mirrorview", "src", "server.js"), "utf8");

test("reset de cache: apagar tudo no disco zera mesmo (em diretório temporário)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-cache-"));
  process.env.DATA_DIR = dir;
  // O módulo guarda a conexão; pegamos uma cópia limpa para não afetar o resto da suíte.
  delete require.cache[require.resolve("../src/lib/sqlite-cache")];
  const cache = require("../src/lib/sqlite-cache");

  cache.set("filme:1", { url: "a" }, 60000);
  cache.set("stream:tv:hbo", { url: "b" }, 60000);
  cache.set("mirror-tv:triagem-mortos:v3", ["canal"], 60000);
  assert.equal(cache.stats().total, 3, "gravou tres chaves");

  const apagadas = cache.limpaTudo();
  assert.equal(apagadas, 3, "a rotina devolve quantas saiu");
  assert.equal(cache.stats().total, 0, "o disco ficou vazio");
  // E o que estava guardado nao volta por evento nenhum (nao ha valor "velho" sobrando).
  assert.equal(cache.get("filme:1"), null);
  assert.equal(cache.get("stream:tv:hbo"), null);

  // Continua usavel depois de apagar — o reset nao pode deixar o cache quebrado.
  cache.set("depois", 1, 60000);
  assert.deepEqual(cache.get("depois"), 1, "o cache volta a gravar depois do reset");
  cache.limpaTudo();
  cache.close();
  delete process.env.DATA_DIR;
});

test("reset de cache: a rota só apaga com o token de diagnóstico", () => {
  const server = fs.readFileSync(path.join(raiz, "src", "server.js"), "utf8");
  const nomes = require("../src/core/nomes");
  assert.equal(nomes.ROTAS.limparCache, "/admin/limpar-cache");
  assert.equal(nomes.PREFIXOS.admin, "/admin/");

  const rota = server.indexOf("ROTAS.limparCache");
  assert.ok(rota > 0, "a rota de reset tem que existir");
  const portao = server.indexOf("limpar-cache exige o token de diagnostico", rota);
  const apaga = server.indexOf("sqliteCache.limpaTudo()", rota);
  assert.ok(portao > rota && apaga > portao,
    "o portão tem que vir ANTES de qualquer apagamento — sem token, nada é apagado");

  // E o que o reset apaga: disco, memória, as duas travas de pedido e os disjuntores. Faltando o
  // ultimo, o reset pareceria não ter resolvido (fonte caída continua pulada por 5 min).
  //
  // DECISAO 155: DUAS entradas sairam desta lista junto com o que elas guardavam —
  // `qualityCache` (a sonda de resolução real do vídeo) e `reachCache` ("a origem já foi
  // alcançada"). As duas existiam para servir/rebaixar vídeo pelo servidor; sem relay, não há o
  // que sondar. E o que entrou no lugar: o mapa de grupos e o memo do catálogo de TV, que é o
  // estado de RAM que sobra.
  for (const [descricao, marca] of [
    ["disco", "sqliteCache.limpaTudo()"],
    ["cache de titulo de anime", "animeTitleCache.clear()"],
    ["cache geral", "cache.clear()"],
    ["geracao do catalogo", "geracaoPorChave.clear()"],
    ["pedido em voo de stream", "inflightStreams.clear()"],
    ["pedido em voo de catalogo", "inflightCatalogs.clear()"],
    ["disjuntores das fontes", "engine.reset()"],
  ]) {
    assert.ok(server.includes(marca), `o reset precisa apagar ${descricao} (${marca})`);
  }
  // As duas entradas de TV que ficaram sao do MIRRORVIEW (decisao do dono: TV em produto
  // separado). Aqui nao ha TV nenhuma para resetar.
  for (const [descricao, marca] of [["catalogo de TV em memoria", "invalidarCatalogoTv()"],
                                  ["mapa de grupos e memo do catalogo de TV", "tvSources.limpaMemoria()"]]) {
    assert.ok(tvServer.includes(marca), `o reset do MirrorView precisa apagar ${descricao} (${marca})`);
  }

  // E o que nao pode ter sobrado: as duas caches que mediam video.
  for (const saiu of ["qualityCache", "reachCache"]) {
    assert.equal(new RegExp("(const|let|function) " + saiu + "\\b").test(server), false,
      saiu + " foi embora com a entrega de video");
  }

  // E o que ele NÃO promete: as caches internas de cada scraper não têm chave para apagar de fora.
  // DECISAO 155: o que não é apagado mudou de nome — não é mais o "catálogo de painel" (as
  // fontes de VOD saíram na 154), e sim o catálogo do REI e o XMLTV do guia, que é o que sobra
  // de cacheado dentro do scraper.
  assert.match(server, /as caches internas de cada scraper \(o catalogo do REI, o XMLTV do guia\) nao sao apagadas/,
    "a resposta precisa dizer o que não foi apagado, senão o reset parece completo e não é");
  // E o antes/depois precisa mostrar as provas, que e o estado que nao mora no disco.
  // DECISAO 155: o que o reset conta agora e' o estado de TV em memoria (canais), nao as provas
  // de morte — que nao existem sem triagem.
  assert.match(tvServer, /canaisEmMemoria: tvSources\.quantosCanaisEmMemoria\(\)/, "o reset do MirrorView reporta os canais em memoria antes e depois");
  assert.match(tvServer, /canaisApagadosDaMemoria: canaisApagados/, "e quantos ele apagou");
  // o NOME pode aparecer no comentario do server que explica a saida; o que nao pode e' uso.
  assert.equal(/provasDeMorte:/.test(server), false, "as provas de morte sairam com a triagem");
  assert.equal(/tvSources\.limpaProvasDeMorte/.test(server), false, "e o reset nao as apaga mais");
});