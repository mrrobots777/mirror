require("dotenv").config();

const BASE = (process.env.CARGA_BASE || "http://localhost:7000").replace(/\/$/, "");
const USUARIOS = Number(process.env.CARGA_USUARIOS) || 300;
const DURACAO_S = Number(process.env.CARGA_SEGUNDOS) || 25;

const ALVOS = [
  "/api/streams/series/tmdb:1396?season=1&episode=1",
  "/api/streams/series/tmdb:66732?season=1&episode=2",
  "/api/streams/movie/tmdb:603",
  "/api/streams/tv/hbo",
  "/api/channels/categories",
  "/api/vod/genres",
  "/api/vod/search?q=matrix",
  "/stream/tv/tv:live:globosp.json",
  "/health",
];

const TETO_RSS_MB = Number(process.env.CARGA_TETO_RSS) || 300;

// O RSS sai do PROCESSO do servidor, nao do /health: em 300 usuarios o proprio endpoint
// disputa socket com o trafego e o fetch do vigia era o que mais falhava (medido: 25/26
// erros vinham do /health, todos "operation was aborted"). Ler o RSS de fora mede o que
// importa — o numero que estoura o container — sem adicionar carga.
const { execFileSync } = require("child_process");

function rssDoServidor() {
  try {
    const out = execFileSync("bash", ["-lc",
      "ss -ltnp 2>/dev/null | grep ':7000 ' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2"], { encoding: "utf8" }).trim();
    if (!out) return 0;
    return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", out], { encoding: "utf8" }).trim()) / 1024);
  } catch (_) { return 0; }
}

(async () => {
  console.log(`carga: ${USUARIOS} usuarios simultaneos por ${DURACAO_S}s em ${BASE}`);
  const alvo = ALVOS[Math.floor(Math.random() * ALVOS.length)];
  const pico = { rss: 0 };
  const t0Carga = Date.now();
  const erros = { porRota: new Map(), total: 0 };
  let pedidos = 0;
  let latencias = [];
  let fim = false;

  const vigia = (async () => {
    while (!fim) {
      const rss = rssDoServidor();
      if (rss > pico.rss) pico.rss = rss;
      const restante = DURACAO_S * 1000 - (Date.now() - t0Carga);
      if (restante <= 0) break;
      await new Promise(r => setTimeout(r, Math.min(1000, restante)));
    }
  })();

  const cliente = new AbortController();
  async function usuario(id) {
    while (!fim) {
      const rota = ALVOS[(id + Math.floor(Math.random() * ALVOS.length)) % ALVOS.length];
      const t0 = Date.now();
      try {
        const r = await fetch(`${BASE}${rota}`, { signal: AbortSignal.timeout(20000) });
        await r.arrayBuffer();
        latencias.push(Date.now() - t0);
        pedidos++;
      } catch (e) {
        erros.total++;
        const k = `${rota} :: ${String(e.message).slice(0, 28)}`;
        erros.porRota.set(k, (erros.porRota.get(k) || 0) + 1);
      }
    }
  }

  const t0 = Date.now();
  const todos = Array.from({ length: USUARIOS }, (_, i) => usuario(i));
  await new Promise(r => setTimeout(r, DURACAO_S * 1000));
  fim = true;
  await Promise.allSettled(todos);
  const duracaoS = Math.round((Date.now() - t0) / 1000);
  await vigia;

  latencias.sort((a, b) => a - b);
  const p = q => latencias[Math.min(latencias.length - 1, Math.floor(latencias.length * q))] || 0;
  const porSegundo = (pedidos / Math.max(1, duracaoS)).toFixed(1);

  console.log(`\npedidos: ${pedidos}  (${porSegundo}/s)  latencia p50=${p(0.5)}ms p90=${p(0.9)}ms p99=${p(0.99)}ms max=${latencias[latencias.length - 1] || 0}ms`);
  console.log(`RSS pico: ${pico.rss}MB   teto do dono: ${TETO_RSS_MB}MB   ${pico.rss <= TETO_RSS_MB ? "DENTRO" : "ESTOUROU"}`);
  console.log(`erros: ${erros.total}`);
  if (erros.porRota.size) {
    for (const [k, v] of [...erros.porRota.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${v}x  ${k}`);
  }
  process.exit(0);
})();
