# MirrorView — addon de TV ao vivo

Servidor de **TV**: as 4 fontes de live, o **guia (EPG)**, o catálogo de canal, a página `/tv` e
o P2P. É daqui que o Nuvio tira a **lista de canais** (rotas `/nuvio/*`).

**Nada de VOD.** Filmes, séries e anime são do [`mirrorstream/`](../mirrorstream/).

## O que está medido hoje

```
/catalog/tv/mirror-tv-live.json   200   327 canais
/api/channels                     200
/nuvio/catalog/channel/tv.json    200   327 canais, id numérico
/tv                               200
guia                              327 canais, 156 com programa hoje / 143 amanhã
/api/vod/*, /api/streams/*        404   (é do MirrorStream, e o corpo diz isso)
```

## O que falta: a camada de player (etapa 2)

**O código não está no histórico deste repositório.** O histórico foi compactado em 7 commits
(todos "1.0.1") e as decisões 154/155 removeram do servidor o relay, o proxy, 3 das 4 fontes de
TV e o registro das fontes. O que **sobra** são os arquivos dos scrapers e o motor.

Para o MirrorView virar o addon de TV completo:

| falta | o que é |
|---|---|
| `core/tv-sources.js` | hoje é `METADADOS` (1 provedor, o REI); o completo tem `PROVIDERS` (4) + `getStreams` / `resolvePlaylist` / `membersOf` / `ownerOf` |
| `lib/stream-relay.js` | o relay: serve a playlist com token novo a cada ida |
| `lib/proxy.js` | máscara de URL e `workerDe()` |
| `lib/etc.js` + `routes/segmentos.js` | a fonte ETC e o segmento que exige `Referer` |
| `scrapers/embedtv.js`, `embedcanais.js`, `reidoscanais.js` | 3 das 4 fontes |
| `handleStreams` de TV | hoje responde `{"streams":[]}` por decisão |

**As 4 fontes já existiam funcionando no `plugin/`** — medido antes de TV sair de lá: 16/16 casos
entregavam stream, zero erro, e o `rcd` saiu de 0 para 1 quando a regra de 403 mudou. São a
referência da porta; a versão de servidor precisa do relay porque a playlist do REI chega como
`text/plain` com token de 300 s, que o player não reconhece.

## Rodar e construir

```bash
cd mirrorview && npm ci
PORT=7001 PUBLIC_BASE_URL=http://localhost:7001 node src/server.js

docker build -f mirrorview/Dockerfile -t mirrorview .   # contexto: a RAIZ do repo
```

## Testes

```bash
node --test mirrorview/test/
```

Inclui `split-tv.test.js` (a ponte do cluster), `tv-rotas.test.js` (página, p2p, gêneros, EPG,
relay) e `catalogo-tv.test.js` (o `/nuvio/*` com id numérico).