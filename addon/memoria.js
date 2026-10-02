// ONDE ESTA A RAM? Mede o app inteiro, modulo a modulo, como ele faz no boot.
//
// A meta do dono: 150MB no maximo, e nunca passar de 300MB com milhares de pessoas. Antes de
// mexer em qualquer coisa, o numero: RSS, heap, external — e o que cada modulo carrega.
//
//   node memoria.js           mede o boot completo (com EPG e catalogo de TV)
//   node memoria.js --so-codigo   mede sem carregar base nenhuma (so o codigo require)
//   node memoria.js --vod     mede o boot ANTIGO, com as 10 fontes de VOD e o catalogo de painel
//
// DECISAO 154 (02/10/2026): o servidor virou SO CATALOGO + RELAY, entao o boot medido aqui nao
// carrega mais base do KAK nem catalogo de painel Xtream — eles eram so das 10 fontes de VOD, que
// foram para o plugin do Nuvio. O ganho medido com a MESMA sequencia de pedidos, depois que o
// aquecimento termina: RSS 272MB -> 136MB, heap 81MB -> 31MB, e `paineis.db` (15MB em disco)
// deixou de ser gravado. `--vod` existe para refazer a conta antiga e comparar.

process.env.DOTENV_CONFIG_QUIET = "true";

const MB = (b) => Math.round((b / (1024 * 1024)) * 10) / 10;
const soCodigo = process.argv.includes("--so-codigo");
const comVod = process.argv.includes("--vod");

let ultimo = process.memoryUsage();
function marca(rotulo) {
  const m = process.memoryUsage();
  const linha = [
    rotulo.padEnd(34),
    `rss ${String(MB(m.rss)).padStart(7)}MB`,
    `heap ${String(MB(m.heapTotal)).padStart(7)}MB`,
    `usado ${String(MB(m.heapUsed)).padStart(7)}MB`,
    `ext ${String(MB(m.external)).padStart(6)}MB`,
    `delta-rss ${String(MB(m.rss - ultimo.rss)).padStart(7)}MB`,
  ].join(" | ");
  console.log(linha);
  ultimo = m;
  return m;
}

(async () => {
  console.log(`node ${process.version} | data: ${process.env.DATA_DIR || "(padrao)"} | pid ${process.pid}\n`);
  marca("inicio (so o runtime)");

  require("dotenv").config();

  // 1) servidor: o codigo inteiro, sem nenhuma base
  marca("requer o servidor (rotas, libs)");
  if (soCodigo) {
    console.log("\n(--so-codigo: nao carrega base nenhuma)");
    process.exit(0);
  }

  // 2) o KAK e os paineis Xtream: sao as bases das 10 fontes de VOD, que NAO estao mais no
  // servidor (decisao 154). Sem `--vod` o servidor nem abre o `iptv.db` nem grava `paineis.db`.
  if (comVod) {
    const kakito = require("./src/scrapers/kakito");
    marca("require kakito");
    try {
      await kakito.preloadPlaylist();
      marca(`kakito: base carregada (${kakito.stats ? JSON.stringify(kakito.stats()) : "?"})`);
    } catch (e) {
      marca(`kakito: FALHOU (${e.message.slice(0, 40)})`);
    }

    const xtream = require("./src/scrapers/xtream");
    marca("require xtream");
    try {
      await xtream.preloadLists();
      const st = xtream.stats ? xtream.stats() : null;
      marca(`xtream: catalogos (${st ? JSON.stringify(st) : "?"})`);
    } catch (e) {
      marca(`xtream: FALHOU (${e.message.slice(0, 40)})`);
    }

    require("./src/scrapers/otakulogia");
    require("./src/scrapers/animesdigital");
    require("./src/scrapers/aon");
    require("./src/scrapers/anitube");
    require("./src/scrapers/playerflix");
    require("./src/scrapers/vizer");
    require("./src/scrapers/redetoons");
    require("./src/scrapers/doramogo");
    marca("require das 8 fontes de VOD");
  } else {
    marca("fontes de VOD: fora do servidor (--vod mede o boot antigo)");
  }

  // 5) TV: catalogo + EPG
  const tv = require("./src/core/tv-sources");
  marca("require tv-sources");
  try {
    await tv.warmup();
    marca(`TV: catalogo aquecido (${tv.getCatalog ? (tv.getCatalog().length || "?") + " grupos" : "?"})`);
  } catch (e) {
    marca(`TV: FALHOU (${e.message.slice(0, 40)})`);
  }

  // 6) quantos objetos de lista existem: o numero que explica o RSS
  const v8 = require("v8");
  const hs = v8.getHeapStatistics();
  console.log(`\nheap: total ${MB(hs.total_heap_size)}MB | usado ${MB(hs.used_heap_size)}MB |ExecSpace ${MB(hs.total_heap_size_executable)}MB`);
  console.log(`external: ${MB(process.memoryUsage().external)}MB | arrayBuffers: ${MB(process.memoryUsage().arrayBuffers)}MB`);

  // 7) o teste de arena: se o heap for pequeno e o RSS grande, e arena (nao vazamento)
  if (global.gc) {
    const antes = process.memoryUsage();
    global.gc();
    const depois = process.memoryUsage();
    console.log(`\ngc completo: rss ${MB(antes.rss)} -> ${MB(depois.rss)}MB (caiu ${MB(antes.rss - depois.rss)}MB) | heap usado ${MB(antes.heapUsed)} -> ${MB(depois.heapUsed)}MB`);
    console.log(antes.rss - depois.rss > depois.heapUsed * 0.5
      ? "=> HEAP PEQUENO E RSS GRANDE: e arena, nao vazamento (MALLOC_ARENA_MAX=2 derruba ~11%)"
      : "=> o RSS acompanha o heap: ha objeto retido no processo");
  } else {
    console.log("\n(sem --expose-gc: rode com node --expose-gc memoria.js para separar arena de vazao)");
  }
  process.exit(0);
})();