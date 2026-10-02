// Tirou os BOTOES e o GitHub do dashboard, e puseram a logo e o banner novos.
//
// MEDIDO 02/10/2026, o que mudou e por que:
//
// 1. O `<a href="/install" class="logo">` virou um `<div>`. Era o unico elemento clicavel
//    do cabecalho, e ele apontava para a pagina de instalacao — agora o dashboard e' uma
//    pagina de MONITORAMENTO e se chega nela por URL. O dono: "a dashboard nao vai ter mais
//    botao, so acessando via link".
//
// 2. O link do GitHub foi embora do rodape. O endereco que estava la
//    (`github.com/devavmirror/mirror`) diedo antes do repo virar `mirrorstream`, entao ele
//    levava a 404 de qualquer jeito.
//
// 3. `logo.svg` (o simbolo do Stremio, CC0) foi trocado pela logo do produto, e o fundo
//    ganhou o banner — o MESMO arquivo que o `/install` usa.
//
// O script nao muda: e' o mesmo painel de metricas, com o `fetch('/health')` de 5 em 5
// segundos. `test/paginas.test.js` continua executando o parser (`new Function`) em todo
// script embutido das 3 paginas — por isso o IIFE fecha e nenhum `/*` aparece em `//`.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");

const PRODUTOS = [
  {
    nome: "MirrorStream",
    dir: "mirrorstream",
    logo: "/mirrorstream-logo.png",
    titulo: "MirrorStream",
    versao: "MirrorStream 1.0.1",
    idLogo: "MirrorStream",
    pagina: "dashboard.html"
  },
  {
    nome: "MirrorView",
    dir: "mirrorview",
    logo: "/mirrorview-logo.png",
    titulo: "MirrorView",
    versao: "MirrorView 1.0.1",
    idLogo: "MirrorView",
    pagina: "dashboard.html"
  }
];

const CABECALHO_ANTIGO = `      <a href="/install" class="logo">
        <img src="/logo.svg?v=1.0.2" alt="Logo Mirror" width="32" height="32">
        <span>Mirror</span>
      </a>`;

const CABECALHO_NOVO = (p) => `      <!-- SEM LINK: o dashboard e' so por URL (decisao do dono, 02/10/2026). -->
      <div class="logo">
        <img src="${p.logo}?v=1" alt="Logo ${p.idLogo}" width="32" height="32">
        <span>${p.titulo}</span>
      </div>`;

const RODAPE_ANTIGO = `  <footer>Mirror 1.0.1</footer>`;
const RODAPE_NOVO = (p) => `  <footer>${p.versao}</footer>`;

const FUNDO_ANTIGO = `    .grid-bg { background-image: linear-gradient(rgba(229,9,20,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(229,9,20,.03) 1px, transparent 1px); background-size: 40px 40px; }`;
const FUNDO_NOVO = `    .grid-bg {
      background-image:
        linear-gradient(rgba(8,8,10,.62), rgba(8,8,10,.88)),
        linear-gradient(rgba(229,9,20,.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(229,9,20,.035) 1px, transparent 1px),
        url("/mirrorstream-banner.png");
      background-size: cover, 40px 40px, 40px 40px, cover;
      background-position: center, center, center, center top;
      background-repeat: no-repeat, repeat, repeat, no-repeat;
      background-attachment: fixed, fixed, fixed, fixed;
    }`;

for (const p of PRODUTOS) {
  const arquivo = path.join(RAIZ, p.dir, "public", p.pagina);
  let t = fs.readFileSync(arquivo, "utf8");
  const antes = t.length;

  if (!t.includes(CABECALHO_ANTIGO)) throw new Error(`${p.dir}: cabecalho nao achado`);
  t = t.replace(CABECALHO_ANTIGO, CABECALHO_NOVO(p));
  t = t.replace(RODAPE_ANTIGO, RODAPE_NOVO(p));
  if (!t.includes(FUNDO_ANTIGO)) throw new Error(`${p.dir}: fundo nao achado`);
  t = t.replace(FUNDO_ANTIGO, FUNDO_NOVO);
  t = t.replace('<title>Mirror — Dashboard</title>', `<title>${p.titulo} — Dashboard</title>`);

  // o GitHub some de vez. Nao ha mais nenhum link para fora na pagina.
  t = t.replace(/<a[^>]+href="https:\/\/github\.com[^"]*"[^>]*>[\s\S]*?<\/a>/gi, "");
  t = t.replace(/<a[^>]+href="\/install"[^>]*>([\s\S]*?)<\/a>/gi, "$1");

  fs.writeFileSync(arquivo, t);
  console.log(`${p.dir}/public/${p.pagina}: ${antes} -> ${t.length} bytes`);
}