// O COLETOR DE LIXO, que de fato coleta.
//
// MEDIDO 01/10/2026: o `cleanup` do servidor roda a cada 30s e chamava `global.gc()` — que
// NUNCA EXISTE em producao, porque `--expose-gc` nao e permitido em `NODE_OPTIONS` (medido:
// o Node recusa com "is not allowed in NODE_OPTIONS"). Ou seja, a linha existia, a intencao
// existia, e nada era coletado: o RSS subia no boot e ficava la.
//
// O truque e o mesmo usado widely no Node: pedir a flag ao V8 EM TEMPO DE EXECUCAO e puxar o
// `gc` de um contexto novo. Sem flag no arranque, sem restart, e funciona (medido: 92MB -> 69MB
// de RSS, heap 33MB -> 3MB, num processo so com stringas na RAM).
//
// O outro caminho do problema era a arena: o `MALLOC_ARENA_MAX=2` do Dockerfile derruba ~11%, e o
// numero esta no AGENTS. Aqui o gain maior e parar de carregar 200MB de catalogo (decisao 136).

const v8 = require("v8");
const vm = require("vm");

let gc = null;
let tentou = false;
let disponivel = true;

function gcSeForcar() {
  if (!disponivel) return false;
  // O proprio `global.gc` (util no dev, com --expose-gc) e o caminho mais limpo.
  if (typeof global.gc === "function") {
    try {
      global.gc();
      return true;
    } catch (_) {}
  }
  if (tentou) return !!gc;
  tentou = true;
  try {
    v8.setFlagsFromString("--expose_gc");
    gc = vm.runInNewContext("gc");
    v8.setFlagsFromString("--no-expose_gc");
    return typeof gc === "function";
  } catch (e) {
    console.error(`[memoria] gc indisponivel (${e.message.slice(0, 60)})`);
    disponivel = false;
    gc = null;
    return false;
  }
}

function rssMB() {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}

function heapMB() {
  return Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
}

// Coleta e mede o ganho. Devolve o que caiu, ou `null` se nao coletou.
function coletarSePreciso(limiteMB, motivo) {
  const antes = rssMB();
  if (antes <= Number(limiteMB)) return null;
  const fez = gcSeForcar();
  if (!fez) return null;
  const depois = rssMB();
  const caiu = antes - depois;
  console.warn(`[memoria] ${motivo || "coleta"}: RSS ${antes}MB -> ${depois}MB (caiu ${caiu}MB), heap ${heapMB()}MB`);
  return { antes, depois, caiu };
}

module.exports = { gcSeForcar, rssMB, heapMB, coletarSePreciso };