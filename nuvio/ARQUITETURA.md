# Arquitetura — Mirror em duas peças

> Desenho de 02/10/2026 (decisão 154). Este arquivo responde a três perguntas: **quais são as
> peças**, **por que o servidor continua existindo** e **qual é a regra de uma fonte entrar**.

---

## 1. As duas peças

```
┌──────────────────────────────────────────────┐
│ APARELHO — app Nuvio                         │
│                                              │
│  plugin "mirror"  (nuvio/, este repositório) │
│  ├─ 15 scrapers: anime, filme, série,        │
│  │  dorama e TV                              │
│  ├─ TMDB própria, índice estático dos painéis │
│  └─ sai do IP RESIDENCIAL de quem assiste    │
└───────┬──────────────────────┬───────────────┘
        │ players (link)       │ catálogo
        │ (direto p/ a origem) │ (o que existe, o que passa)
        ▼                      ▼
   origem CDN            ┌──────────────────────────┐
   (sem servidor)        │ SERVIDOR — mirrorhub     │
                         │  src/server.js           │
                         │  ├─ /nuvio/* (catalogo,  │
                         │  │          meta, guia)  │
                         │  ├─ /catalog /meta       │
                         │  ├─ /api/*                │
                         │  └─ paginas, /health      │
                         │     SEM player, SEM relay │
                         └──────────────────────────┘
```

### `mirrorhub` — o servidor (este repositório, `src/`)

Catálogo, metadado e guia. **Nenhum player — nem de VOD (decisão 154), nem de TV (decisão 155).**
O servidor não entrega um único byte de vídeo.

- **Catálogo/meta de TV** — `/nuvio/*` (formato Nuvio: tipo `channel`, id numérico) e
  `/catalog/tv/*`, `/meta/tv/*` (formato Stremio: `tv:live:<slug>`). Mesmo catálogo e mesmo
  cache; só o `id` muda na entrada e na saída.
- **Catálogo/meta de filme e série** — o Nuvio tem TMDB própria, mas o addon continua
  respondendo `/meta/*` e `/api/vod/*`.
- **Guia (EPG)** — `src/lib/epg.js`, decisões 55/56/121. O REI é a fonte (`/api/guia`).
- **Metadado de canal** — `src/core/tv-sources.js` monta a lista a partir do `/api/channels` do
  REI (327 canais, logo em 100% deles, medido). É a única fonte que restou no servidor, e ela
  entrega **metadado**, nunca vídeo.
- **Páginas e diagnóstico** — `/install`, `/dashboard`, `/tv`, `/health`, `/metrics`, p2p.

### O que saiu na decisão 155, e por quê

O dono: *"nada no servidor senão catálogo, todas as fontes são via plugin"*. Saiu:

| Saiu | Era | Onde está agora |
|---|---|---|
| `/stream/hls/*` | relay de TV: playlist `text/plain` → `mpegurl`, token novo a cada ida | `nuvio/src/scrapers/reidosembeds.js`, no aparelho |
| `/stream/proxy`, `/seg/etc/*` | máscara de URL e o segmento da ETC com `Referer` | `nuvio/src/scrapers/` |
| `/stream/proxy-check` | medir se a WAF de uma origem barrava o servidor | não tem mais o que medir |
| `getStreams` das 4 fontes de TV | a lista de players do canal | `nuvio/src/core/fontes.js` |
| a **triagem** de TV | provar, com o player real, quem tocava (131 s medidos) | o plugin decide na tela |
| `VIDEO_BASE_URL` | round-robin do embrulho de vídeo entre dois apps | `nuvio/src/scrapers/xtream.js` |

**Medido depois:** o catálogo de TV no app1 passou de **127 s** (a triagem) para **1,17 s** — uma
leitura de 256 KB na API do REI. Busca e categoria: **0 ms** (o memo filtra). É por isso que a
decisão 155 também estreitou o cluster de TV: ele deixou de repassar as rotas de stream.

O **id numérico** do canal é o ponto de contato com o plugin: `nuvio/src/lib/canais.js` tem o mapa
número → slug, e `src/lib/nuvio-canais.js` importa o mesmo arquivo. Um canal que não esteja no
mapa não existe para o Nuvio.

### `mirror` — o plugin (`nuvio/`)

As 15 fontes, dentro do app, no aparelho. `nuvio/src/scrapers/` tem os 15 scrapers;
`nuvio/src/core/fontes.js` é o registro; `nuvio/src/lib/` tem o runtime (http, extrator, índice,
match, painel, tmdb, quality, canais).

Nenhum vídeo de VOD passa pelo servidor. O pedido sai do celular ou da TV direto para a origem, do
IP residencial de quem assiste.

---

## 2. Por que o servidor continua existindo

O plugin não tem servidor. Mesmo assim, **quatro** coisas continuam precisando de um. Duas são de
funcionalidade, uma é de conhecimento, e a quarta é o motivo pelo qual o dono vai conseguir
assistir de forma confiável.

### 2.1 ~~O relay~~ — saiu na decisão 155

Este parágrafo existia até ontem, e é o registro do **principal motivo** de o servidor ter sido
diferente de um catálogo de metadados. A fonte de TV principal (REI) entregava a playlist como
**`text/plain`**, com um **JWT de 300 s**; o player não reconhecia `text/plain` como HLS; e cada
ida do player precisava de um token novo. Logo, um servidor no meio (decisão 111).

**Na 155 isso foi para o plugin — e o argumento não sobrevive a isso:**

- O `text/plain` e o token de 300 s são um problema do **host de origem** (o REI), não do
  transporte. O plugin resolve a cadeia a cada pedido, no aparelho, e entrega a lista como HLS.
- O player do Nuvio consome a URL que o **plugin** devolve. Ela não passa pelo servidor.

O relay existia porque o servidor fabricava a URL do vídeo. Sem fabricar URL, não há o que
fabricar. O que fica não é "metadado + relay": é **catálogo, metadado e guia** — três coisas de
leitura, nenhuma de escrita.

### 2.2 A lista de canais não é do plugin

O Nuvio **não tem lista de canal nativo**. A lista de TV ao vivo sempre vem de um addon — por isso
as rotas `/nuvio/*`. O plugin sabe *tocar* um canal; só o addon diz *quais canais existem*.

**Medido:** 327 canais, catálogo frio em **1,17 s**, busca e categoria em **0 ms**, e o `id`
numérico cruzando com `nuvio/src/lib/canais.js` sem nenhum canal órfão em nenhum dos dois
sentidos.

### 2.3 O guia (EPG)

`src/lib/epg.js` baixa o XMLTV do REI (`/api/guia`, 1,2 MB, ~3.900 programas), parseia **por
stream**, e guarda **só os canais que batem com o nosso catálogo**, em tupla compacta. A grade do
dia sai em `videos` da meta do canal. O plugin não tem onde buscar isso.

### 2.4 O servidor não pode cair

Isto não estava no pedido, e é o motivo de este documento existir. Ver a seção 4.

---

## 3. A regra: fonte que não toca no 1º play não entra

**Regra.** Uma fonte só entra na lista se provar que entrega, **no primeiro play** — não "depois
de um retry", não "às vezes".

**Por que a regra existe.** Ela é a contraparte de uma coisa que o Mirror tinha e que as
decisões 154 e 155 tiraram do caminho: no servidor havia prova de vida (`lib/prova-viva.js`),
circuito de breaker, `scraper-engine` com disjuntor, e a **triagem de TV** que só levava à
lista quem já tinha passado (decisão 125). Tudo isso saiu junto com as fontes.

No plugin não existe motor nenhum: o scraper é uma função que devolve array, e o app mostra o
que veio. **É a mesma situação, e a regra é a mesma defesa.**

Isso significa que a única defesa contra uma fonte morta é **não a deixar ativa**:

| Situação | Decisão |
|---|---|
| fonte devolve link, o player toca | entra |
| fonte devolve link e o player **não** toca | **sai** — não entra, nem em "às vezes funciona" |
| fonte responde vazio | sai |
| fonte lança erro | fica registrada, mas o app mostra o erro dela sozinha |
| fonte é a única do título | o título aparece sem stream — é isso, ou nada. Link quebrado é pior que ausência |

**Consequência prática:** o dono escolhe os scrapers na tela de Plugins. Ativar uma fonte é um
ato de confiança — e vale mais assim do que com uma lista de 15 em que metade não entrega. Melhor
pouco que abre.

**O que NÃO continua valendo do servidor — e o ganho (decisão 155):** antes, canal de TV só saía
da lista de catálogo na **2ª confirmação** sem stream (`TV_MORTES_PARA_TIRAR`, decisão 134), e a
regra do dono ("nunca retirar canal") dependia disso. **Essa regra inteira saiu do servidor.**
Agora a lista é exatamente o que o REI declara, e **ninguém no servidor pode encurtá-la** — nem
por prova de morte, nem por erro de rede, nem por oscilação da origem.

A defesa contra fonte morta não enfraqueceu: ela **mudou de lugar**. Antes o servidor provava com
o player de verdade (e pagava 131 s por isso, acima dos 12,3 s do gateway). Agora é o plugin, na
tela, com o player do aparelho — que é a prova mais honesta que existe, e é a que o dono vê.

---

## 4. O conserto que não era pedido (02/10/2026, decisão 154)

Enquanto media a RAM do servidor novo, a validação bateu em um **404** e o processo **morreu**:
`ERR_HTTP_HEADERS_SENT`, e o `uncaughtException` do servidor chama `process.exit(1)`.

A causa era a guarda da decisão 140 ("nenhum erro pode ficar guardado 4 h na CDN"). Ela estava
num `res.on("finish")`, e o `finish` dispara **depois** dos headers irem — então o `setHeader`
era sempre tarde, **em toda resposta >= 400**. Reproduzido em 3 s com um `curl` num canal que não
existe, e confirmado **no código antigo**: não é regressão desta decisão, é a forma como a decisão
140 foi escrita.

O conserto está em `src/lib/cache-erro.js`: a guarda entra no **`writeHead`**, que é o último
ponto em que o cabeçalho ainda é nosso. Resposta boa continua cacheável; erro sai com
`Cache-Control`, `CDN-Cache-Control` e `Cloudflare-CDN-Cache-Control` = `no-store` — que é o que
a decisão 140 queria, e que ela nunca conseguiu fazer.

**Por que isso importa para o plugin:** o Nuvio pede canal que não está no mapa, id errado,
`/stream/hls` de um canal que a triagem tirou. Cada um desses é um 404, e cada um derrubava o
catálogo inteiro.

---

## 5. O que o servidor deixou de fazer (e por que foi ganho)

As 10 fontes de VOD/anime saíram do registro (`src/core/sources.js`). Os arquivos continuam em
`src/scrapers/` — outros módulos e os testes os referenciam — mas o servidor não carrega mais
nenhum deles no boot, e o aquecimento que abria o `iptv.db` do KAK e gravava o `paineis.db` dos
painéis Xtream foi junto.

| | Antes | Depois |
|---|---|---|
| RSS (mesma sequência, após aquecimento) | 272 MB | **136 MB** |
| heap usado | 81 MB | **31 MB** |
| `paineis.db` | 15 MB gravados | não é gravado |
| fontes no motor | 10 | **0** |

O caminho de stream de filme/série responde `{"streams":[]}` (200, cache de 60 s) **antes** de
resolver metadado: sem fonte registrada, a busca no AniList e a sonda de qualidade só serviam para
alimentar fontes que não existem mais.

### 5.1 A mesma coisa na TV (decisão 155)

A 155 aplicou à TV exatamente a mesma regra, e o motivo dela era mais forte: lá ainda **havia**
fonte, e mesmo assim ela saiu.

| Saiu | Motivo |
|---|---|
| `/stream/hls/*`, `/stream/proxy`, `/seg/etc/*` | serviam vídeo; o player agora sai do aparelho |
| `getStreams` das 4 fontes | a lista de players é montada pelo plugin |
| a **triagem** (131 s) | provava quem tocava, com o player de verdade — agora é o plugin que prova, na tela |
| a **prova de morte** e o "só sai na 2ª confirmação" | sem triagem, e a lista passa a nunca encolher |
| `VIDEO_BASE_URL` e o round-robin | o embrulho de vídeo era da rota `/stream/proxy` |

**Medido depois:** RSS de pé com o catálogo e o guia aquecidos em **85 MB** (heap 20 MB). O
catálogo de TV, que era a peça cara, caiu de **127 s para 1,17 s** — porque "montar o catálogo"
agora é *ler a lista do REI*, e não *perguntar a 4 CDNs se o canal toca*.

**O que a 155 não mexeu, e por quê:** os 3 scrapers de VOD continuam em `src/scrapers/`. Eles
pertencem à decisão 154, não a esta — e o plugin tem as próprias cópias, que é onde o código vivo
está. Já os 3 scrapers de **TV** (`embedtv`, `embedcanais`, `reidoscanais`) foram **apagados**:
o servidor não tinha mais uso nenhum de metadado deles, e manter arquivo morto é o jeito mais
rápido de alguém importar `require` dele e derrubar o boot.
---

## 6. O contrato do player, medido no código do Nuvio (02/10/2026)

O plugin não escolhe como o vídeo é interpretado — o **app** escolhe, e a regra está em
`PlayerMediaSourceFactory.kt`. Ler lá mudou duas decisões:

### 6.1 O tipo do stream vem da URL, nunca do `content-type`

| ordem | regra | exemplo |
|---|---|---|
| 1 | `inferMimeTypeFromUrl` — o **caminho** | `.m3u8` → HLS · `.mp4` → progressivo |
| 2 | só se o caminho não disser nada: `inferMimeTypeFromQuery` — a **query** | chave `format`/`ext`/`type`/`mime` com valor de manifesto, ou valor `m3u8`/`mpegurl`/`hls` |
| — | `proxyHeaders.response` do scraper | **sempre nulo** — não dá para injetar o `content-type` |

Consequência: o REI entrega a playlist como `__index.txt` com `text/plain`, e **o caminho diz
"arquivo de texto"**. `sinaliza()` (`src/lib/hls.js`) põe `format=m3u8` na URL de quem termina
em extensão de texto — é a única forma de o manifesto ser reconhecido como HLS. Medido
(`tools/mime.js`, que reproduz a regra do Kotlin): rei/emb saíam "progressivo", agora saem
`application/x-mpegurl (HLS ✓)`, e `etc/rcd` (`.m3u8`) já saíam certos.

Provas de que não quebra nada: `sinaliza` é **idempotente**, **preserva a query existente** e
**não toca em arquivo de vídeo** (`.mp4`, `.ts`) nem em quem já diz o formato. E o parâmetro é
aceito em silêncio pelas origens — mesmos bytes de corpo com e sem ele
(`tools/prova-formato.js`).

### 6.2 O orçamento de um `fetch` tem de cobrir o que a origem demora para RECUSAR

Uma origem que responde 404 **em 10,2 s** (o REI, em canal morto) quebra o padrão "timeout é
sempre falha de rede": com o probe de 8 s o erro subia e o canal aparecia com **chip de erro**
em vez de **lista vazia**. O probe da playlist usa o orçamento **restante** do sandbox
(`restante(p, MS_PLAYLIST)`), não o valor fixo, e a cadeia tem teto próprio (`TETO_MS`) para
que um canal morto não prenda a tela.

A régua que ficou:

- **respondeu e não tem playlist** → `[]` (o chip diz "sem fonte");
- **rede/timeout/5xx no 1º probe** → erro (o chip diz "fonte com erro") — decisão 131;
- **a 2ª tentativa só roda se couber um probe inteiro**, e falha nela → `[]` (a 1ª já respondeu).

### 6.3 O worker é derivado, e só entra onde a origem recusa

O worker por fonte (`workerDe(sigla)` → `mirror-<sigla>`) é **derivado do registro**, nunca
escrito à mão — um teste varre `nuvio/src/` inteiro e falha com qualquer `mirror-<x>` literal.
Hoje ele é usado em dois lugares: a **reserva do ATO** (a origem devolve 235 B de nginx para IP
de datacenter e o worker devolve o JSON) e as variantes de stream que precisam de `Referer`.

**O que ele não resolve:** o **arquivo** do ATO. Medido 02/10: `…/movie/…mp4` devolve os mesmos
235 B direto (com `Range`, com `Referer`) e **`403 Upstream 403` pelo worker** — o painel recusa
o arquivo para qualquer IP controlável. Só o aparelho prova.

### 6.4 Barreira

`test/nuvio-fontes-tv.test.js` — 12 testes **sem rede**: a regra do MIME, os 4 emissores
assinando a URL, os tetos do orçamento do REI, o REI sem `Referer`, a cadeia do REI rodada com
origem falsa (viva → stream sinalizado · 404 → `[]` · 404 na cadeia → `[]` · rede → **erro**), a
derivacão do worker e a reserva do ATO.

```
node --test test/    # 259
```
