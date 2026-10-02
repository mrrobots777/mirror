require("dotenv").config();

const xtream = require("./src/scrapers/xtream");
const playerflix = require("./src/scrapers/playerflix");
const kakito = require("./src/scrapers/kakito");
const otakulogia = require("./src/scrapers/otakulogia");
const animesdigital = require("./src/scrapers/animesdigital");
const aon = require("./src/scrapers/aon");
const anitube = require("./src/scrapers/anitube");
const vizer = require("./src/scrapers/vizer");
const doramogo = require("./src/scrapers/doramogo");
const redetoons = require("./src/scrapers/redetoons");

function streamReq(s) {
  return (s && s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) || {};
}

async function probe(url, extra) {
  if (!url) return "sem url";
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-1023", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", ...extra },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "-";
    return `${res.status} ${ct} ${buf.byteLength}b`;
  } catch (e) {
    return `FAIL ${e.message}`;
  }
}

const cases = [
  { label: "BLZ/SPC filme Matrix (1999)", run: () => xtream.streamsFor("Matrix", 1, "movie", undefined, 1, 1999) },
  { label: "BLZ/SPC filme Interestelar (2014)", run: () => xtream.streamsFor("Interestelar", 1, "movie", undefined, 1, 2014) },
  { label: "BLZ/SPC serie Breaking Bad S01E05", run: () => xtream.streamsFor("Breaking Bad", 5, "series", undefined, 1, 2008) },
  { label: "BLZ/SPC serie The Last of Us S01E03", run: () => xtream.streamsFor("The Last of Us", 3, "series", undefined, 1, 2023) },
  { label: "SPT filme Matrix tmdb:603", run: () => playerflix.streamsFor("Matrix", 1, "movie", 603, 1, 1999) },
  { label: "SPT serie Breaking Bad S01E05 tmdb:1396", run: () => playerflix.streamsFor("Breaking Bad", 5, "series", 1396, 1, 2008) },
  { label: "KKT filme Matrix (1999)", run: () => kakito.streamsFor("Matrix", 1, "movie", 1, 1999) },
  { label: "KKT serie Breaking Bad S01E05", run: () => kakito.streamsFor("Breaking Bad", 5, "series", 1, 2008) },
  { label: "KKT filme Duna (2021)", run: () => kakito.streamsFor("Duna", 1, "movie", 1, 2021) },
  { label: "SHG Naruto E1", run: () => otakulogia.streamsFor("Naruto", 1) },
  { label: "SHG Bleach E5", run: () => otakulogia.streamsFor("Bleach", 5) },
  { label: "RON Naruto S01E01", run: () => animesdigital.streamsFor("Naruto", 1, 1) },
  { label: "RON Shingeki no Kyojin S01E03", run: () => animesdigital.streamsFor("Shingeki no Kyojin", 3, 1) },
  { label: "AON Naruto S01E01", run: () => aon.streamsFor("Naruto", 1, 1) },
  { label: "AON Dragon Ball S01E05", run: () => aon.streamsFor("Dragon Ball", 5, 1) },
  { label: "ATB Naruto S01E01", run: () => anitube.streamsFor("Naruto", 1, 1) },
  { label: "ATB One Piece S01E100", run: () => anitube.streamsFor("One Piece", 100, 1) },
  { label: "DGO Goblin S01E01", run: () => doramogo.streamsFor("Goblin", 1, "series", 1, 2016) },
  { label: "VZR filme Matrix tmdb:603", run: () => vizer.streamsFor(603, 1, "movie", 1, "Matrix", 1999) },
  { label: "VZR serie Breaking Bad S01E05 tmdb:1396", run: () => vizer.streamsFor(1396, 5, "series", 1, "Breaking Bad", 2008) },
  { label: "VZR serie Stranger Things S01E01 tmdb:66732", run: () => vizer.streamsFor(66732, 1, "series", 1, "Stranger Things", 2016) },
  { label: "DGO Conspiracao do Amor S01E02", run: () => doramogo.streamsFor("Conspiração do Amor", 2, "series", 1, 2026) },
  { label: "RTD filme Matrix tmdb:603", run: () => redetoons.streamsFor(603, 1, "movie", 1, "Matrix", 1999) },
  { label: "RTD serie Golden Time S01E01 tmdb:67389", run: () => redetoons.streamsFor(67389, 1, "series", 1, "Golden Time", 2013) },
];

(async () => {
  let ok = 0;
  let fail = 0;
  for (const c of cases) {
    const t0 = Date.now();
    try {
      const streams = await c.run();
      const ms = Date.now() - t0;
      if (!streams.length) fail++; else ok++;
      console.log(`\n### ${c.label}: ${streams.length} streams (${ms}ms)`);
      for (const s of streams.slice(0, 3)) {
        console.log(`   - ${s.title || s.name}`);
      }
      if (streams.length) {
        const p1 = await probe(streams[0].url, streamReq(streams[0]));
        console.log(`   probe[0]: ${p1}`);
        if (streams.length > 2) {
          const last = streams[streams.length - 1];
          const p2 = await probe(last.url, streamReq(last));
          console.log(`   probe[last]: ${p2}`);
        }
      }
    } catch (e) {
      fail++;
      console.log(`\n### ${c.label}: ERRO ${e.message} (${Date.now() - t0}ms)`);
    }
  }
  console.log(`\n== resumo: ${ok} com streams, ${fail} vazios/erros, ${cases.length} casos ==`);
  process.exit(0);
})();
