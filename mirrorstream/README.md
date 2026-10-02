# MirrorStream — addon de filmes, séries e anime

Servidor de **VOD**: catálogo e meta (TMDB/AniList) e, na etapa 2, o **player** das 11 fontes —
as mesmas do [`plugin/`](../plugin/), rodando aqui do lado do servidor.

**Nada de TV.** Catálogo de canal, guia e players de TV são do [`mirrorview/`](../mirrorview/).

## Rodar e construir

```bash
cd mirrorstream && npm ci
PORT=7000 PUBLIC_BASE_URL=http://localhost:7000 node src/server.js

docker build -t mirrorstream .      # o Dockerfile fica na RAIZ do repo (é o BeamUp)
```

## Rotas

| rota | o que faz |
|---|---|
| `/catalog/*`, `/meta/*` | catálogo e meta de VOD |
| `/api/vod/*` | API direta, formato `{success, data}` |
| `/install`, `/dashboard` | páginas |
| `/health`, `/metrics` | diagnóstico |
| `/api/channels*`, `/nuvio/*`, `/tv`, `/p2p/*` | **404, e o corpo diz que é do MirrorView** |

O 404 do outro produto é deliberado. Sem o guarda, a SDK responde qualquer `/catalog/:type/:id`
com `{metas:[]}` e o cliente lê *"o servidor não tem nenhum canal"* em vez de *"este não é o
servidor de TV"*. Um 404 que diz onde procurar é mais útil que um 200 vazio.

## O que falta (etapa 2): o player

O servidor ainda responde `{"streams":[]}` no caminho de stream, **de propósito** (decisões
154/155: ele virou só catálogo). A etapa 2 registra as 11 fontes em `core/sources.js` e
reconstrói o `handleStreamsCore` — que não está no histórico deste repositório (o histórico foi
compactado em 7 commits). O `plugin/` tem as 11 fontes funcionando e medidas, e é a referência
de como cada uma resolve.

Anunciar `stream` no manifesto sem entregar link faz o cliente mostrar "nenhum player
encontrado". Por isso a rota **continua registrada** e devolve `{"streams":[]}`: um 404 viraria
"erro do addon" na tela, e lista vazia vira "nenhuma fonte".

## Testes

```bash
node --test mirrorstream/test/
```

A barra do repo (`../test/`) cobre o que é dos três produtos — inclusive o teste que **sobe os
dois servidores de verdade**, porque a lição da decisão 155 é que ler o arquivo como texto não
executa nada.