// AS PAGINAS DO ADDON. Sao tres arquivos que o dono abre no navegador, e elas nao tem nenhum
// teste: o que existe sao checagens de texto.
//
// MOTIVO DESTE ARQUIVO (medido 01/10/2026): o script embutido de `public/tv.html` estaba com a
// IIFE **sem fechamento** (`})();` faltando) em TODOS os commits do repositorio — nenhum nunca
// teve. Isso e um erro de SINTAXE, entao o navegador descartava o script inteiro: a pagina
// `/tv` nao tinha player, nao tinha P2P e nao mandava o relato de telemetria. O sintoma era
// "a pagina nao faz nada", e a causa nao aparecia em nenhum teste de texto — porque o arquivo
// tem todas as strings que um teste procura.
//
// Aqui o script e **executado** pelo parser do Node (`new Function`), que e o mesmo parser que o
// navegador usa para scripts classicos: fecha ou nao fecha, e o teste falha.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.join(__dirname, "..");
const PAGINAS = ["tv.html", "install.html", "dashboard.html"];

// Extrai o corpo de cada `<script>` sem atributo (os de `src=` nao tem corpo).
function scriptsEmbutidos(html) {
  const saida = [];
  const re = /<script(?![^>]*\bsrc=)(?![^>]*type=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/json|application\/ld\+json/i.test(m[1] || "")) continue;
    saida.push({ atributos: (m[1] || "").trim(), corpo: m[2] });
  }
  return saida;
}

test("páginas: todo script embutido é JavaScript válido (o /tv estava com a IIFE sem fechar)", () => {
  for (const arquivo of PAGINAS) {
    const html = fs.readFileSync(path.join(raiz, "public", arquivo), "utf8");
    const scripts = scriptsEmbutidos(html);
    assert.ok(scripts.length > 0, `${arquivo} nao tem script embutido para checar`);
    for (const [i, s] of scripts.entries()) {
      // `new Function` = parser de script classico, sem executar nada. O `return` de topo que a
      // pagina usa (`return` dentro da IIFE) e o que fecha a funcao, entao tudo bem.
      assert.doesNotThrow(
        () => new Function(s.corpo),
        `${arquivo}: o script embutido #${i} nao parseia (erro de sintaxe = pagina morta)`
      );
      // E o balanceio de chaves bate, que e a forma barata de dizer a mesma coisa.
      const abre = (s.corpo.match(/\{/g) || []).length;
      const fecha = (s.corpo.match(/\}/g) || []).length;
      assert.equal(abre, fecha, `${arquivo}: script #${i} tem ${abre - fecha} chave(s) sem fechar`);
    }
  }
});

test("páginas: o /tv sempre fecha a IIFE que ele abre", () => {
  const html = fs.readFileSync(path.join(raiz, "public", "tv.html"), "utf8");
  const corpo = scriptsEmbutidos(html)[0].corpo;
  assert.match(corpo, /^\s*\(function \(\) \{/, "a pagina abre uma IIFE");
  assert.match(corpo.trimEnd(), /\}\)\(\);\s*$/, "e ela tem de terminar com })(); — sem isso o navegador joga o script fora");
});

// As conferencias negativas (o que NAO pode existir) olham so o codigo executavel: o
// comentario que explica o defeito naturalmente escreve a forma antiga, e um teste que le
// comentario acusaria o proprio comentario.
function semComentarios(corpo) {
  return corpo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

test("páginas: o P2P usa a API v4 (injectMixin), não a v3 (Engine como loader)", () => {
  const html = fs.readFileSync(path.join(raiz, "public", "tv.html"), "utf8");
  const codigo = semComentarios(scriptsEmbutidos(html)[0].corpo);
  // MEDIDO 01/10/2026 na documentacao oficial: em v3 o motor entrava como `loader` na
  // configuracao do hls.js; em v4 ele entra por `HlsJsP2PEngine.injectMixin(Hls)`, que devolve
  // uma SUBCLASS, e a configuracao vai em `hls.p2p`. A v3 era o motivo do `manifestLoadError`.
  assert.match(html, /HlsJsP2PEngine\.injectMixin/, "tem que injetar o motor no hls.js (API v4)");
  assert.match(html, /opcoes\.p2p = \{/, "a configuracao do P2P vai no `p2p` do hls.js");
  assert.match(html, /onHlsJsCreated/, "os eventos sao ligados em onHlsJsCreated");
  assert.ok(!/new window\.p2pml\.hlsjs\.Engine\(/.test(codigo), "a API v3 (Engine como loader) nao pode voltar");
  assert.ok(!/p2p-media-loader-core@latest\/build/.test(html), "a v4 e so ESM: os bundles UMD nao devem voltar");
  assert.ok(!/\bloader\s*[:=]\s*p2p\b/.test(codigo), "o P2P nao entra mais como `loader` do hls.js");
  // Os eventos da v4 tem prefixo "on" — e o que separa "veio de par" de "veio da origem".
  assert.match(html, /onSegmentLoaded/, "escuta o carregamento de segmento");
  assert.match(html, /downloadSource === "p2p"/, "e distingue o que veio de par pelo downloadSource");
  assert.match(html, /onStreamRegistrationError/, "stream que nao registra nao serve para nada em silencio");
  // E o motor espera: com P2P ligado o player so nasce depois do modulo ESM.
  assert.match(html, /__p2pPronto/, "a pagina espera o modulo do P2P antes de criar o player");
});