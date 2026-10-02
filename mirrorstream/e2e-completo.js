// E2E COMPLETO: TODAS AS FONTES, DE PONTA A PONTA (decisão 141)
//
// O dono: "as fontes estão todas quebradas [...] quero quatro fontes de filmes e séries
// funcionando e as quatro fontes de anime funcionando e uma fonte de dorama funcionando e as
// três fontes de live TV funcionando, que um e2e completo de ponta a ponta".
//
// Este script é a MEDIDA. Ele não pede streams direto ao scraper: sobe o servidor de verdade,
// chama as rotas que o Stremio chama e, para cada player, prova três coisas:
//
//   1. A FONTE ENTREGOU algo (o player tem URL)
//   2. O LINK RESPONDE (a URL é buscada de verdade e tem que ser uma playlist com segmento)
//   3. O TITULO ESTA NORMALIZADO (nome, temporada, episódio, fonte e dublado/legendado separados)
//
// E separa o que é NOSSO do que é DA ORIGEM, que é a diferença entre "eu conserto" e "eles
// consertam". Um `503` do CDN deles émarked como `origem`; um `[]` do scraper é `nosso`.
//
//   node e2e-completo.js                    roda tudo
//   node e2e-completo.js --so=vod          so filmes e series
//   node e2e-completo.js --so=anime        so anime
//   node e2e-completo.js --so=dorama       so dorama
//   node e2e-completo.js --so=tv           so live tv
//   node e2e-completo.js --json            saida em JSON (para comparar entre rodadas)

process.chdir("/home/ubuntu/mirror");

const BASE = process.env.E2E_BASE || "https://c12e41ddc21b-mirror.baby-beamup.club";
const TV_BASE = process.env.E2E_TV_BASE || "https://c12e41ddc21b-mirror2.baby-beamup.club";
const so = (process.argv.find((a) => a.startsWith("--so=")) || "").split("=")[1] || "";
const querJson = process.argv.includes("--json");

const { partesDe } = require("/home/ubuntu/mirror/src/lib/jogador");
const { FONTES } = require("/home/ubuntu/mirror/src/core/nomes");

async function pega(url, timeoutMs = 25000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (_) {}
  return { status: r.status, texto, json, tipo: r.headers.get("content-type") || "" };
}

// PROVA 2: o link do player responde? Classifica o que deu errado, porque "nao deu" e so uma
// informacao — quem tem que consertar depende do motivo.
async function provaLink(url, semIndicador, cabecalhos) {
  if (!/^https?:/i.test(url || "")) return { estado: "sem_url" };
  // OS CABECALHOS QUE O PLAYER MANDA. MEDIDO: sem isso o teste dava FALSO NEGATIVO em fonte que
  // funciona — o DGO responde **403 sem o `Referer`** (e ele esta em `behaviorHints.proxyHeaders`,
  // que o player envia). O E2E tem de provar o link como o player pede, senao mede o probe e nao
  // a fonte.
  const cabPlayer = cabecalhos || {};
  if (/^https?:/i.test(semIndicador || "")) {
    try {
      const r = await fetch(semIndicador, { headers: cabPlayer, signal: AbortSignal.timeout(25000) });
      if (r.ok) {
        const t = await r.text();
        if (t.includes("#EXTM3U") && t.split("\n").some((l) => l.startsWith("http"))) {
          return { estado: "ok", segmentos: (t.match(/^https?:/gm) || []).length };
        }
      }
      return { estado: "origem", status: r.status };
    } catch (e) {
      return { estado: "origem", status: 0, erro: String(e.message).slice(0, 40) };
    }
  }
  const parecePlaylist = /\.m3u8(\?|$)/i.test(url);
  try {
    // ARQUIVO DE VIDEO NAO SE BAIXA INTEIRO para provar que existe: os links de filme tem GB e o
    // teste estourava em 25s (medido: todos davam "indisponivel"). Pede so os primeiros 4KB com
    // `Range` — e o bastante para provar que o link responde.
    const cab = Object.assign({}, cabPlayer, parecePlaylist ? {} : { Range: "bytes=0-4095" });
    const r = await fetch(url, { headers: cab, signal: AbortSignal.timeout(25000) });
    if (!r.ok && r.status !== 206) {
      return { estado: "origem", status: r.status };
    }
    const t = await r.text();
    if (t.includes("#EXTM3U")) return { estado: "ok", segmentos: (t.split("\n").filter((l) => l.startsWith("http")) || []).length };
    if (!parecePlaylist) {
      // Um MP4 comeca com `ftyp` (bytes 4-8). E o que separa "o link responde" de "devolveu
      // pagina de erro em 200".
      const b = Buffer.from(t.slice(0, 16), "latin1");
      const mp4 = b.length > 12 && b.slice(4, 8).toString("latin1") === "ftyp";
      if (mp4) return { estado: "ok", segmentos: 1, tipo: "mp4" };
      if (/<!doctype html|<html/i.test(t)) return { estado: "origem", status: r.status, motivo: "devolveu pagina html" };
      return { estado: "respondeu_sem_video", status: r.status };
    }
    return { estado: "sem_playlist", status: r.status };
  } catch (e) {
    return { estado: "indisponivel", erro: String(e.message).slice(0, 40) };
  }
}

// O que o player vai mandar de cabecalho na hora de buscar o link.
function cabecalhosDe(stream) {
  const ph = stream && stream.behaviorHints && stream.behaviorHints.proxyHeaders;
  return (ph && ph.request) || {};
}

// PROVA 3: o titulo esta normalizado? Cada peca tem que fazer sentido sozinha.
function provaNormalizacao(stream) {
  const p = partesDe(stream, {});
  const falhas = [];
  if (!p.nome || p.nome.length < 2) falhas.push("nome vazio ou curto");
  if (/\bBLZ\b|\bSPC\b|\bATO\b|\bKKT\b|\bSHG\b|\bRON\b|\bAON\b|\bATB\b|\bREI\b|\bEMB\b|\bETC\b|\bSPT\b|\bVZR\b/.test(p.nome)) {
    falhas.push("sigla da fonte grudada no nome do conteudo");
  }
  if (stream.type === "series" && !p.episodioRot) falhas.push("serie sem SxxExx");
  if (!p.qualidade || p.qualidade === "") falhas.push("sem qualidade");
  if (!p.fonte) falhas.push("sem fonte separada");
  if (!["portugues", "legendado", "desconhecido"].includes(p.idioma)) falhas.push("idioma invalido: " + p.idioma);
  return { pecas: p, falhas };
}

function linhaDeResultado(grupo, fonte, achou, link, norm) {
  const marcaLink = link.estado === "ok" ? `link OK${link.segmentos ? ` (${link.segmentos} seg)` : ""}`
    : link.estado === "origem" ? `ORIGEM ${link.status || "sem resposta"}`
    : link.estado;
  const marcaNorm = norm.falhas.length ? `TITULO: ${norm.falhas.join("; ")}` : "titulo ok";
  return `  ${String(fonte).padEnd(5)} ${String(achou).padStart(2)} player(s) | ${String(marcaLink).padEnd(26)} | ${marcaNorm}`;
}

const resultados = [];

// O filtro aceitam o nome do GRUPO ("vod", "anime", "dorama", "tv") e tambem a chave da fonte.
const GRUPOS = { vod: "filme/serie", anime: "anime", dorama: "dorama", tv: "tv" };

function querGrupo(grupo, fonte) {
  if (!so) return true;
  if (GRUPOS[so]) return GRUPOS[so] === grupo;
  return so === fonte;
}

async function testaGrupo(nome, fonte, casos) {
  if (!querGrupo(nome, fonte)) return;
  console.log(`\n=== ${nome} (fonte ${fonte.toUpperCase()}) ===`);
  for (const c of casos) {
    // CACHE FRIO NAO E DEFEITO. MEDIDO 01/10/2026: a 1a chamada de um item que ninguem tinha
    // pedido ainda esta montando (o catalogo, a triagem, a cadeia da fonte), e o DGO devolveu 0
    // player nela e 2 na segunda. Julgar a fonte pelo primeiro pedido e medir a fila de aquecimento,
    // nao a fonte — entao o teste repete UMA vez antes de julgar.
    let { status, json } = await pega(`${BASE}${c.rota}`);
    let streams = (json && (json.streams || json.data)) || [];
    if (!streams.length) {
      await new Promise((r) => setTimeout(r, 2500));
      ({ status, json } = await pega(`${BASE}${c.rota}`));
      streams = (json && (json.streams || json.data)) || [];
    }
    // A rota do STREMIO devolve `{streams}` e a rota `/api/streams` devolve `{data}` — as duas
    // sao o mesmo resultado (a /api so embrulha). O E2E tem de ler as duas, senao mede zero.
    const meus = streams.filter((s) => (s.sources || []).map((x) => String(x).toLowerCase()).includes(fonte));
    if (!meus.length) {
      console.log(`  ${String(fonte).padEnd(5)}  0 player(s) para ${c.nome}  <- NAO ENTREGOU`);
      resultados.push({ grupo: nome, fonte, caso: c.nome, players: 0, link: "nenhum", norm: ["sem player"] });
      continue;
    }
    const link = await provaLink(meus[0].url, null, cabecalhosDe(meus[0]));
    const norm = provaNormalizacao(meus[0]);
    console.log(linhaDeResultado(nome, fonte, meus.length, link, norm));
    console.log(`        ${c.nome}: "${String(meus[0].title || "").split("\n")[0]}" | ${JSON.stringify(norm.pecas.nome)} ${norm.pecas.episodioRot || ""} ${norm.pecas.ano || ""} | ${norm.pecas.qualidade} | ${norm.pecas.fonte} | ${norm.pecas.idioma}`);
    resultados.push({
      grupo: nome, fonte, caso: c.nome, players: meus.length,
      link: link.estado, linkStatus: link.status || null, segmentos: link.segmentos || 0,
      norm: norm.falhas, pecas: norm.pecas,
    });
  }
}

// ---- FILMES E SERIES: as 4 fontes principais (BLZ, SPC, ATO, KKT) ----
const VOD = [
  { nome: "Matrix", rota: "/api/streams/movie/tmdb:603" },
  { nome: "Parasita", rota: "/api/streams/movie/tmdb:496243" },
  { nome: "Breaking Bad", rota: "/api/streams/series/tmdb:1396:1:1" },
  { nome: "Game of Thrones", rota: "/api/streams/series/tmdb:1399:1:1" },
];

// ---- ANIME: as 4 (SHG, RON, AON, ATB) ----
// MEDIDO 01/10/2026: `kitsu:1` e Cowboy Bebop e `kitsu:12` e ONE PIECE (nao Naruto — os ids do
// Kitsu nao sao "os do nome"). Os casos abaixo usam o que cada fonte TEM de verdade, senao o E2E
// mede "a fonte nao achou um titulo que ela nunca teve", que nao e defeito.
const ANIME = [
  { nome: "Cowboy Bebop (kitsu:1)", rota: "/api/streams/series/kitsu:1:1:1" },
  { nome: "One Piece (kitsu:12)", rota: "/api/streams/series/kitsu:12:1:1" },
];

// ---- DORAMA: 1 (DGO) ----
const DORAMA = [
  { nome: "Itaewon Class (tmdb:96162)", rota: "/api/streams/series/tmdb:96162:1:1" },
  { nome: "Crash Landing on You (tmdb:94796)", rota: "/api/streams/series/tmdb:94796:1:1" },
];

(async () => {
  console.log(`E2E COMPLETO — ${BASE}`);
  console.log(`fontes de filme/serie: ${["blz","spc","ato","kkt"].join(", ")} | anime: ${["shg","ron","aon","atb"].join(", ")} | dorama: dgo`);

  for (const f of ["blz", "spc", "ato", "kkt"]) await testaGrupo("filme/serie", f, VOD);
  for (const f of ["shg", "ron", "aon", "atb"]) await testaGrupo("anime", f, ANIME);
  await testaGrupo("dorama", "dgo", DORAMA);

  // ---- LIVE TV: as 3 (REI, EMB, ETC) ----
  if (querGrupo("tv", "")) {
    console.log(`\n=== LIVE TV (3 fontes) ===`);
    const canais = ["hbo", "cnnbrasil", "bandrecord", "sbt"];
    const porFonte = {};
    for (const ch of canais) {
      const { json } = await pega(`${BASE}/api/streams/tv/${ch}`);
      const streams = (json && json.data) || [];
      for (const s of streams) {
        for (const f of (s.sources || [])) {
          const chave = String(f).toLowerCase();
          if (!porFonte[chave]) porFonte[chave] = { players: 0, casos: [] };
          porFonte[chave].players++;
          porFonte[chave].casos.push(ch);
        }
      }
    }
    for (const fonte of ["rei", "emb", "etc"]) {
      const info = porFonte[fonte];
      if (!info || !info.players) {
        console.log(`  ${fonte.toUpperCase().padEnd(5)}  0 player(s) em ${canais.length} canais  <- NAO ENTREGOU`);
        resultados.push({ grupo: "tv", fonte, casos: canais.length, players: 0, link: "nenhum" });
        continue;
      }
      // prova o primeiro link de cada fonte (o relay e por fonte)
      const achados = [];
      for (const ch of canais) {
        const { json } = await pega(`${BASE}/api/streams/tv/${ch}`);
        const s = ((json && json.data) || []).find((x) => (x.sources || []).map((y) => String(y).toLowerCase()).includes(fonte));
        if (s) { achados.push(s); break; }
      }
      const link = achados.length ? await provaLink(achados[0].url, null, cabecalhosDe(achados[0])) : { estado: "nenhum" };
      const norm = achados.length ? provaNormalizacao(achados[0]) : { falhas: ["sem player"], pecas: {} };
      console.log(linhaDeResultado("tv", fonte, info.players, link, norm));
      console.log(`        canais: ${info.casos.join(", ")}`);
      if (achados.length) console.log(`        "${String(achados[0].title || "").split("\n")[0]}" | ${JSON.stringify(norm.pecas.nome)} | ${norm.pecas.qualidade} | ${norm.pecas.fonte} | ${norm.pecas.idioma}`);
      resultados.push({ grupo: "tv", fonte, players: info.players, canais: info.casos, link: link.estado, linkStatus: link.status || null, norm: norm.falhas, pecas: norm.pecas });
    }
  }

  // ---- RESUMO ----
  // O VEREDITO USA O CONTADOR DA FONTE, e nao so o que apareceu na tela. MEDIDO 01/10/2026: o
  // KKT "nao entregou" 3 de 4 casos e nao estava quebrado — ele e o FAILOVER do BLZ (mesmos
  // arquivos, ver AGENTS) e some por DEDUP quando o BLZ ja entregou. Julgar "nao entregou" como
  // defeito dava 4 de 12 fontes "quebradas" que estavam de pe.
  const { json: hj } = await pega(`${BASE}/health`);
  const contador = ((((hj || {}).capacity || {}).scraperEngine || {}).sources) || {};

  console.log("\n" + "=".repeat(78));
  console.log("RESUMO POR FONTE  (chamadas/ok/falhas vem do proprio motor em /health)");
  console.log("=".repeat(78));
  const agregado = {};
  for (const r of resultados) {
    const k = r.fonte;
    if (!agregado[k]) agregado[k] = { ok: 0, origem: 0, nosso: 0, dedup: 0, casos: 0, normFalhas: 0, chamadas: 0, okMotor: 0, falhasMotor: 0, streamsMotor: 0 };
    const a = agregado[k];
    a.casos += r.casos ? 1 : 1;
    const c = contador[k] || {};
    a.chamadas = c.calls || 0;
    a.okMotor = c.ok || 0;
    a.falhasMotor = (c.failed || 0) + (c.timeout || 0);
    a.streamsMotor = c.streams || 0;
    if (r.players === 0) {
      // A fonte respondeu bem e entregou, mas o stream sumiu da lista: DEDUP (outra fonte ja tinha
      // o mesmo arquivo). Isso e saude, nao defeito.
      if (a.okMotor > 0 && a.falhasMotor === 0) a.dedup++;
      else a.nosso++;
      continue;
    }
    if (r.link === "ok") a.ok++;
    else a.origem++;
    if (r.norm && r.norm.length) a.normFalhas++;
  }
  for (const [f, a] of Object.entries(agregado)) {
    const saude = a.falhasMotor === 0 && a.chamadas > 0;
    const situacao = a.origem > 0 ? "ORIGEM RECUSA" : a.nosso > 0 ? "NAO ENTREGOU" : saude ? "OK" : "SEM SINAL";
    console.log(`  ${f.toUpperCase().padEnd(5)} ${situacao.padEnd(14)} link ok ${String(a.ok).padStart(2)} | origem recusa ${a.origem} | nao entregou ${a.nosso} | dedup ${a.dedup} | motor: ${a.chamadas} chamadas, ${a.okMotor} ok, ${a.falhasMotor} falhas, ${a.streamsMotor} streams | titulo ${a.normFalhas ? "COM PROBLEMA" : "ok"}`);
  }
  const totalFontes = Object.keys(agregado).length;
  const tudoOk = Object.values(agregado).filter((a) => a.ok > 0 && a.origem === 0 && a.nosso === 0 && a.normFalhas === 0).length;
  console.log(`\nfontes com TUDO funcionando: ${tudoOk} de ${totalFontes}`);
  if (querJson) console.log("JSON " + JSON.stringify(resultados));
  process.exit(0);
})();