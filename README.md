# MirrorStream — três produtos

O repositório tem **três produtos independentes**. A divisão é por **o que cada um entrega**:

| Produto | Onde roda | O que é |
|---|---|---|
| [`plugin/`](plugin/) | dentro do app **Nuvio**, no aparelho | resolve stream de filmes, séries e anime (**11 fontes**), do IP residencial de quem assiste |
| [`mirrorstream/`](mirrorstream/) | servidor (BeamUp) | **addon de VOD**: catálogo e metadados de filmes, séries e anime |
| [`mirrorview/`](mirrorview/) | servidor | **addon de TV ao vivo**: as 4 fontes, o guia (EPG) e o catálogo de canal |

**VOD é do MirrorStream; TV é do MirrorView.** Nenhum dos dois serve o outro: a rota do produto
errado responde **404 e diz o nome do outro**, porque a SDK responde qualquer `/catalog/:type`
com `{metas:[]}` e o cliente leria "o servidor não tem canais" em vez de "este não é o servidor
de TV".

## O que funciona hoje, e onde

```
Nuvio       plugin + os DOIS addons  →  stream das 11 fontes + catálogo + 327 canais + EPG
Stremio     os DOIS addons           →  catálogo e guia. SEM player (ver abaixo)
```

**O Stremio não tem player, e isso é decisão, não defeito.** As decisões 154/155 tiraram a
camada de vídeo do servidor: o player no aparelho é o que resolve o problema de origem que
recusa IP de datacenter — medido, várias fontes respondem 200 do IP residencial e 403 do
datacenter. Os três addons anunciam `stream` no manifesto porque a SDK **exige** (todo handler
definido tem que estar em `resources`), e respondem `{"streams":[]}` com 200: o Stremio lê
"nenhuma fonte", que é a verdade, e não um 404, que ele leria como "o addon quebrou".

Reconstruir o player no servidor é a **etapa 2**, e não está no histórico deste repositório
(compactado em 7 commits). Para VOD os 10 scrapers e o motor ainda estão em
`mirrorstream/src/` — falta o registro. Para TV é do zero: as 4 fontes não existem em lugar
nenhum hoje.

## Instalar

| | Endereço | Para quê |
|---|---|---|
| **MirrorStream** | `https://e75602c18409-mirrorstream.baby-beamup.club/manifest.json` | catálogo e metadados de filmes, séries e anime |
| **MirrorView** | `https://e75602c18409-mirrorview.baby-beamup.club/manifest.json` | catálogo de 327 canais e guia EPG do dia inteiro |
| **Plugin** | `https://mrrobots777.github.io/mirrorstream` | resolve os streams das 11 fontes — **só Nuvio** |

No **Nuvio** você precisa dos três. No **Stremio**, os dois addons e nenhum plugin.

Páginas de instalação (abrem no navegador, com o botão):

```
https://e75602c18409-mirrorstream.baby-beamup.club/install
https://e75602c18409-mirrorview.baby-beamup.club/install
```

## Rodar

```bash
plugin:       cd plugin      && npm ci && node build.js
mirrorstream: cd mirrorstream && npm ci && PORT=7000 node src/server.js
mirrorview:   cd mirrorview   && npm ci && PORT=7001 node src/server.js

barreiras:    node --test test/ && node --test mirrorstream/test/ && node --test mirrorview/test/
imagens:      docker build -t mirrorstream .                   # Dockerfile da raiz
              docker build -f mirrorview/Dockerfile -t mirrorview .
```

## Borda (Cloudflare Worker)

[`worker-borda.mjs`](worker-borda.mjs) coloca os dois addons na borda: o primeiro pedido de cada
objeto paga a origem, e o resto sai de um PoP perto de quem perguntou.

```bash
npx wrangler deploy                                   # wrangler.toml, um worker por addon
curl -s https://<worker>.workers.dev/__borda           # diagnóstico, responde no próprio PoP
curl -sI https://<worker>.workers.dev/manifest.json | grep -i x-mirror
```

Medido de dentro do Brasil, **antes** do worker: `/manifest.json` levava **1,09 s** e
`/meta/movie/tmdb:603.json` **0,60 s** — o cache de borda da zona do BeamUp só guarda o JSON
*depois* de a origem responder.

O que **não** vai para a borda está decidido em `classifica()` e cada regra está justificada em
`test/worker-borda.test.js`: stream (é link de vídeo), `?date=` (1,1 MB por dia, medido),
qualquer erro ≥ 400 (decisão 140), diagnóstico e telemetria, e qualquer rota não classificada.

## Antes desta divisão

O repositório era **um** servidor (`src/` na raiz) que servia catálogo de VOD **e** de TV, com a
camada de player desligada pelas decisões 154/155. A divisão por domínio foi pedida em
02/10/2026 — o histórico de cada decisão está em [`CONTEXTO.md`](CONTEXTO.md), e as armadilhas
que já custaram tempo em [`AGENTS.md`](AGENTS.md).