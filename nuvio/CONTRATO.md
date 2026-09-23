# CONTRATO — Mirror como plugin Nuvio

Documento único de construção. Toda portagem de fonte segue isto. Fonte de verdade:
`estudos/nuvio-plugin-estudo.md` (estudo do código do Nuvio, com arquivo:linha).

## 1. O que é

Reescrever **todas as fontes do Mirror** como **plugin Nuvio** — só plugin, sem addon,
sem servidor. O Nuvio já tem catálogo e metadado (TMDB); o plugin só entrega o link.

Um **repositório** (`manifest.json`, gerado de `src/core/fontes.js`) com **15 scrapers**, um
por fonte. O usuário ativa o que quiser na tela de Plugins do Nuvio.

## 2. Contrato do provider

```js
module.exports.getStreams = async (tmdbId, mediaType, season, episode) => [...]
```

- `tmdbId`: **string** (ex.: `"603"`; às vezes pode vir `"tmdb:603"` — normalizar tirando o prefixo)
- `mediaType`: `"movie"` | `"tv"` | `"channel"` (**nunca** `"series"`; `tv` = série)
- `season`/`episode`: números ou `null`/`undefined` em filme
- retorno: array de

```js
{
  name: "BLZ",                       // sigla da fonte
  title: "1080p · Dublado · BLZ",    // o que aparece na linha
  url: "https://...",                // link jogável direto
  quality: "1080p",                  // 4K | 1080p | 720p | 480p | ...
  headers: { "Referer": "...", "User-Agent": "..." }  // opcional, só se a origem exige
}
```

- **150** é o teto absoluto de resultados por scraper (125 na quota `limited`); entregar
  **< 25** de qualidade é melhor que 150 fracos.
- Erro: **lançar** (throw). `[]` só significa "essa fonte não tem o título". O app mostra
  o que veio; throw não derruba os outros scrapers.

## 3. Sandbox — o que existe (provado em arquivo:linha)

| recurso | status |
|---|---|
| `fetch(url, {method, headers, body, redirect})` | **SIM**, headers arbitrários (Range vale) |
| resposta | `.text()` `.json()` `.arrayBuffer()` `.status` `.ok` `.headers.get()` |
| **teto de corpo** | **1 MB** por resposta (512 KB na quota `limited`) — **nunca baixar catálogo inteiro de painel** |
| UA padrão | Chrome browser **se não mandar** `User-Agent` |
| proxy | **NÃO** — saída direta do aparelho (IP residencial do usuário) |
| `cheerio` | **SIM** (global e `require("cheerio")`) |
| `require` | **só** `cheerio*` e `crypto-js`; resto lança |
| `crypto.subtle` + CryptoJS | **SIM** (MD5/SHA/HMAC/AES) |
| `URL`/`URLSearchParams`, `atob`/`btoa`, `TextEncoder`/`TextDecoder`, `Uint8Array` | **SIM** |
| `setTimeout` | SIM, máx 60000 ms |
| `console.*` | SIM (log do app, tag `Plugin:<id>`) |
| `TMDB_API_KEY` | **SIM** — global injetada; usar para resolver título |
| `SCRAPER_ID` / `SCRAPER_SETTINGS` | SIM |
| Node (`fs`, `http`, `process`, `child_process`, sqlite) | **NÃO** |
| `WebAssembly` | morto (placeholder) |
| tempo | **60 s** por invocação, **10** simultâneas, **120 s global** para todos os scrapers |

Consequências práticas:

1. **Toda resposta HTTP < 1 MB.** Fonte cujo catálogo é gigante precisa de **busca**,
   não de catálogo inteiro (medir antes: ver `medicoes.md`).
2. **Runtime novo a cada chamada** — nada de cache em memória entre invocações. O cache
   HTTP do OkHttp (50 MB em disco) existe e **segue os cabeçalhos da origem**.
3. Orçamento: 15 scrapers correm em 120 s com 10 simultâneos → cada fonte precisa de
   **< 15 s** no caso comum. Timeout de fetch próprio: **6-8 s**, e nada de espera morta.

## 4. Título: vem da TMDB

O provider recebe **só o id**. O título se resolve com `globalThis.TMDB_API_KEY`:

- filme: `https://api.themoviedb.org/3/movie/<id>?api_key=...` → `title`, `release_date`
- série: `https://api.themoviedb.org/3/tv/<id>?api_key=...` → `name`, `first_air_date`
  + episódio: `/tv/<id>/season/<s>/episode/<e>` → `episode_name`, `air_date`

`src/lib/tmdb.js` faz isso com memo **dentro da chamada**. Fonte que joga direto pelo id
TMDB (RTD, VZR) **não precisa**.

## 5. Utilitários (`src/lib/`)

| arquivo | função | origem |
|---|---|---|
| `http.js` | `pegar(url, opts)` → fetch com timeout, headers padrão, erros claros; `json()`, `texto()` | novo |
| `tmdb.js` | `tituloDe(tmdbId, tipo, temp, ep)` → `{titulo, original, ano, epNome, epData}` | novo |
| `text.js` | `normalizeText`, `normalizeLoose`, `stripYear`, `lower`, `ascii`, `slugify`, `decodeEntities`, `words`, `looseCoverage`, `extraWords` | `src/lib/text.js` |
| `match.js` | `matchKey`, `matchScore`, `matchVodTitle`, `preFiltra`, `adjustScoreForYear`, `extractYear` + penalidades | `src/lib/match.js` |
| `quality.js` | `extractQuality`, `normalizeQuality`, `qualityRank`, `videoResolutionToQuality` | `src/lib/quality.js` |
| `html.js` | `parse`, `seleciona`, `um`, `textoDe` (sem dependência) | `src/lib/html.js` |
| `extrator.js` | `coletar`, `resolver`, `literal` — achar URL do vídeo em qualquer página | `src/lib/extrator.js` |
| `ua.js` | `UA` | `src/lib/ua.js` |
| `url-resolver.js` | `resolveUrl`, `detectHost`, `ehMidia` — seguir redirect de URL de mídia | `src/lib/url-resolver.js` |
| `canais.js` / `canal.js` | mapa estático de canais (GERADO por `tools/gerar-canais.js`) e a busca `de(id, fonte)` | decisao 153 do addon |
| `fonte-painel.js` / `painel.js` | fonte de painel Xtream compartilhada (blz/spc/ato) e o cliente `player_api.php` | `src/scrapers/xtream.js` |
| `indice.js` | leitor do índice estático em `public/idx/` (o catálogo do painel passa de 1 MB) | próprio |

`src/core/` tem o **registro único** e o runtime, não utilitário:

| arquivo | função |
|---|---|
| `fontes.js` | REGISTRO ÚNICO das 15 fontes: chave, arquivo, sigla, rótulo, tipos, conteúdos, descrição. `build.js` gera o `manifest.json` a partir daqui. |
| `sandbox.js` | tetos do runtime (`TETO_CORPO_BYTES`, `TEMPO_FETCH_PADRAO_MS`, …) e o relógio de orçamento `novo()` |

Regras: **CommonJS**, sem dependência que não seja bundlada, sem `process.env` (usar
defaults literais), sem rede fora da função exportada.

## 6. Qualidade que continua valendo (do AGENTS.md)

- **Nunca entregar item errado** — sem correspondência de título, `[]` (`matchVodTitle` +
  portão; o detalhe do episódio também é conferido).
- **Achar URL com `extrator.js`, nunca com regex de m3u8** (`coletar`/`resolver`).
- **HTML com `html.js`**, não regex (quebra quando o site muda a ordem).
- **Prova de vida antes de entregar**: morto (`403/404/410/451`, 5xx, `text/html`, playlist
  vazia) não entra. **Timeout nunca condena.**
- **Codec**: nunca entregar H.265/VP9/AV1 como se fosse universal se existe H.264.
- **Referer/UA exigidos** → no campo `headers` (é o que o player manda).
- Título da linha informativo, uma informação por linha: qualidade · idioma · fonte.

## 7. Estrutura

```
nuvio/
├── CONTRATO.md          # este arquivo
├── STATUS.md            # tabela final das 15 fontes e o que falta
├── package.json
├── build.js             # esbuild: src/scrapers/<fonte>.js → dist/<fonte>.js + manifest.json
├── teste.js             # harness Node: node teste.js <fonte> <tmdbId> movie|tv [s] [e]
├── medicoes.md          # tamanho/endpoint de cada fonte (medir, não supor)
├── src/
│   ├── core/            # fontes.js (REGISTRO ÚNICO) + sandbox.js (tetos do runtime)
│   ├── lib/             # §5
│   └── scrapers/        # 15 fontes, um arquivo por fonte (o nome vem do registro)
├── tools/               # geradores e medições (Node, nunca bundlados)
├── public/              # raiz do GitHub Pages: manifest.json + <fonte>.js + idx/
└── dist/                # saída do build (o que vai pro gh-pages)
```

**`manifest.json` não é escrito à mão**: `build.js` o gera de `src/core/fontes.js` e escreve
em `dist/manifest.json`, copiando para `public/manifest.json`. Mudou a lista de fontes, mudou
no registro.

Fontes: `shg ron aon atb` (anime), `spt blz spc ato rtd vzr` (filme/série),
`dgo` (dorama), `rei emb etc rcd` (TV, `supportedTypes: ["channel"]`).
**`kkt` não entra** — é o mesmo painel do `blz` (kakito.xyz) lido de outra forma, e o dedup
por host+path já colapsa os dois (motivo em `STATUS.md` §0).

## 8. Publicação (sem commit neste repositório)

`npm run build` → `dist/` e `public/` → publicar `public/` no GitHub Pages de um repo novo
(`gh-pages`). No Nuvio: **Settings → Plugins → Add repository URL** =
`https://<usuario>.github.io/<repo>/manifest.json` (o app anexa `/manifest.json`
automaticamente se faltar). Refresh automático a cada **6 h**.

**Este repositório: criar arquivos sim, `git commit` NUNCA.**

## 9. Teste

`node teste.js vzr 603 movie` roda o `getStreams` em Node 18+ (tem `fetch` global) e imprime
o resultado. O teste prova lógica e rede **deste servidor** (IP de datacenter — uma origem
que bloqueia datacenter pode reprovar aqui e funcionar no aparelho; anotar em `medicoes.md`).

Barreira de aceitação por fonte: entrega URL, URL responde, título bate com o pedido.
