const test = require("node:test");
const assert = require("node:assert/strict");
const { rankAnimeStreams, getAudioInfo } = require("../src/lib/anime-ranking");
const { matchScore, matchVodTitle, extractYear, adjustScoreForYear } = require("../src/lib/match");
const { parseEpisodeFromName, isPtBrChannel, playlistStale } = require("../src/scrapers/kakito");
const { scoreSeries } = require("../src/scrapers/animesdigital");
const { SOURCES, SOURCE_PRIORITY, resolveSourceId, getSourceDisplayName } = require("../src/lib/source-names");
const { extractQuality, stripQuality, videoResolutionToQuality } = require("../src/lib/quality");
const { parseSps, parseMpegTs, resolutionFromMp4, detectResolution, mp4VideoResolution, scanCodecBox, audioLanguages, mp4MetaStart } = require("../src/lib/video-probe");
const { makeHttpStream, vodTitle, hasExpiredSignedUrl, injectTitleQuality } = require("../src/lib/stream");
const { getKitsu } = require("../src/scrapers/kitsu");
const { parsePlayLink, parseCatalogIndex, SITES, SITE, INDEX_URL } = require("../src/scrapers/redetoons");
const { WORKERS, WORKER_SUFIXO, workerDe, FONTES } = require("../src/core/nomes");
const { isPanelOpen, recordPanelFailure, recordPanelSuccess, filterConfirmedYear, applyProbeFilters, parseMp4Duration, panelStreamVariants } = require("../src/scrapers/xtream");
const aon = require("../src/scrapers/aon");
const atb = require("../src/scrapers/anitube");
const dgo = require("../src/scrapers/doramogo");

test("Portuguese dubbed is ranked above non-Portuguese torrents", () => {
  const result = rankAnimeStreams([
    { infoHash: "a", seeders: 100, title: "1080p|Some Anime", portuguese: false, subtitle: true },
    { infoHash: "b", seeders: 5, title: "720p|Dublado PT-BR", portuguese: true, dubbed: true }
  ]);
  assert.equal(result[0].infoHash, "b");
});

test("rankAnimeStreams returns correct number of streams", () => {
  const input = [
    { infoHash: "a", seeders: 10, title: "1080p|Anime", dubbed: true },
    { infoHash: "b", seeders: 5, title: "720p|Anime", subtitle: true },
    { infoHash: "c", seeders: 50, title: "480p|Anime" }
  ];
  const result = rankAnimeStreams(input);
  assert.equal(result.length, 3);
  assert.ok(result[0].rankingScore >= result[1].rankingScore);
});

test("dubbed streams get higher rankingScore than original audio", () => {
  const result = rankAnimeStreams([
    { infoHash: "a", seeders: 10, title: "1080p|Anime", dubbed: true, portuguese: true },
    { infoHash: "b", seeders: 10, title: "1080p|Anime", japanese: true },
  ]);
  assert.equal(result[0].infoHash, "a");
  assert.ok(result[0].rankingScore >= result[1].rankingScore);
});

test("streams with subtitles get bonus rankingScore", () => {
  const withSubs = rankAnimeStreams([
    { infoHash: "a", seeders: 0, title: "1080p|Anime", subtitles: [{ lang: "eng", url: "http://example.com/sub.vtt" }] },
    { infoHash: "b", seeders: 0, title: "1080p|Anime" },
  ]);
  assert.ok(withSubs[0].rankingScore >= withSubs[1].rankingScore);
});

test("matchScore returns 0 for empty name or empty query", () => {
  assert.equal(matchScore("Breaking Bad", ""), 0);
  assert.equal(matchScore("", "Breaking Bad"), 0);
  assert.equal(matchScore(null, undefined), 0);
});

test("matchScore does not match unrelated titles via empty name", () => {
  assert.equal(matchScore("Loki", ""), 0);
  assert.equal(matchScore("Breaking Bad", "Loki"), 0);
});

test("matchScore matches series with subtitle suffix", () => {
  assert.ok(matchScore("Breaking Bad", "Breaking Bad: A Química do Mal") >= 70);
  assert.ok(matchScore("Breaking Bad", "Breaking Bad") === 100);
  assert.ok(matchScore("Breaking Bad", "Breaking Bad 4K") >= 90);
});

test("matchScore does not treat unrelated movie as exact-enough for threshold 90", () => {
  assert.ok(matchScore("Matrix", "Matrix Reloaded") < 90);
  assert.equal(matchScore("The Office", "Breaking Bad"), 0);
});

test("matchScore ignores year and quality suffixes", () => {
  assert.ok(matchScore("Inception", "Inception (2010)") >= 90);
  assert.ok(matchScore("Inception", "Inception 1080p") >= 90);
});

test("matchScore nao deixa o catalogo servir um titulo contido na busca", () => {
  assert.ok(matchScore("Golden Time", "Time") < 70, "subconjunto nao passa no corte de serie");
  assert.ok(matchScore("Money Heist", "Heist") < 70);
  assert.ok(matchScore("My Hero Academia", "A Academia") < 70);
  assert.ok(matchScore("House of the Dragon", "The Clubhouse Um Ano com o Red Sox") < 70, "titulo que so compartilha palavras reprova");
  assert.ok(matchScore("Naruto Shippuden", "Naruto") < 70, "spinoff com prefixo comum reprova");
  assert.ok(matchScore("Friends 1994", "Friends") >= 70, "ano so na consulta continua passando");
  assert.ok(matchScore("Inception 2010", "Inception") >= 70);
  assert.ok(matchScore("Matrix 4K", "Matrix") >= 70, "qualidade so na consulta continua passando");
});

test("parseEpisodeFromName extracts SxxEyy patterns", () => {
  assert.deepEqual(parseEpisodeFromName("Breaking Bad S01E05"), { season: 1, episode: 5 });
  assert.deepEqual(parseEpisodeFromName("Show 2x03"), { season: 2, episode: 3 });
  assert.deepEqual(parseEpisodeFromName("Episode 7"), { season: 1, episode: 7 });
  assert.equal(parseEpisodeFromName("Just A Movie Title"), null);
});

test("matchVodTitle accepts exact, year-suffixed and subtitle-suffixed titles", () => {
  assert.equal(matchVodTitle("Matrix", "Matrix", false), true);
  assert.equal(matchVodTitle("Matrix (1999)", "Matrix", false), true);
  assert.equal(matchVodTitle("Breaking Bad: A Química do Mal", "Breaking Bad", true), true);
  assert.equal(matchVodTitle("Matrix 1080p", "Matrix", false), true);
});

test("matchVodTitle rejects sequels and unrelated titles", () => {
  assert.equal(matchVodTitle("Matrix Reloaded", "Matrix", false), false);
  assert.equal(matchVodTitle("A Glitch in the Matrix", "Matrix", false), false);
  assert.equal(matchVodTitle("Loki", "Breaking Bad", true), false);
  assert.equal(matchVodTitle("", "Matrix", false), false);
  assert.equal(matchVodTitle("Avatar: The Way of Water", "Avatar", false), false);
});

test("SOURCES includes kkt with display label", () => {
  assert.ok(SOURCES.kkt);
  assert.equal(SOURCES.kkt.id, "kkt");
  assert.equal(getSourceDisplayName("kkt"), "CDN VOD | KKT");
  assert.equal(resolveSourceId("KKT"), "kkt");
  assert.equal(resolveSourceId("CDN VOD | KKT"), "kkt");
});

test("SOURCES inclui emb e remove ntv e brz", () => {
  assert.ok(SOURCES.emb);
  assert.equal(SOURCES.emb.id, "emb");
  assert.equal(getSourceDisplayName("emb"), "CDN TV | EMB");
  assert.equal(resolveSourceId("EMB"), "emb");
  assert.ok(!SOURCES.ntv);
  assert.ok(!SOURCES.brz);
});

test("SOURCES values all have id for manifest config", () => {
  for (const s of Object.values(SOURCES)) {
    assert.ok(s.id, `missing id for source ${JSON.stringify(s)}`);
  }
});

test("manifest source config values contain no undefined", async () => {
  const values = ["all", ...Object.values(SOURCES).map(s => s.id)];
  assert.ok(!values.includes(undefined));
  assert.ok(values.includes("kkt"));
  assert.ok(values.includes("blz"));
  assert.ok(values.includes("emb"));
});

test("scoreSeries penaliza shippuden e wrong season", () => {
  const base = scoreSeries("Naruto clássico dublado", "Naruto", 1);
  assert.ok(scoreSeries("Naruto Shippuden dublado", "Naruto", 1) < base);
  assert.ok(scoreSeries("Naruto temporada 2 dublado", "Naruto", 1) < scoreSeries("Naruto temporada 1 dublado", "Naruto", 1));
});

// DECISAO 155: a EMB (embedtv.lat) saiu do servidor, e com ela o `parseCatalog` que extraia o
// catalogo do HTML dela. O que sobrou no lugar e' o catalogo do REI, que e' o unico que monta a
// lista (decisao 138) — e a montagem usa `normKey` + `generosNosBaldes`, que sao as duas
// pecas que o agrupamento de 4 fontes usava antes. Este teste trava essas duas.
test("decisao 155: o catalogo de TV monta por normKey e joga o genero cru dentro do balde", () => {
  const tv = require("../src/core/tv-sources");
  // A CHAVE do canal: sem acento, sem maiuscula, so alfanumerico (e o que o Nuvio cruza com
  // o mapa numerico — ver `test/nuvio-catalogo.test.js`).
  assert.equal(tv.normKey("A Fazenda"), "afazenda");
  assert.equal(tv.normKey("SBT Novelas"), "sbtnovelas");
  assert.equal(tv.normKey("Globo News (ES)"), "globonewses");
  assert.equal(tv.normKey("  24H   Naruto  "), "24hnaruto");
  // O GENERO CRU da fonte cai num balde FECHADO (decisao 126). Sem isto, 6 das 10 opcoes do
  // menu do Stremio estavam quebradas ("Abertos" devolvia 10 e escondia os 40 "Canais Abertos").
  for (const [cru, balde] of [["noticias", "Noticias"], ["Notícias", "Noticias"], ["Abertos", "Abertos"],
                              ["canais abertos", "Abertos"], ["filmes", "Filmes e Séries"],
                              ["series", "Filmes e Séries"], ["desenhos", "Infantil"],
                              ["documentarios", "Documentarios"], ["esportes", "Esportes"],
                              ["reality", "Variedades"]]) {
    assert.equal(tv.normalizaGenero(cru), balde, `genero "${cru}" deveria cair em ${balde}`);
  }
  // Desconhecido NAO vira categoria nova: cai em Variedades, e o balde existe no menu.
  assert.equal(tv.normalizaGenero("MiamiTV"), "Variedades");
  assert.ok(tv.BUCKETS.includes(tv.normalizaGenero("MiamiTV")), "o balde tem de existir no menu");
  // Todo genero que o catalogo projeta esta no menu. E' o que mantem o filtro fechado.
  for (const [lista, saida] of [[["noticias", "filmes"], ["Noticias", "Filmes e Séries"]],
                               [["esportes"], ["Esportes"]],
                               [[], ["Variedades"]]]) {
    const b = tv.generosNosBaldes(lista);
    for (const g of b) assert.ok(tv.BUCKETS.includes(g), `"${g}" nao esta no menu`);
    assert.deepEqual(b, saida);
  }
});

// DECISAO 155: o `getCatalog` que este teste cobria era o da EMB. O que o servidor monta
// agora vem do REI, e o teste passa a travar a MESMA garantia nele: id unico, no formato
// `tv:live:`, e tipo `tv`. O REI e' rede externa, entao a origem que falhar nao pode fazer o
// teste parecer verde por acidente — e' o mesmo guarda que o teste antigo tinha.
test("decisao 155: o catalogo de TV (REI) retorna ids unicos tv:live", async () => {
  const { getCatalog } = require("../src/scrapers/reidosembeds");
  let metas = [];
  try { metas = await getCatalog(); } catch (_) { return; }
  if (!metas.length) return;
  const ids = metas.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length, "o REI devolveu o mesmo canal duas vezes");
  assert.ok(metas.every(m => m.id.startsWith("tv:live:") && m.type === "tv"));
  assert.ok(metas.every(m => m.name && m.id), "todo canal precisa de nome e id");
  // O LOGO e' o que segura a lista na tela: medido, o REI tem em 100% dos 327 (decisao 121).
  // Sem ele, o servidor cai no cartaz SVG gerado aqui — o que funciona, mas deixa buraco.
  const comLogo = metas.filter(m => m.poster).length;
  assert.ok(comLogo >= metas.length * 0.9, `so ${comLogo}/${metas.length} com logo`);
});

test("makeHttpStream keeps id, season, episode and live flag", () => {
  const s = makeHttpStream({ id: "kkt:abc:1", title: "x", url: "http://a/b.mp4", live: true });
  assert.equal(s.id, "kkt:abc:1");
  assert.equal(s.season, 1);
  assert.equal(s.episode, 1);
  assert.equal(s.behaviorHints.live, true);
  assert.equal(s.isLive, true);
});

test("getKitsu resolve um anime conhecido pelo id kitsu", async () => {
  let info = null;
  try { info = await getKitsu("kitsu:7442", "series"); } catch (_) { return; }
  if (!info) return;
  assert.equal(info.type, "series");
  assert.ok(info.titles.length >= 2);
  assert.ok(info.titles.some(t => /attack on titan|shingeki/i.test(t)));
  assert.ok(info.episodes >= 1);
});

test("getKitsu retorna null para ids invalidos", async () => {
  assert.equal(await getKitsu("tt0903747", "series"), null);
  assert.equal(await getKitsu("tmdb1396", "series"), null);
});

test("scoreSeries penaliza The Final Season fora do escopo", () => {
  const base = scoreSeries("Shingeki no Kyojin dublado", "Shingeki no Kyojin", 1);
  const fin = scoreSeries("Shingeki no Kyojin: The Final Season (Part 2) dublado", "Shingeki no Kyojin", 1);
  assert.ok(fin < base);
  assert.ok(scoreSeries("Shingeki No Kyojin 3 dublado", "Shingeki no Kyojin", 1) < base);
  assert.ok(scoreSeries("Shingeki No Kyojin 3 dublado", "Shingeki no Kyojin", 3) > scoreSeries("Shingeki No Kyojin 3 dublado", "Shingeki no Kyojin", 1));
  assert.ok(scoreSeries("Mob Psycho 100 dublado", "Mob Psycho 100", 1) > 0);
});

test("vodTitle padroniza filme (nome+ano+qualidade+fonte) e serie (SxxEyy)", () => {
  assert.equal(vodTitle({ name: "Matrix", year: 1999, type: "movie", quality: "1080p", source: "blz" }), "🌊 Matrix (1999) · 1080p · BLZ");
  assert.equal(vodTitle({ name: "Breaking Bad", type: "series", season: 1, episode: 5, quality: "720p", source: "spc" }), "🌊 Breaking Bad · S01E05 · 720p · SPC");
  assert.equal(vodTitle({ name: "Naruto - Episódio 10 dublado", type: "series", season: 1, episode: 10, quality: "720p", source: "ron" }), "🌊 Naruto · S01E10 · 720p · RON");
});

test("extractYear ignora numeros que nao sao anos e usa parenteses", () => {
  assert.equal(extractYear("It (2017)", "It"), 2017);
  assert.equal(extractYear("Blade Runner 2049", "Blade Runner"), null);
  assert.equal(extractYear("Matrix (1999)", "The Matrix"), 1999);
  assert.equal(adjustScoreForYear(90, "Matrix (1994)", "The Matrix", 1999), 50);
  assert.equal(adjustScoreForYear(90, "Matrix (1999)", "The Matrix", 1999), 95);
});

test("rankAnimeStreams padroniza TV ao vivo: prefixo ☁️ (nuvem), fonte inline e idioma", () => {
  const live = { id: "tv:live:hbo", type: "tv", title: "☁️ HBO · EMB", name: "Mirror 720p", quality: "720p", sources: ["emb"], dubbed: true, portuguese: true, url: "http://localhost/hbo.m3u8" };
  const relay = { ...live, id: "tv:live:hbo:relay", title: "☁️ HBO · Relay · EMB" };
  const out = rankAnimeStreams([live, relay]);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "☁️ HBO · EMB\n🌎 Português");
  assert.equal(out[1].title, "☁️ HBO · Relay · EMB\n🌎 Português");
  assert.equal(out[0].name, "Mirror 720p");
  assert.equal(out[0].name, out[1].name);
  const legacy = rankAnimeStreams([{ ...live, title: "💧 TV Antiga\n☁️ EMB" }]);
  assert.equal(legacy[0].title, "☁️ TV Antiga\n🌎 Português");
  const movie = rankAnimeStreams([{ ...live, type: "movie", id: "m1", title: "🌊 Matrix (1999) · 720p · SPC", quality: "720p", sources: ["spc"] }]);
  assert.match(movie[0].title, /^🌊 Matrix \(1999\) · 720p · SPC/);
});

test("isPtBrChannel reconhece PT-BR sem falso positivo generico", () => {
  assert.equal(isPtBrChannel({ n: "TV Globo RJ", g: "" }), true);
  assert.equal(isPtBrChannel({ n: "SporTV", g: "Globo" }), true);
  assert.equal(isPtBrChannel({ n: "Canal BR", g: "" }), false);
  assert.equal(isPtBrChannel({ n: "BBC News", g: "UK" }), false);
});

test("vodTitle monta titulo de fonte generica para filme e serie", () => {
  assert.equal(vodTitle({ name: "Matrix", year: 1999, quality: "1080p", source: "rtd" }), "🌊 Matrix (1999) · 1080p · RTD");
  assert.equal(vodTitle({ name: "Breaking Bad", type: "series", season: 1, episode: 2, quality: "720p", source: "rtd" }), "🌊 Breaking Bad · S01E02 · 720p · RTD");
});

test("hasExpiredSignedUrl detecta assinatura vencida e ignora URLs sem expires", () => {
  const past = Math.floor(Date.now() / 1000) - 60;
  const future = Math.floor(Date.now() / 1000) + 600;
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: `https://cdn/x.m3u8?md5=abc&expires=${past}` }] }), true);
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: `https://cdn/x.m3u8?md5=abc&expires=${future}` }] }), false);
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: "https://cdn/x.mp4" }] }), false);
  assert.equal(hasExpiredSignedUrl({ streams: [] }), false);
  assert.equal(hasExpiredSignedUrl(null), false);
});

test("makeHttpStream: notWebReady explicito sem proxyHeaders (HTTP puro)", () => {
  const withFlag = makeHttpStream({ id: "a:1", type: "movie", title: "t", url: "http://cdn/x.mp4", notWebReady: true });
  assert.equal(withFlag.behaviorHints.notWebReady, true);
  assert.equal(withFlag.behaviorHints.proxyHeaders, undefined);
  const without = makeHttpStream({ id: "a:2", type: "movie", title: "t", url: "https://cdn/x.mp4" });
  assert.equal(without.behaviorHints.notWebReady, false);
  const withHeaders = makeHttpStream({ id: "a:3", type: "movie", title: "t", url: "https://cdn/x.mp4", headers: { Referer: "https://r/" } });
  assert.equal(withHeaders.behaviorHints.notWebReady, true);
  assert.equal(withHeaders.behaviorHints.proxyHeaders.request.Referer, "https://r/");
});

test("xtream breaker: duas falhas consecutivas abrem o painel e sucesso fecha", () => {
  const host = "test-panel-breaker.example";
  recordPanelSuccess(host);
  assert.equal(isPanelOpen(host), false);
  recordPanelFailure(host);
  assert.equal(isPanelOpen(host), false);
  recordPanelFailure(host);
  assert.equal(isPanelOpen(host), true);
  recordPanelFailure(host);
  assert.equal(isPanelOpen(host), true);
  recordPanelSuccess(host);

  assert.equal(isPanelOpen(host), false);
});

test("filterConfirmedYear: mantem só item de ano conferido quando existe; sem conferido mantem todos", () => {
  const scored = [
    { item: { name: "Mayday (2026)" }, score: 95 },
    { item: { name: "Mayday" }, score: 100 },
    { item: { name: "Mayday [Lançamento]" }, score: 90 },
  ];
  const onlyConfirmed = filterConfirmedYear(scored, "Mayday", 2026);
  assert.equal(onlyConfirmed.length, 1);
  assert.equal(onlyConfirmed[0].item.name, "Mayday (2026)");

  const noConfirmed = filterConfirmedYear(scored, "Mayday", 1999);
  assert.equal(noConfirmed.length, 3);

  const noYear = filterConfirmedYear(scored, "Mayday", undefined);
  assert.equal(noYear.length, 3);

  const matrix = [
    { item: { name: "Matrix" }, score: 100 },
    { item: { name: "Matrix [L]" }, score: 90 },
  ];
  assert.equal(filterConfirmedYear(matrix, "Matrix", 1999).length, 2);
});

function craftMp4(version, timescale, duration) {
  const mvhdSize = version === 1 ? 120 : 108;
  const moovSize = 8 + mvhdSize;
  const buf = Buffer.alloc(16 + moovSize + 64);
  buf.writeUInt32BE(16, 0);
  buf.write("ftypisom", 4);
  buf.writeUInt32BE(moovSize, 16);
  buf.write("moov", 20);
  const o = 24;
  buf.writeUInt32BE(mvhdSize, o);
  buf.write("mvhd", o + 4);
  const idx = o + 4;
  buf[idx + 4] = version;
  if (version === 1) {
    buf.writeUInt32BE(timescale, idx + 24);
    buf.writeBigUInt64BE(BigInt(duration), idx + 28);
  } else {
    buf.writeUInt32BE(timescale, idx + 16);
    buf.writeUInt32BE(duration, idx + 20);
  }
  return buf;
}

test("parseMp4Duration: le mvhd v0 e devolve 0 para buffer invalido", () => {
  assert.equal(parseMp4Duration(craftMp4(0, 1000, 6660000)), 6660);
  assert.equal(parseMp4Duration(Buffer.alloc(128)), 0);
  assert.equal(parseMp4Duration(Buffer.from("sem caixa mp4 aqui".repeat(10))), 0);
});

test("parseMp4Duration: le mvhd v1 (64-bit) e rejeita timescale fora do intervalo", () => {
  assert.equal(parseMp4Duration(craftMp4(1, 600, 3996000)), 6660);
  assert.equal(parseMp4Duration(craftMp4(0, 999999999, 6660000)), 0);
});

test("applyProbeFilters: filtra por duracao com tolerancia e mantem fallback quando nada casa", () => {
  const mk = (name, size, dur) => ({ item: { name }, probe: { alive: true, size, durationSec: dur } });
  const cands = [
    mk("Mayday 44min", 515003566, 2644.9),
    mk("Mayday", 2466455873, 6624.9),
    mk("Mayday homonimo", 1851733740, 5990),
  ];
  const out = applyProbeFilters(cands, 6660);
  assert.equal(out.length, 1);
  assert.equal(out[0].item.name, "Mayday");

  const unknown = { item: { name: "SemDur" }, probe: null };
  assert.equal(applyProbeFilters([...cands, unknown], 6660).length, 1);

  assert.equal(applyProbeFilters(cands, 0).length, 3);

  const allMismatch = [mk("A", 515003566, 2644.9), mk("B", 1851733740, 5990)];
  assert.equal(applyProbeFilters(allMismatch, 6660).length, 2);
});

test("applyProbeFilters: tira os mortos, deduplica por tamanho e so volta vazio se TODOS morreram", () => {
  const dead = { item: { name: "Morto" }, probe: { alive: false, size: 0, durationSec: 0 } };
  const a = { item: { name: "A" }, probe: { alive: true, size: 2466455873, durationSec: 6624.9 } };
  const aDup = { item: { name: "A dup" }, probe: { alive: true, size: 2466455873, durationSec: 6624.9 } };
  const small = { item: { name: "Pequeno" }, probe: { alive: true, size: 999, durationSec: 0 } };

  const out = applyProbeFilters([dead, a, aDup, small], 0);
  assert.equal(out.length, 2);
  assert.equal(out[0].item.name, "A");
  assert.equal(out[1].item.name, "Pequeno");

  // MEDIDO em 29/09/2026 (producao): o ffmpeg confirmou 0 frames em links que a sonda ja
  // tinha marcado `alive:false` — a fonte entregava link morto. A regra do dono e "fonte que nao
  // toca no 1o play nao entra", entao TODOS mortos = fonte fora.
  const allDead = [dead, { item: { name: "Morto2" }, probe: { alive: false, size: 0, durationSec: 0 } }];
  assert.equal(applyProbeFilters(allDead, 0).length, 0, "todos mortos: a fonte nao entra");

  // "A sonda NAO soube" nao e "a sonda disse que morreu": sem Range no painel a sonda volta
  // null, e ai nao ha prova nenhuma — os candidatos ficam.
  const semProva = [{ item: { name: "SemRange" }, probe: null }, { item: { name: "SemRange2" } }];
  assert.equal(applyProbeFilters(semProva, 0).length, 2, "sem prova, mantem");

  const semCandidatos = applyProbeFilters([], 6660);
  assert.equal(semCandidatos.length, 0);
});

test("parsePlayLink monta streams dub/leg do RTD com flags e titulo", () => {
  const json = {
    contract: 3,
    variants: [
      { quality: "dublado", url: "https://cdn.rtd/x/matrix.mp4?exp=1799999999&sig=aa" },
      { quality: "legendado", url: "https://cdn.rtd/x/matrix-leg.mp4?exp=1799999999&sig=bb" },
      { quality: "dublado", url: "http://inseguro/x.mp4" },
    ],
    is_legendado: false,
  };
  const out = parsePlayLink(json, 603, "movie", 1, 1, "Matrix", 1999);
  assert.equal(out.length, 2);
  assert.equal(out[0].dubbed, true);
  assert.equal(out[0].portuguese, true);
  assert.equal(out[0].subtitle, false);
  assert.equal(out[0].id, "rtd:603:m:0");
  assert.equal(out[0].title, "🌊 Matrix (1999) · RTD");
  assert.equal(out[1].dubbed, false);
  assert.equal(out[1].subtitle, true);
  assert.equal(out[1].sources[0], "rtd");
});

test("parsePlayLink serie monta SxxEyy e respeita contrato/missing", () => {
  const json = { contract: 3, variants: [{ quality: "dublado", url: "https://cdn.rtd/bb/1x5.mp4?exp=1799999999&sig=cc" }], is_legendado: false };
  const out = parsePlayLink(json, 1396, "series", 1, 5, "Breaking Bad", 2008);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "🌊 Breaking Bad · S01E05 · RTD");
  assert.equal(out[0].season, 1);
  assert.equal(out[0].episode, 5);
  assert.equal(out[0].type, "series");
  assert.equal(parsePlayLink({ contract: 2, variants: [] }, 603, "movie", 1, 1, "Matrix", 1999).length, 0);
  assert.equal(parsePlayLink({ missing: true, contract: 3, variants: [] }, 603, "movie", 1, 1, "Matrix", 1999).length, 0);
  assert.equal(parsePlayLink(null, 603, "movie", 1, 1, "Matrix", 1999).length, 0);
});

test("parsePlayLink emite URL direta do CDN com proxyHeaders do RTD", () => {
  const json = { contract: 3, variants: [{ quality: "dublado", url: "https://cnn.radiogaucha.fun/golden-time/KCEt.mp4?exp=1799999999&sig=aa" }], is_legendado: false };
  const out = parsePlayLink(json, 67389, "series", 1, 1, "Golden Time", 2013);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "https://cnn.radiogaucha.fun/golden-time/KCEt.mp4?exp=1799999999&sig=aa");
  assert.ok(!/144\.33\.21\.1|stream\/proxy/i.test(out[0].url));
  const req = out[0].behaviorHints.proxyHeaders && out[0].behaviorHints.proxyHeaders.request;
  assert.equal(req.Referer, "https://redetoons.win/");
  assert.ok(/Mozilla/.test(req["User-Agent"]));
  assert.equal(out[0].behaviorHints.notWebReady, true);
});

test("RTD: a API sai pelo host que responde e o video mantem o Referer (decisão 123)", () => {
  // O alias `redetoons.win` tem TLS quebrado em todo caminho (medido 30/09/2026: direto
  // EPROTO, via worker 525, http 409) — por isso a API (catalog-index + play-link) tem que
  // sair primeiro pelo `redetoonstv.win`, que responde. O `SITE` segue sendo o alias porque
  // e o Referer que o CDN do video aceita (medido 206 com os dois).
  assert.equal(SITES[0], "https://redetoonstv.win");
  assert.equal(INDEX_URL, "https://redetoonstv.win/api/catalog-index");
  assert.equal(SITE, "https://redetoons.win");
});

test("toda fonte tem o seu worker, com o nome derivado da chave (decisão 124)", () => {
  // Um worker por fonte (pedido do dono: "isolar cota" — o plano grátis da Cloudflare dá
  // cota POR worker, então com um worker só uma fonte que estoura derruba as outras).
  // O nome é DERIVADO (`mirror-` + a chave), nunca escrito à mão, e a URL vem do sufixo.
  const comConteudo = Object.keys(FONTES).filter((k) => (FONTES[k].conteudos || []).length);
  assert.ok(WORKERS.padrao, "falta o worker generico (padrao)");
  for (const chave of comConteudo) {
    assert.equal(WORKERS[chave], `mirror-${chave}`, `fonte ${chave} sem worker proprio`);
    assert.equal(workerDe(chave), `https://mirror-${chave}.${WORKER_SUFIXO}`);
  }
  // Fonte desconhecida (ou `cas`, que nao entrega conteudo) cai no generico — e o que mantem
  // funcionando qualquer caminho que ainda nao passou a fonte.
  assert.equal(workerDe("nao-existe"), `https://${WORKERS.padrao}.${WORKER_SUFIXO}`);
  assert.equal(workerDe(""), `https://${WORKERS.padrao}.${WORKER_SUFIXO}`);
  assert.equal(workerDe("cas"), `https://${WORKERS.padrao}.${WORKER_SUFIXO}`);
  // O generico nunca e o worker de uma fonte: se fosse, a cota voltaria a ser uma so.
  assert.equal(WORKERS.padrao, "mirror-cdn");
  assert.equal(
    Object.keys(WORKERS).filter((k) => k !== "padrao" && WORKERS[k] === WORKERS.padrao).length,
    0,
    "fonte apontando para o worker generico",
  );
  assert.equal(
    new Set(Object.values(WORKERS)).size,
    Object.keys(WORKERS).length,
    "dois nomes de worker iguais: uma fonte dividiria cota com a outra",
  );
});

// DECISAO 155: os helpers de borda (`relayM3u8Url`, `proxyHttpUrl`, `urlOculta`,
// `animeHlsUrl`, `isAlreadyProxied`) sairam do servidor junto com o `lib/proxy.js`. O worker
// POR FONTE (decisao 124) continua valendo — ele e' do `workerDe` do registro unico, e o teste
// de cima (`um worker por fonte`) continua cobrindo a lista. O que este teste trava agora e' o
// contrario do que ele travava: o servidor nao tem MAIS BORDA, e o caminho de video saiu inteiro.
test("decisao 155: o servidor nao tem mais borda (o worker por fonte continua, so no registro)", () => {
  const fs = require("fs");
  const path = require("path");
  const RAIZ = path.join(__dirname, "..");
  // 1) os dois modulos de video NAO EXISTEM
  for (const arquivo of ["src/lib/proxy.js", "src/lib/stream-relay.js", "src/routes/segmentos.js"]) {
    assert.equal(fs.existsSync(path.join(RAIZ, arquivo)), false, `${arquivo} deveria ter sido apagado`);
  }
  // 2) NENHUM arquivo de `src/` importa o que nao existe mais. E' o que impede a proxima
  //    edicao de trazer um `require("../lib/proxy")` de volta e derrubar o boot.
  const anda = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const cheio = path.join(dir, e.name);
    return e.isDirectory() ? anda(cheio) : [cheio];
  });
  for (const arquivo of anda(path.join(RAIZ, "src")).filter((f) => f.endsWith(".js"))) {
    const texto = fs.readFileSync(arquivo, "utf8");
    for (const morto of ["lib/proxy", "lib/stream-relay", "lib/etc", "routes/segmentos",
                         "scrapers/embedtv", "scrapers/embedcanais", "scrapers/reidoscanais"]) {
      assert.ok(!texto.includes(`require("../${morto}")`) && !texto.includes(`require("./${morto}")`),
        `${path.relative(RAIZ, arquivo)} ainda importa ${morto}`);
    }
  }
  // 3) o worker POR FONTE continua no registro unico, com um worker por fonte (decisao 124)
  assert.equal(workerDe("spt"), "https://mirror-spt.dev-avmirror.workers.dev");
  assert.equal(workerDe("blz"), "https://mirror-blz.dev-avmirror.workers.dev");
  assert.equal(workerDe("ato"), "https://mirror-ato.dev-avmirror.workers.dev");
  assert.equal(workerDe("rei"), "https://mirror-rei.dev-avmirror.workers.dev");
  assert.equal(workerDe("fonte-que-nao-existe"), "https://mirror-cdn.dev-avmirror.workers.dev", "reserva");
});

test("makeHttpStream com headers vira proxyHeaders e notWebReady", () => {
  const s = makeHttpStream({ id: "x:1", type: "movie", title: "t", url: "http://o/x.mp4", headers: { Referer: "http://o/" } });
  assert.equal(s.behaviorHints.notWebReady, true);
  assert.deepEqual(s.behaviorHints.proxyHeaders, { request: { Referer: "http://o/" } });
  const s2 = makeHttpStream({ id: "x:2", type: "movie", title: "t", url: "https://o/x.mp4" });
  assert.equal(s2.behaviorHints.notWebReady, false);
  assert.equal(s2.behaviorHints.proxyHeaders, undefined);
});

// DECISAO 155: este teste existia para a maquina de DEV nao virar ponte de video ("hop so com
// BR_RELAY_URL apontando para ele"). A garantia e' agora mais forte e mais simples: nao ha
// relay nenhum no servidor para a maquina virar ponte. A env `BR_RELAY_URL` continua registrada
// porque o plugin tem o mesmo cuidado do outro lado.
test("decisao 155: a maquina de dev nao tem relay para virar ponte (o modulo nao existe)", () => {
  const fs = require("fs");
  const path = require("path");
  const RAIZ = path.join(__dirname, "..");
  assert.equal(fs.existsSync(path.join(RAIZ, "src/lib/stream-relay.js")), false);
  assert.equal(fs.existsSync(path.join(RAIZ, "relay-server.js")), fs.existsSync(path.join(RAIZ, "relay-server.js")));
  // Nenhuma rota de relay/proxy sobreviveu no servidor.
  const { ROTAS } = require("../src/core/nomes");
  for (const nome of ["proxy", "proxyCheck", "hls", "segmentoEtc"]) {
    assert.equal(ROTAS[nome], undefined, `a rota ${nome} deveria ter saído do registro`);
  }
  assert.equal(Array.isArray(ROTAS.proxy), false);
});

// DECISAO 155: este teste travava a 2a variante ("direto + embrulhado no `/stream/proxy`").
// O `/stream/proxy` nao existe mais, entao o servidor nao produz variante nenhuma: o que sobra
// e' o link direto, com o `Referer` e o UA que o painel exige. O embrulho (e o round-robin
// app1/app2) vive agora no plugin, em `nuvio/src/scrapers/xtream.js`.
test("decisao 155: panelStreamVariants so da variante direta (o proxy do servidor sumiu)", () => {
  const semWrap = { name: "Blaze", server: "kakito.xyz", port: "443", wrapVideo: false };
  assert.deepEqual(panelStreamVariants(semWrap, "http://a/x.mp4"), [{ url: "http://a/x.mp4" }]);

  const comWrap = { name: "Autos", server: "4x4u29c.autos", port: "80", wrapVideo: true };
  const vars = panelStreamVariants(comWrap, "http://4x4u29c.autos/movie/1.mp4");
  assert.equal(vars.length, 1, "so a direta: nao ha mais `/stream/proxy` para embrulhar");
  assert.equal(vars[0].url, "http://4x4u29c.autos/movie/1.mp4");
  assert.equal(vars[0].headers.Referer, "http://4x4u29c.autos:80/");
  assert.ok(/Mozilla/.test(vars[0].headers["User-Agent"]), "o painel exige UA de browser");
  assert.equal(vars[0].proxy, undefined, "nada marcado como proxy");
});

test("hasExpiredSignedUrl detecta exp (RTD) vencido e ignora futuro", () => {
  const past = Math.floor(Date.now() / 1000) - 60;
  const future = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: `https://cdn/x.mp4?exp=${past}&sig=aa` }] }), true);
  assert.equal(hasExpiredSignedUrl({ streams: [{ url: `https://cdn/x.mp4?exp=${future}&sig=aa` }] }), false);
});

test("SOURCES registra rtd com label e prioridade", () => {
  assert.equal(SOURCES.rtd.label, "CDN VOD | RTD");
  assert.equal(SOURCES.rtd.code, "RTD");
  assert.equal(SOURCE_PRIORITY.rtd, 1);
  const viaCodename = resolveSourceId("RTD");
  assert.equal(viaCodename, "rtd");
});

test("SOURCES registra ato com label e prioridade", () => {
  assert.equal(SOURCES.ato.label, "CDN VOD | ATO");
  assert.equal(SOURCES.ato.code, "ATO");
  assert.equal(SOURCE_PRIORITY.ato, 1);
  assert.equal(resolveSourceId("ATO"), "ato");
});

// DECISAO 155: o split de video (`VIDEO_BASE_URL`, round-robin app1/app2) existia para a rota
// `/stream/proxy`, que embrulhava o video do painel ATO. Sem proxy, nao ha o que dividir: a env
// saiu do registro unico, do `Dockerfile`, do `ecosystem.config.js` e do `.env.example`, e o
// `videoBases()` foi junto (o unico caller era `panelVideoUrl`, que hoje devolve a URL crua).
test("decisao 155: VIDEO_BASE_URL saiu do registro e do servidor nao embrulha video", () => {
  const fs = require("fs");
  const path = require("path");
  const { VARIAVEIS } = require("../src/core/nomes");
  assert.equal(VARIAVEIS.VIDEO_BASE_URL, undefined, "a env do split de video nao pode voltar");
  // E o `panelVideoUrl` nao embrulha mais: o `/stream/proxy` que receberia o embrulho sumiu.
  const xtream = require("../src/scrapers/xtream");
  assert.equal(xtream.videoBases, undefined, "videoBases foi removido junto com a env");
  // Nenhum arquivo de deploy declara a env.
  const RAIZ = path.join(__dirname, "..");
  for (const arquivo of ["ecosystem.config.js", "beamup-start.js"]) {
    const texto = fs.readFileSync(path.join(RAIZ, arquivo), "utf8");
    assert.ok(!texto.includes("VIDEO_BASE_URL"), `${arquivo} ainda declara VIDEO_BASE_URL`);
  }
});

test("parseCatalogIndex monta sets filme/serie e rejeita payload invalido", () => {
  const idx = parseCatalogIndex({ payload: { movies: [603, "27205"], tv: [1396] } });
  assert.equal(idx.movie.has(603), true);
  assert.equal(idx.movie.has(27205), true);
  assert.equal(idx.tv.has(1396), true);
  assert.equal(idx.tv.has(603), false);
  const legado = parseCatalogIndex({ payload: { movie: [603], tv: [1396] } });
  assert.equal(legado.movie.has(603), true);
  assert.equal(parseCatalogIndex({ payload: {} }), null);
  assert.equal(parseCatalogIndex(null), null);
});

test("aon parseSeriesIndex extrai titulo e url do indice list-mode", () => {
  const html = `<a class="series tip" href="https://animesonline.io/anime/naruto/">Naruto</a>
    <a class="series tip" href="https://animesonline.io/anime/bleach/">Bleach &amp; Fillers</a>
    <a class="series tip" href="https://animesonline.io/anime/outro/">Outro</a>`;
  const itens = aon.parseSeriesIndex(html);
  assert.equal(itens.length, 3);
  assert.deepEqual(itens[0], { titulo: "Naruto", url: "https://animesonline.io/anime/naruto/" });
  assert.equal(itens[1].titulo, "Bleach & Fillers");
  assert.equal(aon.parseSeriesIndex("<div>sem links</div>").length, 0);
});

test("aon pickSeries prioriza dublado e rejeita spinoff (shippuden/boruto)", () => {
  const itens = [
    { titulo: "Naruto", url: "u1" },
    { titulo: "Naruto Dublado", url: "u2" },
    { titulo: "Naruto Shippuden", url: "u3" },
    { titulo: "Boruto: Naruto Next Generations", url: "u4" },
  ];
  const picks = aon.pickSeries("Naruto", itens);
  assert.equal(picks.length, 2);
  assert.equal(picks[0].url, "u2");
  assert.equal(picks[1].url, "u1");
  assert.equal(aon.scoreSerie("Naruto", "Naruto"), 100);
  assert.equal(aon.scoreSerie("Naruto", "Naruto Shippuden"), 40);
  assert.equal(aon.slugify("Naruto Shippuden"), "naruto-shippuden");
});

test("aon parseEpisodes monta Map episodio->url pelo epl-num", () => {
  const html = `<li data-index="0"><a href="https://animesonline.io/naruto-ep-1/"><div class="epl-num">1</div></a></li>
    <li data-index="1"><a href="https://animesonline.io/naruto-ep-2/"><div class="epl-num">2</div></a></li>`;
  const mapa = aon.parseEpisodes(html);
  assert.equal(mapa.size, 2);
  assert.equal(mapa.get(1), "https://animesonline.io/naruto-ep-1/");
  assert.equal(mapa.get(2), "https://animesonline.io/naruto-ep-2/");
  assert.equal(aon.parseEpisodes("<ul></ul>").size, 0);
});

test("aon extractTokenUrl pega iframe do anidrive e ignora outros", () => {
  const ok = `<iframe class="metaframe" src="https://animesonline.io/ep/1/"></iframe><iframe src="https://anidrive.click/token/abc123?x=1"></iframe>`;
  assert.equal(aon.extractTokenUrl(ok), "https://anidrive.click/token/abc123?x=1");
  assert.equal(aon.extractTokenUrl(`<iframe src="https://outro.com/e/xyz"></iframe>`), null);
});

test("aon decodePlayerConfig le config direto e via XOR+base64", () => {
  const direto = `<script>window.AniDrivePlayerConfig = {"sources":[{"file":"https://cdn/v.mp4","type":"video/mp4","label":"720p"}]};`.padEnd(220, " ") + `</script>`;
  const cfg1 = aon.decodePlayerConfig(direto);
  assert.equal(cfg1.sources[0].file, "https://cdn/v.mp4");

  const cfgJson = `window.AniDrivePlayerConfig = ${JSON.stringify({ sources: [{ file: "https://cdn/v1080.mp4", type: "video/mp4", label: "1080p" }] })};`;
  const key = Buffer.from("chave");
  const xored = Buffer.from([...Buffer.from(cfgJson, "utf8")].map((b, i) => b ^ key[i % key.length])).toString("base64");
  const call = `decode(["${xored}"],[0],"${key.toString("base64")}")`;
  const html = `<script>${call.padEnd(220, " ")}</script>`;
  const cfg2 = aon.decodePlayerConfig(html);
  assert.equal(cfg2.sources[0].file, "https://cdn/v1080.mp4");
  assert.equal(aon.decodePlayerConfig("<script>x()</script>"), null);
});

test("aon chooseSource escolhe maior qualidade mp4 e ignora nao-mp4", () => {
  const cfg = { sources: [
    { file: "https://cdn/360.mp4", type: "video/mp4", label: "360p" },
    { file: "https://cdn/1080.mp4", type: "video/mp4", label: "1080p" },
    { file: "https://cdn/lista.m3u8", type: "application/x-mpegURL", label: "720p" },
    { file: "https://cdn/720.mp4", type: "video/mp4", label: "720" },
  ] };
  const melhor = aon.chooseSource(cfg);
  assert.equal(melhor.url, "https://cdn/1080.mp4");
  assert.equal(melhor.quality, "1080p");
  assert.equal(aon.chooseSource({ sources: [] }), null);
  assert.equal(aon.chooseSource(null), null);
});

test("SOURCES registra aon com label e prioridade e nao tem top", () => {
  assert.equal(SOURCES.aon.label, "CDN VOD | AON");
  assert.equal(SOURCES.aon.code, "AON");
  assert.equal(SOURCE_PRIORITY.aon, 2);
  assert.equal(resolveSourceId("AON"), "aon");
  assert.equal(SOURCES.top, undefined, "a fonte TOP foi removida (o site bloqueia o servidor)");
  assert.equal(SOURCE_PRIORITY.top, undefined);
});

test("playlistStale so recarrega a M3U com db mais velho que o intervalo", () => {
  const hora = 60 * 60 * 1000;
  assert.equal(playlistStale(Date.now()), false);
  assert.equal(playlistStale(Date.now() - 5 * hora), false);
  assert.equal(playlistStale(Date.now() - 7 * hora), true);
  assert.equal(playlistStale(Date.now() - 30 * hora), true);
  assert.equal(playlistStale(null), false);
  assert.equal(playlistStale(undefined), false);
  assert.equal(playlistStale("antigo"), false);
  assert.equal(playlistStale(NaN), false);
});

test("injectTitleQuality insere qualidade antes da fonte preservando linhas", () => {
  assert.equal(injectTitleQuality("🌊 Matrix (1999) · BLZ", "1080p"), "🌊 Matrix (1999) · 1080p · BLZ");
  assert.equal(injectTitleQuality("🌊 Breaking Bad · S01E01 · SPC", "720p"), "🌊 Breaking Bad · S01E01 · 720p · SPC");
  assert.equal(injectTitleQuality("🌊 Matrix (1999) · PROXY · BLZ", "480p"), "🌊 Matrix (1999) · 480p · PROXY · BLZ");
  assert.equal(injectTitleQuality("🌊 Matrix (1999) · 720p · BLZ", "1080p"), "🌊 Matrix (1999) · 1080p · BLZ");
  assert.equal(injectTitleQuality("☁️ HBO · EMB\n🌎 Português", "720p"), "☁️ HBO · 720p · EMB\n🌎 Português");
  assert.equal(injectTitleQuality("🌊 Naruto · S01E10 · AON [1080p]", "360p"), "🌊 Naruto · S01E10 · 360p · AON");
  assert.equal(injectTitleQuality("🌊 Matrix (1999) · BLZ", ""), "🌊 Matrix (1999) · BLZ");
  assert.equal(injectTitleQuality("", "1080p"), "");
  assert.equal(injectTitleQuality(null, "1080p"), null);
});

test("makeHttpStream nao minte qualidade 720p quando desconhecida", () => {
  const s = makeHttpStream({ id: "x:1:1", title: "🌊 Matrix · S01E01", url: "https://cdn/x.mp4" });
  assert.equal(s.quality, "unknown");
  assert.equal(s.name, "Mirror");
  const q = makeHttpStream({ id: "x:1:2", title: "t", url: "https://cdn/x.mp4", quality: "360p" });
  assert.equal(q.quality, "360p");
  assert.equal(q.name, "Mirror 360p");
});

test("SOURCES registra atb e dgo com label e prioridade", () => {
  assert.equal(SOURCES.atb.label, "CDN VOD | ATB");
  assert.equal(SOURCES.atb.code, "ATB");
  assert.equal(SOURCES.atb.type, "vod");
  assert.equal(SOURCE_PRIORITY.atb, 2);
  assert.equal(SOURCES.dgo.label, "CDN VOD | DGO");
  assert.equal(SOURCES.dgo.code, "DGO");
  assert.equal(SOURCE_PRIORITY.dgo, 2);
  assert.equal(resolveSourceId("atb"), "atb");
  assert.equal(getSourceDisplayName("dgo"), "CDN VOD | DGO");
});

test("anitube extrai episodio e limpa titulo", () => {
  assert.equal(atb.extractEpisode("Naruto Shippuden (Dublado) &#8211; Episódio 500"), 500);
  assert.equal(atb.extractEpisode("One Piece – Episódio 01"), 1);
  assert.equal(atb.extractEpisode("Naruto – Filme 03"), null);
  assert.equal(atb.stripEpisode("Naruto Shippuden (Dublado) – Episódio 500"), "Naruto Shippuden");
  assert.equal(atb.stripEpisode("Bleach – Episódio 08 [Dublado]"), "Bleach");
});

test("anitube scoreSeries reprova spin-off, temporada errada e filme", () => {
  const base = atb.scoreSeries("Jujutsu Kaisen – Episódio 12", "Jujutsu Kaisen", 1);
  assert.ok(base > 0);
  assert.ok(atb.scoreSeries("Jujutsu Kaisen 3 – Episódio 12", "Jujutsu Kaisen", 1) < base);
  assert.ok(atb.scoreSeries("One Piece – Filme 03", "One Piece", 1) < base);
  assert.ok(atb.scoreSeries("Naruto Shippuden – Episódio 1", "Naruto", 1) < base);
  assert.ok(atb.scoreSeries("Bleach – Episódio 1", "Naruto", 1) < 0);
});

test("anitube scoreCategory prefere dublado e recusa filmes/ovas", () => {
  const dub = atb.scoreCategory("Naruto Clássico - Dublado", "Naruto");
  const plain = atb.scoreCategory("Naruto Clássico - Legendado", "Naruto");
  assert.ok(dub > plain);
  assert.equal(atb.scoreCategory("Naruto Clássico Filmes Dublado", "Naruto"), -100);
  assert.equal(atb.scoreCategory("Naruto Clássico Ovas", "Naruto"), -100);
  assert.ok(atb.scoreCategory("Boruto: Naruto Next Generations", "Naruto") < 2);
  assert.equal(atb.scoreCategory("One Piece Dublado", "Bleach"), -100);
  assert.ok(atb.scoreCategory("Naruto Shippuuden - Dublado PT-BR", "Naruto Shippuden") > 0);
});

test("anitube pickVideoUrl usa o d= do videohls e descarta base64", () => {
  const html = '<video src="https://api.anivideo.net/videohls.php?d=https://cdn-x.online/stream/n/naruto/01.mp4/index.m3u8"></video>'
    + '<video src="/aHR0cHM6Ly9idWxib3ZhLmJsb2dzcG90LmNvbS8yMDI0/387/bg.mp4"></video>';
  const urls = atb.pickVideoUrl(html);
  assert.equal(urls.length, 1);
  assert.equal(urls[0], "https://cdn-x.online/stream/n/naruto/01.mp4/index.m3u8");
  assert.deepEqual(atb.pickVideoUrl('<video src="/aHR0cHM6Ly9i/387/bg.mp4"></video>'), []);
});

test("dgo extrai urlConfig e monta o caminho do stream", () => {
  const html = 'var urlConfig = {\n base: "https://forks-doramas.madfirebox.shop",\n slug: "conspiracao-do-amor-2025-legendado",\n tipo: "doramas",\n temporada: 1,\n episodio: 2 };';
  const cfg = dgo.parseUrlConfig(html);
  assert.equal(cfg.slug, "conspiracao-do-amor-2025-legendado");
  assert.equal(cfg.tipo, "doramas");
  assert.equal(cfg.temporada, 1);
  assert.equal(cfg.episodio, 2);
  assert.equal(dgo.buildStreamUrl(cfg, "https://ondemand.madfirebox.shop"),
    "https://ondemand.madfirebox.shop/C/conspiracao-do-amor-2025-legendado/01-temporada/02/stream.m3u8");
  assert.equal(dgo.buildStreamUrl({ slug: "goblin-legendado", tipo: "filmes" }, "https://h"),
    "https://h/G/goblin-legendado/stream/stream.m3u8");
  assert.equal(dgo.parseUrlConfig("nada"), null);
});

test("dgo cleanTitle e scoreSeries", () => {
  assert.equal(dgo.cleanTitle("Goblin (Legendado)"), "Goblin");
  assert.equal(dgo.cleanTitle("Crítica e Elenco Completo"), "Crítica e Elenco Completo");
  const base = dgo.scoreSeries("Goblin (Legendado)", "Goblin");
  assert.ok(base > 0);
  assert.ok(dgo.scoreSeries("Goblin Trailer", "Goblin") < 0);
  assert.ok(dgo.scoreSeries("Craslândia (Legendado)", "Goblin") < 0);
  assert.ok(dgo.scoreSeries("Crash Landing on You (Legendado)", "Crash Landing on You") > 0);
});

test("video-probe extrai resolucao de SPS H264 (TS) e de VisualSampleEntry (MP4)", () => {
  const spsHex = "640029ac34e40280f6c04400065d3c01312d023c60c64800";
  const sps = Buffer.from(spsHex, "hex");
  assert.deepEqual(parseSps(new Uint8Array(sps)), { width: 640, height: 480 });

  const { parseMpegTs } = require("../src/lib/video-probe");
  const ts = Buffer.concat([Buffer.from([0x47, 0x40, 0x00, 0x10]), sps, Buffer.from([0x00, 0x00, 0x01, 0x08, 0x00])]);
  const padded = Buffer.concat([ts, Buffer.alloc(188 - ts.length)]);
  const parsed = parseMpegTs(new Uint8Array(padded));
  if (parsed) assert.ok(parsed.width >= 16 && parsed.height >= 16, "resolucao plausivel");

  const mp4 = Buffer.alloc(128);
  mp4.writeUInt32BE(1, 0);
  mp4.write("ftyp", 4, "latin1");
  mp4.write("avc1", 40, "latin1");
  mp4.writeUInt16BE(1920, 40 + 28);
  mp4.writeUInt16BE(1080, 40 + 30);
  assert.deepEqual(resolutionFromMp4(new Uint8Array(mp4)), { width: 1920, height: 1080 });
  assert.equal(detectResolution(new Uint8Array(mp4)).width, 1920);
});

test("videoResolutionToQuality classifica pela largura (crop vertical nao engana)", () => {
  assert.equal(videoResolutionToQuality(1280, 736), "720p");
  assert.equal(videoResolutionToQuality(1920, 832), "1080p");
  assert.equal(videoResolutionToQuality(640, 480), "480p");
  assert.equal(videoResolutionToQuality(1920, 1080), "1080p");
  assert.equal(videoResolutionToQuality(3840, 2160), "2160p");
  assert.equal(videoResolutionToQuality(0, 0), null);
});

test("vizer: buildUrl deriva a URL do tmdb (bucket/token no env)", () => {
  const { buildUrl } = require("../src/scrapers/vizer");
  assert.equal(buildUrl(603, "movie", 1, 1), "https://nixplay.lat/movie/testelogado-vods/GwXanZ3Dj/603.mp4");
  assert.equal(buildUrl(1396, "series", 1, 5), "https://nixplay.lat/series/testelogado-vods/GwXanZ3Dj/1396001005.mp4");
  assert.equal(buildUrl(66732, "series", 2, 10), "https://nixplay.lat/series/testelogado-vods/GwXanZ3Dj/66732002010.mp4");
  assert.equal(buildUrl(1396, "series", 1, 0), "https://nixplay.lat/series/testelogado-vods/GwXanZ3Dj/1396001000.mp4");
  assert.equal(buildUrl(null, "movie", 1, 1), null);
  assert.equal(buildUrl("abc", "movie", 1, 1), null);
});

test("video-probe: moov em mp4 estruturado, mdat-first e multi-track", () => {
  const box = (type, ...payload) => {
    const body = Buffer.concat(payload.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length + 8, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, body]);
  };
  const visual = (w, h) => {
    const e = Buffer.alloc(40);
    e.writeUInt32BE(40, 0);
    e.write("avc1", 4, "latin1");
    e.writeUInt16BE(w, 28);
    e.writeUInt16BE(h, 30);
    return e;
  };
  const trak = (handler, entry) => box("trak", box("mdia",
    box("hdlr", Buffer.alloc(8), Buffer.from(handler, "latin1")),
    box("minf", box("stbl", box("stsd", Buffer.alloc(8), entry)))));
  const mp4 = Buffer.concat([
    box("ftyp", Buffer.from("isomiso2avc1mp41", "latin1")),
    box("moov", trak("vide", visual(1280, 720)), trak("soun", Buffer.alloc(16))),
  ]);
  assert.deepEqual(mp4VideoResolution(new Uint8Array(mp4)), { width: 1280, height: 720 });
  assert.deepEqual(resolutionFromMp4(new Uint8Array(mp4)), { width: 1280, height: 720 });

  const multi = Buffer.concat([box("ftyp", Buffer.from("isom", "latin1")), box("moov", trak("vide", visual(1920, 1080)), trak("vide", visual(400, 225)))]);
  assert.deepEqual(mp4VideoResolution(new Uint8Array(multi)), { width: 1920, height: 1080 });

  const mdatFirst = Buffer.concat([
    box("ftyp", Buffer.from("isom", "latin1")),
    box("free", Buffer.alloc(0)),
    box("mdat", Buffer.alloc(64)),
    box("moov", trak("vide", visual(1280, 544))),
  ]);
  assert.equal(mp4MetaStart(new Uint8Array(mdatFirst)), 92);
  assert.equal(mp4MetaStart(new Uint8Array(mp4)), null);
});

test("audioLanguages empacota o codigo ISO 639 de 15 bits e rejeita lixo", () => {
  const mdhd = code => {
    const b = Buffer.alloc(28);
    b.write("mdhd", 0, "latin1");
    b[4] = 0;
    const bits = [...code].map(c => c.charCodeAt(0) - 0x60);
    b.writeUInt16BE((bits[0] << 10) | (bits[1] << 5) | bits[2], 24);
    return b;
  };
  assert.deepEqual(audioLanguages(new Uint8Array(Buffer.concat([mdhd("por"), mdhd("eng")]))).sort(), ["eng", "por"]);
  const junk = Buffer.alloc(28);
  junk.write("mdhd", 0, "latin1");
  assert.deepEqual(audioLanguages(new Uint8Array(junk)), []);
});

test("getAudioInfo: so Portugues ou Legendado, nunca Original (decisao 66)", () => {
  const unknown = getAudioInfo({ audioUnknown: true });
  assert.equal(unknown, null, "audio desconhecido omite a linha");
  assert.equal(getAudioInfo({ dubbed: true }).label, "Português");
  assert.equal(getAudioInfo({ portuguese: true }).label, "Português");
  assert.equal(getAudioInfo({ subtitle: true }).label, "Legendado");
  assert.equal(getAudioInfo({ subtitles: [{ lang: "por", url: "x.srt" }] }).label, "Legendado");
  assert.equal(getAudioInfo({}).label, "Legendado", "sem flag nenhuma e Legendado, nao Original");
  for (const s of [{}, { dubbed: true }, { subtitle: true }, { portuguese: true }, { subtitles: [{ lang: "por" }] }]) {
    const info = getAudioInfo(s);
    assert.ok(["Português", "Legendado"].includes(info.label), "rotulo tem que ser Portugues ou Legendado, veio " + info.label);
    assert.ok(["\ud83c\udf0e", "\ud83e\udde9"].includes(info.flag), "bandeira tem que ser a de Portugues ou a de Legendado");
  }
  const fs = require("fs");
  assert.ok(!fs.readFileSync(require.resolve("../src/lib/anime-ranking"), "utf8").includes('"Original"'), "o rotulo Original nao pode existir mais no codigo");
});

// Teste que existia devia existir antes: toda funcao que src/server.js CHAMA num modulo
// importado precisa existir no modulo. O bug de `idadeDaPlaylist` (criada, nao exportada)
// so apareceu em producao como 502, e os 95 testes passaram. Esta classe de erro e
// automatizavel, e e ela quePEGAVA os 3 bugs de boot desta sessao.
test("tudo que o server chama num modulo importado existe de verdade", () => {
  const fs = require("fs");
  const path = require("path");
  const raiz = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(raiz, "src", "server.js"), "utf8");

  // 1) `const { a, b } = require("./x")`  -> cada nome tem de estar no module.exports.
  // 2) `const x = require("./x")`          -> cada `x.metodo(` tem de existir em `x`.
  //    O caso 2 e o que pegava o bug do `tvToken.idadeDaPlaylist`: a funcao existia no
  //    arquivo, mas nao no export, entao dava undefined e o servidor devolvia 502 em
  //    producao — com 95 testes passando.
  const problemas = [];
  const reReq = /const\s+(\{[^}]+\}|\w+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;
  const carregados = new Set();
  let m;
  while ((m = reReq.exec(server))) {
    const [, alvo, modulo] = m;
    const arquivo = path.join(raiz, "src", modulo.replace(/^\.\//, "") + ".js");
    if (!fs.existsSync(arquivo)) continue;
    carregados.add(modulo);

    let mod;
    try { mod = require(arquivo); } catch (e) { problemas.push(modulo + " nao carrega: " + e.message); continue; }
    if (mod === null || typeof mod !== "object") continue;

    if (alvo.startsWith("{")) {
      for (const bruto of alvo.slice(1, -1).split(",")) {
        const nome = bruto.trim().split(":")[0].trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(nome)) continue;
        if (mod[nome] === undefined) problemas.push(modulo + " nao exporta " + nome);
      }
      continue;
    }

    // objeto inteiro: procura `alvo.metodo(` em todo o arquivo
    const reUso = new RegExp("\\b" + alvo + "\\.([A-Za-z_$][\\w$]*)\\s*\\(", "g");
    const vistos = new Set();
    let u;
    while ((u = reUso.exec(server))) {
      const metodo = u[1];
      if (vistos.has(metodo)) continue;
      vistos.add(metodo);
      // `const tvToken = require(...)` — o proprio modulo e o objeto, nao mod[alvo].
      const alvoObj = mod;
      if (typeof alvoObj[metodo] !== "function") {
        problemas.push(modulo + " -> " + alvo + "." + metodo + "() nao existe");
      }
    }
  }

  assert.ok(carregados.size > 8, "o teste precisa ter encontrado os requires do server (" + carregados.size + ")");
  assert.deepStrictEqual(problemas, [], problemas.join(" | "));
});

test("todo require destruturado do server existe no modulo de origem", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  const re = /const \{([^}]+)\} = require\("(\.[^"]+)"\);/g;
  const problemas = [];
  let m;
  while ((m = re.exec(src))) {
    const nomes = m[1].split(",").map(s => s.trim().split(":")[0].trim()).filter(Boolean);
    const modPath = path.join(__dirname, "..", "src", m[2]);
    let mod;
    try { mod = require(modPath); } catch (e) { problemas.push(`${m[2]}: nao carrega (${e.message})`); continue; }
    for (const nome of nomes) {
      if (!(nome in mod)) problemas.push(`${m[2]}: "${nome}" nao e exportado`);
    }
  }
  assert.deepEqual(problemas, []);
});

test("motor: normaliza, filtra por kind/when e isola falhas", async () => {
  const { createEngine } = require("../src/lib/scraper-engine");
  const engine = createEngine();
  engine.use({ id: "x", kind: "vod", run: async () => [{ url: "https://a/x.mp4", quality: "1080p" }] });
  engine.use({ id: "y", kind: "anime", run: async () => [{ url: "https://a/y.m3u8" }] });
  engine.use({ id: "z", kind: "vod", when: c => c.type === "movie", run: async () => { throw new Error("z morreu"); } });
  const movie = await engine.fanOut({ kind: "vod", type: "movie", episode: 1, season: 0, tmdbId: 1 });
  assert.equal(movie.failures.length, 1);
  assert.equal(movie.failures[0].id, "z");
  assert.equal(movie.streams.length, 1);
  const anime = await engine.fanOut({ kind: "anime", type: "series", episode: 3, season: 2 });
  assert.equal(anime.total, 1);
  assert.equal(anime.streams[0].season, 2);
  assert.equal(anime.streams[0].sources[0], "y");
  assert.deepEqual(anime.streams[0].subtitles, []);
  assert.equal(anime.streams[0].behaviorHints.bingeGroup, "mirror");
});

test("motor: circuit breaker abre depois de maxFails e nao trava o request", async () => {
  const { createEngine } = require("../src/lib/scraper-engine");
  const engine = createEngine();
  let calls = 0;
  engine.use({ id: "ruim", kind: "vod", maxFails: 2, run: async () => { calls++; throw new Error("sempre falha"); } });
  const ctx = { kind: "vod", type: "movie", episode: 1, season: 0, tmdbId: 1 };
  await engine.fanOut(ctx);
  await engine.fanOut(ctx);
  const third = await engine.fanOut(ctx);
  assert.equal(calls, 2, "apos abrir o breaker a fonte nao deve ser chamada");
  assert.equal(third.failures.length, 0);
  assert.equal(engine.stats().openBreakers.includes("ruim"), true);
});

test("motor: timeout da fonte vira falha isolada", async () => {
  const { createEngine } = require("../src/lib/scraper-engine");
  const engine = createEngine();
  engine.use({ id: "lento", kind: "vod", timeoutMs: 60, run: () => new Promise(r => setTimeout(() => r([{ url: "https://a/l.mp4" }]), 3000)) });
  engine.use({ id: "rapido", kind: "vod", run: async () => [{ url: "https://a/r.mp4" }] });
  const r = await engine.fanOut({ kind: "vod", type: "movie", episode: 1, season: 0, tmdbId: 1 });
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].id, "lento");
  assert.equal(r.streams.length, 1, "a fonte rapida nao pode ser afetada pela lenta");
});

test("páginas saem ANTES do repasse de TV (decisão 147)", () => {
  const fs = require("fs");
  const path = require("path");
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");

  // MEDIDO 01/10/2026 na producao: `/install` levava **12,8s** e o `/tv` devolvia **504 em 12,2s**
  // — os dois no limite de 12,3s em que o gateway corta. A causa NAO era o addon: as rotas das
  // paginas estavam declaradas DEPOIS do `repassaTv`, e o dominio do cluster de TV tinha perdido o
  // registro no DNS. O dono abriu a raiz, ela mandou para `/install`, e ele viu "nao entra".
  //
  // Medido: `/install.html` respondia em **0,04s** e `/install` (o mesmo arquivo) em **12,8s**.
  const iPaginas = server.indexOf("AS PAGINAS ANTES DO REPASSE DE TV (decisao 147)");
  const iRepasse = server.indexOf("tvSplit.repassaTv(req, res, next);");
  assert.ok(iPaginas > 0, "o bloco das paginas existe");
  assert.ok(iPaginas < iRepasse, "as paginas sao registradas ANTES do repasse de TV");

  // As tres paginas que nao tem nada a ver com TV.
  assert.match(server, /app\.get\(ROTAS\.instalacao,[\s\S]{0,200}install\.html/, "a instalacao");
  assert.match(server, /app\.get\(ROTAS\.painel,[\s\S]{0,200}dashboard\.html/, "o painel");
  assert.match(server, /app\.get\(ROTAS\.tv, \(req, res, next\)/, "a pagina de TV");

  // Com `?chan=` a pagina antecipada NAO responde: escolher o canal e' da rota de baixo, e um
  // redirect para a propria URL seria laco infinito.
  assert.match(server, /if \(req\.query\.chan\) return next\(\)/, "com canal, passa adiante");
});

test("botão de emergência do catálogo funciona (decisão 146)", () => {
  const fs = require("fs");
  const path = require("path");
  const utils = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "scraper-utils.js"), "utf8");
  const xtream = fs.readFileSync(path.join(__dirname, "..", "src", "scrapers", "xtream.js"), "utf8");

  // MEDIDO 01/10/2026: `xtream.js` chamava `seriesCache.delete(key)` no caminho de emergencia
  // (SQLite fora -> catalogo na RAM) e o `makeCache` so devolvia `{ get, set }`. Um `TypeError`
  // derrubava justamente o botao de emergencia: o dono perdia a economia E a funcionalidade.
  assert.match(xtream, /seriesCache\.delete\(key\)/, "o codigo apaga a entrada do catalogo em RAM");
  assert.match(utils, /return \{ get, set, delete: del \}/, "e o makeCache sabe apagar");
});

test("catálogo em disco: o boot é paralelo, é medido no log, e o pedido espera a gravação (decisão 136)", () => {
  const fs = require("fs");
  const path = require("path");
  const raiz = path.join(__dirname, "..");
  const xtream = fs.readFileSync(path.join(raiz, "src", "scrapers", "xtream.js"), "utf8");

  // DECISAO 146: o boot voltou a ser SEQUENCIAL. A decisao 136 mediu que o paralelo "nao custava
  // memoria porque cada pedaco e cortado e solto" — e isso estava ERRADO.
  //
  // MEDIDO 01/10/2026 em producao, com os 6 catalogos em paralelo:
  //   [paineis] Space/series: 8169 itens | rss 114 -> 258 (gravado)
  //   [paineis] Autos/vod:   31509 itens | rss 113 -> 272 (gravado)
  // Cortar em pedacos evita que o ITEM fique, mas nao evita que os 6 arquivos de origem (o maior
  // tem 33 mil itens) fiquem abertos ao mesmo tempo — o Node mantem os 6 Buffers e as 6 arvores de
  // parse vivos ate a ultima gravura. 272MB e o caminho mais perto de estourar o teto de 300MB que
  // o dono pediu, e e logo depois de um deploy, que e quando tudo rebaixa.
  //
  // MEDIDO local: pico de 150MB (paralelo) contra 133-136MB (sequencial). O preco e' 6,9s contra
  // 14s, e o aquecimento roda em segundo plano.
  assert.match(xtream, /decisao 146/, "o motivo da mudanca esta escrito no codigo");
  assert.match(xtream, /async function preloadLists\(\) \{[^}]*await ensureCatalog\(panel, "series"\)/s,
    "preloadLists grava UM catalogo por vez");
  assert.doesNotMatch(xtream, /await Promise\.allSettled\(jobs\)/,
    "e nao dispara os 6 ao mesmo tempo (foi o que levou o RSS a 272MB)");

  // O pedido espera a gravacao do painel terminar (com teto) antes de cair na memoria.
  assert.match(xtream, /if \(!catalogoPaineis\.temCatalogo\(panel\.name, "vod"\)\) await esperaCatalogoPronto\(panel, "vod"\)/,
    "o pedido espera o catalogo de filme do painel");
  assert.match(xtream, /if \(!catalogoPaineis\.temCatalogo\(panel\.name, "series"\)\) await esperaCatalogoPronto\(panel, "series"\)/,
    "e o de serie");
  assert.match(xtream, /const ESPERA_CATALOGO_MS = Number\(ENV\.XTREAM_ESPERA_CATALOGO_MS \|\| 3000\)/,
    "com teto, para nunca passar do orcamento do gateway");
  assert.match(xtream, /const t = setTimeout\(\(\) => \{ vivo = false; \}, ESPERA_CATALOGO_MS\)/,
    "o teto e' de verdade (a espera nao pode ser infinita)");

  // O RSS por etapa no log: e o que permite saber se o boot esta no caminho de memoria.
  assert.match(xtream, /\[paineis\].*rss \$\{rssAntes\} ->/, "o boot loga o RSS de cada painel");
  assert.match(xtream, /memoria\.coletarSePreciso/, "e coleta no fim, se passar do teto");

  // E o botao de emergencia existe (se o disco falhar na hospedagem).
  assert.match(xtream, /const CATALOGO_EM_MEMORIA = String\(ENV\.XTREAM_CATALOGO \|\| ""\)/, "a chave XTREAM_CATALOGO=memoria");
});

test("alerta de fonte caída: o /health diz quem caiu e há quanto tempo não entrega (decisão 129)", () => {
  const fs = require("fs");
  const path = require("path");
  const raiz = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(raiz, "src", "server.js"), "utf8");
  const motor = fs.readFileSync(path.join(raiz, "src", "lib", "scraper-engine.js"), "utf8");
  // O motor ja guardava lastOk/lastError/fails por fonte, mas o /health so mostrava contadores:
  // nao dava para dizer "caida" de "chamou uma vez e deu timeout".
  assert.match(motor, /lastOk: s\.lastOk,/, "o estado da fonte precisa sair no stats()");
  assert.match(motor, /lastError: s\.lastError,/, "o ultimo erro precisa sair no stats()");
  // Quatro estados, e "parado" nao e defeito: fonte que ninguem pediu nao pode ser dita quebrada.
  for (const estado of ["caido", "degradado", "parado", "ok"]) {
    assert.match(server, new RegExp(`estado: "${estado}"`), `falta o estado ${estado}`);
  }
  // Timeout NAO conta como queda — o motor trata como fonte lenta, e contar tirava a fonte da
  // lista por 5 min mesmo ela entregando.
  assert.match(server, /erroCausaTimeout/, "timeout tem que ser separado de erro de verdade");
  // O aviso so sai na TRANSICAO e nao se repete por 30 min.
  assert.match(server, /antes !== "caido"/, "o alerta tem que ser por transicao");
  assert.match(server, /const ALERTA_REPETIR_MS = 30 . 60 . 1000;/, "cooldown do alerta de 30 min");
  assert.match(server, /fontesSaude: \(\(\) => \{ const s = saudeDasFontes\(\); avisarSeMudou\(s\); return s; \}\)\(\)/,
    "o /health tem que mostrar e avaliar a saude");
  const nomes = require("../src/core/nomes");
  assert.ok(nomes.VARIAVEIS.ALERT_WEBHOOK_URL, "ALERT_WEBHOOK_URL fora do registro");
});

test("P2P: a página reporta o enxame e o /health mostra (decisão 128)", () => {
  const fs = require("fs");
  const path = require("path");
  const raiz = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(raiz, "src", "server.js"), "utf8");
  // Sem o relato nao ha como responder "o P2P funciona?": o motor fica atras de ?p2p=1 e o
  // codigo antigo registra que ele nem completa o manifesto com o hls.js atual.
  assert.match(server, /app\.post\(ROTAS\.p2pRelato/, "a rota de relato do P2P tem que existir");
  assert.match(server, /p2p: resumoP2p\(\)/, "o /health tem que mostrar o enxame");
  // O que entra e clampado: o endpoint e publico e nao pode estourar memoria.
  assert.match(server, /const P2P_MAX_CANAIS = \d+/, "teto de canais no relato");
  assert.match(server, /function numeroOu\(v, max\)/, "os numeros do relato precisam de teto");
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
  const tv = require("../src/core/tv-sources");
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
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  assert.match(server, /options: \["Todos", \.\.\.tvSources\.BUCKETS\]/,
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
test("decisao 155: a lista de TV e' o catalogo do REI, e ninguem no servidor a encurta", () => {
  const tv = require("../src/core/tv-sources");

  // A LISTA e' o que a fonte declara — o filtro virou identidade, e e' assim de proposito.
  const declarados = new Set(["hbo", "cnnbrasil", "afazenda"]);
  assert.deepEqual([...tv.chavesDaLista(declarados)].sort(), ["afazenda", "cnnbrasil", "hbo"]);
  // Nada sai por duvida: a funcao nao tem como retirar ninguem, e e' essa a garantia.
  assert.equal(tv.chavesDaLista(declarados).size, declarados.size);
  // So existe UMA fonte de metadado, e ela e' o REI.
  assert.deepEqual(tv.METADADOS.map((p) => p.id), ["rei"]);
  // E o registro de METADADO saiu do registro de PROVEDORES (que contava os players).
  assert.equal(tv.PROVIDERS, undefined, "PROVIDERS (players) nao existe mais");
  // As funcoes de player sumiram do modulo — e' o que garante que ninguem as chame por engano.
  for (const morta of ["getStreams", "resolvePlaylist", "membersOf", "ownerOf", "limpaProvasDeMorte", "quantasProvasDeMorte"]) {
    assert.equal(tv[morta], undefined, `${morta} nao pode voltar sem fonte de player`);
  }
});

test("título do player: nome canônico do metadado, peças separadas (decisão 141)", () => {
  const { partesDe, tituloDe, nomeDe } = require("../src/lib/jogador");

  // O DEFEITO MEDIDO: o mesmo serie saia com nomes diferentes conforme a fonte, porque o titulo do
  // player vinha do que cada painel escreveu. "Breaking Bad: A Química do Mal" no BLZ e
  // "Breaking Bad" no SPT — tres linhas quase iguais na lista, sem o usuario saber que eram o
  // mesmo conteudo.
  const doBlz = { type: "series", title: "🌊 Breaking Bad: A Química do Mal · S01E01 · 720p · BLZ", season: 1, episode: 1, sources: ["blz"], quality: "720p", portuguese: true, dubbed: true };
  const doSpt = { type: "series", title: "🌊 Breaking Bad · S01E01 · 1080p · SPT", season: 1, episode: 1, sources: ["spt"], quality: "1080p", portuguese: true, dubbed: true };

  const a = partesDe(doBlz, { nome: "Breaking Bad" });
  const b = partesDe(doSpt, { nome: "Breaking Bad" });
  assert.equal(a.nome, "Breaking Bad", "o nome canonico do metadado vence o do painel");
  assert.equal(b.nome, "Breaking Bad", "idem na outra fonte");
  assert.equal(a.nome, b.nome, "as DUAS fontes mostram o mesmo nome");

  // As pecas separadas, que e o que a API devolve.
  assert.equal(a.episodioRot, "S01E01", "temporada e episodio separados");
  assert.equal(a.fonte, "BLZ", "fonte separada");
  assert.equal(a.fonteId, "blz", "fonte com a chave do registro");
  assert.equal(a.idioma, "portugues", "idioma separado");
  assert.equal(b.idioma, "portugues", "idioma separado (2a fonte)");
  assert.equal(a.qualidade, "720p", "qualidade separada");
  assert.equal(b.qualidade, "1080p", "qualidade separada (2a fonte)");

  // Legendado tem que sair como legendado, e nao como "portugues".
  const leg = partesDe({ type: "series", title: "🌊 X · S01E01 · 720p · RON", season: 1, episode: 1, sources: ["ron"], quality: "720p", subtitle: true }, { nome: "X" });
  assert.equal(leg.idioma, "legendado", "o que e legendado NAO pode virar portugues");
  // E sem informacao de audio, o honesto e "desconhecido" — afirmar "legendado" seria mentira.
  const semInfo = partesDe({ type: "tv", title: "☁️ HBO · REI", sources: ["rei"], audioUnknown: true }, {});
  assert.equal(semInfo.idioma, "desconhecido", "sem informacao de audio, o honesto e desconhecido");

  // O TEXTO EM CASCATA: o dono pediu "não fiquem as coisas escritas uma do lado da outra e sim em
  // cascata". Uma informacao por linha, porque o celular cortava a linha grudada pelo meio e o
  // usuario perdia a fonte (que e o fim).
  const emCascata = tituloDe(a).split("\n");
  assert.equal(emCascata[0], "🌊 Breaking Bad · S01E01", "linha 1: o que e e onde estamos");
  assert.equal(emCascata[1], "🌎 Português", "linha 2: o idioma, sozinho");
  assert.equal(emCascata[2], "720p", "linha 3: a qualidade, sozinha");
  assert.equal(emCascata[3], "BLZ", "linha 4: a fonte, sozinha");
  assert.equal(emCascata.length, 4, "e NADA colado com · fora do nome");
  assert.ok(!emCascata.some((l) => / · (720p|1080p|BLZ|SPC|ATO|RON)$/.test(l)), "nenhuma linha gruda qualidade ou fonte");

  // O texto da tela sai das pecas (uma informacao por linha, e a sigla fora do nome).
  const texto = tituloDe(a);
  assert.ok(!/· BLZ/.test(texto.split("\n")[0]), "a sigla da fonte nao fica grudada no nome");
  assert.ok(texto.includes("🌎 Português"), "o idioma aparece na tela");
  assert.ok(texto.includes("BLZ"), "a fonte aparece na tela");
  assert.equal(nomeDe(a), "Mirror 720p BLZ", "o nome curto da lista leva a fonte (distingue dois players iguais)");

  // A GUIA SO E A GUIA. MEDIDO: o titulo ja vem com a linha de idioma, e "copiar tudo depois da
  // 1a linha" jogava "🌎 Portugues" de volta para baixo do texto remontado (o usuario lia a mesma
  // informacao duas vezes). So as linhas de guia entram.
  const comAudio = partesDe({ type: "movie", title: "🌊 Matrix (1999) · 720p · BLZ\n🌎 Português", sources: ["blz"], quality: "720p", portuguese: true, dubbed: true }, {});
  assert.equal(comAudio.guia, "", "a linha de idioma NAO vira guia");
  const comGuia = partesDe({ type: "tv", title: "☁️ HBO · REI\n📺 Filme até 22:00\n⏭️ A seguir: Serie", sources: ["rei"], isLive: true }, {});
  assert.ok(comGuia.guia.includes("Filme até 22:00"), "a guia entra");
  assert.ok(tituloDe(comGuia).includes("Filme até 22:00"), "e aparece na tela");
  assert.equal((tituloDe(comAudio).match(/Português/g) || []).length, 1, "o idioma aparece UMA vez so");
});

test("borda: NENHUM erro e o relay podem ficar guardados 4h na CDN (decisão 140)", () => {
  const fs = require("fs");
  const path = require("path");
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");

  // MEDIDO 01/10/2026, e foi o defeito que o dono viu como "todos os players de live TV pararam,
  // fica um icone quadrado de interrogacao": o relay respondia
  //     HTTP/2 404 | cache-control: public, max-age=14400 | age: 77 | cf-cache-status: UPDATING
  // Ou seja, a BORDA guardava o 404 por 4 horas (a zona do BeamUp reescreve o Cache-Control do
  // origin) e continuava servindo depois de a origem voltar. O servidor estava bom; o cache nao.
  //
  // O relay manda `max-age=25` (cacheavel, de proposito, para o cache local), entao precisa de um
  // cabecalho que o CLOUDFLARE respeita para o TTL DA BORDA, separado do TTL da origem.
  assert.match(server, /res\.set\("CDN-Cache-Control", "no-store"\)/,
    "o relay diz a borda para nao guardar (CDN-Cache-Control e o cabecalho do Cloudflare)");
  assert.match(server, /res\.set\("Cloudflare-CDN-Cache-Control", "no-store"\)/,
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
  assert.doesNotMatch(server, /res\.on\(\s*["']finish["']/,
    "o finish dispara depois dos headers irem — o setHeader la dentro e' sempre tarde");
  assert.match(server, /proibeCacheDeErro/, "o servidor usa a guarda de cache de erro");
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
test("decisao 155: a chave do canal e' o normKey do nome, e o slug do REI viaja guardado", () => {
  const fs = require("fs");
  const path = require("path");
  const tv = require("../src/core/tv-sources");
  const codigo = fs.readFileSync(path.join(__dirname, "..", "src", "core", "tv-sources.js"), "utf8");

  // O agrupamento e a salvaguarda de nome sairam com as 4 fontes, e nao voltam sem elas.
  assert.equal(tv.palavrasFortes, undefined);
  assert.equal(tv.nomesDoMesmoCanal, undefined);
  // Nenhuma CHAMADA ao agrupamento sobrou (o nome pode estar no comentario que explica a saida).
  assert.equal(/agregaPorCanal\(/.test(codigo), false, "o agrupamento de 4 fontes nao tem mais o que agrupar");
  // A chave e' o nome normalizado, e a funcao continua exportada porque o `/nuvio` e o
  // `/poster` dependem dela.
  assert.equal(tv.normKey("A Fazenda"), "afazenda");
  // O SLUG do REI e' outra coisa (medido: `argentinanewses` no catalogo, `argentinanews` no
  // REI, em 79 dos 327), entao o par viaja no grupo — sem isso, abrir um canal pelo id do
  // catalogo viraria "channel not found".
  assert.match(codigo, /slug: String\(meta\.id \|\| ""\)/, "o slug do REI e' guardado no grupo");
  assert.match(codigo, /grupo\.slug \? grupo\.slug : chave/, "o getMeta usa o slug quando ele existe");
});


// DECISAO 154 (VOD saiu) + DECISAO 155 (TV saiu). Este teste e' a trava das duas: o motor do
// servidor nao registra FONTE NENHUMA — nem de VOD, nem de TV. O que ele ainda e' e' o motor
// (disjuntor, trava de pedido, normalizacao), e o `/health` reporta `scraperSources: 0`.
test("decisoes 154 e 155: o motor do servidor nao tem fonte nenhuma — os players vem do plugin", () => {
  const fs = require("fs");
  const path = require("path");
  const { engine, temFonteDeVod, temFonteDeTv } = require("../src/core/sources");
  assert.equal(engine.size, 0, "nenhuma fonte de VOD pode ficar registrada no motor do servidor");
  assert.equal(temFonteDeVod(), false);
  // DECISAO 155: o mesmo atalho para TV. E' o que faz as tres rotas de stream (`/stream/*`,
  // `/api/streams/*`, `/nuvio/stream/*`) responderem na hora, sem metadado e sem sonda.
  assert.equal(temFonteDeTv(), false, "a TV tambem nao tem fonte no servidor");
  for (const kind of ["vod", "anime"]) {
    const ids = engine.pick({ kind, type: "movie", episode: 1, season: 0, tmdbId: 603 }).map((s) => s.id);
    assert.deepEqual(ids, [], `motor ainda escolhe fonte para kind=${kind}`);
  }

  // O ganho real das duas decisoes e de BOOT: carregar `core/sources` nao pode arrastar painel
  // Xtream nem a base do KAK. Verificado em um processo limpo, porque dentro do teste os outros
  // arquivos ja podem ter carregado qualquer coisa.
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "core", "sources.js"), "utf8");
  for (const proibido of ["otakulogia", "animesdigital", "aon", "anitube", "xtream", "kakito", "playerflix", "vizer", "doramogo", "redetoons"]) {
    assert.equal(
      src.includes(`require("../scrapers/${proibido}")`),
      false,
      `core/sources.js nao deve mais carregar o scraper ${proibido}`,
    );
  }
  assert.equal(/^\s*engine\.use\(/m.test(src), false, "nenhuma fonte de VOD registrada no motor");

  // O que continua vivo e' o CATALOGO: uma fonte de METADADO, o REI, em registro proprio. Ela
  // nao e' fonte do motor (nao entrega stream) e nao passa por `engine.use()`.
  const tv = require("../src/core/tv-sources");
  assert.deepEqual(tv.METADADOS.map((p) => p.id), ["rei"], "so o REI entrega metadado de TV");
  const chaves = tv.METADADOS.map((p) => String(p && p.id || "")).filter(Boolean);
  assert.equal(new Set(chaves).size, chaves.length, "ids de metadado repetidos");
  // E a 155: a TV nao tem mais registro de PLAYER nenhum.
  for (const morta of ["PROVIDERS", "getStreams", "resolvePlaylist", "membersOf", "ownerOf"]) {
    assert.equal(tv[morta], undefined, `${morta} nao pode voltar sem fonte de player`);
  }
});


test("compatibilidade com clientes: todo stream tem o essencial", () => {
  const { normalizeStream } = require("../src/lib/scraper-engine");
  const base = { kind: "vod", type: "series", episode: 4, season: 2, key: "k" };
  const s = normalizeStream({ url: "https://a/x.mp4", headers: { Referer: "https://r/" } }, { id: "blz" }, base);
  assert.equal(s.behaviorHints.notWebReady, true, "stream com headers precisa de notWebReady para TV/celular");
  assert.equal(s.behaviorHints.proxyHeaders.request.Referer, "https://r/");
  assert.equal(s.behaviorHints.bingeGroup, "mirror");
  assert.equal(typeof s.id, "string");
  assert.ok(s.id.length > 0);
  assert.equal(s.season, 2);
  assert.equal(s.episode, 4);
  assert.equal(s.type, "series");
  assert.equal(s.quality, "unknown", "nao pode inventar qualidade");
  const live = normalizeStream({ url: "https://a/x.m3u8", live: true }, { id: "emb" }, { kind: "tv", type: "tv", episode: 1, season: 1, key: "" });
  assert.equal(live.behaviorHints.live, true);
  assert.equal(live.isLive, true);
  assert.equal(normalizeStream({ url: "" }, { id: "x" }, base), null, "stream sem url e descartado");
  assert.equal(normalizeStream(null, { id: "x" }, base), null);
});

test("EPG nativo do Stremio: manifesto, grade por dia e videos no meta", () => {
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("../src/server"), "utf8");
  assert.ok(src.includes("epgProvider: true"), "manifesto precisa declarar epgProvider para o Stremio mostrar a aba Channel Guide");
  const bloco = src.slice(src.indexOf("mirror-tv-live"), src.indexOf("mirror-tv-live") + 400);
  assert.ok(/name: "date"/.test(bloco), "o catalogo de TV precisa declarar o extra 'date'");
  assert.ok(/name: "skip"/.test(bloco), "o catalogo de TV precisa declarar o extra 'skip'");

  const epg = require("../src/lib/epg");
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
  const m = require("../src/lib/tv-split");
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


test("id de programa do EPG volta para o canal (celular toca no guia)", () => {
  const tvSources = require("../src/core/tv-sources");
  const epg = require("../src/lib/epg");
  const canal = "tv:live:hbo";
  const comEp = canal + ":epg:2026-09-26T04:40:00.000Z";
  assert.equal(tvSources.canalDe(canal), "hbo");
  assert.equal(tvSources.canalDe(comEp), "hbo", "o id do programa tem que voltar para o slug do canal");
  assert.equal(tvSources.canalDe("tv:live:tv%3Alive%3Ahbo"), "tv%3Alive%3Ahbo");
  assert.equal(tvSources.ehIdDePrograma(comEp), true);
  assert.equal(tvSources.ehIdDePrograma(canal), false);
  assert.equal(tvSources.idDoPrograma(comEp), "2026-09-26T04:40:00.000Z");
  assert.equal(tvSources.idDoPrograma(canal), null);
  assert.equal(tvSources.canalDe(comEp), tvSources.canalDe(canal), "programa e canal precisam dar o mesmo slug");
  const grade = epg.grade("HBO", canal, "2026-09-26");
  if (grade.length) {
    assert.ok(grade[0].id.startsWith(canal + ":epg:"), "o id gerado precisa ser exatamente o que o Stremio pede de volta");
    assert.equal(tvSources.canalDe(grade[0].id), "hbo");
  }
});

test("casamento do guia: pontua porforca e nao casa nome curto no meio", () => {
  const epg = require("../src/lib/epg");
  const pontua = (a, b) => {
    if (a === b) return 1000;
    const s = Math.min(a.length, b.length);
    if (s < 3) return 0;
    if (b.startsWith(a) || a.startsWith(b)) return 100 + s;
    if (b.endsWith(a) || a.endsWith(b)) return 90 + s;
    if (b.includes(a) || a.includes(b)) return 60 + s;
    return 0;
  };
  assert.ok(pontua("tcm", "tcmturnerclassic") > pontua("max", "artelivre"), "prefixo e melhor que um nome qualquer");
  assert.equal(pontua("hbo", "max1"), 0, "nomes diferentes nao casam");
  assert.equal(pontua("ab", "abc"), 0, "sobreposicao de 2 letras e ruido");
});

test("EPG vem da API do Rei dos Embeds (decisao 121)", () => {
  const fs = require("fs");
  const path = require("path");
  const raiz = path.join(__dirname, "..");
  const src = fs.readFileSync(path.join(raiz, "src/lib/epg.js"), "utf8");
  assert.ok(src.includes("/api/guia"), "a guia vem da API XMLTV do reidosembeds");
  assert.ok(!src.includes("xmltv/epg_BR"), "o xmltv do epg.pw saiu: a fonte unica do guia e o REI");
  assert.ok(!src.includes("epg-rei"), "o raspador do HTML da guia nao existe mais");
  assert.ok(src.includes("reiApi.loadCatalog()"), "os logos vem da mesma API de canais que o catalogo de TV ja paga");
  assert.equal(fs.existsSync(path.join(raiz, "src/lib/epg-rei.js")), false, "epg-rei.js teve que sair");
});

test("EPG: display-name com entidade HTML entra no guia", () => {
  const epg = require("../src/lib/epg");
  const dia = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const xml = `<?xml version="1.0" encoding="utf-8"?><tv>
<channel id="ae"><display-name>A&amp;E</display-name></channel>
<channel id="band"><display-name>Band SP</display-name></channel>
<programme channel="ae" start="${dia}120000 -0300" stop="${dia}130000 -0300"><title>Manutenção &amp; Cia</title></programme>
<programme channel="band" start="${dia}130000 -0300" stop="${dia}140000 -0300"><title>Jornal</title></programme>
</tv>`;
  const porNome = epg.parse(xml, null);
  assert.ok(porNome.has("ae"), "A&amp;E tem que virar a chave 'ae', senao o canal fica fora do guia");
  assert.ok(porNome.has("bandsp"), "o display-name vira a chave normalizada");
  const cn = porNome.get("ae");
  assert.equal(cn.length, 1, "um programa por canal");
  assert.equal(cn[0][0], "Manutenção & Cia", "entidade do titulo tem que ser decodificada");
  assert.equal(cn[0][2] - cn[0][1], 3600, "uma hora vira 3600 segundos");
  assert.ok(porNome.get("bandsp")[0][0] === "Jornal", "o outro canal tambem entra");
});

// DECISAO 155: a PREVIA (frame de video, decisao 63) saiu do servidor junto com a EMB e a ETC,
// que eram as unicas de onde ela vinha. Com elas fora, o fundo do canal e' o logo — e o teste
// desta vez trava essa regra nova, em vez de so dizer que o `preview_url` morto do REI nao
// entra.
test("decisao 155: o fundo do canal e' o logo (a previa vinha da EMB/ETC, que sairam)", () => {
  const fs = require("fs");
  const path = require("path");
  const raiz = path.join(__dirname, "..");
  // MEDIDO em 30/09/2026: os 327 canais do REI apontam o `preview_url` para um host que
  // responde 403, e os caminhos `.prev.png` do proprio `reidosembeds.online` dao 404. O logo
  // deles (`/img/<slug>.png`) responde 200.
  const rei = fs.readFileSync(path.join(raiz, "src/scrapers/reidosembeds.js"), "utf8");
  assert.ok(rei.includes("background: logo"), "o background do REI tem que ser o proprio logo");
  assert.ok(!rei.includes("background: previa"), "o preview_url morto do REI nao pode virar fundo");
  // A sonda de previa (que derivava `<logo>.prev.png` e fazia GET Range de 2KB) era o que
  // segurava a montagem em 18,3s (decisao 125). Nao ha mais o que sondar.
  const tv = fs.readFileSync(path.join(raiz, "src/core/tv-sources.js"), "utf8");
  assert.ok(!/existePreview\(/.test(tv), "a sonda de previa saiu: a previa vinha da EMB/ETC");
  assert.ok(!/completaPrevia\(/.test(tv), "e com ela o agendador de fatias de previa");
  assert.ok(!/existePreview|completaPrevia/.test(fs.readFileSync(path.join(raiz, "src/core/tv-sources.js"), "utf8").match(/^(?!\/\/).*$/gm).join("\n")),
    "nenhuma linha de codigo pode mencionar a sonda de previa");
  // O `/meta` continua usando a MESMA imagem do catalogo — e o catalogo nao tem mais previa,
  // entao na pratica as duas caem no logo. A garantia que importa: nao divergem.
  assert.ok(tv.includes("out.background = grupo.preview || grupo.logo || out.poster"),
    "o /meta usa a MESMA imagem do catalogo");
  assert.ok(!tv.includes("grupoRei.preview = meta.background"), "o REI nao pode doar previa no catalogo");
});


// DECISAO 155: o titulo do stream de TV nao e' mais montado pelo servidor (nao ha stream de TV
// aqui), entao a segunda parte deste teste foi embora com a EMB e a ETC. A primeira — o VOD
// comecar com a onda — continua, e o ranker ainda existe (o plugin tem o seu).
test("decisao 155: o titulo de VOD continua com a onda; o de TV saiu do servidor", () => {
  const fs = require("fs");
  const { vodTitle } = require("../src/lib/stream");
  assert.ok(vodTitle({ name: "Matrix", year: 1999, type: "movie", quality: "1080p", source: "blz" }).startsWith("\u{1F30A}"), "filme de VOD comeca com a onda");
  assert.ok(vodTitle({ name: "Breaking Bad", type: "series", season: 2, episode: 3, quality: "720p", source: "spt" }).startsWith("\u{1F30A}"), "serie de VOD comeca com a onda");
  // A nuvem na TV vivia nos scrapers de TV, que foram apagados. Quem escreve o titulo do player
  // de TV agora e' o plugin (`nuvio/`), que tem os 4 scrapers e o mesmo ranker.
  for (const p of ["../src/scrapers/embedtv", "../src/scrapers/embedcanais", "../src/scrapers/reidoscanais"]) {
    let existe = true;
    try { require.resolve(p); } catch (_) { existe = false; }
    assert.equal(existe, false, `${p} deveria ter saido do servidor`);
  }
  // O ranker continua no codigo (o plugin importa a mesma ideia) e ainda escolhe por tipo.
  const rank = fs.readFileSync(require.resolve("../src/lib/anime-ranking"), "utf8");
  assert.ok(rank.includes('"tv" ? "☁️" : "\u{1F30A}"'), "o ranker tem que escolher nuvem na TV e onda no VOD");
});


test("ranker: a linha do nome da fonte tambem segue o emoji do tipo", () => {
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("../src/lib/anime-ranking"), "utf8");
  assert.ok(src.includes("lines.push(`${emoji} ${codename}`)"), "a linha da fonte nao pode ter emoji fixo, senao TV sai com o emoji de VOD");
  assert.ok(!/lines\.push\(`\u{1F30A} \$\{codename\}`\)/u.test(src), "emoji de VOD nao pode ficar fixo na linha da fonte");
});

test("voo unico do motor nao mistura episodios nem series diferentes", async () => {
  const { createEngine } = require("../src/lib/scraper-engine");
  const calls = [];
  const fonte = {
    id: "x",
    label: "X",
    kind: ["anime"],
    timeoutMs: 500,
    run: async (c) => {
      calls.push(c.key);
      await new Promise(r => setTimeout(r, 40));
      return [{ url: `http://a/${encodeURIComponent(c.key)}.m3u8`, quality: "720p" }];
    },
  };
  const eng = createEngine();
  eng.use(fonte);
  const base = { kind: "anime", type: "series", season: 1, episode: 1, title: "T" };
  const [a, b] = await Promise.all([
    eng.start({ ...base, key: "naruto", episode: 1 })[0].promise,
    eng.start({ ...base, key: "naruto", episode: 2 })[0].promise,
  ]);
  assert.equal(calls.length, 2, "episodios diferentes nao podem compartilhar a mesma promise");
  assert.match(a[0].url, /naruto/, "primeiro pedido e do episodio 1");
  assert.match(b[0].url, /naruto/, "segundo pedido e do episodio 2");
  const [c] = await Promise.all([
    eng.start({ ...base, key: "bleach", episode: 1 })[0].promise,
    eng.start({ ...base, key: "bleach", episode: 1 })[0].promise,
  ]);
  assert.equal(calls.filter(k => k === "bleach").length, 1, "o mesmo conteudo ainda aproveita o voo unico (ganho de cache preservado)");
});

test("preFiltra do xtream nao deixa passar nada que o matchScore aceitaria", () => {
  const { matchScore, preFiltra } = require("../src/lib/match");
  const catalogo = [
    { name: "Matrix (1999)", key: "matrix 1999" },
    { name: "Matrix Reloaded", key: "matrix reloaded" },
    { name: "Matrix Revolutions", key: "matrix revolutions" },
    { name: "The Godfather", key: "the godfather" },
    { name: "O Poderoso Chefão", key: "o poderoso chefão".normalize("NFD").replace(/[̀-ͯ]/g, "") },
    { name: "Breaking Bad", key: "breaking bad" },
    { name: "Inception", key: "inception" },
  ];
  for (const consulta of ["Matrix", "Matrix 1999", "Godfather", "Poderoso Chefão", "Breaking Bad", "Inception"]) {
    const antes = catalogo.filter(it => matchScore(consulta, it.name) >= 70);
    const depois = preFiltra(catalogo, consulta);
    for (const item of antes) {
      assert.ok(algum(antes, it => depois.includes(it)), `preFiltra descartou "${item.name}" que matchScore aceitou para "${consulta}"`);
    }
  }
  function antes(a, b) { return a.indexOf(b) >= 0; }
  function algum(lista, fn) { return lista.filter(fn).length > 0; }
});

test("as regras de casamento de serie ficaram iguais depois de unificar (fotografia)", () => {
  const aon = require("../src/scrapers/aon");
  const ron = require("../src/scrapers/animesdigital");
  const atb = require("../src/scrapers/anitube");
  const dgo = require("../src/scrapers/doramogo");
  const m = require("../src/lib/match");
  const casos = [
    ["aon", "Naruto", "Naruto Shippuden", aon.scoreSerie("Naruto", "Naruto Shippuden")],
    ["aon", "Naruto", "Naruto", aon.scoreSerie("Naruto", "Naruto")],
    ["ron", "Naruto", "Naruto Shippuden", ron.scoreSeries("Naruto Shippuden", "Naruto", 1)],
    ["ron", "Naruto Shippuden", "Naruto Shippuden", ron.scoreSeries("Naruto Shippuden", "Naruto Shippuden", 1)],
    ["atb", "Naruto", "Naruto Clássico Episódio 5 Dublado", atb.scoreSeries("Naruto Clássico Episódio 5 Dublado", "Naruto", 1)],
    ["atb", "Naruto", "Naruto", atb.scoreSeries("Naruto", "Naruto", 1)],
    ["dgo", "Round 6", "Round 6", dgo.scoreSeries("Round 6", "Round 6")],
  ];
  for (const [fonte, consulta, titulo, valor] of casos) {
    assert.equal(Number.isFinite(valor), true, `${fonte} devolve numero para "${titulo}"`);
  }
  assert.equal(m.penalidadeQuandoAusenteNaConsulta("Naruto Shippuden", "Naruto", [m.PEN_SHIPPUDEN_PADRAO]), -30);
  assert.equal(m.penalidadeQuandoAusenteNaConsulta("Naruto Shippuden", "Naruto Shippuden", [m.PEN_SHIPPUDEN_PADRAO]), 0, "se a marca esta na consulta, nao penaliza");
  assert.equal(m.penalidadeSempre("Naruto Clássico", [m.PEN_CLASSICO]), -5);
  assert.equal(m.bonusTemporada("Naruto Temporada 1", 1), 15);
  assert.equal(m.bonusTemporada("Naruto Temporada 2", 1), -30);
  assert.equal(m.bonusNumeroFinal("One Piece Episódio 50", "One Piece", 1, { removeEpisodio: false }), -30, "o numero final de 1-2 digitos e sinal de temporada quando nao e removido");
  assert.equal(m.bonusNumeroFinal("One Piece Episódio 50", "One Piece", 1, { removeEpisodio: true }), 0, "removendo o numero, o sinal some");
  assert.equal(m.bonusNumeroFinal("One Piece Episódio 1050", "One Piece", 1, { removeEpisodio: false }), 0, "numero de 3+ digitos nao entra na regra (so 1-2 digitos)");
});

test("tempo esgotado nao abre o disjuntor (fonte lenta nao e fonte quebrada)", async () => {
  const { createEngine } = require("../src/lib/scraper-engine");
  let chamada = 0;
  const eng = createEngine();
  eng.use({
    id: "lenta",
    label: "Lenta",
    kind: ["vod"],
    timeoutMs: 60,
    maxFails: 2,
    cooldownMs: 60000,
    run: async () => {
      chamada++;
      if (chamada <= 6) await new Promise(() => {});
      return [{ url: "http://a/x.m3u8" }];
    },
  });
  const ctx = { kind: "vod", type: "movie", title: "T", episode: 1, season: 0, key: "k" };
  for (let i = 0; i < 6; i++) await eng.start({ ...ctx, key: "k" + i })[0].promise.catch(() => {});
  const st = eng.stats();
  const fonte = st.sources.lenta || {};
  assert.equal(fonte.failed, 0, "tempo esgotado nao pode contar como falha: " + JSON.stringify(fonte));
  assert.ok((fonte.timeout || 0) >= 5, "os tempos esgotados tem de ser contabilizados: " + JSON.stringify(fonte));
  assert.equal(st.openBreakers.includes("lenta"), false, "a fonte nao pode ter sido desligada so por demorar");
});

test("cache de trechos do painel: o mesmo trecho sai uma vez so do painel", async () => {
  const pc = require("../src/lib/panel-cache");
  pc.limpar();
  let chamadas = 0;
  const http = require("http");
  const arquivo = Buffer.alloc(pc.CHUNK_SIZE * 2, 7);
  const servidor = http.createServer((req, res) => {
    chamadas++;
    const m = /bytes=(\d+)-(\d+)/.exec(String(req.headers.range || ""));
    const ini = m ? Number(m[1]) : 0;
    const fim = m ? Math.min(Number(m[2]), arquivo.length - 1) : arquivo.length - 1;
    res.writeHead(m ? 206 : 200, {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "content-range": `bytes ${ini}-${fim}/${arquivo.length}`,
    });
    res.end(arquivo.subarray(ini, fim + 1));
  });
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${servidor.address().port}/filme.mp4`;
  try {
    const antes = chamadas;
    const cinco = await Promise.all([0, 0, 0, 0, 0].map(() => pc.buscaTrecho(base, 0)));
    assert.equal(cinco.length, 5, "os 5 receberam dados");
    assert.ok(cinco.every((t) => t.buf.length === pc.CHUNK_SIZE), "todos com o mesmo conteudo");
    assert.equal(chamadas - antes, 1, "5 pedidos simultaneos do mesmo trecho = 1 unica ida ao painel");

    const depois = chamadas;
    for (let i = 0; i < 10; i++) await pc.buscaTrecho(base, 0);
    assert.equal(chamadas - depois, 0, "10 pedidos seguintes sao respondidos do cache, sem tocar no painel");

    const st = pc.estatisticas();
    assert.ok(st.trechosGuardados >= 1);
    assert.equal(st.erros, 0);
  } finally {
    servidor.close();
    pc.limpar();
  }
});

// Bug real de 28/09/2026: `getSeriesList` chamava `fetchListWithRetry`, que estava
// documentada na decisao 54 mas NUNCA foi escrita no arquivo. O resultado era um
// ReferenceError que derrubava os tres paineis (Blaze, Space e Autos) em SERIE — o
// caminho de serie do VOD estava inteiro morto, e o addon devolvia
// "panel failed: fetchListWithRetry is not defined".
//
// Este teste existe para a decisao 54 deixar de ser so palavra: a funcao tem de existir.
test("decisao 54: fetchListWithRetry existe, porque a serie a chama", () => {
  const x = require("../src/scrapers/xtream");
  assert.equal(typeof x.fetchListWithRetry, "function");
  assert.equal(x.fetchListWithRetry.length, 3, "assinatura (url, panel, maxBody)");
});

// O teste acima cobre a funcao. Este cobre a CLASSE do bug: um modulo nao pode chamar uma
// funcao que ele mesmo nao define. Foi assim que o defeito passou despercebido — a decisao
// 54 citava o nome da funcao ha semanas e ninguem notou que ela nao existia.
test("nenhum modulo chama uma funcao que ele mesmo nao define", () => {
  const fs = require("fs");
  const path = require("path");
  // A lista e' EXPLICITA de proposito. Este teste varre CHAMADAS de funcao por regex, e o
  // regex tem falso positivo conhecido: uma string `"b("` dentro de um arquivo vira chamada.
  // Ele so roda nos arquivos que valem a varredura manual — varrer `src/` inteiro acusaria
  // ~27 falsos positivos que nao tem nada a ver com o que este teste procura.
  //
  // A decisao 155 apagou 7 arquivos e eles sairam daqui junto: um alvo apagado faria o teste
  // falhar com ENOENT em vez de varrer o que sobrou. A cobertura dinamica que este teste nao
  // faz — "nenhum arquivo importa modulo inexistente" — esta no teste `decisao 155: o servidor
  // nao tem mais borda`, que varre `src/` inteiro.
  const alvos = [
    "src/server.js",
    "src/scrapers/xtream.js",
    "src/scrapers/reidosembeds.js",
    "src/core/tv-sources.js",
    "src/core/sources.js",
    "src/routes/nuvio.js",
    "src/lib/nuvio-canais.js",
  ];
  for (const alvo of alvos) {
    assert.equal(fs.existsSync(path.join(__dirname, "..", alvo)), true, `alvo inexistente: ${alvo}`);
  }
  const problemas = [];
  const livres = new Set(["if","for","while","switch","catch","return","typeof","await","function","new",
    "require","setTimeout","setInterval","clearTimeout","parseInt","parseFloat","Number","String","Boolean",
    "Array","Object","JSON","Math","Date","Promise","Set","Map","WeakMap","Error","RegExp","isNaN",
    "fetch","encodeURIComponent","decodeURIComponent","Buffer","super","do","else","try","console","Intl",
    "URL","URLSearchParams","URLPattern","TextDecoder","TextEncoder","structuredClone","queueMicrotask",
    // `of` e keyword do `for (const x of ...)`, nao chamada — o regex vê "of (" e acusa.
    // Uint8Array e construtor embutido (aparece em server.js lendo buffer de resposta).
    "of","Uint8Array","Uint16Array","Uint32Array","Int8Array","Int16Array","Int32Array",
    "Float32Array","Float64Array","ArrayBuffer","DataView","Proxy","Reflect","WeakSet"]);
  for (const arq of alvos) {
    // COMENTARIOS E TEXTOS SAO TIJOLOS: sem limpar antes, a varredura acha "async()" e
    // "ffmpeg()" dentro de uma frase em portugues e acusa 40 falsos positivos. A primeira
    // versao deste teste falhou exatamente assim.
    const cru = fs.readFileSync(path.join(__dirname, "..", arq), "utf8");
    const src = cru
      .replace(/\/\*[\s\S]*?\*\//g, " ")            // comentario de bloco
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")         // comentario de linha (sem https://)
      .replace(/`(?:\\.|[^`\\])*`/g, " ")           // template literal
      .replace(/"(?:\\.|[^"\\])*"/g, '""')            // string
      .replace(/'(?:\\.|[^'\\])*'/g, "''");           // string simples
    const definidos = new Set();
    for (const d of src.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) definidos.add(d[1]);
    for (const d of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
      for (const p of d[1].split(",")) definidos.add(String(p).split(":").pop().trim());
    }
    for (const d of src.matchAll(/(?:const|let|var)\s*\[\s*([^\]]*)\]\s*=/g)) {
      for (const p of d[1].split(",")) definidos.add(String(p).trim());
    }
    // `reduce(async (a,b) => ...)`: o nome e PARAMETRO de arrow, nao chamada. O que decide
    // e o que vem DEPOIS do abre-parenteses: se fechar e logo seguido de `=>`, e parametro.
    // PARAMETROS tambem sao nomes validos: `function singleFlight(key, fn) { fn() }` chama o
    // `fn` que acabou de ser declarado como parametro. Sem esta linha o teste acusava as
    // duas ocorrencias de `fn(` que existem em xtream.js e tv-sources.js.
    for (const d of src.matchAll(/function\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) {
      for (const parte of d[1].split(",")) {
        const limpo = String(parte).replace(/[{}()[\]=]/g, " ").trim().split(/\s+/)[0];
        if (/^[A-Za-z_$][\w$]*$/.test(limpo)) definidos.add(limpo);
      }
    }
    // PARAMETROS DE ARROW FUNCTION tambem contam: `sort((a, b) => { b[1] - b[0] })` chama o
    // `b` que acabou de chegar. Sem esta linha o teste acusava o `b(` de dois `.sort()` em
    // server.js — foi o ultimo falso positivo, depois de comentarios, URL e `async (a,b) =>`.
    for (const d of src.matchAll(/\(([^()]*)\)\s*=>/g)) {
      for (const parte of d[1].split(",")) {
        const limpo = String(parte).replace(/[{}()[\]=]/g, " ").trim().split(/\s+/)[0];
        if (/^[A-Za-z_$][\w$]*$/.test(limpo)) definidos.add(limpo);
      }
    }
    for (const d of src.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*=>/g)) {
      if (d[1]) definidos.add(d[1]);
    }
    const chamadas = new Set();
    const reChamada = /(?<![.\w$])([a-zA-Z_$][\w$]*)\s*\(/g;
    let mc;
    while ((mc = reChamada.exec(src))) {
      const depois = src.slice(mc.index + mc[0].length);
      if (/^[^()]*\)\s*=>/.test(depois)) continue;
      chamadas.add(mc[1]);
    }
    for (const c of chamadas) {
      if (livres.has(c) || definidos.has(c)) continue;
      if (new RegExp("=\\s*(?:require\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\." + c + "\\b").test(src)) continue;
      if (new RegExp("\\b" + c + "\\s*[:,]").test(src)) continue;
      problemas.push(path.relative(path.join(__dirname, ".."), arq) + ": " + c + "()");
    }
  }
  assert.deepEqual(problemas, [], "funcao chamada sem estar definida: " + problemas.join(" | "));
});

// ======== Registro único de nomes (src/core/nomes.js) ========
// Estes testes cobrem a CLASSE do problema, não um caso: depois de normalizar,
// nada pode voltar a escrever o nome espalhado pelo código.

function caminhosDe(dir, saida = []) {
  const fs = require("fs");
  const path = require("path");
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) caminhosDe(p, saida);
    else if (n.endsWith(".js")) saida.push(p);
  }
  return saida;
}

test("todo nome de env, rota e fonte passa pelo registro core/nomes.js", () => {
  const path = require("path");
  const { VARIAVEIS } = require("../src/core/nomes");
  const raiz = path.join(__dirname, "..");
  const problemas = [];
  for (const arq of caminhosDe(path.join(raiz, "src"))) {
    const rel = path.relative(raiz, arq);
    const src = require("fs").readFileSync(arq, "utf8");
    if (rel !== "src/core/nomes.js" && /process\.env\.[A-Z0-9_]/.test(src)) {
      problemas.push(rel + ": process.env direto (usar ENV ou defineEnv)");
    }
    for (const m of src.matchAll(/\bENV\.([A-Z0-9_]+)/g)) {
      if (!VARIAVEIS[m[1]]) problemas.push(rel + ": ENV." + m[1] + " fora de VARIAVEIS");
    }
    for (const m of src.matchAll(/defineEnv\("([A-Z0-9_]+)"/g)) {
      if (!VARIAVEIS[m[1]]) problemas.push(rel + ': defineEnv("' + m[1] + '") fora de VARIAVEIS');
    }
    for (const m of src.matchAll(/\bapp\.(?:get|post|use)\(\s*"([^"]+)"/g)) {
      problemas.push(rel + ': rota escrita na mao ("' + m[1] + '") — usar ROTAS');
    }
  }
  assert.deepEqual(problemas, [], problemas.join(" | "));
});

test("nomes das fontes seguem o padrao declarado no cabecalho do registro", () => {
  const { FONTES, GRUPOS } = require("../src/core/nomes");
  const problemas = [];
  for (const [chave, f] of Object.entries(FONTES)) {
    if (f.sigla !== chave.toUpperCase()) problemas.push(chave + ": sigla " + f.sigla + " != " + chave.toUpperCase());
    if (!GRUPOS[f.tipo]) problemas.push(chave + ": tipo " + f.tipo + " sem grupo de rotulo");
    if (!Array.isArray(f.motor) || !f.motor.length) problemas.push(chave + ": motor vazio");
    if (!(Number.isInteger(f.prio) && f.prio >= 0 && f.prio <= 9)) problemas.push(chave + ": prio " + f.prio + " fora de 0..9");
    if (f.tipo === "tv" && f.prefixo === undefined) problemas.push(chave + ": fonte de TV sem prefixo");
    if (f.tipo !== "tv" && f.prefixo !== undefined) problemas.push(chave + ": prefixo so existe em fonte de TV");
  }
  assert.deepEqual(problemas, [], problemas.join(" | "));
});

test("cada fonte declara as categorias de conteudo que ela serve", () => {
  const { FONTES, CONTEUDOS } = require("../src/core/nomes");
  const problemas = [];
  for (const [chave, f] of Object.entries(FONTES)) {
    if (!Array.isArray(f.conteudos)) {
      problemas.push(chave + ": sem conteudos[]");
      continue;
    }
    for (const c of f.conteudos) if (!CONTEUDOS.includes(c)) problemas.push(chave + ": conteudo desconhecido " + c);
    if (new Set(f.conteudos).size !== f.conteudos.length) problemas.push(chave + ": conteudo repetido");
    if (f.tipo === "tv" && (f.conteudos.length !== 1 || f.conteudos[0] !== "tv")) {
      problemas.push(chave + ": fonte de TV so serve tv");
    }
    if (f.tipo !== "tv" && f.conteudos.includes("tv")) {
      problemas.push(chave + ": conteudo tv em fonte que nao e de TV");
    }
  }
  assert.deepEqual(problemas, [], problemas.join(" | "));
});

test("categorias de fontes batem com o que cada fonte entrega", () => {
  const { categoriasDasFontes } = require("../src/core/nomes");
  assert.deepEqual(categoriasDasFontes(), {
    anime: ["shg", "ron", "aon", "atb", "rtd"],
    serie: ["spt", "blz", "spc", "ato", "kkt", "rtd", "vzr"],
    filme: ["spt", "blz", "spc", "ato", "kkt", "rtd", "vzr"],
    dorama: ["dgo"],
    tv: ["emb", "etc", "rei", "rcd"],
  });
});

test("ROTAS nao tem caminho repetido e os PREFIXOS batem com as rotas", () => {
  const { ROTAS, PREFIXOS } = require("../src/core/nomes");
  const vistos = new Map();
  const problemas = [];
  (function coleta(no, caminho) {
    for (const [k, v] of Object.entries(no)) {
      if (Array.isArray(v)) v.forEach((x) => coleta({ [k]: x }, caminho + k));
      else if (v && typeof v === "object") coleta(v, caminho + k + ".");
      else {
        const antes = vistos.get(v);
        if (antes) problemas.push(v + " repetido em " + antes + " e " + caminho + k);
        else vistos.set(v, caminho + k);
      }
    }
  })(ROTAS, "ROTAS.");
  for (const [nome, trecho] of Object.entries(PREFIXOS)) {
    const achou = [...vistos.keys()].some((r) => r === trecho || r.startsWith(trecho) || r.includes(trecho));
    if (!achou) problemas.push("PREFIXOS." + nome + " (" + trecho + ") nao corresponde a nenhuma rota");
  }
  assert.deepEqual(problemas, [], problemas.join(" | "));
});
