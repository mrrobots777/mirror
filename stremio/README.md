# MirrorStream Stremio — o addon Stremio completo

Addon **completo**: catálogo **e** players, num servidor só. É para quem usa Stremio e não
precisa (nem pode) instalar plugin nenhum.

```
nuvio/     plugin Nuvio        — os players rodam DENTRO do app (15 fontes)
addon/     catálogo para o Nuvio — servidor de leitura: canais, guia, meta de VOD
stremio/   addon Stremio       — este: catálogo E players, autossuficiente
```

Os três são **produtos independentes**, cada um com o seu `package.json`, o seu `Dockerfile` e
os seus testes. O que é comum a eles (o worker, o deploy, o `.gitignore`) fica na raiz do repo.

---

## Onde esta hoje: **etapa 1**

O que já funciona, medido:

```
id: com.mirrorstream.stremio | name: MirrorStream Stremio | resources: [catalog, meta, stream]
/health              200  0,013s
/catalog/tv/all.json 200  0,009s
/nuvio/...           200  0,013s
/install             200  0,008s
```

Ou seja: **o catálogo funciona, com identidade própria.** O `id` é diferente do `addon/`
(`com.mirrorstream.addon`) de propósito — dois addons com o mesmo `id` não convivem: o segundo
sobrescreve o primeiro na lista, e o usuário perde um dos dois sem nenhuma mensagem.

## O que falta: **etapa 2 — a camada de player**

**Este código não está no histórico do repositório.** O histórico foi compactado em 7 commits
(todos "1.0.1"), e as decisões 154/155 removeram a camada de player do servidor. O que **sobra**
são os arquivos dos 15 scrapers em `src/scrapers/` e o motor em `src/lib/scraper-engine.js`.

Para o `stremio/` virar o addon completo, é preciso reconstruir:

| falta | o que é |
|---|---|
| registro das 10 fontes | `src/core/sources.js` tem **0** `engine.use()`; precisa dos 10 `require` + `use` |
| `src/lib/stream-relay.js` | o relay de TV (playlist servida com token novo a cada ida) |
| `src/lib/proxy.js` | máscara de URL, cifra e `workerDe()` |
| `src/lib/etc.js` + `src/routes/segmentos.js` | a fonte ETC e o segmento que exige `Referer` |
| `src/scrapers/embedtv.js`, `embedcanais.js`, `reidoscanais.js` | 3 das 4 fontes de TV |
| `src/core/tv-sources.js` | hoje é `METADADOS` (1 provedor); o completo tem `PROVIDERS` (4) + `getStreams`/`resolvePlaylist`/`membersOf`/`ownerOf` |
| `handleStreamsCore` | hoje responde `{"streams":[]}` por decisão (154/155) |

O `nuvio/` tem **todas as 15 fontes funcionando e medidas** (16/16 casos entregam stream, zero
erro) e é a referência de como cada fonte resolve. O `plugin` resolve no aparelho; a versão
servidor tem o mesmo `getStreams`, mas com o relay, o proxy e a máscara no lugar do player.

**Nada aqui é opcional.** Um addon que anuncia `stream` no manifesto e devolve `{"streams":[]}`
faz o Stremio mostrar "nenhum player encontrado" — que é o defeito que as decisões 154/155
resolveram removendo o anúncio. Na etapa 2 o `stream` volta a ser real, e o teste
`test/produtos-sobem.test.js` + a barreira de `addon/test/` são a rede de segurança.

---

## Rodar e construir

```bash
# local
cd stremio && npm ci && PORT=7802 PUBLIC_BASE_URL=http://127.0.0.1:7802 node src/server.js

# imagem
docker build -f stremio/Dockerfile -t mirror-stremio .
```

O contexto de build é a **raiz** do repo (o `Dockerfile` da raiz constrói o `addon/`; este
constrói o `stremio/`).

Os testes deste produto entram na barreira do repo em `test/produtos-sobem.test.js`, que **sobe
os dois servidores de verdade** — porque a lição da decisão 155 é que ler o arquivo como texto
não executa nada, e foi assim que um `require` quebrado passou a barreira inteira.