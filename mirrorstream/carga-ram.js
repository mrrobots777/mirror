// PROVA DA REGRA DO DONO: "com pico de milhares de usuarios, nao passando 300MB".
//
// Roda o teste de carga do projeto (mesmos caminhos, 2000 usuarios simulados com
// `X-Forwarded-For` variando) contra um servidor LOCAL com o mesmo codigo de producao, e mede o
// RSS do processo a cada 2s. E a prova de que a memoria nao cresce com o numero de pessoas — e
// por isso que ela roda aqui e nao contra o addon do dono.
//
//   node carga-ram.js            2000 usuarios (padrao do load-test.js)
//   node carga-ram.js 500        500 usuarios

const { spawn } = require("node:child_process");
const http = require("node:http");

const TOTAL = Number(process.argv[2] || 2000);
const CONC = Number(process.argv[3] || 50);
const PORTA = 7001;
const BASE = `http://127.0.0.1:${PORTA}`;

function rssDoFilho(pid) {
  return new Promise((resolve) => {
    http
      .get(`http://127.0.0.1:${PORTA}/health`, (res) => {
        let s = "";
        res.on("data", (d) => (s += d));
        res.on("end", () => {
          try {
            const j = JSON.parse(s);
            resolve(j.memory ? j.memory.rss : null);
          } catch (_) {
            resolve(null);
          }
        });
      })
      .on("error", () => resolve(null));
  });
}

(async () => {
  console.log(`subindo o servidor local na ${PORTA}…`);
  const servidor = spawn("node", ["src/server.js"], {
    env: { ...process.env, PORT: String(PORTA), PUBLIC_BASE_URL: BASE, ...(process.env.MEM_CACHE_BIG_MAX ? { MEM_CACHE_BIG_MAX: process.env.MEM_CACHE_BIG_MAX } : {}), ...(process.env.MEM_CACHE_MAX ? { MEM_CACHE_MAX: process.env.MEM_CACHE_MAX } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const linhas = [];
  servidor.stdout.on("data", (d) => linhas.push(d.toString()));
  servidor.stderr.on("data", (d) => linhas.push(d.toString()));

  // espera ficar de pe
  let pronto = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const rss = await rssDoFilho(servidor.pid);
    if (rss !== null) {
      console.log(`no ar com RSS ${rss}MB`);
      pronto = true;
      break;
    }
  }
  if (!pronto) {
    console.log("o servidor nao subiu; ultimas linhas:\n" + linhas.slice(-8).join(""));
    servidor.kill();
    process.exit(1);
  }

  const amostras = [{ t: 0, rss: await rssDoFilho(servidor.pid) }];
  const inicio = Date.now();
  const timer = setInterval(async () => {
    const rss = await rssDoFilho(servidor.pid);
    if (rss !== null) amostras.push({ t: Math.round((Date.now() - inicio) / 1000), rss });
  }, 2000);

  console.log(`\ncarga: ${TOTAL} usuarios, ${CONC} simultaneos, 90s\n`);
  const carga = spawn("node", ["load-test.js"], {
    env: { ...process.env, LOAD_BASE: BASE, LOAD_TOTAL: String(TOTAL), LOAD_CONCURRENCY: String(CONC), LOAD_TESTE_SEGUNDOS: "90" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let relatorio = "";
  carga.stdout.on("data", (d) => (relatorio += d.toString()));
  carga.stderr.on("data", (d) => (relatorio += d.toString()));

  await new Promise((r) => carga.on("exit", r));
  clearInterval(timer);
  // DEPOIS DA CARGA: o `cleanup` do servidor roda a cada 30s. Se a RAM volta, era pico; se fica,
  // e alguma coisa retida. E a diferenca entre "memoria alta" e "vazao".
  console.log("\n--- 90s DEPOIS da carga, sem nenhum pedido (o cleanup do servidor roda a cada 30s) ---");
  for (let i = 0; i < 9; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const rss = await rssDoFilho(servidor.pid);
    console.log(`  t+${(i + 1) * 10}s  ${rss}MB`);
  }

  console.log("--- RSS durante a carga (de 2 em 2 segundos) ---");
  for (const a of amostras) console.log(`  t+${String(a.t).padStart(3)}s  ${String(a.rss).padStart(4)}MB` + (a.rss > 300 ? "  <<< ACIMA DE 300MB" : a.rss > 150 ? "  (acima de 150)" : ""));
  const maior = Math.max(...amostras.map((a) => a.rss));
  const ultimo = amostras[amostras.length - 1].rss;
  console.log(`\npico: ${maior}MB | depois da carga: ${ultimo}MB`);
  console.log(`regra do dono: maximo 150MB, nunca 300MB -> ${maior <= 300 ? "RESPEITADA no teto de 300" : "VIOLADA"}; ${maior <= 150 ? "dentro do alvo de 150" : "acima do alvo de 150"}`);

  console.log("\n--- relatorio do load-test ---");
  console.log(relatorio.split("\n").slice(-24).join("\n"));

  servidor.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  try { process.kill(servidor.pid, 0); servidor.kill("SIGKILL"); } catch (_) {}
  process.exit(0);
})();