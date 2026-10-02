# MirrorStream — addon/ (servidor de catálogo para o Nuvio)

Servidor de **leitura**, e nada mais: catálogo e meta de TV, catálogo e meta de VOD, guia
(EPG), logo de canal, páginas, `/health` e p2p.

**Nenhum byte de vídeo passa por aqui.** As decisões 154/155 tiraram do servidor toda a camada
de player (relay, proxy, as 4 fontes de TV, o registro das 10 fontes de VOD). Quem resolve
stream é o plugin — [`../nuvio/`](../nuvio/), instalado no app.

Quem quer **catálogo e player no mesmo servidor** é o [`../stremio/`](../stremio/).

```
nuvio/     plugin Nuvio        — os players rodam DENTRO do app (15 fontes)
addon/     este                — servidor de leitura: canais, guia, meta
stremio/   addon Stremio       — catálogo E players, autossuficiente
```

## Rodar e construir

```bash
# local
cd addon && npm ci && PORT=7000 PUBLIC_BASE_URL=http://localhost:7000 node src/server.js

# imagem (o Dockerfile fica na RAIZ do repo — é o ponto de entrada do BeamUp)
docker build -t mirror-addon .
```

## Rotas

| rota | o que faz |
|---|---|
| `/catalog/*`, `/meta/*` | catálogo e meta de VOD (TMDB/AniList) |
| `/catalog/tv/*`, `/meta/tv/*` | catálogo e meta de canal de TV |
| `/nuvio/*` | catálogo no formato Nuvio (`id` numérico) — é de onde o Nuvio tira a lista de canais |
| `/api/channels*`, `/api/vod/*` | API HTTP direta, formato `{success, data}` |
| `/install`, `/dashboard`, `/tv` | páginas |
| `/health`, `/metrics` | diagnóstico |

O caminho de stream (`/stream/*`, `/api/streams/*`) responde `{"streams":[]}` com 200 — as
três rotas continuam registradas de propósito: o manifesto vive em cache e um cliente com o
manifesto antigo ainda vai pedir essa rota. Um 404 viraria "erro do addon" na tela;
`{"streams":[]}` vira "nenhuma fonte", que é a resposta certa. Ver `src/server.js`.

## Testes

`npm test` → `node --test test/` (276 testes, sem rede). A barreira do repo, em
`../test/`, cobre o que é dos três produtos — inclusive o teste que sobe este servidor e o do
`stremio/` de verdade.

`test/` ainda contém os testes do contrato do plugin (`nuvio-*.test.js`): eles moram aqui
porque a barreira é do repositório e é daqui que se roda, mas exercitam `../../nuvio/src`.