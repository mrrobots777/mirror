// Bateria de TV ao vivo: cruza canais (ids do addon) × as 4 fontes de TV e prova o link.
//
//   node tools/bateria-tv.js                       # amostra padrão
//   node tools/bateria-tv.js /tmp/canais.txt       # arquivo "id<TAB>nome" por linha
//   PROBE_MAX=1 node tools/bateria-tv.js ...       # menos sondas por canal
//
// O id é o do catálogo do addon (`/nuvio/catalog/channel/tv.json`), que é o mesmo que o
// Nuvio manda para o plugin — é esse o caminho que se prova aqui.

const fs = require("fs");
const path = require("path");
const fontes = require("../src/core/fontes");
const { um: provar } = require("../tools/provar-links.js");

const FONTES_TV = ["rei", "emb", "etc", "rcd"];

const AMOSTRA = [
  "1001\tA&E",
  "1021\tApple TV 6",
  "1041\tCanal Goat 3",
  "1061\tCultura Brasil",
  "1081\tDiscovery World",
  "1101\tEurosport",
  "1121\tGazeta",
  "1141\tHBO 2",
  "1161\tMax 5",
  "1181\tMovieSphere",
  "1201\tParamount+ 4",
  "1221\tReal Madrid TV",
  "1241\tSBT PI",
  "1261\tSporTV",
  "1281\tTNT Novelas",
  "1301\tUFC Fight Pass",
];

function linhasDo(argv) {
  const arquivo = argv[0];
  if (arquivo) return fs.readFileSync(arquivo, "utf8").split("\n").filter(Boolean);
  return AMOSTRA;
}

async function umaFonte(chave, id) {
  const mod = require(path.join(__dirname, "..", "dist", fontes.bundleDe(chave)));
  const t0 = Date.now();
  let lista;
  try {
    lista = await mod.getStreams(String(id), "channel", null, null);
  } catch (e) {
    return { chave, ms: Date.now() - t0, streams: -1, erro: String((e && e.message) || e).slice(0, 70) };
  }
  const ms = Date.now() - t0;
  if (!Array.isArray(lista)) return { chave, ms, streams: -2, erro: "nao array" };
  if (!lista.length) return { chave, ms, streams: 0, vivos: 0, ruins: 0 };
  const alvos = lista.slice(0, Number(process.env.PROBE_MAX) || 2);
  const res = [];
  const conc = Number(process.env.PROBE_CONC) || 3;
  for (let i = 0; i < alvos.length; i += conc) {
    res.push(...(await Promise.all(alvos.slice(i, i + conc).map(provar))));
  }
  return {
    chave,
    ms,
    streams: lista.length,
    vivos: res.filter((r) => r.veredito === "ok").length,
    ruins: res.filter((r) => ["MORTO", "RUIM", "STUB", "VAZIO"].includes(r.veredito)).length,
    bytes: res[0] ? res[0].bytes : 0,
    status: res[0] ? res[0].status : 0,
  };
}

(async () => {
  const canais = linhasDo(process.argv.slice(2));
  const fontesTv = (process.env.FONTES ? process.env.FONTES.split(",").map((s) => s.trim()) : FONTES_TV)
    .filter((c) => fontes.FONTES[c]);
  const t0 = Date.now();
  const porFonte = {};
  fontesTv.forEach((f) => { porFonte[f] = { comStream: 0, comLink: 0, semStream: 0, lancou: 0, ms: 0, canais: [] }; });
  const matriz = [];

  for (const linha of canais) {
    const [id, nome] = linha.split("\t");
    const celulas = [];
    for (const f of fontesTv) {
      const r = await umaFonte(f, id);
      const acc = porFonte[f];
      acc.ms += r.ms;
      if (r.streams === -1 || r.streams === -2) { acc.lancou += 1; }
      else if (r.streams === 0) { acc.semStream += 1; }
      else {
        acc.comStream += 1;
        if (r.vivos > 0) { acc.comLink += 1; acc.canais.push(nome); }
      }
      const marca = r.streams === -1 ? "ERR"
        : r.streams === 0 ? " ·  "
        : r.vivos > 0 ? `${r.streams}/${r.vivos}✓`
        : `${r.streams}/${r.ruins}✗`;
      celulas.push(`${f.padEnd(4)} ${marca.padEnd(9)} ${String(r.ms).padStart(5)}ms${r.erro ? ` ${r.erro}` : ""}`);
    }
    matriz.push(`${String(id).padEnd(5)} ${(nome || "").slice(0, 22).padEnd(23)}${celulas.join(" | ")}`);
    console.log(matriz[matriz.length - 1]);
  }

  console.log("-".repeat(100));
  for (const f of fontesTv) {
    const a = porFonte[f];
    console.log(`${f.padEnd(4)} com stream ${String(a.comStream + "/" + canais.length).padStart(6)} | com link vivo ${String(a.comLink).padStart(6)} | sem stream ${String(a.semStream).padStart(4)} | lancou ${a.lancou} | medio ${Math.round(a.ms / canais.length)}ms`);
    if (a.comLink) console.log(`     ok: ${a.canais.join(", ").slice(0, 200)}`);
  }
  console.log(`total ${Date.now() - t0}ms`);
})().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
