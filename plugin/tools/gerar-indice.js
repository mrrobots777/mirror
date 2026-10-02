const fs = require("fs");
const path = require("path");

const { chaveDe, primeiraPalavra } = require("../src/lib/indice");
const fontes = require("../src/core/fontes");
const { TETO_CORPO_BYTES } = require("../src/core/sandbox");

const RAIZ = path.join(__dirname, "..");
const ALVO_PADRAO = 400 * 1024;
const FONTES = fontes.fontesComIndice();
const UA = "Mozilla/5.0 (Windows NT.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const AGORA = Math.floor(Date.now() / 1000);

const args = process.argv.slice(2);
const DIRETO = args.includes("--direto");
const ARG_ADDON = (args.find((a) => a.startsWith("--addon=")) || "").split("=")[1] || "";
// `--addon=<dir>` aponta para um clone do repo do addon. Sem ele, usa o `addon/src` do
// monorepo. O workflow de publicacao clona o addon e roda daqui dentro do `plugin/`.
// MEDIDO 02/10/2026: este era o ultimo `addon/` do repo. O addon de VOD virou
// `mirrorstream/`, e a publicacao falhou com "ENOENT .../addon/src/scrapers/xtream.js" — o
// gerador nao achava as credenciais dos paineis e nao gerava indice nenhum.
const ADDON = ARG_ADDON ? path.resolve(RAIZ, ARG_ADDON, "src") : path.join(RAIZ, "..", "mirrorstream", "src");
const SAIDA = process.env.IDICE_SAIDA || path.join(RAIZ, "public", "idx");
const SO = (args.find((a) => !a.startsWith("--")) || "").trim().toLowerCase();
const ALVO = (() => {
  const a = args.find((x) => x.startsWith("--alvo="));
  const n = a ? Number(a.split("=")[1]) : Number(process.env.IDICE_ALVO_BYTES) || ALVO_PADRAO;
  return Math.max(4 * 1024, Math.floor(n) || ALVO_PADRAO);
})();
const SEM_ESCREVER = process.env.IDICE_SALVA === "1";
const USA_CACHE = process.env.IDICE_CACHE === "1";
const CACHE_DIR = process.env.IDICE_CACHE_DIR || path.join(require("os").tmpdir(), "nuvio-idx");

function workerDe(fonte) {
  try {
    const nomes = require(path.join(ADDON, "core", "nomes.js"));
    return nomes.workerDe(fonte);
  } catch (_) {
    return "";
  }
}

function campoDe(bloco, nome) {
  const re = new RegExp(`${nome}\\s*:\\s*(?:ENV\\.[A-Z0-9_]+\\s*\\|\\|\\s*)?"([^"]*)"`);
  const m = bloco.match(re);
  return m ? m[1] : "";
}

function campoEnv(bloco, nome, variavel) {
  const re = new RegExp(`${nome}\\s*:\\s*ENV\\.${variavel}\\s*\\|\\|\\s*"([^"]*)"`);
  const m = bloco.match(re);
  return process.env[variavel] || (m ? m[1] : "");
}

function paineisDoAddon() {
  const txt = fs.readFileSync(path.join(ADDON, "scrapers", "xtream.js"), "utf8");
  const mapa = {};
  for (const pedaco of txt.split("panels.push({").slice(1)) {
    const bloco = pedaco.split("});")[0];
    const chave = (bloco.match(/sourceKey\s*:\s*"([a-z0-9]+)"/) || [])[1];
    if (!chave) continue;
    mapa[chave] = {
      sigla: (chave || "").toUpperCase(),
      servidor: campoEnv(bloco, "server", "IPTV_SERVER") || campoDe(bloco, "server"),
      porta: campoEnv(bloco, "port", "IPTV_PORT") || campoDe(bloco, "port") || "443",
      usuario: campoDe(bloco, "username"),
      senha: campoDe(bloco, "password"),
      wrapVideo: /wrapVideo\s*:\s*true/.test(bloco),
      sempreEmbrulhar: /sempreEmbrulhar\s*:/.test(bloco)
    };
  }
  if (!mapa.spc) {
    mapa.spc = {
      sigla: "SPC",
      servidor: campoEnv(txt, "server", "XTREAM_SPACE_SERVER"),
      porta: campoEnv(txt, "port", "XTREAM_SPACE_PORT") || "80",
      usuario: campoEnv(txt, "username", "XTREAM_SPACE_USER"),
      senha: campoEnv(txt, "password", "XTREAM_SPACE_PASS"),
      wrapVideo: false,
      sempreEmbrulhar: false
    };
  }
  return mapa;
}

function painelDoPlugin(chave) {
  const arquivo = path.join(RAIZ, "src", "scrapers", fontes.arquivoDe(chave));
  if (!fs.existsSync(arquivo)) return null;
  const txt = fs.readFileSync(arquivo, "utf8");
  return {
    sigla: campoDe(txt, "sigla"),
    idx: campoDe(txt, "idx"),
    servidor: campoDe(txt, "servidor"),
    porta: campoDe(txt, "porta"),
    usuario: campoDe(txt, "usuario"),
    senha: campoDe(txt, "senha")
  };
}

function comparaCredencial(chave, doAddon, doPlugin) {
  const linhas = [];
  if (doPlugin.idx !== chave) linhas.push(`  ${chave}.idx: esperado "${chave}", plugin diz "${doPlugin.idx}" (e o namespace do shard)`);
  if (doPlugin.sigla !== chave.toUpperCase()) linhas.push(`  ${chave}.sigla: esperado "${chave.toUpperCase()}", plugin diz "${doPlugin.sigla}"`);
  for (const campo of ["servidor", "porta", "usuario", "senha"]) {
    const a = String(doAddon[campo] || "");
    const b = String(doPlugin[campo] || "");
    if (a !== b) linhas.push(`  ${chave}.${campo}: addon="${a}" plugin="${b}"`);
  }
  return linhas;
}

function baseDe(painel) {
  const proto = String(painel.porta) === "80" ? "http" : "https";
  return `${proto}://${painel.servidor}:${painel.porta}`;
}

function urlDe(painel, acao, extra, fonte) {
  const interna = `${baseDe(painel)}/player_api.php?username=${encodeURIComponent(painel.usuario)}&password=${encodeURIComponent(painel.senha)}&action=${acao}${extra || ""}`;
  if (DIRETO) return interna;
  const worker = workerDe(fonte);
  if (!worker) return interna;
  return `${worker}/proxy?url=${encodeURIComponent(interna)}`;
}

async function pegaJson(url, cache) {
  if (cache && USA_CACHE) {
    try {
      const texto = fs.readFileSync(path.join(CACHE_DIR, cache), "utf8");
      return { dados: JSON.parse(texto), bytes: texto.length, ms: 0, doCache: true };
    } catch (_) {}
  }
  const t0 = Date.now();
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), 120e3);
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const t = await r.text();
    if (cache && USA_CACHE) {
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(path.join(CACHE_DIR, cache), t);
      } catch (_) {}
    }
    return { dados: JSON.parse(t), bytes: t.length, ms: Date.now() - t0 };
  } finally {
    clearTimeout(relogio);
  }
}

function anoDe(bruto, nome) {
  const n = Number(bruto);
  if (Number.isFinite(n) && n >= 1890 && n <= 2200) return n;
  const s = String(nome || "");
  const paren = s.match(/\(((?:19|20)\d{2})\)/);
  if (paren) return Number(paren[1]);
  const fim = s.match(/(?:^|\s)((?:19|20)\d{2})\s*$/);
  return fim ? Number(fim[1]) : 0;
}

function norm(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function itemDe(x, serie) {
  const nome = String(x.name || x.title || "").trim();
  if (!nome) return null;
  const id = Number(serie ? x.series_id : x.stream_id);
  if (!Number.isFinite(id)) return null;
  const ext = String(x.container_extension || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return [id, norm(nome), nome, serie ? 1 : 0, anoDe(x.year || x.releaseDate || x.release_date, nome), ext];
}

function serializa(itens, fonte, chave, partes) {
  const ordenados = itens.slice().sort((a, b) => (String(a[1]) < String(b[1]) ? -1 : String(a[1]) > String(b[1]) ? 1 : a[0] - b[0]));
  return JSON.stringify({ v: 1, f: fonte, g: AGORA, k: chave, n: ordenados.length, it: ordenados });
}

function stubDe(fonte, chave, partes) {
  return JSON.stringify({ v: 1, f: fonte, g: AGORA, d: 1, k: chave, p: partes });
}

function letraDoItem(item) {
  return chaveDe(String(item[1] || ""));
}

function segundaDoItem(item) {
  const palavra = primeiraPalavra(String(item[1] || ""), true);
  const c = String(palavra || "").charAt(1) || "_";
  return /^[a-z0-9]$/.test(c) ? c : "_";
}

function apagaTudo(diretorio) {
  if (!fs.existsSync(diretorio)) return;
  for (const nome of fs.readdirSync(diretorio)) {
    const alvo = path.join(diretorio, nome);
    if (fs.statSync(alvo).isDirectory()) {
      apagaTudo(alvo);
      fs.rmdirSync(alvo);
    } else {
      fs.unlinkSync(alvo);
    }
  }
}

function escreve(fonte, relativo, conteudo) {
  const alvo = path.join(SAIDA, fonte, relativo);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo);
  return Buffer.byteLength(conteudo);
}

function sharda(fonte, itens) {
  const baldes = new Map();
  for (const item of itens) {
    const l = letraDoItem(item);
    if (!baldes.has(l)) baldes.set(l, []);
    baldes.get(l).push(item);
  }
  const arquivos = [];
  const letras = {};
  for (const [l, lista] of [...baldes.entries()].sort()) {
    const corpo = serializa(lista, fonte, l);
    if (Buffer.byteLength(corpo) <= ALVO) {
      const bytes = escreve(fonte, `${l}.json`, corpo);
      arquivos.push({ chave: `${l}.json`, bytes, itens: lista.length, nivel: 1 });
      letras[l] = { itens: lista.length, bytes, nivel: 1 };
      continue;
    }
    const sub = new Map();
    for (const item of lista) {
      const k = segundaDoItem(item);
      if (!sub.has(k)) sub.set(k, []);
      sub.get(k).push(item);
    }
    const partes = [];
    for (const [k, subLista] of [...sub.entries()].sort()) {
      const chave = `${l}/${l}${k}`;
      const subCorpo = serializa(subLista, fonte, chave);
      const bytes = escreve(fonte, `${chave}.json`, subCorpo);
      arquivos.push({ chave: `${chave}.json`, bytes, itens: subLista.length, nivel: 2 });
      partes.push(chave);
    }
    const bytesStub = escreve(fonte, `${l}.json`, stubDe(fonte, l, partes));
    arquivos.push({ chave: `${l}.json`, bytes: bytesStub, itens: 0, nivel: 0, stub: true });
    letras[l] = {
      itens: lista.length,
      bytes: Buffer.byteLength(corpo),
      nivel: 2,
      partes: partes.length,
      maiorParte: Math.max(...partes.map((p) => (arquivos.find((a) => a.chave === `${p}.json`) || {}).bytes || 0))
    };
  }
  return { arquivos, letras };
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

(async () => {
  const paineis = paineisDoAddon();
  const divergencias = [];
  for (const fonte of FONTES) {
    const doAddon = paineis[fonte];
    const doPlugin = painelDoPlugin(fonte);
    if (!doAddon) { divergencias.push(`  ${fonte}: nao achei o painel no src/scrapers/xtream.js`); continue; }
    if (!doPlugin) { divergencias.push(`  ${fonte}: nao achei src/scrapers/${fontes.arquivoDe(fonte)}`); continue; }
    divergencias.push(...comparaCredencial(fonte, doAddon, doPlugin));
  }
  if (divergencias.length) {
    console.error("[indice] CREDENCIAL DIVERGENTE entre o addon e o plugin (o gerador parou):");
    for (const l of divergencias) console.error(l);
    process.exit(1);
  }
  console.log("[indice] credenciais conferem com src/scrapers/xtream.js");
  console.log(`[indice] alvo por shard: ${ALVO} bytes (${(ALVO / 1024).toFixed(0)} KB)${SEM_ESCREVER ? " — MODO LEITURA: nada foi escrito" : ""}`);
  console.log(`[indice] saida: ${SAIDA}/<fonte>/<letra>.json  (via ${DIRETO ? "direto do painel" : "worker por fonte"}${USA_CACHE ? ", com cache em " + CACHE_DIR : ""})`);

  if (!SEM_ESCREVER) {
    apagaTudo(SAIDA);
    fs.mkdirSync(SAIDA, { recursive: true });
  }

  const relatorio = {};
  let totalItens = 0;
  let totalBytes = 0;
  for (const fonte of FONTES) {
    if (SO && SO !== fonte) continue;
    const painel = paineis[fonte];
    const vod = await pegaJson(urlDe(painel, "get_vod_streams", "", fonte), `${fonte}-vod.json`);
    const serie = await pegaJson(urlDe(painel, "get_series", "", fonte), `${fonte}-ser.json`);
    const itens = [];
    for (const x of Array.isArray(vod.dados) ? vod.dados : []) { const it = itemDe(x, false); if (it) itens.push(it); }
    const vodN = itens.length;
    for (const x of Array.isArray(serie.dados) ? serie.dados : []) { const it = itemDe(x, true); if (it) itens.push(it); }
    const vistos = new Set();
    const unicos = itens.filter((it) => {
      const marca = `${it[3]}:${it[0]}`;
      if (vistos.has(marca)) return false;
      vistos.add(marca);
      return true;
    });
    const { arquivos, letras } = sharda(fonte, unicos);
    const maior = arquivos.reduce((a, b) => (b.bytes > a.bytes ? b : a), arquivos[0]);
    const bytes = arquivos.reduce((a, b) => a + b.bytes, 0);
    totalItens += unicos.length;
    totalBytes += bytes;
    relatorio[fonte] = {
      painel: baseDe(painel),
      via: DIRETO ? "direto" : workerDe(fonte) || "direto",
      vod: vodN,
      serie: unicos.length - vodN,
      itens: unicos.length,
      bytes,
      arquivos: arquivos.length,
      maiorShard: { chave: maior.chave, bytes: maior.bytes, itens: maior.itens },
      letras,
      brutos: { vod: vod.bytes, serie: serie.bytes, msVod: vod.ms, msSerie: serie.ms }
    };
    console.log(
      `[indice] ${fonte.toUpperCase()} ${String(unicos.length).padStart(6)} itens (${vodN} filme + ${unicos.length - vodN} serie) | ` +
      `bruto ${mb(vod.bytes)}/${mb(serie.bytes)} em ${(vod.ms / 1000).toFixed(1)}s/${(serie.ms / 1000).toFixed(1)}s | ` +
      `indice ${mb(bytes)} em ${arquivos.length} arquivo(s) | maior shard ${maior.chave} ${(maior.bytes / 1024).toFixed(0)} KB (${maior.itens} itens)`
    );
    const grandes = Object.entries(letras).filter(([, v]) => v.nivel === 2);
    if (grandes.length) console.log(`[indice] ${fonte.toUpperCase()} letras em 2 niveis: ${grandes.map(([l, v]) => `${l}(${v.partes} partes, maior ${Math.round(v.maiorParte / 1024)} KB)`).join(", ")}`);
  }

  if (SEM_ESCREVER) {
    console.log("[indice] MODO LEITURA: nenhum arquivo escrito (use para medir antes de gravar).");
    return;
  }
  const indice = { v: 1, geradoEm: AGORA, geradoEmIso: new Date().toISOString(), alvoBytes: ALVO, totalItens, totalBytes, fontes: relatorio };
  const bytesIndice = Buffer.byteLength(`${JSON.stringify(indice, null, 2)}\n`);
  fs.writeFileSync(path.join(SAIDA, "indice.json"), `${JSON.stringify(indice, null, 2)}\n`);
  console.log(`[indice] TOTAL ${totalItens} itens em ${mb(totalBytes)} + ${(bytesIndice / 1024).toFixed(1)} KB de indice.json`);
  console.log(`[indice] maior shard do conjunto: ${(Math.max(...FONTES.filter((f) => relatorio[f]).map((f) => relatorio[f].maiorShard.bytes)) / 1024).toFixed(0)} KB (teto do runtime: ${(TETO_CORPO_BYTES / 1024).toFixed(0)} KB)`);
  console.log("[indice] fontes com shard sao as do registro que tem `idx` (src/core/fontes.js): " + FONTES.join(", "));
  console.log("[indice] kkt NAO entra: e o mesmo painel do blz (kakito.xyz, mesmas credenciais) e o dedup por host+path do addon ja colapsa os dois — indexar seria 48,8 MB de M3U para os mesmos arquivos.");
})().catch((e) => {
  console.error("[indice] erro:", e && e.message ? e.message : e);
  process.exit(1);
});