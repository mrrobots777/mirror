require("dotenv").config();

const BASE = process.env.E2E_BASE || "http://localhost:7000";

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function getOnce(path) {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(30000),
    headers: { connection: "close" },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, text, json };
}

async function get(path) {
  try {
    return await getOnce(path);
  } catch (e) {
    await new Promise(r => setTimeout(r, 400));
    return await getOnce(path);
  }
}

async function ffprobe(url, extra = {}) {
  const { spawnSync } = require("child_process");
  const args = ["-v", "error", "-user_agent", extra["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "-read_intervals", "%+#15"];
  const hdrs = Object.entries(extra).filter(([k]) => !/user-agent|range/i.test(k)).map(([k, v]) => `${k}: ${v}`).join("\r\n");
  if (hdrs) args.push("-headers", hdrs);
  args.push("-show_entries", "format=duration,format_name", "-of", "json", url);
  const r = spawnSync("ffprobe", args, { timeout: 45000, encoding: "utf8" });
  if (r.error) return { ok: false, detail: r.error.message };
  if (r.status !== 0) return { ok: false, detail: (r.stderr || "").slice(0, 200) };
  try {
    const j = JSON.parse(r.stdout);
    return { ok: true, detail: `duration=${j.format?.duration}s format=${j.format?.format_name}` };
  } catch (e) {
    return { ok: false, detail: "parse error" };
  }
}

function streamReq(s) {
  return (s && s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) || {};
}

function streamSummary(json) {
  const streams = json?.streams || [];
  return {
    n: streams.length,
    titles: streams.slice(0, 8).map(s => s.title || s.name),
    urls: streams.map(s => s.url).filter(Boolean),
    items: streams.filter(s => s.url).map(s => ({ url: s.url, hdr: streamReq(s) })),
    sources: [...new Set(streams.flatMap(s => s.sources || []))],
  };
}

(async () => {
  const health = await get("/health");
  check("health 200", health.status === 200, `status=${health.status}`);
  check("health scraperQueueTimeout=15000", health.json?.capacity?.scraperQueueTimeout === 15000, `valor=${health.json?.capacity?.scraperQueueTimeout}`);
  check("health relay maxRelayStreams presente", typeof health.json?.relay?.maxRelayStreams === "number");

  const manifest = await get("/mirror/manifest.json");
  check("manifest 200", manifest.status === 200, `status=${manifest.status}`);
  check("manifest version 1.0.1", manifest.json?.version === "1.0.1", `version=${manifest.json?.version}`);
  check("manifest catalogos", (manifest.json?.catalogs || []).length >= 1, `${manifest.json?.catalogs?.length} catalogs`);

  const catTv = await get("/catalog/tv/mirror-tv-live.json");
  check("catalog tv 200", catTv.status === 200, `status=${catTv.status}`);
  check("catalog tv tem metas", (catTv.json?.metas || []).length > 0, `${catTv.json?.metas?.length} metas`);

  const catTvSearch = await get("/catalog/tv/mirror-tv-live.json?search=hbo");
  check("catalog tv search=hbo", (catTvSearch.json?.metas || []).length > 0, `${catTvSearch.json?.metas?.length} metas`);

  const metaMovie = await get("/meta/movie/tt0133093.json");
  check("meta movie Matrix", !!metaMovie.json?.meta?.name, `nome=${metaMovie.json?.meta?.name}`);

  const metaSeries = await get("/meta/series/kitsu:11.json");
  check("meta series Naruto", !!metaSeries.json?.meta?.name, `nome=${metaSeries.json?.meta?.name}`);
  check("meta series kitsu videos", (metaSeries.json?.meta?.videos || []).length > 0, `${metaSeries.json?.meta?.videos?.length} videos`);

  const metaLive = await get("/meta/tv/tv:live:hbo.json");
  check("meta live hbo", !!metaLive.json?.meta?.name, `nome=${metaLive.json?.meta?.name}`);

  const sMovie = await get("/stream/movie/tt0133093.json");
  const sm = streamSummary(sMovie.json);
  check("streams filme Matrix >0", sm.n > 0, `${sm.n} streams, fontes=[${sm.sources}]`);
  sm.titles.slice(0, 4).forEach(t => console.log(`     · ${t}`));
  check("label filme nome+ano+fonte", sm.titles.some(t => /\(1999\).*·/.test(t) && /(SPC|SPT|KKT|BLZ)/.test(t)), sm.titles[0] || "sem titulo");

  const sMovie1080 = await get("/quality=1080p/stream/movie/tt0133093.json");
  const smq = streamSummary(sMovie1080.json);
  check("filtro quality=1080p ok", smq.n > 0 && smq.n <= sm.n, `sem filtro=${sm.n}, com filtro=${smq.n}`);
  check("filtro quality=1080p mantem >=1080", smq.titles.every(t => /1080p|2160p|4K/i.test(t)) && smq.n > 0, smq.titles.slice(0, 3).join(" | "));

  const sMovieSpt = await get("/sources=spt/stream/movie/tt0133093.json");
  const sms = streamSummary(sMovieSpt.json);
  check("filtro sources=spt", sms.n > 0 && sms.sources.length === 1 && sms.sources[0] === "spt", `fontes=[${sms.sources}]`);

  const sSeries = await get("/stream/series/tt0903747:1:5.json");
  const ss = streamSummary(sSeries.json);
  check("streams Breaking Bad S01E05 >0", ss.n > 0, `${ss.n} streams, fontes=[${ss.sources}]`);
  check("label serie SxxEyy", ss.titles.some(t => /S01E05/.test(t)), ss.titles[0] || "sem titulo");

  const sAnime = await get("/stream/series/kitsu:11:1:3.json");
  const sa = streamSummary(sAnime.json);
  check("streams Naruto E3 >0", sa.n > 0, `${sa.n} streams, fontes=[${sa.sources}]`);
  check("label anime S01E03", sa.titles.some(t => /S01E03/.test(t)), sa.titles[0] || "sem titulo");
  const langLines = sAnime.text.match(/🌎 Português|🧩 Legendado/g) || [];
  check("linha de idioma nos streams anime", langLines.length > 0, `${langLines.length} ocorrencias`);

  const sAnimeDub = await get("/lang=dubbed/stream/series/kitsu:11:1:3.json");
  const sad = streamSummary(sAnimeDub.json);
  const allDubbed = sAnimeDub.json?.streams?.every(s => s.dubbed === true);
  check("filtro lang=dubbed so dublados", sad.n > 0 && allDubbed, `${sad.n} streams, todosDubbed=${allDubbed}`);

  const sLive = await get("/stream/tv/tv:live:hbo.json");
  const sl = streamSummary(sLive.json);
  check("streams live hbo >0", sl.n > 0, `${sl.n} streams, fontes=[${sl.sources}]`);

  const mf = await getOnce("/manifest.json");
  check("manifesto declara epgProvider", mf.json?.behaviorHints?.epgProvider === true, JSON.stringify(mf.json?.behaviorHints));
  const catManifest = (mf.json?.catalogs || []).find(c => c.type === "tv");
  check("catalogo TV declara extra date+skip", ["date", "skip"].every(n => (catManifest?.extra || []).some(e => e.name === n)), (catManifest?.extra || []).map(e => e.name).join(","));

  const hoje = new Date().toISOString().slice(0, 10);
  const cGrade = await get(`/catalog/tv/mirror-tv-live.json?date=${hoje}`);
  const detailed = cGrade.json?.metasDetailed;
  const comGrade = (detailed || []).filter(m => m.videos?.length);
  check("catalogo com date devolve metasDetailed", Array.isArray(detailed), `${(detailed || []).length} canais, ${comGrade.length} com grade`);
  const v0 = comGrade[0]?.videos?.[0];
  check("programa tem startTime/endTime ISO", !!v0 && new Date(v0.endTime) > new Date(v0.startTime), v0 ? `${v0.startTime.slice(11, 16)}-${v0.endTime.slice(11, 16)} ${v0.title.slice(0, 30)}` : "sem grade");
  check("meta do canal traz videos + hasScheduledVideos", (() => {
    const m = comGrade[0];
    return !!m && m.behaviorHints?.hasScheduledVideos === true;
  })(), comGrade[0]?.name || "nenhum");
  const metaCanal = await get(`/meta/tv/${comGrade[0]?.id || "tv:live:hbo"}.json`);
  check("meta do canal tem a grade do dia", (metaCanal.json?.meta?.videos?.length || 0) > 0, `${metaCanal.json?.meta?.videos?.length || 0} programas em ${metaCanal.json?.meta?.name}`);

  const vid = comGrade[0]?.videos?.[0]?.id;
  const stProg = await get(`/stream/tv/${encodeURIComponent(vid)}.json`);
  const sp = streamSummary(stProg.json);
  check("programa do guia abre os streams (celular)", sp.n > 0, `id ${vid} -> ${sp.n} streams, fontes=[${sp.sources}]`);
  const metaProg = await get(`/meta/tv/${encodeURIComponent(vid)}.json`);
  check("meta do programa devolve o nome do programa", (metaProg.json?.meta?.title || metaProg.json?.meta?.name || "") === (comGrade[0]?.videos?.[0]?.title || ""), `${metaProg.json?.meta?.title || metaProg.json?.meta?.name}`);

  const unreachable = /4x4u29c\.autos|kakito\.xyz|telaplay93/i;
  const seen = new Set();
  const candidates = [];
  for (const c of [...sm.items, ...ss.items, ...sa.items, ...smq.items]) {
    if (!c.url || unreachable.test(c.url) || seen.has(c.url)) continue;
    seen.add(c.url);
    candidates.push(c);
  }
  let fp = null;
  let used = null;
  let attempts = 0;
  for (const c of candidates.slice(0, 4)) {
    used = c;
    attempts++;
    fp = await ffprobe(c.url, c.hdr);
    if (fp.ok) break;
    console.log(`     ffprobe tentativa ${attempts} falhou: ${fp.detail}`);
  }
  if (used) {
    console.log(`     ffprobe: ${used.url.slice(0, 120)}`);
    check("ffprobe playback", fp.ok, fp.ok && attempts > 1 ? `${fp.detail} (tentativa ${attempts})` : fp.detail);
  } else {
    check("ffprobe playback", false, "nenhuma url disponivel");
  }

  const health2 = await get("/health");
  check("processo vivo apos requests", health2.status === 200, `status=${health2.status}`);

  console.log(`\n== E2E: ${pass} pass, ${fail} fail ==`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log("E2E FATAL:", e.message);
  process.exit(2);
});
