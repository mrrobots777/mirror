const fs = require("fs");
const path = require("path");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const RAIZ = path.join(__dirname, "..", "src", "lib");
const SAIDA = path.join(RAIZ, "canais.js");
const REI_API = "https://reidosembeds.online/api/channels";
const EMB_API = "https://embedtv.lat/api/channels";
const EMB_HOME = "https://embedtv.lat/";
const ETC_API = "https://apisinalpublico.vercel.app/canais.json";
const RCD_API = "https://api.reidoscanais.st/channels";
const PRIMEIRO = 1001;

function nn(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}
function palavrasFortes(nome) {
  const limpo = String(nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return new Set(limpo.split(/[^a-z0-9]+/).filter((p) => p.length >= 3));
}
function nomesDoMesmoCanal(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  const pa = palavrasFortes(x), pb = palavrasFortes(y);
  for (const p of pa) if (pb.has(p)) return true;
  return false;
}
function emparelha(meu, outros) {
  const exato = outros.find((c) => c.slug === meu.slug);
  if (exato) return { via: "slug", outro: exato };
  const chave = nn(meu.nome);
  const porNome = outros.find((c) => nn(c.nome) === chave);
  if (porNome) return { via: "nome", outro: porNome };
  const porSlug = outros.find((c) => nn(c.slug) === nn(meu.slug));
  if (porSlug && nomesDoMesmoCanal(meu.nome, porSlug.nome)) return { via: "slug", outro: porSlug };
  return null;
}
async function json(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return JSON.parse(await r.text());
}
async function texto(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return r.text();
}
function daEmbHome(html) {
  const partes = String(html).split(/<h2[^>]*>/);
  const mapa = new Map();
  for (let i = 1; i < partes.length; i++) {
    const fecha = partes[i].indexOf("</h2>");
    if (fecha < 0) continue;
    for (const card of partes[i].slice(fecha + 5).split(/(?=<article\s+data-id=")/)) {
      const m = card.match(/^<article\s+data-id="([^"]+)"\s+data-busca="([^"]*)"/);
      if (!m) continue;
      const alt = card.match(/<img[^>]*\salt="([^"]+)"/);
      if (!mapa.has(m[1])) mapa.set(m[1], String((alt && alt[1].trim()) || m[2].trim()));
    }
  }
  return [...mapa].map(([slug, nome]) => ({ slug, nome }));
}

(async () => {
  const rei = await json(REI_API);
  const emb = await json(EMB_API);
  const etc = await json(ETC_API);
  const rcd = await json(RCD_API);
  const reis = (rei.data || rei.channels).filter((c) => c && c.id && c.is_active !== false).map((c) => ({ slug: String(c.id), nome: String(c.name || c.id) }));
  const embs = (emb.channels || emb.data || []).map((c) => ({ slug: String(c.id), nome: String(c.name || c.id) }));
  const etcs = (Array.isArray(etc) ? etc : []).map((c) => { const m = /[?&]id=([a-zA-Z0-9_-]+)/.exec(String(c.url || "")); return m ? { slug: m[1], nome: String(c.name || "").trim() } : null; }).filter(Boolean);
  const rcds = (rcd.data || rcd.channels || rcd.items).map((c) => ({ slug: String(c.id), nome: String(c.name || c.id) }));
  const home = daEmbHome(await texto(EMB_HOME));
  const embsComNome = embs.map((c) => home.find((h) => h.slug === c.slug) || c);

  const porSlug = {};
  const porNumero = {};
  const relatorio = { emb: { nome: 0, slug: 0 }, etc: { nome: 0, slug: 0 }, rcd: { nome: 0, slug: 0 } };
  let difSlug = 0;
  const usados = { emb: new Set(), etc: new Set(), rcd: new Set() };
  reis.forEach((r, i) => {
    const numero = PRIMEIRO + i;
    const item = { slug: r.slug, nome: r.nome, rei: 1 };
    for (const [fonte, lista] of [["emb", embsComNome], ["etc", etcs], ["rcd", rcds]]) {
      const h = emparelha(r, lista);
      if (!h) continue;
      if (item.nome === item.slug && h.outro.nome && h.outro.nome !== h.outro.slug) item.nome = h.outro.nome;
      relatorio[fonte][h.via]++;
      usados[fonte].add(h.outro.slug);
      item[fonte] = h.outro.slug;
      if (h.outro.slug !== r.slug) difSlug++;
    }
    porSlug[r.slug] = item;
    porNumero[numero] = { slug: r.slug, nome: r.nome };
  });

  const extras = { emb: 0, etc: 0, rcd: 0 };
  let proximo = PRIMEIRO + reis.length;
  const LADO = { emb: embsComNome, etc: etcs, rcd: rcds };
  for (const fonte of Object.keys(LADO)) {
    for (const c of LADO[fonte]) {
      const item = porSlug[c.slug];
      if (item) {
        if (!item[fonte]) item[fonte] = c.slug;
        continue;
      }
      porSlug[c.slug] = { slug: c.slug, nome: c.nome, [fonte]: c.slug };
      porNumero[proximo] = { slug: c.slug, nome: c.nome };
      proximo++;
      extras[fonte]++;
    }
  }
  const soDe = { emb: 0, etc: 0, rcd: 0, nenhum: 0 };
  for (const item of Object.values(porSlug)) {
    const fontes = Object.keys(LADO).filter((f) => item[f]);
    if (!fontes.length) soDe.nenhum++;
    else if (fontes.length === 1) soDe[fontes[0]]++;
  }

  const corpo = { porSlug, porNumero };
  const js = `module.exports = ${JSON.stringify(corpo)};\n`;
  fs.writeFileSync(SAIDA, js);
  console.log(`canais: ${Object.keys(porSlug).length} (numero ${PRIMEIRO}..${proximo - 1}) | do REI: ${reis.length}`);
  console.log(`emb ${embsComNome.length} / etc ${etcs.length} / rcd ${rcds.length}`);
  console.log(`casamento por nome/slug: ${JSON.stringify(relatorio)}`);
  console.log(`novos por fonte: ${JSON.stringify(extras)} | por fonte unica: ${JSON.stringify(soDe)} | slugs diferentes: ${difSlug}`);
  console.log(`canais.js: ${js.length} bytes`);
})().catch((e) => { console.error(e); process.exit(1); });
