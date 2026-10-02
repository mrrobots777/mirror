// Bateria COMPLETA: as 15 fontes, N casos cada, ponta a ponta.
//
//   node tools/bateria-completa.js                 # tudo
//   node tools/bateria-completa.js vod             # so VOD/anime/dorama
//   node tools/bateria-completa.js tv              # so TV ao vivo
//   node tools/bateria-completa.js vzr blz         # so essas fontes
//   CONC=3 node tools/bateria-completa.js          # menos casos por fonte
//
// O que ela mede, por fonte e por caso:
//
//   1. TEMPO      — quanto a fonte leva do `getStreams` ate devolver a lista. E o que
//                   o usuario espera na tela antes de o primeiro player aparecer.
//   2. ENTREGA    — devolveu stream? lancou erro? Erro e diferente de `[]`: erro
//                   marca a fonte como "com erro" no app, `[]` e "sem fonte".
//   3. CONTRATO   — o objeto que o Nuvio vai ler. Confere o que o app DELE:
//                   `name` (linha 1), `quality` (que o app usa para completar a
//                   linha 1 e para ordenar), `title` (linha 2) e `url`. Sem `quality`
//                   o app escreve "Desconhecido" — ver `src/lib/apresentacao.js`.
//   4. QUALIDADE  — quantos streams sairam com a resolucao REAL lida do video.
//   5. VIVO       — Range de 2 KB no link, com os mesmos cabecalhos que o player
//                   manda. `INDECISO` (429) e `BLOQUEADO` (recusa a IP de
//                   datacenter) NAO contam como morto: sao situacoes em que o link
//                   pode tocar no aparelho do usuario e nao da para provar daqui.
//
// NADA aqui e bundlado: e tooling Node.

const path = require("path");
const fontes = require("../src/core/fontes");
const { chaveTmdb, PADRAO, casosDosArgs } = require("./casos");
const { um: provar } = require("./provar-links");
const canal = require("../src/lib/canal");

const chave = chaveTmdb();
if (chave) globalThis.TMDB_API_KEY = chave;

const TEMPOS = [2500, 5000, 10000, 15000, 25000, 35000, 60000];
const CONC_PADRAO = 3;
const CASOS_TV_PADRAO = [
  "1141\tHBO 2",
  "1061\tCultura Brasil",
  "1121\tGazeta",
  "1241\tSBT PI",
  "1281\tTNT Novelas"
];

function classeDe(ms) {
  let i = 0;
  while (i < TEMPOS.length - 1 && ms > TEMPOS[i]) i += 1;
  return i;
}

// O que o app FAZ com o objeto. Medido em `StreamRepositoryImpl.toPluginStream`:
// a linha 1 e `name` e o app acrescenta " - <quality>"; quando `quality` vem
// vazio, ele escreve o rotulo de localizacao do device. O mesmo contrato esta em
// `src/lib/apresentacao.js` — aqui a bateria so confere que a fonte obedeceu.
function confereContrato(fonte, stream) {
  const falta = [];
  if (!stream || typeof stream !== "object") return ["nao e objeto"];
  if (typeof stream.url !== "string" || !/^https?:\/\//i.test(stream.url)) falta.push("url ausente ou nao http(s)");
  if (typeof stream.name !== "string" || !stream.name.trim()) falta.push("name vazio (linha 1)");
  if (typeof stream.title !== "string" || !stream.title.trim()) falta.push("title vazio (linha 2)");
  if (!fonte.conteudos.includes("tv") && !stream.quality) falta.push("sem quality (o app escreve 'Desconhecido')");
  const sigla = fonte.sigla;
  if (!String(stream.title || "").includes(sigla)) falta.push(`title sem a sigla ${sigla}`);
  // Campos que o runtime do Nuvio NAO conhece: o LocalScraperResult e um data class
  // do Moshi, e campo a mais pode fazer o parse falhar em runtime.
  const ACEITOS = new Set([
    "name", "title", "description", "url", "quality", "size", "language", "provider",
    "type", "seeders", "peers", "infoHash", "headers", "subtitles"
  ]);
  for (const campo of Object.keys(stream)) {
    if (!ACEITOS.has(campo)) falta.push(`campo "${campo}" nao existe no LocalScraperResult do Nuvio`);
  }
  return falta;
}

async function rodaCaso(fonte, caso, rotulo) {
  const modulo = path.join(__dirname, "..", "dist", fontes.bundleDe(fonte));
  // TV ao vivo: um canal que NAO existe nesta fonte nao e defeito — e a resposta
  // certa. O mapa estatico (`src/lib/canais.js`, gerado do catalogo do addon) diz
  // quem tem o que, entao a bateria separa "a fonte nao tem este canal" de "a fonte
  // tem e nao entregou", que sao defeitos de natureza oposta.
  const alvoCanal = caso[1] === "channel" ? canal.de(caso[0], fonte) : null;
  if (alvoCanal && !alvoCanal.tem) {
    return { fonte, rotulo, caso: caso.join(" "), ms: 0, classe: 0, streams: 0, erro: "", vivos: 0, comQualidade: 0, falta: [], semCanal: true };
  }
  const t0 = Date.now();
  let lista = null;
  let erro = "";
  try {
    const mod = require(modulo);
    lista = await mod.getStreams(caso[0], caso[1], caso[2], caso[3]);
  } catch (e) {
    erro = String((e && e.message) || e);
  }
  const ms = Date.now() - t0;
  const reg = fontes.FONTES[fonte];
  const linha = { fonte, rotulo, caso: caso.join(" "), ms, classe: classeDe(ms), streams: 0, erro: "", vivos: 0, comQualidade: 0, falta: [], semCanal: false };
  if (erro) {
    linha.streams = -1;
    linha.erro = erro;
    return linha;
  }
  if (!Array.isArray(lista)) {
    linha.streams = -2;
    linha.erro = `devolveu ${typeof lista}, nao lista`;
    return linha;
  }
  linha.streams = lista.length;
  if (!lista.length) return linha;
  for (const s of lista) linha.falta.push(...confereContrato(reg, s));
  linha.comQualidade = lista.filter((s) => s && s.quality).length;
  const alvos = lista.slice(0, 2);
  const conc = 2;
  const res = [];
  for (let i = 0; i < alvos.length; i += conc) {
    res.push(...(await Promise.all(alvos.slice(i, i + conc).map(provar))));
  }
  linha.vivos = res.filter((r) => ["ok", "INDECISO", "BLOQUEADO"].includes(r.veredito)).length;
  linha.provas = res.map((r) => `${r.veredito}/${r.status}`).join(" ");
  return linha;
}

async function casosDe(fonte) {
  const reg = fontes.FONTES[fonte];
  if (reg.tipos.includes("channel")) {
    return CASOS_TV_PADRAO.map((l) => {
      const [id, nome] = l.split("\t");
      return { caso: [id, "channel", null, null], rotulo: nome };
    });
  }
  const base = PADRAO[fonte];
  if (!base) return [];
  const termos = String(base[0]).split("|");
  return termos.map((t) => ({ caso: [t.trim(), base[1], base[2], base[3]], rotulo: t.trim() }));
}

function cabecalho() {
  console.log("fonte  caso              tempo  classe  streams  qual  vivos  contrato");
}

function linhaDe(l) {
  const tempo = `${l.ms}ms`;
  if (l.semCanal) {
    return `${l.fonte.padEnd(5)} ${String(l.rotulo).slice(0, 16).padEnd(17)} ${"—".padStart(6)} ${"—".padStart(5)}  ${"n/esta fonte".padStart(7)} ${"—".padStart(5)} ${"—".padStart(6)}  ok`;
  }
  const estado = l.streams === -1 ? `LANCOU (${l.erro.slice(0, 40)})`
    : l.streams === -2 ? l.erro
    : `${l.streams}`;
  const contrato = l.falta.length ? `FALHA: ${[...new Set(l.falta)].slice(0, 2).join("; ")}` : "ok";
  return `${l.fonte.padEnd(5)} ${String(l.rotulo).slice(0, 16).padEnd(17)} ${tempo.padStart(6)} ${String(l.classe).padStart(5)}  ${estado.padStart(7)} ${String(l.comQualidade).padStart(5)} ${String(l.vivos).padStart(6)}  ${contrato}`;
}

(async () => {
  const argv = process.argv.slice(2);
  const so = argv.filter((a) => !a.includes("/") && fontes.FONTES[a]).map((a) => a);
  const grupos = argv.filter((a) => ["vod", "tv"].includes(a));
  let lista = fontes.chaves();
  if (so.length) lista = so;
  else if (grupos.length) {
    lista = lista.filter((k) => (grupos.includes("tv") ? fontes.FONTES[k].tipos.includes("channel") : !fontes.FONTES[k].tipos.includes("channel")));
  }

  const conc = Number(process.env.CONC) || CONC_PADRAO;
  const todos = [];
  let i = 0;
  for (const fonte of lista) {
    const casos = (await casosDe(fonte)).slice(0, conc);
    for (const c of casos) {
      const l = await rodaCaso(fonte, c.caso, c.rotulo);
      todos.push(l);
      console.log(linhaDe(l));
      i += 1;
    }
  }

  console.log("\n═══ resumo");
  const semCanal = todos.filter((l) => l.semCanal);
  const tentados = todos.filter((l) => !l.semCanal);
  const comRede = tentados.filter((l) => l.streams >= 0 && l.streams > 0);
  const entregues = tentados.filter((l) => l.streams > 0).length;
  const lancaram = tentados.filter((l) => l.streams === -1);
  const quebradas = tentados.filter((l) => l.streams > 0 && l.falta.length);
  const semQualidade = comRede.filter((l) => l.comQualidade === 0);
  const semLinkVivo = comRede.filter((l) => l.vivos === 0);
  const vazias = tentados.filter((l) => l.streams === 0);
  const porFonte = new Map();
  for (const l of comRede) {
    const at = porFonte.get(l.fonte) || { tot: 0, com: 0, ms: [] };
    at.tot += 1;
    if (l.vivos > 0) at.com += 1;
    at.ms.push(l.ms);
    porFonte.set(l.fonte, at);
  }
  console.log(`casos: ${todos.length} | canal nao existe nesta fonte: ${semCanal.length} | tentados: ${tentados.length}`);
  console.log(`com stream: ${entregues}/${tentados.length} | lancou erro: ${lancaram.length} | devolveu vazio: ${vazias.length} | contrato quebrado: ${quebradas.length}`);
  console.log(`sem nenhum link vivo: ${semLinkVivo.length} de ${comRede.length}`);
  console.log(`sem qualidade real: ${semQualidade.length} de ${comRede.length}`);
  console.log("\npor fonte (com stream):");
  for (const [f, at] of porFonte) {
    const media = Math.round(at.ms.reduce((a, b) => a + b, 0) / at.ms.length);
    const pior = Math.max(...at.ms);
    console.log(`  ${f.padEnd(5)} ${String(at.com).padStart(2)}/${String(at.tot).padEnd(2)} com link vivo | media ${media}ms | pior ${pior}ms`);
  }
  if (vazias.length) {
    console.log("\nrespondeu VAZIO depois de tentar (a fonte tem o item e nao entregou):");
    vazias.forEach((l) => console.log(`  ${l.fonte} [${l.rotulo}] ${l.caso}`));
  }
  if (lancaram.length) {
    console.log("\nfontes que LANCARAM erro (o app marca como 'com erro', nao 'sem fonte'):");
    lancaram.forEach((l) => console.log(`  ${l.fonte} [${l.rotulo}] ${l.erro}`));
  }
  if (quebradas.length) {
    console.log("\nCONTRATO quebrado:");
    [...new Set(quebradas.flatMap((l) => l.falta.map((f) => `${l.fonte}: ${f}`)))].forEach((x) => console.log(`  ${x}`));
  }
  if (semQualidade.length) {
    console.log("\nsem qualidade real (a linha 1 vai escrever 'Desconhecido'):");
    const porFonte2 = {};
    for (const l of semQualidade) porFonte2[l.fonte] = (porFonte2[l.fonte] || 0) + 1;
    console.log("  " + Object.entries(porFonte2).map(([k, v]) => `${k}:${v}`).join("  "));
  }
})();