# Mirror — três produtos

Todos os três se chamam **MirrorStream**. A divisão é por **quem entrega o player** (o link
do vídeo) e por **quem consome**:

| Produto | Onde | O que é |
|---|---|---|
| [`nuvio/`](nuvio/) | dentro do app Nuvio, no aparelho | **plugin**: os **players**, as 15 fontes de anime, filme, série, dorama e TV |
| [`addon/`](addon/) | servidor (BeamUp) | **só catálogo** para o Nuvio: canais, metas e guia/EPG. Nenhum player, nenhum byte de vídeo |
| [`stremio/`](stremio/) | servidor | **addon Stremio completo**: catálogo **e** players, num servidor só |

Quem usa **Nuvio** instala o plugin `nuvio/` e o servidor `addon/` serve o catálogo.
Quem usa **Stremio** instala o `stremio/` e não precisa de mais nada.

Os três são **produtos separados de verdade**: cada um tem o seu `package.json`, o seu
`Dockerfile` e os seus testes. O que é comum a eles — o worker, o deploy, o `.gitignore`, os
docs — fica na raiz.

O dono decidiu em duas etapas (decisões 154 e 155, 02/10/2026): para o **Nuvio**, os players vêm
**exclusivamente do plugin**, e o servidor `addon/` não entrega vídeo nenhum — nem de VOD, nem
de TV. O `stremio/` é a exceção que o dono pediu depois: lá o servidor volta a ser o dono do
player, porque quem consome é o Stremio e não existe plugin para ele.

```
aparelho (Nuvio)
  ├─ plugin mirror ─────────► as 15 fontes, direto do IP residencial de quem assiste
  └─ addon mirrorhub ───────► este servidor: QUAL canais existem e O QUE passa neles agora
```

---

## Por que o servidor continua existindo

Tudo o que ele faz é **leitura**. As três coisas que o plugin não tem como fazer sozinho:

1. **A lista de canais.** O Nuvio não tem lista de canal nativo: ela sempre vem de um addon.
   São as rotas `/nuvio/*`, com o `id` em **número** (o NuvioTV só deixa o plugin rodar em id
   numérico) cruzando com `nuvio/src/lib/canais.js`.
2. **O guia (EPG).** `src/lib/epg.js` baixa o XMLTV do REI (1,2 MB, ~3.900 programas), guarda só
   os canais que batem com o catálogo e monta a grade do dia em `videos`. O plugin não tem onde
   buscar isso.
3. **O logo e o metadado do canal.** A lista vem do `/api/channels` do REI: **327 canais, logo em
   100% deles** (medido). Sem isso a lista abre com 82% de buraco.

E, desde 02/10/2026, uma quarta, que era um bug escondido: **o servidor não pode cair**. Ver
"o conserto que não era pedido" no fim.

**O que deixou de ser motivo (decisão 155):** até a 154 o servidor também era o **relay de TV**,
porque a playlist do REI chega como `text/plain` com token de 300 s e o player não reconhece
aquilo como HLS. Isso foi para o plugin — e o argumento não sobrevive: `text/plain` e token de
300 s são um problema do **host de origem**, não do transporte. O plugin resolve a cadeia no
aparelho. O relay existia porque o servidor fabricava a URL do vídeo; sem fabricar URL, não há o
que fabricar.

---

## URLs

### Catálogo para o Nuvio (`mirrorhub`) — o que o Nuvio instala

| Rota | O que responde |
|---|---|
| `GET /nuvio/manifest.json` | o manifesto do addon `MirrorHub` |
| `GET /nuvio/catalog/channel/tv.json` | a lista de canais (id **numérico**) |
| `GET /nuvio/meta/channel/:id.json` | um canal e os programas do dia |
| `GET /nuvio/stream/channel/:id.json` | `{"streams":[]}` — a rota **fica** (cliente com manifesto antigo em cache), mas `stream` **não é mais um recurso declarado**. O player vem do plugin |

Base: `https://<host>/nuvio`

### Catálogo Stremio (continua valendo, não foi renomeado nada)

| Rota | O que responde |
|---|---|
| `GET /manifest.json` | manifesto do addon |
| `GET /catalog/:type/:id.json` | catálogo (TV ao vivo vem daqui) |
| `GET /meta/:type/:id.json` | meta de filme/série/canal |
| `GET /stream/:type/:id.json` | `{"streams":[]}` para tudo (TV, filme e série) — o servidor não tem player |
| `GET /api/channels`, `/api/channels/categories`, `/api/channels/:slug` | API de TV |
| `GET /api/vod/search`, `/api/vod/genres`, `/api/vod/:type/:id` | API de metadado (TMDB) — **continua** |
| `GET /api/streams/:type/:id` | lista vazia, `{success:true,data:[]}` |
| `GET /health`, `/metrics` | diagnóstico |
| `GET /install`, `/dashboard`, `/tv` | páginas |

---

## Instalar no Nuvio

### 1. O plugin (os players)

No app: **Settings → Plugins → Add repository URL**, e cole o endereço do `manifest.json`
publicado do plugin:

```
https://<user>.github.io/<repo>/manifest.json
```

O app aceita o endereço sem o `/manifest.json` e acrescenta sozinho. Depois é só escolher e
ativar os scrapers na tela de Plugins. Detalhes em [`nuvio/README.md`](nuvio/README.md) e o
desenho em [`nuvio/ARQUITETURA.md`](nuvio/ARQUITETURA.md).

### 2. O catálogo `mirrorhub` (a lista de canais)

**Settings → Addons →** cole a URL base do addon Mirror com `/nuvio` no fim:

```
https://<host>/nuvio
```

**Sem o catálogo os canais não aparecem.** O plugin entrega o *player*; quem diz **quais canais
existem e o que passa neles agora** é o addon.

---

## O que o servidor faz hoje

- **Catálogo/meta de TV** — `/nuvio/*` (formato Nuvio) e `/catalog/tv/*`, `/meta/tv/*` (formato
  Stremio). Mesmo catálogo, mesmo cache: a rota do Nuvio é acréscimo, só muda o `id` na entrada
  (numérico) e na saída.
- **Catálogo/meta de filme e série** — o Nuvio usa a própria TMDB, mas o addon continua
  respondendo `/meta/*` e `/api/vod/*`.
- **Guia/EPG** — `src/lib/epg.js`, decisoes 55/56/121.
- **Metadado de canal** — `src/core/tv-sources.js` monta a lista a partir do `/api/channels` do
  REI. É a única fonte que restou no servidor, e ela entrega **metadado**, nunca vídeo.

## O que saiu do servidor

As **10 fontes de VOD/anime** (`shg ron aon atb blz kkt spt vzr dgo rtd`). Elas estão em
`nuvio/src/scrapers/`. Os **arquivos** continuam em `src/scrapers/` (outros módulos e os testes os
referenciam) — o que saiu foi o **registro** em `src/core/sources.js`, o `require` dos módulos no
boot e o aquecimento que carregava base do KAK e catálogo de painel.

Medido, mesma sequência de pedidos, depois que o aquecimento termina:

| | Antes | Depois |
|---|---|---|
| RSS | 272 MB | **136 MB** |
| heap usado | 81 MB | **31 MB** |
| `paineis.db` em disco | 15 MB | **não é gravado** |
| `iptv.db` aberto | sim | **não** |
| `capacity.scraperSources` | 10 | **0** |

### E as 4 fontes de TV (decisão 155)

O dono: *"nada no servidor senão catálogo, todas as fontes são via plugin"*. Saiu o resto do
caminho de vídeo:

| Saiu | Era |
|---|---|
| `/stream/hls/*`, `/stream/proxy`, `/seg/etc/*` | relay e máscara de URL |
| `/stream/proxy-check` | medir se a WAF de uma origem barrava o servidor |
| `src/lib/stream-relay.js`, `src/lib/proxy.js`, `src/lib/etc.js`, `src/routes/segmentos.js` | os arquivos delas |
| `src/scrapers/{embedtv,embedcanais,reidoscanais}.js` | as 3 fontes de TV que não entregam **metadado** — apagadas |
| `getStreams`, `resolvePlaylist`, a **triagem** e a **prova de morte** | o motor de player de TV |
| `VIDEO_BASE_URL` e o round-robin de vídeo | o embrulho do `/stream/proxy` |

O `reidosembeds.js` **continua**, enxuto ao que é de verdade: catálogo, logo e guia.

**O ganho que ninguém esperava, e que é o argumento para a decisão:** o catálogo de TV era a peça
cara do servidor — 284 canais × 4 fontes, em concorrência 48, para decidir quem entrava na lista.
Isso custava **127 s**, muito acima dos 12,3 s em que o gateway corta. Medido depois da 155:

| | Antes | Depois |
|---|---|---|
| catálogo de TV, frio | 127 s | **1,17 s** |
| busca e categoria | 42 s (504) | **0 ms** |
| canais na lista | 284 (a triagem podia encolher) | **327** (é o que o REI declara, e ninguém encurta) |
| RSS de pé, com catálogo e guia aquecidos | — | **85 MB** (heap 20 MB) |

---

## Executar localmente

```bash
npm ci
PUBLIC_BASE_URL=http://localhost:7000 node src/server.js
```

```bash
node --test test/       # 247 testes
node --expose-gc memoria.js   # onde está a RAM
node memoria.js --vod         # mede o boot antigo, com as 10 fontes de VOD
```

> **Node local = 18** (`/usr/bin/node`). O `better-sqlite3` foi compilado contra o ABI do Node 18;
> rodar com o Node 22 faz `sqlite-cache.js` despejar core (SIGSEGV) no boot. Está no AGENTS.md.

## Deploy

BeamUp (Dokku). Dois apps: **`mirrorhub`** (este repositório) e **`mirrorhub2`** (cluster de TV,
mesmo código). Hash novo: **`e75602c18409`**.

| App | Start Command |
|---|---|
| `mirrorhub` / `mirrorhub2` | `npm start` → `node src/server.js` |

`PUBLIC_BASE_URL` é obrigatória (o gateway reescreve o `Host`, e sem ela as URLs de TV saem
relativas). `SCRAPER_TIMEOUT_MS=9000` porque o gateway corta em ~12,3 s. Passo a passo em
[`DEPLOY.md`](DEPLOY.md).

## Variáveis de ambiente

Todas passam por `src/core/nomes.js` (um teste falha se alguém escrever um nome fora do
registro). Principais:

```bash
PORT=7000                     # local; em prod é injetada pelo Dokku
PUBLIC_BASE_URL=https://...   # obrigatória em prod
TMDB_API_KEY=sua_chave        # metadados
TV_BASE_URL=                  # cluster de TV (app2), opcional
```

## Segurança

- Proteção contra SSRF (bloqueio de IPs privados)
- Rate limiting por IP (Redis ou memória)
- Cache com limite de tamanho (SQLite + memória), **e erro nunca é guardado** (decisão 140)
- DNS Cloudflare (1.1.1.1)

## Licença

Uso pessoal.