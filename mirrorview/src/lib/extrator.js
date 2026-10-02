// MOTOR DE EXTRAÇÃO: a parte que descobre a URL do vídeo em um site que a gente nunca viu.
//
// A IDEIA (medida em 29/09/2026, 13 padrões repetidos em 16 scrapers): todo site de vídeo,
// por mais diferente que pareça, faz sempre os MESMOS 5 movimentos —
//   1. a página do episódio tem o vídeo dentro de uma TAG, de um SCRIPT, ou de um JSON;
//   2. esse vídeo está em um IFRAME, ou é a página que vem em segundo;
//   3. a URL final é uma playlist (.m3u8) ou um arquivo (.mp4);
//   4. as vezes ela vem escondida dentro de outra URL, como parâmetro (`?d=<a url>`);
//   5. as vezes vem embaralhada (base64+XOR, ou o "packer" do JavaScript).
// Este arquivo cobre os 5. O scraper especifico do site fica so com "onde fica a pagina do
// episodio" e "qual o nome da serie" — que e a parte que realmente muda de site para site.
//
// POR QUE COLETAR E RANKEAR, e nao "achar o primeiro .m3u8": porque a primeira URL de video que
// aparece na pagina quase nunca e a melhor. A pagina tem o logo, a imagem de compartilhamento, o
// trailer, o anuncio e o preview do episodio anterior. Pegar a primeira e o que fazia a gente
// entregar o trailer em vez do episodio. Aqui TODAS sao coletadas e pontuadas.
//
// SEM NAVEGADOR DE VERDADE, de proposito: ele custa +200-400MB de RAM (o teto do projeto e
// 300MB com 300 pessoas) e 1-2s para acordar, num orcamento de 9s. Nada aqui precisa de JS
// executado: quanto mais o site tem de video, mais o endereco esta no TEXTO (tag, script ou
// JSON) e menos depende de o navegador montar alguma coisa.

const H = require("./html");
const { browserFetch, makeCache } = require("./scraper-utils");
const { detectHost, ehMidia } = require("./url-resolver");
const { normalizeQuality, extractQuality } = require("./quality");

const cache = makeCache(150, 10 * 60 * 1000);

// -------- 1. LITERAL DE JAVASCRIPT EMBUTIDO --------
// Sites escondem a configuracao do player dentro da pagina: `window.PlayerConfig = {...}`,
// `var sources = [...]`, `var urlConfig = {...}`. Regex nao acha isso de forma confiavel porque o
// objeto tem `{` dentro de string e `}` dentro de string. Este le ate o fechamento Certo,
// respeitando aspas e escape — e o mesmo algoritmo que o AON e o REI precisaram escrever
// separados (duplicados antes).
function literal(texto, marcador, limite = 40000) {
  const fonte = String(texto || "");
  if (!fonte) return null;
  let comecou = -1;
  if (marcador) {
    const achado = fonte.indexOf(marcador);
    if (achado < 0) return null;
    comecou = achado + marcador.length;
  } else {
    comecou = 0;
  }
  const abre = fonte.slice(comecou, comecou + limite).search(/[[{]/);
  if (abre < 0) return null;
  return literalEm(fonte, comecou + abre, limite);
}

// Versao que comeca numa posicao exata da pagina (o `{` ja localizado por quem chamou).
function literalEm(fonte, inicio, limite = 40000) {
  const pares = { "[": "]", "{": "}" };
  const pilha = [pares[fonte[inicio]]];
  if (!pilha[0]) return null;

  let dentroDeTexto = false, escape = false;
  for (let i = inicio + 1; i < fonte.length && i < inicio + limite; i++) {
    const c = fonte[i];
    if (dentroDeTexto) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"' || c === "'" || c === "`") dentroDeTexto = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { dentroDeTexto = true; continue; }
    if (c === "/" && fonte[i + 1] === "/") { const fim = fonte.indexOf("\n", i); if (fim < 0) return null; i = fim; continue; }
    if (c === "/" && fonte[i + 1] === "*") { const fim = fonte.indexOf("*/", i); if (fim < 0) return null; i = fim + 1; continue; }
    if (c === "{" || c === "[") { pilha.push(pares[c]); continue; }
    if (c === "}" || c === "]") {
      if (c !== pilha[pilha.length - 1]) {
        // Fecha na ordem errada: o que achamos NAO era o objeto que comecou. Em script de
        // site isso significa que o marcador apontava para o lugar errado — devolve null em vez
        // de devolver um objeto truncado (que viraria URL quebrada em silencio).
        return null;
      }
      pilha.pop();
      if (!pilha.length) return tryParse(fonte.slice(inicio, i + 1));
    }
  }
  return null;
}

// Tira comentario do pedaco. O scanner acima JA pula comentario ao medir o fechamento, mas o
// pedaco extraido ainda os contem — e `JSON.parse` recusa. `//` so e considerado quando o
// caracter antes dele nao e `:` (para nao cortar o `https://` de dentro de uma string).
function semComentario(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n"']*/g, "$1 ");
}

// Tenta ler o pedaco como JSON. Se nao der — e nao da quando o site escreve `{file:"x", a:1}`,
// que e javascript valido e JSON invalido — tenta de novo com chave entre aspas e aspas simples
// viradas. Devolve so objeto/array: um numero solto nao serve para nada aqui.
function tryParse(pedaco) {
  const bruto = String(pedaco);
  const tentativas = [bruto, semComentario(bruto)];
  for (const texto of tentativas) {
    try {
      const r = JSON.parse(texto);
      if (r && typeof r === "object") return r;
    } catch (_) {}
  }
  try {
    const r = JSON.parse(semComentario(bruto)
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'([^'\\]*)'/g, '"$1"'));
    if (r && typeof r === "object") return r;
  } catch (_) {}
  return null;
}

// Reconstrói um objeto que o site montou com virgula solta ou chave sem aspas.
function flexivel(pedaco) {
  return tryParse(pedaco);
}

// -------- 2. COLETA DE CANDIDATOS --------
// Nao e "ache o primeiro": e "colete todos e depois escolha". Cobre 5 formatos em que o video
// aparece, que sao exatamente os 5 que medimos em uso real.
const EXT_MIDIA = /\.(m3u8|mp4|mkv|webm|mov|flv|ts)(\?|#|$)/i;
const CHAVE_MIDIA = /^(file|src|source|sources|url|uri|video|videourl|filelink|link|stream|playlist|hls|dash|download|content|embed|src_?hd|file_?hd|file_?fhd|master)/i;
// Chaves que o SITE usa para dizer "este e o video". Quando a chave e uma dessas, a gente aceita
// o endereco mesmo sem extensao de midia.
//
// MEDIDO em 29/09/2026 (REI): o player responde `{"src":"https://…/__index.txt?token=…"}` — a
// playlist e um `.txt`, servida como `application/vnd.apple.mpegurl`. Nenhuma regra por extensao
// acha isso; so a chave do objeto diz. O mesmo formato vale para o EMB e a ETC, que tambem
// entregam `.txt` (e que hoje tem um ramo so para cada um no `server.js`).
const CHAVE_FORTE = /^(src|file|file_?hd|file_?fhd|file_?sd|src_?hd|src_?sd|hls|hlsurl|hls_?url|master|masterurl|playlist|stream|streamurl|stream_?url|video|videourl|media|mediaurl|src_?url)$/i;

const IGNORADOS = [
  /\.jpe?g|\.png|\.gif|\.webp|\.svg|\.ico|\.css|\.woff2?|\.ttf|\.eot([?#]|$)/i,
  /doubleclick|googlesyndication|google-analytics|googletagmanager|adservice|adnxs|doubleclick\.net/i,
  /\/(logo|poster|thumb|thumbnail|banner|avatar|img|image|images|perfil|capa|cover|preview|amostra|sample)[/_-]/i,
  /[?&](utm_|fbclid|gclid|msclkid)/i,
  /\b(trailer|teaser|prevista|amostra|preview)\b/i,
];

// `deConfig` separa "chave de configuracao" de "nome de atributo". A distincao e obrigatoria:
// MEDIDO em 29/09/2026, o REI poe a pagina seguinte em `<div src="https://…/__play/…">`. Como
// `src` tambem e nome de chave forte, o motor aceitava a PAGINA como se fosse video e parava ali
// (nota 34, 285ms, reproducao nenhuma). So a chave de configuracao (`"src":"…"` dentro de um
// objeto) autoriza aceitar endereco sem extensao de midia.
function pontuar(url, dica, deConfig) {
  const u = String(url || "");
  const forte = deConfig && dica && CHAVE_FORTE.test(dica);
  let p = 0;
  if (/\.m3u8(\?|#|$)/i.test(u)) p += 40;
  else if (/\.mp4(\?|#|$)/i.test(u)) p += 45;
  else if (/\.(mkv|webm|mov|flv|ts)(\?|#|$)/i.test(u)) p += 20;
  else if (forte) p = 30; // o proprio site diz que este endereco e o video
  else return -1;

  const qualidade = extractQuality(u) || normalizeQuality(dica || "") || "";
  if (/2160|4k/i.test(qualidade)) p += 30;
  else if (/1080|fullhd/i.test(qualidade)) p += 24;
  else if (/720|hd/i.test(qualidade)) p += 16;
  else if (/480|sd/i.test(qualidade)) p += 8;
  else if (/360/i.test(qualidade)) p += 3;

  if (dica && CHAVE_MIDIA.test(dica)) p += 12;
  if (/master|playlist|\.m3u8$/i.test(u)) p += 4;
  if (/googlevideo|cloudfront|akamaized|fastly|b-cdn|mywallpaper|cloudflarestorage|hwcdn|r2\.dev/i.test(u)) p += 6;

  for (const re of IGNORADOS) if (re.test(u)) p -= 60;
  // Pagina de player que tem a media como parametro (`videohls.php?d=<a playlist>`): funciona,
  // mas a origem direta e melhor (um salto a menos e um servico a menos no meio). MEDIDO no ATB e
  // no RON, que hoje pagam esse caminho.
  if (/\.php(\?|#|$)/i.test(u)) p -= 20;
  if (u.length > 600) p -= 8;
  return p;
}

function absolute(u, base) {
  if (!u) return null;
  const s = String(u).trim().replace(/\\\//g, "/");
  if (!s || s.length < 8) return null;
  let abs = s;
  if (s.startsWith("//")) abs = `https:${s}`;
  else if (!/^https?:\/\//i.test(s)) {
    // Endereco RELATIVO de verdade comeca com barra. Sem esta guarda, `<meta content="width=
    // device-width,initial-scale=1">` virava `https://v1.watchplay.shop/movie/width=device-width…`
    // e a cadeia do motor ia caçar tres paginas de lixo antes da pagina certa — MEDIDO no SPT e
    // no REI, que foi exatamente o que aconteceu na primeira versao.
    if (!/^(\/|\.\/|\.\.\/)/.test(s)) return null;
    if (!base) return null;
    try { abs = new URL(s, base).href; } catch (_) { return null; }
  }
  // MEDIDO em 29/09/2026: o REI tem `<iframe src="about:blank">` na pagina. Sem esta guarda o
  // motor tentava buscar `about:blank` e o erro que subia era `ECONNREFUSED 127.0.0.1:80` —
  // que nao diz NADA sobre o site. Aqui so passa endereco http(s) de verdade.
  if (!/^https?:\/\/[^/\s?#]+/i.test(abs)) return null;
  return abs;
}

function andaJson(no, dica, achados, profundidade = 0) {
  if (!no || profundidade > 6) return;
  if (typeof no === "string") {
    const u = absolute(no, null);
    // Aceita pela extensao OU pela chave que o site deu. Antes so pela extensao, e a playlist do
    // REI (`.txt`) nunca entrava na lista.
    if (u && (EXT_MIDIA.test(u) || (dica && CHAVE_FORTE.test(dica)))) achados.push({ url: u, dica, config: true });
    return;
  }
  if (Array.isArray(no)) {
    for (const item of no) andaJson(item, dica, achados, profundidade + 1);
    return;
  }
  if (typeof no === "object") {
    for (const [k, v] of Object.entries(no)) andaJson(v, k, achados, profundidade + 1);
  }
}

// Devolve os candidatos de video de uma pagina, ja sem duplicar e ja ordenados pelo melhor.
function coletar(entrada, opcoes) {
  const o = opcoes || {};
  const base = o.base || null;
  // MEDIDO em 29/09/2026: duas formas de esconde endereco, e as duas quebram quem procura.
  // (1) SPT escreve com a barra escapada — `url:"https:\/\/host\/…\/playlist.m3u8"`, que e
  // javascript valido. Regex que procure `https://` nao acha NADA, e era o que fazia o motor
  // falhar justo na fonte que ja funcionava.
  // (2) REI escreve com `&amp;` no meio da query — `__play/x?pt=…&amp;pc=…&amp;ib=…`. Sem
  // desfazer, a query chega com o nome do parametro errado e o site responde **404** — que parece
  // "fonte morta" e nao e. Desfazemos uma vez, na entrada, e todo o resto (tags, JSON,
  // expressoes) passa a ver o endereco como o site quis que se lesse.
  let texto = typeof entrada === "string"
    ? entrada.replace(/\\\//g, "/").replace(/&amp;/gi, "&")
    : "";
  const achados = [];
  const vistos = new Set();
  const poe = (u, dica, deConfig) => {
    const abs = absolute(u, base);
    if (!abs || vistos.has(abs)) return;
    const p = pontuar(abs, dica, deConfig);
    if (p < 0) return;
    vistos.add(abs);
    achados.push({ url: abs, dica: dica || "", nota: p });
  };

  if (!texto) return [];

  // (a) Tags e atributos. Via interpretador, e nao regex: o site pode ter mudado a ordem das
  // classes ou tirado as aspas sem deixar de ser o mesmo endereco.
  try {
    const doc = H.parse(texto);
    for (const tag of ["video", "source", "iframe", "embed", "object", "a", "meta", "link", "track"]) {
      for (const no of H.seleciona(doc, tag)) {
        for (const [k, v] of Object.entries(no.attrs)) {
          if (/^(src|data-src|data-video|data-url|data-file|data-hls|href|content|value|poster|data-poster)$/i.test(k)) poe(v, k);
        }
      }
    }
  } catch (_) { /* pagina que nao da para interpretar: segue pela varredura de texto */ }

  // (b) URL solta no texto — inclusive dentro de script. Onde a maioria dos sites esconde.
  //
  // MEDIDO em 29/09/2026 (SPT): o endereco vem com a barra escapada —
  // `url:"https:\/\/vid7102402.hclod.qzz.io\/…\/playlist.m3u8?md5=…"` — e a primeira versao
  // proibia a barra escapada no meio do address, o que cortava a URL em `https:\/` e nao
  // achava NADA. Por isso o `\\` entra na lista de caracteres permitidos aqui e e desfeito em
  // `absolute()`. E a `dica` sai da chave que vem logo antes (`url:`, `file:`, `hls:`), que e o
  // que separa o video do advertisement.
  const RE_MIDIA = /https?:\/\/[^\s"'<>)\\]+?\.(?:m3u8|mp4|mkv|webm|mov|flv|ts)(?:\?[^\s"'<>)\\]*)?/gi;
  for (const achado of texto.matchAll(RE_MIDIA)) {
    const antes = texto.slice(Math.max(0, achado.index - 40), achado.index);
    const chave = antes.match(/([A-Za-z_$][\w$]*)\s*[:=]\s*["']?\s*$/);
    poe(achado[0], chave ? chave[1] : "");
  }

  // (c) Video escondido DENTRO de outra URL, como parametro. O ATB e o RON usam esse mesmo
  // provedor (`videohls.php?d=<a playlist>`) e cada um tinha o seu codigo.
  for (const achado of texto.matchAll(/https?:\/\/[^\s"'<>)]+?[?&][\w-]+=([^&"'\s<>)]*(?:\.m3u8|\.mp4)[^&"'\s<>)]*)/gi)) {
    try { poe(decodeURIComponent(achado[1]), achado[0]); } catch (_) { poe(achado[1], achado[0]); }
  }
  for (const achado of texto.matchAll(/https?:\/\/[^\s"'<>)]+?[?&]\w+=([^&"'\s<>)]*)/gi)) {
    const valor = achado[1];
    if (!/[%a-z0-9+/=]{16,}/i.test(valor) || !/%|%2f/i.test(valor)) continue;
    let alvo = null;
    try { alvo = decodeURIComponent(valor.replace(/\\\//g, "/")); } catch (_) { continue; }
    if (/^https?:\/\//i.test(alvo)) poe(alvo, achado[0]);
  }

  // (d) Objetos e listas de JavaScript: `window.Config = {...}`, `var sources = [...]`.
  // Varre os marcadores E, se nenhum der midia, todo `{` da pagina (com teto) — senao um objeto
  // cujo nome nao esta na lista passa batido. MEDIDO em 29/09/2026: e o que achou o
  // `createMyPlayer({…})` do SPT, que nao tem `window.` nem `var` na frente.
  //
  // These goes to a SEPARATE list and only passes through `poe` at the end. Mixing them meant the
  // raw entry (which has no `nota`) won the dedup and every URL from a config came out with
  // `nota undefined` — measured on the REI.
  const doJson = [];
  let achouPorMarcador = false;
  for (const marcador of o.marcadores || [
    "window.", "var ", "let ", "const ", "sources", "playlist", "player", "config", "data",
  ]) {
    const achado = literal(texto, marcador);
    if (achado) {
      andaJson(achado, "", doJson, 0);
      if (doJson.length) achouPorMarcador = true;
    }
  }
  if (!achouPorMarcador) {
    for (const achado of texto.matchAll(/[{[]/g)) {
      if (achado.index > 400000) break;
      const obj = literalEm(texto, achado.index);
      if (!obj) continue;
      andaJson(obj, "", doJson, 0);
      if (doJson.length) break;
    }
  }
  for (const achado of texto.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const obj = tryParse(achado[1]);
    if (obj) andaJson(obj, "contentUrl", doJson, 0);
  }
  for (const achado of doJson) poe(achado.url, achado.dica, true);

  const vistosFinal = new Set();
  return achados
    .filter((x) => (vistosFinal.has(x.url) ? false : (vistosFinal.add(x.url), true)))
    .sort((a, b) => b.nota - a.nota || a.url.length - b.url.length);
}

// -------- 3. PAGINAS INTERMEDIARIAS (o proximo salto) --------
// Quando a pagina nao tem video nenhum, ela tem um IFRAME, ou um `src` de player, e essa pagina
// tem o video. Estes sao os proximos candidatos a buscar.
//
// MEDIDO em 29/09/2026: o REI nao usa `<iframe>` para o primeiro salto — e um `src="https://…/__play/…"`
// em um elemento qualquer. So procurar iframe pegava a cadeia do REI pela metade. Por isso aqui
// varrimos TODO atributo que pode conter endereco, e nao so as tags de player.
const PARECE_PLAYER = /(__play|\/play|\/player|\/embed|\/watch|\/e\/|\/v\/|player|embed|watch|\/tv\/)/i;

function paginasIntermedarias(html, base, teto = 8) {
  const vistas = new Map();
  const poe = (u, via) => {
    const abs = absolute(u, base);
    if (!abs || EXT_MIDIA.test(abs)) return;
    if (/\.(css|js|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)(\?|#|$)/i.test(abs)) return;
    for (const re of IGNORADOS) if (re.test(abs)) return;
    if (abs === base) return;
    const nota = (PARECE_PLAYER.test(abs) ? 20 : 0) + (via === "tag" ? 8 : 0) - abs.length / 1000;
    const anterior = vistas.get(abs);
    if (anterior === undefined || anterior < nota) vistas.set(abs, nota);
  };
  try {
    const doc = H.parse(html);
    for (const tag of ["iframe", "embed", "object", "source", "a", "video", "link", "meta"]) {
      for (const no of H.seleciona(doc, tag)) {
        for (const [k, v] of Object.entries(no.attrs)) {
          if (/^(src|href|data|data-src|data-url|data-file|poster|content|value)$/i.test(k)) poe(v, "tag");
        }
      }
    }
  } catch (_) {}
  // Endereco de player solto no texto (o caso do REI, que vem em atributo exótico). O `&amp;` e
  // desfeito aqui pelo mesmo motivo do `coletar` (MEDIDO 29/09/2026: com `&amp;` a query vai
  // errada e o site responde 404).
  for (const achado of String(html || "").replace(/&amp;/gi, "&").matchAll(/https?:\/\/[^\s"'<>)\\]*?(?:\/__play|\/play|\/player|\/embed|\/watch)[^\s"'<>)\\]*/gi)) {
    poe(achado[0], "texto");
  }
  return [...vistas.keys()].sort((a, b) => vistas.get(b) - vistas.get(a)).slice(0, teto);
}

// -------- 3b. O SEXTO MOVIMENTO: `ref` com `src` vazio --------
// MEDIDO em 29/09/2026 (REI): o player moderno nao entrega a URL, entrega um ENDERECO para
// buscar. O objeto vem `{"src":"", "type":"application/x-mpegURL", "ref":"/NP…/PV0…"}` e o
// endereco so aparece se voce mandar um POST nesse `ref` e ler o `src` da resposta. Sem este passo
// a cadeia do REI terminava na terceira pagina com a lista VAZIA — e o erro que subia era
// "nenhum video", que nao diz que faltou um salto.
const RE_REF = /(?:"(ref|referer|api|endpoint|stream_?url|src_?url|fetch)"|\b(ref|referer|api|endpoint|stream_?url|src_?url|fetch))\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{6,})/gi;

function refsDe(texto) {
  const saida = [];
  const vistos = new Set();
  // O mesmo `\/` escapado do SPT (MEDIDO 29/09/2026): o `ref` do REI vem como `"\/NP…"`, e sem
  // desfazer o `\` o valor nao comecava com `/` e era descartado como se nao houvesse `ref`.
  for (const achado of String(texto || "").replace(/\\\//g, "/").matchAll(RE_REF)) {
    // O valor e o ULTIMO grupo: a regex tem dois grupos de chave (com e sem aspas) e o do valor
    // so vem por ultimo, entao `achado[2]` seria `undefined` quando a chave veio sem aspas.
    const cru = achado[achado.length - 1];
    const valor = cru[0] === '"' || cru[0] === "'" ? cru.slice(1, -1) : cru;
    if (!valor || valor.length < 6) continue;
    if (!/^(\/|https?:\/\/)/i.test(valor)) continue;
    if (vistos.has(valor)) continue;
    vistos.add(valor);
    saida.push(valor);
  }
  return saida;
}

// -------- 4. QUE SITE E ESSE (diagnostico) --------
// Nao extrai video: descreve a ARQUITETURA. E o que responde "por que essa fonte parou" sem
// precisar abrir o site na mao — o `saude` de cada fonte no /health pode mostrar isto.
const ASSINATURAS = [
  ["wordpress", /wp-content|wp-includes|wp-json|wp-embed/i, "WordPress"],
  ["graphql", /\/graphql|apollo|graphql-query/i, "GraphQL"],
  ["xtream", /player_api\.php|\/player_api\?/i, "Painel Xtream"],
  ["hlsjs", /hls\.js|hlsjs|new Hls\(/i, "player HLS (hls.js)"],
  ["videojs", /video\.js|videojs\(/i, "player Video.js"],
  ["jwplayer", /jwplayer|jwPlayer\(/i, "player JW"],
  ["dplayer", /dplayer/i, "player DPlayer"],
  ["plyr", /plyr/i, "player Plyr"],
  ["dash", /dash\.js|dashjs|application\/dash\+xml/i, "player MPEG-DASH"],
  ["elementor", /elementor/i, "montado no Elementor"],
  ["shopify", /cdn\.shopify/i, "Shopify"],
  ["cloudflare", /cf-browser-verification|just a moment|challenge-platform/i, "desafio do Cloudflare"],
  ["captcha", /recaptcha|hcaptcha|turnstile/i, "pede captcha"],
  ["vimeoclip", /player\.vimeo\.com/i, "player Vimeo"],
  ["youtube", /youtube\.com\/embed|ytimg\.com/i, "video no YouTube"],
];

function arquitetura(html, url) {
  const t = `${String(html || "").slice(0, 400000)}\n${url || ""}`;
  const encontradas = [];
  for (const [chave, re, nome] of ASSINATURAS) if (re.test(t)) encontradas.push({ chave, nome });
  let titulo = "";
  const doc = (() => { try { return H.parse(t.slice(0, 200000)); } catch (_) { return null; } })();
  if (doc) {
    const tt = H.um(doc, "title");
    if (tt) titulo = H.textoDe(tt).trim().slice(0, 120);
  }
  return {
    assinaturas: encontradas,
    nomes: encontradas.map((x) => x.nome),
    titulo,
   Length: t.length,
  };
}

// -------- 5. O RESOLVEDOR: a cadeia inteira --------
// Dada uma pagina, acha o video. Segue iframes, usa a tabela de sites de video ja escrita
// (`url-resolver.js`, 15 tipos) e desiste no tempo. MEDIDO: um episodio do RON tem 148
// segmentos, entao um salto a mais nao e detalhe: e 1 a 2s.
async function resolver(pagina, opcoes) {
  const o = opcoes || {};
  const teto = Number(o.maxPaginas || 4);
  const orcamentoMs = Number(o.ms || 8000);
  const inicio = Date.now();
  const inicioFila = [pagina];
  const vistos = new Set();
  const erros = [];
  let melhor = null;

  while (inicioFila.length && Date.now() - inicio < orcamentoMs) {
    const atual = inicioFila.shift();
    if (!atual || vistos.has(atual)) continue;
    vistos.add(atual);
    if (vistos.size > teto) break;

    // Ja e midia? Entrega e acabou.
    if (ehMidia(atual)) {
      const p = pontuar(atual, "");
      if (p >= 0 && (!melhor || p > melhor.nota)) melhor = { url: atual, nota: p, via: "direto" };
      continue;
    }

    // Site de video conhecido (dos 15)? A tabela resolve e devolve o arquivo final.
    const hoster = detectHost(atual);
    if (hoster && hoster !== "direct") {
      try {
        const resolvido = await require("./url-resolver").resolveUrl(atual, o);
        if (resolvido) {
          const p = pontuar(resolvido, "hoster");
          if (p >= 0 && (!melhor || p > melhor.nota)) melhor = { url: resolvido, nota: p, via: `hoster:${hoster}` };
          continue;
        }
        erros.push(`${hoster}: sem video`);
      } catch (e) {
        erros.push(`${hoster}: ${e.message}`.slice(0, 90));
      }
      continue;
    }

    let html = "";
    const guardado = cache.get(atual);
    if (guardado) html = guardado;
    else {
      try {
        const sobra = Math.max(1500, orcamentoMs - (Date.now() - inicio));
        const res = await browserFetch(atual, {
          timeout: Math.min(Number(o.timeout || 9000), sobra),
          referer: o.referer,
          headers: o.headers,
          maxBody: 3 * 1024 * 1024,
        });
        if (!res.ok) { erros.push(`${res.status} ${atual.slice(0, 60)}`); continue; }
        html = await res.text();
        cache.set(atual, html);
      } catch (e) {
        erros.push(`${atual.slice(0, 50)}: ${e.message}`.slice(0, 90));
        continue;
      }
    }

    const achados = coletar(html, { base: atual, marcadores: o.marcadores });
    for (const c of achados) {
      if (!melhor || c.nota > melhor.nota) melhor = { url: c.url, nota: c.nota, via: "coleta" };
    }
    // Se ja achou midia boa, ainda vale olhar 1 salto a mais so se a nota for baixa.
    if (melhor && melhor.nota >= 55) break;

    // Salto do tipo `ref`: o player entrega endereco para buscar, nao a URL. So entra quando a
    // pagina NAO deu video (se ja deu, o link esta no ar e nao ha razao para o custo extra).
    if (!melhor) {
      for (const ref of refsDe(html).slice(0, 2)) {
        const alvo = absolute(ref, atual);
        if (!alvo || vistos.has(alvo)) continue;
        try {
          const sobra = Math.max(1200, orcamentoMs - (Date.now() - inicio));
          const res = await browserFetch(alvo, {
            method: "POST",
            timeout: Math.min(Number(o.timeout || 9000), sobra),
            referer: atual,
            maxBody: 128 * 1024,
            headers: { Accept: "application/json", "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
          });
          if (!res.ok) { erros.push(`ref ${res.status}`); continue; }
          const corpo = await res.text();
          for (const c of coletar(corpo, { base: atual })) {
            if (!melhor || c.nota > melhor.nota) melhor = { url: c.url, nota: c.nota, via: "ref" };
          }
          if (melhor) break;
        } catch (e) {
          erros.push(`ref: ${e.message}`.slice(0, 70));
        }
      }
    }
    if (melhor) break;

    for (const prox of paginasIntermedarias(html, atual)) inicioFila.push(prox);
  }

  if (!melhor) {
    const err = new Error(`extrator: nenhum video em ${pagina.slice(0, 70)}${erros.length ? ` (${erros.slice(0, 2).join("; ")})` : ""}`);
    err.erros = erros;
    err.visitas = vistos.size;
    throw err;
  }
  return melhor;
}

module.exports = {
  coletar, resolver, paginasIntermedarias, arquitetura, literal, literalEm, flexivel, pontuar, absolute,
  refsDe, EXT_MIDIA, CHAVE_MIDIA, IGNORADOS,
};
