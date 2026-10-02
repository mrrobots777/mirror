require("dotenv").config();

const epg = require("./src/lib/epg");
const tv = require("./src/core/tv-sources");

function soAlfa(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function palavras(chave) {
  return chave.split(/(?=[0-9])/);
}

function casamentoSolto(chaveNossa, chaveGuia) {
  if (chaveNossa === chaveGuia) return 2;
  if (chaveGuia.endsWith(chaveNossa) || chaveGuia.startsWith(chaveNossa)) return 1;
  const a = soAlfa(chaveNossa);
  const b = soAlfa(chaveGuia);
  if (!a || !b) return 0;
  if (b.includes(a) && a.length >= 5) return 1;
  const pa = a.match(/\d+|[a-z]{4,}/g) || [];
  const pb = b.match(/\d+|[a-z]{4,}/g) || [];
  if (!pa.length || !pb.length) return 0;
  const inter = pa.filter(x => pb.includes(x));
  return inter.length && inter.length >= Math.ceil(pa.length * 0.7) ? 1 : 0;
}

(async () => {
  const cat = await tv.getCatalog();
  console.log(`\n=== AUDITORIA DO EPG (${cat.length} canais nossos) ===`);
  await epg.carregar();
  const st = epg.stats();
  console.log(`  guia carregado: ${st.status} | ${st.canais} canais no guia | ${st.programs} programas`);
  const chaves = epg.chaves();
  const porChave = new Map(chaves.map(c => [c.chave, c.programas]));
  const hoje = epg.dataDe(Math.floor(Date.now() / 1000));
  const amanha = epg.dataDe(Math.floor(Date.now() / 1000) + 86400);

  const comHoje = [];
  const soAmanha = [];
  const perdidos = [];
  const semNada = [];

  for (const m of cat) {
    const hj = epg.grade(m.name, m.id, hoje).length;
    const am = epg.grade(m.name, m.id, amanha).length;
    if (hj) { comHoje.push({ nome: m.name, n: hj, am }); continue; }
    if (am) { soAmanha.push({ nome: m.name, n: am }); continue; }
    const nossa = soAlfa(m.name);
    const perto = chaves
      .map(c => ({ chave: c.chave, n: c.programas,forca: casamentoSolto(nossa, c.chave) }))
      .filter(x => x.forca > 0)
      .sort((a, b) => b.forca - a.forca || b.n - a.n);
    if (perto.length) perdidos.push({ nome: m.name, candidatos: perto.slice(0, 4) });
    else semNada.push(m.name);
  }

  const pct = (n) => `${n} (${Math.round((n / cat.length) * 100)}%)`;
  console.log(`\n  com programa HOJE ........... ${pct(comHoje.length)}`);
  console.log(`  so com programa AMANHA ...... ${pct(soAmanha.length)}`);
  console.log(`  o guia TEM e nos perdemos .... ${pct(perdidos.length)}  <-- dinheiro na mesa`);
  console.log(`  o guia NAO tem .............. ${pct(semNada.length)}`);

  if (comHoje.length) {
    const totalHj = comHoje.reduce((a, b) => a + b.n, 0);
    const totalAm = comHoje.reduce((a, b) => a + (b.am || 0), 0);
    console.log(`  total de programas hoje: ${totalHj} | amanha: ${totalAm}`);
    const semProx = comHoje.filter(x => !x.am).length;
    console.log(`  canais com guia hoje e SEM nada amanha: ${semProx}`);
  }

  if (soAmanha.length) {
    console.log(`\n  --- so tem guia amanha (${soAmanha.length}) ---`);
    soAmanha.forEach(x => console.log(`  ${x.nome.padEnd(34).slice(0, 34)} ${x.n} programa(s) amanha`));
  }

  if (perdidos.length) {
    console.log(`\n  --- O GUIA TEM MAS NAO PEGAMOS (${perdidos.length}) ---`);
    for (const p of perdidos) {
      console.log(`  ${p.nome.padEnd(32).slice(0, 32)} -> ${p.candidatos.map(c => `${c.chave}(${c.n})`).join("  ")}`);
    }
  }

  console.log(`\n  --- o guia realmente nao tem (${semNada.length}) ---`);
  console.log("  " + semNada.join(" | ").slice(0, 1000));
  process.exit(0);
})();
