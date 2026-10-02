# MirrorStream — três produtos

O repositório tem **três produtos independentes**, e a divisão é por **o que cada um entrega**:

| Produto | Onde roda | O que é |
|---|---|---|
| [`plugin/`](plugin/) | dentro do app Nuvio, no aparelho | o **plugin**: resolve stream de filmes, séries e anime (11 fontes) |
| [`mirrorstream/`](mirrorstream/) | servidor (BeamUp) | **addon de VOD**: catálogo e meta de filmes/séries, e o player na etapa 2 |
| [`mirrorview/`](mirrorview/) | servidor | **addon de TV ao vivo**: as 4 fontes, o guia (EPG) e o catálogo de canal |

**VOD é do MirrorStream; TV é do MirrorView.** Nenhum dos dois serve o outro: uma rota do
produto errado responde **404 com o nome do outro**, porque a SDK responde qualquer
`/catalog/:type` com `{metas:[]}` e o cliente leria "o servidor não tem canais" em vez de
"este não é o servidor de TV".

Quem usa **Nuvio** instala o plugin e o addon MirrorView (é dele que sai a lista de canais).
Quem usa **Stremio** instala o MirrorStream e não precisa de plugin nenhum.

Os três são **produtos separados de verdade**: cada um tem o seu `package.json`, o seu
`Dockerfile` e os seus testes. O que é comum a eles — o worker, o deploy, o `.gitignore`, os
docs — fica na raiz.

## Medido, depois da divisão

```
plugin      11 bundles + manifesto          (era 15; TV saiu)
mirrorstream  id: com.mirrorstream.addon     name: MirrorStream    types: movie, series
             /catalog/movie, /meta, /api/vod/*        200
             /api/channels*, /nuvio/*, /tv, /p2p/*    404 (com o nome do MirrorView)
mirrorview    id: com.mirrorstream.view      name: MirrorView      types: tv
             /catalog/tv/mirror-tv-live.json          200   327 canais
             /api/channels, /nuvio/catalog/channel/tv.json  200   327 canais
             guia                                  327 canais, 156 com programa hoje
             /api/vod/*, /api/streams/*              404 (com o nome do MirrorStream)
barreiras   279 testes, 0 falha (mirrorstream/ + mirrorview/ + repo)
```

## Rodar

```bash
plugin:       cd plugin      && npm ci && node build.js
mirrorstream: cd mirrorstream && npm ci && PORT=7000 node src/server.js
mirrorview:   cd mirrorview   && npm ci && PORT=7001 node src/server.js

barreiras:    node --test test/ && node --test mirrorstream/test/ && node --test mirrorview/test/
imagens:      docker build -t mirrorstream .                 # Dockerfile da raiz (BeamUp)
              docker build -f mirrorview/Dockerfile -t mirrorview .
plugin:       https://mrrobots777.github.io/mirror/         # é este que o Nuvio instala
```

## O que falta

A **camada de player** dos dois addons. Ela não está no histórico deste repositório (foi
compactado em 7 commits) e é a etapa 2. A lista do que falta está em
[`mirrorview/README.md`](mirrorview/README.md) e [`mirrorstream/README.md`](mirrorstream/README.md).

## Antes desta divisão

O repositório era **um** servidor (`src/` na raiz) que servia catálogo de VOD **e** de TV, com a
camada de player desligada pelas decisões 154/155. A divisão por domínio foi pedida pelo dono em
02/10/2026 — o histórico de cada decisão está em [`CONTEXTO.md`](CONTEXTO.md).