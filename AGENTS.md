# AGENTS.md — Contexto para agentes de IA

> **Antes de qualquer tarefa, leia [`CONTEXTO.md`](CONTEXTO.md)** — contexto compacto (estado, decisões firmes, env de produção, comandos, armadilhas) para não revisar o código inteiro. Atualize os dois arquivos quando algo mudar.

## Visão geral

O Mirror são **DUAS peças** desde a decisão 154 (02/10/2026):

| Peça | Onde | O que faz |
|---|---|---|
| **`mirrorhub`** — este repositório (`src/`) | servidor (BeamUp) | **só catálogo**: canais, metas e guia/EPG. **Nenhum player, nenhum byte de vídeo** |
| **`mirror`** — [`nuvio/`](nuvio/) | dentro do app Nuvio | os **players**: as 15 fontes |

O dono, em duas decisões: *"Nuvio é o único cliente e os players passam a vir exclusivamente do plugin"* (**154**) e *"nada no servidor senão catálogo, todas as fontes são via plugin"* (**155**). **Nenhum vídeo passa por este servidor — nem de VOD, nem de TV.** As 10 fontes de VOD/anime saíram do motor na 154 (os **arquivos** continuam em `src/scrapers/`, mas o servidor não carrega nenhum no boot); as **4 de TV** saíram na 155, junto com o relay e o proxy. O desenho está em [`README.md`](README.md) e [`nuvio/ARQUITETURA.md`](nuvio/ARQUITETURA.md).

O que o servidor **continua** fazendo — **tudo leitura, nada de escrita**: catálogo/meta de TV (`/nuvio/*`, `/catalog/tv/*`, `/meta/tv/*`, `/api/channels*`), catálogo/meta de filme e série (`/meta/*`, `/api/vod/*`), EPG (`src/lib/epg.js`), **metadado e logo de canal** (`core/tv-sources.js` + `reidosembeds.js`, uma fonte só), páginas, `/health`, `/metrics` e p2p. **Não há mais relay, proxy, nem fonte de player** — a seção da decisão 155, mais abaixo, tem a lista completa do que saiu.

**Stack:** Node.js (>=20), CommonJS, Express 5, stremio-addon-sdk, compression

## Arquitetura

```
src/
├── core/                    # Casca nova: o motor, os registros e os NOMES
│   ├── nomes.js             # REGISTRO ÚNICO DE NOMES — fontes, rotas da API e env vars (o resto importa daqui)
│   ├── sources.js           # O MOTOR — sem NENHUMA fonte (154/155); só o motor + buildContext
│   └── tv-sources.js        # CATÁLOGO + META de TV. Uma fonte de METADADO só (o REI)
├── lib/
│   ├── scraper-engine.js    # MOTOR: contrato único, timeout, breaker, normalização
├── server.js                # Express app, rotas Stremio, handler principal
├── scrapers/
│   ├── anilist.js         # Metadados anime (AniList API + Jikan fallback)
│   ├── kitsu.js           # Metadados anime (API Kitsu — ids kitsu:)
│   ├── otakulogia.js      # GraphQL (api.otakulogia.com) — dublado PT-BR
│   ├── animesdigital.js   # HTML scraping (animesdigital.org)
│   ├── aon.js             # HTML scraping (animesonline.io) — índice list-mode + token anidrive
│   ├── anitube.js         # API REST WP (anitube.biz) — categorias WP por anime + vídeo do `d=`
│   ├── kakito.js          # VOD via iptv.db (M3U playlist + SQLite)
│   ├── xtream.js          # Painéis Xtream (BLZ/SPC/ATO) — filmes e séries MP4
│   ├── playerflix.js      # API REST (playerflix.ink) — filmes e séries HLS
│   ├── doramogo.js        # Doramas (doramogo.net) — busca/HTML + path madfirebox
│   ├── vizer.js           # VOD vizer.autos — URL de MP4 derivada do id TMDB (nixplay.lat → R2)
│   ├── reidosembeds.js    # METADADO/LOGO/GUIA da TV (API /api/channels do REI) — sem player (155)
│   ├── tmdb.js            # Metadados TMDB (filmes e séries)
│   ├── cinemeta.js        # Resolução IMDb/TMDB (fallback)
│   └── url-resolver.js    # Resolvedor de URLs (redirects)
├── lib/
│   ├── anime-ranking.js   # Ranking de streams por qualidade/idioma
│   ├── epg.js             # Guia XMLTV (API do REI) — programa por canal
│   ├── match.js           # matchScore, matchVodTitle, bestMatchScore
│   ├── html.js            # Interpretador de HTML tolerante + seletor (SEM dependencia)
│   ├── extrator.js        # MOTOR: acha a URL do video em qualquer site (6 tecnicas)
│   ├── quality.js         # extractQuality, qualityRank, videoResolutionToQuality
│   ├── redis.js           # Cache Redis com rate limiting via Lua
│   ├── scraper-utils.js   # browserFetch, makeCache, probeHlsQuality, enqueue
│   ├── semaphore.js       # Semáforo por tipo
│   ├── source-names.js    # LÓGICA de fontes (SOURCES/SOURCE_PRIORITY derivados de core/nomes.js)
│   ├── sqlite-cache.js    # Cache persistente SQLite
│   ├── stream.js          # makeHttpStream + vodTitle (labels padronizados)
│   ├── video-probe.js     # Resolução real do vídeo (SPS H.264 em TS, VisualSampleEntry em MP4)
│   ├── text.js            # normalizeText, normalizeLoose, stripYear, lower
│   └── ua.js              # User-Agent string
└── test/
    └── mirror.test.js     # Testes
```

## Fluxo principal de streams

1. Stremio chama `handleStreams(type, id, config)` com ID do episódio/filme
2. Se ID começa com `tv:live:` → canal EmbedTV (Kakito é só VOD — não existe mais rota direta `iptv:`)
3. Para anime: `getTitles(id)` resolve o título via AniList (ids `kitsu:`/`kitsuNNN` via API Kitsu)
4. Para filmes/séries: TMDB resolve metadados (título, episódios)
5. `isLikelyAnime()` detecta se é conteúdo anime (caracteres japoneses + keywords)
6. Scrapers são chamados em paralelo, timeout global de 20s
7. ~~Para anime: Otakulogia, AnimesDigital, AON (animesonline.io), ATB (anitube.biz)~~ — **saiu do servidor na decisão 154**; essas e as outras 9 fontes de VOD agora rodam no plugin (`nuvio/src/scrapers/`)
8. ~~Para filmes/séries: Xtream (BLZ/SPC/ATO), PlayerFlix, KKT, RedeToons (RTD)~~ — **idem**
9. ~~Para TV ao vivo: REI + EMB + ETC + RCD~~ — **saíram todas na decisão 155**. O servidor não resolve mais nenhum stream: as três rotas de stream (`/stream/*`, `/api/streams/*`, `/nuvio/stream/*`) respondem `{"streams":[]}` em 200, sem tocar em origem. O REI continua, mas **só como metadado** (catálogo e logo) e fonte do guia
10. `rankAnimeStreams()` ordena por: PT-BR > dual audio > mais legendas > qualidade

**Os passos 7, 8 e 9 saíram — não sobrou nenhum.** O caminho de stream responde `{"streams":[]}` (200, cache de 60 s) para `movie`, `series` **e** `tv`, **antes** de resolver metadado: sem fonte registrada, a busca no AniList, o catálogo de painel e a sonda de qualidade só serviam para alimentar fontes que não existem mais. O atalho é `temFonteDeVod()` e `temFonteDeTv()` (`src/core/sources.js`), e ambos têm teste.

## API pública (HTTP, fora do Stremio)

Formato único `{ success: true, data }` (erro: `{ success: false, error }`), para quem quiser consumir o Mirror sem falar com Stremio/TMDB. **TV (decisão 110):**

| Rota | O que faz |
|------|-----------|
| `GET /api/channels?search=&category=` | Lista os canais (usa o mesmo catálogo do Stremio) |
| `GET /api/channels/categories` | Categorias com contagem |
| `GET /api/channels/:slug` | Um canal (EPG de agora em `now_playing_*`) |

**VOD (filmes e séries):**

| Rota | O que faz |
|------|-----------|
| `GET /api/vod/search?q=&type=movie\|series&limit=&page=` | Busca no TMDB (`type` vazio = os dois) — devolve `id` no formato `tmdb:<id>` |
| `GET /api/vod/genres` | Gêneros (`{ movie: [...], series: [...] }`) |
| `GET /api/vod/:type/:id` | Detalhe; série já vem com **todos os episódios** em `videos`, com id `tmdb:<id>:<temp>:<ep>` pronto para a rota de stream |
| `GET /api/streams/:type/:id?season=&episode=&config=` | **Streams unificados** — um endpoint só para `movie`, `series` e `tv` (`tv` aceita a chave sem o prefixo `tv:live:`) |

A rota `/api/streams/...` reaproveita `handleStreams()` — mesmo cache, mesmo ranking, mesma lista que o Stremio vê. Rotas de caminho fixo (`/genres`, `/search`) vêm **antes** de `/api/vod/:type/:id`, senão o Express captura como parâmetro.

## Tipos de conteúdo suportados

| Tipo | ID Stremio | Fontes ativas |
|------|-----------|---------------|
| `ID Stremio` | `series` | AniList (metadata) + Otakulogia, AnimesDigital, AON, ATB |
| Filme | `movie` | TMDB (metadata) + Xtream Blaze/Space, PlayerFlix, KKT, RedeToons |
| Série (não-anime) | `series` | TMDB (metadata) + Xtream Blaze/Space, PlayerFlix, KKT, RedeToons |
| TV ao vivo | `tv` | **327 canais**, catálogo do **REI** (reidosembeds.online) — **só metadado, logo e guia**. As 4 fontes de player saíram do servidor na decisão 155; o `stream` de TV responde `{"streams":[]}` |

## O motor de scrapers (decisão 46)

Uma fonte se declara em `src/core/sources.js` e o resto é automático:

```javascript
engine.use({
  id: "blz", label: "BLZ", kind: "vod", timeoutMs: 12000,
  run: c => xtream.streamsFor(c.title, c.episode, c.type, undefined, c.season, c.year, c.runtime),
});
```

- `run` recebe **um contexto** (`{kind, type, title, episode, season, year, runtime, tmdbId, origin, key}`) — nunca 7 parâmetros posicionais
- `kind`: `"anime"`, `"vod"` ou array; `when(ctx)`: condição para chamar
- O motor garante: timeout, **circuit breaker** (3 falhas → 5 min), single-flight, e **normalização** (todo stream sai com `id/type/name/url/season/episode/quality/size/sources/dubbed/portuguese/subtitle/subtitles/behaviorHints`)
- `notWebReady` é derivado dos `headers` (igual ao `makeHttpStream`) — é o que faz o stream **abrir no celular e na TV** e não só no navegador
- Falha de uma fonte **não** derruba as outras; `err.partialStreams` traz o que já deu certo
- Métricas por fonte em `/health` → `capacity.scraperEngine`
- **TV tem registro próprio** (`src/core/tv-sources.js`): `PROVIDERS` com prefixo de slug, `ownerOf()` roteia, e o servidor não conhece nenhuma fonte de TV
- **EPG nativo do Stremio (decisões 55/56, fonte trocada na 121)**: `src/lib/epg.js` baixa **`https://reidosembeds.online/api/guia`** (`EPG_REI_URL`, XMLTV de **1,25MB → 3.972 programas em 143 canais**; era o `epg.pw/xmltv/epg_BR.xml.gz`, que dava 18.459 — o XMLTV do REI é 4x menor e derrubou o custo de heap do guia de **+71MB para ~0**, medido `RSS apos EPG: -10MB`), faz parse **por stream** e guarda **só os canais que batem com o nosso catálogo**, em tupla compacta `[titulo, inicio, fim]`. **Os logos vêm do `/api/channels` do REI** (`reiApi.loadCatalog()`, cache 30min — o mesmo cache do catálogo); **`<display-name>` tem que passar por `decodeEntities`** (senão `A&amp;E` vira chave `aetampe` e o canal fica fora do guia). Cache do guia = 6h (o deles responde `max-age=86400`). **O Stremio passou a ter EPG nativo** (exemplo oficial `examples/epg-livetv.js` do SDK) — o guia **não** é mais a descrição: (1) o manifesto declara **`behaviorHints: { epgProvider: true }`**; (2) o catálogo de TV declara o extra **`date`** (e `skip`); (3) **quando `extra.date` vem, a resposta é `metasDetailed`** (não `metas`) e cada meta leva `videos: [{ id: <canal>:epg:<startTime>, title, overview, released, startTime, endTime, runtime: "N min", releaseInfo }]` + `behaviorHints.hasScheduledVideos: true`; (4) o `/meta` do canal devolve a grade do dia em `videos` (é a aba **Channel Guide**). A janela guardada é **de ontem 00:00 até amanhã 24:00** em BRT (`meiaNoite()`/`dataDe()`), para a grade do dia inteiro caber; o `extra.date` compara com `dataDe(epoch)`, que devolve a data **BRT** (o epoch já somou `EPG_TZ_OFFSET`). Medido: **82/161 canais hoje, 71 amanhã**; o catálogo sem `date` continua leve (65KB) e com `date` vai a 660KB. **O XMLTV já vem em hora local (BRT)**: somar `+3h` no epoch e exibir com `timeZone: UTC`, senão tudo desloca 3h. O `<programme>` tem os atributos em **ordem variável** — nunca assuma `start` antes de `channel`. A linha `📺 … até HH:MM` continua na descrição e no título do stream como fallback para cliente sem suporte nativo. `/health → capacity.epg`. **Atenção**: existe uma **rota Express própria** `app.get("/catalog/:type/:id.json")` que intercepta **antes** do `sdkRouter` — mudar o `defineCatalogHandler` não basta, tem que mudar a rota também (foi esse o bug que deixava a grade vazia).
- **TV em cluster separado (decisão 58/60)**: `src/lib/tv-split.js` + middleware `repassaTv`. Com `TV_BASE_URL` ligado, o app1 **busca o JSON de TV no outro cluster e devolve como resposta própria** (`/catalog/tv/*`, `/meta/tv/tv:live:*`, `/stream/tv/tv:live:*`); **VOD e meta de série ficam no app1**. **NÃO usar 302** — o cliente Stremio/Nuvio não segue redirecionamento em `/catalog` e `/meta` (fica sem canal e sem prévia; o dono reportou). Só o JSON passa pelo app1, vídeo nunca. **Se o cluster de TV falhar, `repassaTv` chama `next()` e o app1 serve o TV localmente** — o split é otimização, não ponto único de falha. `TV_PROXY_TIMEOUT_MS` = 8s; resposta vazia ou > 4MB também cai para o local. No primeiro request que chega no cluster de TV o servidor assume `runtimeBase = TV_BASE` e loga `[split] este app e o cluster de TV: base = ...`. O app2, nunca recebendo VOD, **não aquece** o catálogo de filmes (`aqueceVod()` só roda no primeiro request não-TV) — 93MB contra 145MB. **Dokku/BeamUp reescreve o `Host` para só o nome do app** (`c12e41ddc21b-mirror2`, sem domínio) e `x-forwarded-host` chega vazio, então `ehOProprioClusterDeTv()` compara o **primeiro rótulo** do domínio — comparar o host inteiro ou por `startsWith` não funciona (`c12e41ddc21b-mirror` é prefixo de `c12e41ddc21b-mirror2`, o app1 se acharia o cluster de TV). `ehRequisicaoDeTv` precisa **decodificar** o path (o id vem `tv%3Alive%3Ahbo`) e separar `tv:live:` de `tmdb:`. `runtimeBase` é repassado como `base` em `handleStreams(..., base)` → `maskTvUrls(streams, base)`, senão o app2 devolveria URL do app1.
- **Previa do canal = frame de video (decisao 63)**: a previa **nao e o logo**. A fonte EMB entrega `background` num arquivo `.prev.png` que e um **JPEG 1280x720** (frame real do sinal, igual thumb de video do YouTube) e a ETC tem o mesmo padrao em `.../sinalpublico/foto/embed/<slug>.prev.png`. **`buildGroup` guardava so `logo` e `metaOf` sobrescrevia `background` com o logo** — a previa era jogada fora e por isso o Stremio nao mostrava imagem de fundo. Agora `group.preview` e guardado separado, `poster` = logo e `background` = previa (reserva no logo), e **`getStreams` repassa a previa para os streams** (e o que aparece na tela de play). Para os canais sem previa, `completaPrevia()` deriva `<logo sem extensao>.prev.png` e **verifica com GET Range de 2KB antes de usar** (`existePreview`, cacheado **24h** em `previaVerificada`) — sem isso apareceria link quebrado. Medido: **155/161 com previa de video**; as 6 sem previa (PT - Canal 11, BAND RJ, CAZETV 1, GLOBO RJ, 24H PLAY BOY, 24H SEXY HOT) nao tem o arquivo na origem.
- **REI: metadados, logos e guia (decisão 121)**: `src/scrapers/reidosembeds.js` é hoje **a fonte de metadado da TV** — no `getCatalog`, quando o canal existe lá, `grupoRei.logo` sobrescreve a imagem do grupo, e no `getMeta` o REI é o **primeiro membro consultado** (o `poster`/`background` da meta vêm do grupo; fallback = quem já tinha a imagem). **Medido: 284 canais com 0 sem logo** (REI 224 / img.faz-o-eli 57 / vercel 3). `loadCatalog()` cacheia o `GET /api/channels` (256KB, 327 canais com `logo_url`/`preview_url`/`now_playing_*`) por 30min e é dele que o `epg.js` tira os logos. **O `preview_url` é MORTO**: os 327 apontam para o host `xn---bg-09-...rent` que responde **403** para tudo, e `reidosembeds.online/img/<slug>.prev.png` devolve **404** (só o logo responde 200) — por isso `makeMeta` põe `background: logo` e o `/meta` usa `group.preview || group.logo || out.poster`, **nunca** o `preview_url` do REI. O guia veio do `GET /api/guia` (XMLTV); `src/lib/epg-rei.js`, que raspava o HTML do `/guia`, foi **removido** junto com `kakito-tv.js`, `relay-live.js` e `live-kak.js` (o KAK saiu da TV).
- **Ferramentas de TV (decisao 59)**: `node audit-tv.js` (triage rápido de **todos** os canais: quantos com as 2 fontes, quantos com guia hoje/amanhã, status HTTP de cada stream) e `node probe-tv.js` (**verdade**: roda `ffmpeg -t 4 -f null -` e só conta como "toca" se **decodificar**). **Use o `probe-tv.js` para decidir** — o `audit-tv.js` só dá triagem. Dois erros de leitura que já custaram tempo: (1) **canal ao vivo não tem `duration`** na playlist, então exigir `duration > 0` dá falso negativo; (2) rodar **vários ffmpeg em paralelo satura o relay** e vira falso negativo — rode com `PROBE_CONC=1`. Os segmentos da EMB/ETC vêm com **extensão `.woff`** (mas são MPEG-TS válido, 100% dos blocos com sync `0x47`) — o ffprobe recusa a extensão, o ffmpeg toca; não concluir "quebrado" por isso.
- **Catálogo de TV unificado por nome (decisão 52)**: os 2 provedores são **agrupados por nome normalizado** (`normKey` = minúsculas, sem acento, só alfanumérico) e o canal aparece **1 vez**, com `id = tv:live:<chave>`. O índice `groups` guarda de qual provedor veio cada slug, então `getStreams` pergunta a **todos** — 161 canais, **131 com EMB e ETC juntos**. A prévia (`poster`/`background`, o logo) é repassada para **todos** os streams do canal; é ela que o Stremio mostra de fundo na tela de play. **Não voltar a separar por provedor** (o usuário reclamou: "às vezes EMB, às vezes ETC").
- **REI: relay era 404 e o stream não tocava (decisão 111)**: a rota `/stream/hls/:file` só tinha ramos para `kak:` e `etc:` — o prefixo `rei:` caía em `resolvePlaylist` (que só entende EMB/ETC) e devolvia **404 `channel not found`**, então a variante relay do REI estava morta desde a criação da fonte. A via que restava era a URL direta (`__index.txt` com `text/plain`), que o player não reconhece como HLS e cujo token vale **300s** (a TV ao vivo recarrega a playlist, então morria sozinho). Agora existe ramo `rei:` que busca o texto e serve como `application/vnd.apple.mpegurl` — **cada ida do player ganha token novo**, e não precisa reescrever segmento (medi: URIs absolutas, outro host, **sem token**, 206 + sync `0x47` até sem header). `reidosembeds.getStreams` passou a validar com **`temSegmentos()`** antes de emitir: a origem devolve `500`/`404` e **200 com playlist vazia (0 segmentos)** — vazia é o que faz o Stremio trocar de player em loop, então stream sem segmento **não entra na lista** (cache 45s). **Três achados do 2º ciclo (o dono disse "ainda não inicia"):** (1) **o ramo comum do `resolveSrc` não guardava na cache** — quando o `src` vem direto no HTML do player (o caso usual) a função retornava **sem gravar**, e só o ramo do POST gravava; a cadeia de 4 saltos então rodava **a cada clique**, e um salto lento levou a **12,5s**, acima dos 12,3s do gateway → **504 → o player nunca começava**. Corrigido: ambos os ramos gravam, TTL **90s → 240s** (o JWT vale 300s) e `idadeUrl` + `REPREQ_MS=150s` disparam **atualização em segundo plano** — a cadeia só roda quando ninguém está esperando, e uma falha nela **não apaga** o `src` que ainda funciona. Medido: 1ª rodada `1900ms`, 2ª `0ms`. (2) **A variante direta dava 403** — testei 5 combinações de `Referer`/UA e o nginx deles recusou todas, enquanto a validação passava porque usava `browserFetch` (que atravessa): validávamos por um caminho que funciona e o player usava outro. **`getStreams` agora só emite o relay** (o relay toca **5/5** medido; a direta fica só como último recurso se faltar `PUBLIC_BASE_URL`). (3) **O `src` deles rotaciona** — o caminho guardado passa a dar `404 not found` e, com o cache de 240s, o canal ficaria vazio sem parar. Agora, quando `temSegmentos()` rejeita, o `getStreams` **invalida a cache e refaz a cadeia uma vez** antes de desistir (medido: `afazenda7` morto → recuperou; `6/7` canais da amostra). (4) O `Referer` no stream virava `notWebReady: true` e escondia o canal do player web — removido, pois nem playlist nem segmento pedem cabeçalho nenhum (medi os dois). Agora `notWebReady: false`.
- **Triagem do catálogo travava canal bom para sempre (decisão 111)**: `tv-sources.getCatalog()` só põe no catálogo quem passa numa **triagem** (chama `getStreams` de cada canal, `TRIAGEM_CONC=48`), e **o `groups` também era preenchido só com os aprovados**. Dois defeitos em cascata: (1) quem reprova fica fora do `groups`, e `membersOf` aí cai no fallback `ownerOf` (provedor[0] = EMB) → um canal só-do-REI passava a ser consultado **só na EMB**, nunca mais no REI, mesmo com a fonte boa; (2) o resultado da triagem só se atualizava quando a **composição** mudasse (canal novo/removido) — nunca quando a fonte apenas voltasse. A triagem do boot roda 48 cadeias em paralelo, o host do REI recusou, e o erro virou **eterno**. Medido na prod: **259 canais no catálogo** com `sbt`, `disney`, `sony`, `gloobinho`, `bandmg` etc. **fora**, e todos devolvendo `0 streams` (o `sbt` ainda dava timeout de 40s). Correção: `buildGroup` roda para **todos** os seeds (a filtragem por `chavesBoas` vale só para a lista) e o resultado **novo da triagem é somado** ao guardado, mesmo com a composição igual — quem passou antes continua passando (não retirar canal). Medido: **259 → 283 canais** e os 10 testados passaram de **0/10 para 10/10** com stream; `bandmg` que nem aparecia agora toca no ffmpeg.
- **Cache de stream de TV não existia + aquecimento (decisão 111)**: a rota `tv:live:` retornava direto **sem passar pelo `sqliteCache`** (só o VOD usava) — o mesmo canal aberto 3 vezes seguidas custava **9,4-9,9s cada**. Adicionado `TV_STREAM_CACHE_TTL = 90s` (e não 6min porque o JWT do REI vale 300s) + stale-while-revalidate no padrão do VOD. `warmup()` só aquecia **catálogo + EPG, nunca streams**; o novo `aqueceStreamsDeTv()` roda 20s após o boot (conc 4, teto 70) priorizando por **família do canal** (`PRIORIDADE_TV` — Globo/SBT/Record/Band/Cultura, Sportv/ESPN, CNN/Jovem Pan, HBO/Star/TNT): o projeto não guarda contagem de acesso e casar por expressão sobrevive a canal novo. **Medido local**: 1ª vez `hbo` **216ms** e `globonews` **16ms** (antes ~10s), 2ª/3ª **12-25ms**. Roda **também no app1** de propósito: é a cache dele que o `repassaTv` usa quando o cluster de TV demora, e sem ela o app1 refazia os ~10s e estourava a parede de 12,3s do gateway.

## Scraper: a triagem e a prévia NÃO seguram a resposta (decisão 125)

`getCatalog` do TV **não espera a triagem**. Medido: ela levava **131 segundos** (284 canais × 3 fontes, conc. 48) contra os **12,3s** em que o gateway corta, e a rajada de 48 cadeias fazia o REI responder **429** (57 linhas de log numa rodada; o host não limita a 5 req/s — 25 pedidos a 200 ms deram 0 × 429). A sondagem de prévia tinha o mesmo problema: ~380 sondagens de 2 KB levavam o total a **18,3s**.

- A **triagem virou trabalho de fundo**: fatias de 24 canais, 8 em paralelo (`TV_TRIAGEM_FATIA`/`TV_TRIAGEM_CONC`), e o resultado só **soma** — nunca retira.
- A **prévia é cosmética** (o fundo da tela do canal), então também é de fundo; o que o usuário vê primeiro é a lista.
- Medido depois: **131s → 84ms** na montagem, 429 de 57 para 3, catálogo respondendo em 1,2s (app1) / 0,4s (app2).
- **A coesão inverteu**: a lista é o que o catálogo da fonte declara, *menos* quem a triagem **provou** que não entrega (prova dura 24h e atravessa restart, em `CHAVE_MORTOS`). Prova de vida nunca tira ninguém da lista. O preço, dito com clareza: nos primeiros minutos após um deploy pode aparecer canal que ainda não toca — o preço alternativo era o catálogo vazio.

## TV: lista só do REI, e o canal reúne os três players (decisão 138)

O dono corrigiu a 137 na mesma hora em que ela entrou: *"o catálogo é apenas do REI dos embeds"*
— **não são dois catálogos**, é um só, o do REI (`reidosembeds.online`, 327 canais, logo em 100%
deles, com a guia). `chavesDaLista` voltou a filtrar pelo REI.

**O que o dono queria de verdade:** *"uma normalização de títulos dos canais para que seja fácil
colocar, por exemplo, dentro do A Fazenda 1, todos os três players desse canal vindo do REI, do
EMB e do ETC"*. O problema medido é que o mesmo canal tem **três grafias**:

| fonte | nome | chave do `normKey` | slug |
|---|---|---|---|
| REI | `A Fazenda` | `afazenda` | `afazenda` |
| EMB | `A Fazenda 18 - 1` | `afazenda181` | `afazenda` |
| ETC | `A FAZENDA 1` | `afazenda1` | `afazenda` |

Três chaves, três entradas, e o canal não reunia os players. **O slug é o mesmo nas três** — o
caminho é o do canal; o nome é que cada site escreve do jeito dele.

### A regra, em duas passadas (`agrupaPorCanal` em `src/core/tv-sources.js`)

1. **Pelo nome normalizado** — o caminho seguro, é o que a lista de sempre usou.
2. **Pelo slug**, e só entre nomes compatíveis — é o que junta as grafias diferentes.

**Medido nos três catálogos (327 do REI):** pelo nome, 98 canais do REI casam com outra fonte;
pelo slug, 100. Os **8 a mais** são o que o dono pediu (`A Fazenda`, `Disney +`, `Max`,
`Universal TV`, `24H Naruto`).

### A salvaguarda — e por que ela existe

Dos 19 canais que casam **só pelo slug**, medidos um a um:

- **13 legítimos** — o mesmo canal escrito diferente: `A Fazenda 2` / `A Fazenda 18 - 2`,
  `Disney +` / `Disney Plus 1`, `Max` / `Max - 1`, `Universal TV` / `Universal`,
  `24H - Naruto` / `24H Naruto Clássico`.
- **6 falsos** — a EMB usa o slug do canal para um **evento**: `ESPN` / `Liga das Nações - Liga A -
  Grupo 4 País de Gales Noruega`, `SporTV` / `Liga das Nações -Grupo 4 Dinamarca Portugal`,
  `XSports` / `Euroliga Hapoel Tel Aviv Real Madrid`, `ESPN 3` / `MLB - Wild Card…`.

Sem guarda, o ESPN abriria com um jogo de futebol junto. A regra: **os dois nomes têm que
compartilhar uma palavra de 3+ letras, ou um ser prefixo do outro** — comparados no **nome
original**, antes da normalização (a chave tira os espaços e "A Fazenda 2" viraria uma palavra só).
`ESPN` e "Liga das Nações" não têm nada em comum; `A Fazenda 2` e `A Fazenda 18 - 2` têm "fazenda".

**E as edições do programa não se misturam** porque o slug as separa: o REI declara `A Fazenda 1`
como `afazenda` e `A Fazenda 2` como `afazenda2` — baldes diferentes, mesmo com a palavra "fazenda"
em comum nos dois nomes. É por isso que a guarda é consultada **dentro de um balde de slug**, e a
função sozinha não decide nada.

### Medido depois

- Catálogo: **327 canais** (só o REI, como ele pediu).
- `A Fazenda` 1 a 5: **REI + EMB + ETC** (o caso que ele citou).
- `A Fazenda 6` e `7`: só REI — as outras duas fontes não têm (têm só 5 edições da 18).
- `Disney +`: as três. `Max` e `Universal TV`: REI + EMB. `ESPN`/`SporTV`/`XSports`:
  **sem o evento de futebol** — a salvaguarda segurou.

### Verificação da fonte REI reidosembeds.online (medido 01/10/2026)

**Correção importante:** antes eu escrevi aqui que "o REI parou de entregar vídeo" e que a página
do player não tinha mais URL de vídeo. **Estava errado**, e a verificação abaixo mostra por quê: o
`__index.txt` continua na cadeia, a playlist volta com 200 e 3-7 segmentos, e em produção o `hbo`
abre com os 3 players. Os 500 que eu vi eram a **origem oscilando**, não uma mudança de site — meu
erro foi medir uma vez e concluir.

**O que está bom (medido):**

| rota | resposta |
|---|---|
| `/` | 200, 261KB |
| `/api/channels` | 200, 256KB, **327 canais**, 0 sem nome, 0 id repetido |
| `/api/guia` (EPG) | 200, 1,2MB, **327 canais, 3.939 programas**, XML bem formado, hora BRT |
| `/img/<id>.png` (logo) | 200 — **40 de 40** da amostra, 0 falha, ~50ms cada |
| `logo_url` | os 327 apontam para o próprio domínio (nenhum link externo quebrado) |
| `now_playing_title` | 327 de 327 |

**O que tem de defeito, com o número:**

1. **`preview_url` dos 327 canais é lixo** — aponta para o host `….rent`, que responde **403 para
   tudo**. O projeto já ignorava esse campo (decisão 121) e usa o logo; `.prev.png` também é 404.
2. **A playlist oscila.** Amostra de 20 canais: 12 com player numa rodada, 3 com HTTP **500** e 5
   com playlist **vazia** (o `src` rotaciona — caso já tratado na decisão 111, que invalida a
   cache e refaz a cadeia uma vez). Numa segunda rodada foram 11 de 14. **Não dá para medir taxa
   fixa**: a origem liga e desliga.
3. **O CDN dos segmentos bloqueia IP de datacenter.** Buscando um segmento do servidor volta
   `200 text/html` com a página *"Anonymous Proxy detected"* (servidor = Cloudflare). **Isto não
   deve afetar o usuário**: o relay só entrega a playlist, e as URIs dos segmentos são absolutas
   (medido, host diferente, **sem token**) — quem baixa é o aparelho do usuário, do IP residencial
   dele. **Não dá para provar daqui**, porque deste servidor só sai IP de datacenter.

## Relay de TV: escolhe a fonte que RESPONDE, não a que só existe (decisão 139)

O dono: *"todos os links de todos os players de live TV pararam, fica um ícone quadrado de
interrogação"*. **Medido, e a causa não era o meu agrupamento** (comparei os dois algoritmos nos
mesmos catálogos: **388 grupos, 0 provedores perdidos**).

**A causa:** o CDN final da EMB e o da ETC é o **mesmo** (`s23-cloudfront-net.lat`) e estava fora do
ar — **522 em 6 de 6 tentativas, 19,4s cada**; a ETC com o `Referer` certo também dava 522. A REI,
em outra família de CDN, continuava de pé.

**Os três defeitos que se somavam:**

1. **`Promise.any` sem prova** — o relay devolvia o **primeiro que "responde"**, e o EMB responde
   sempre: o `playlistVerdict` dele aceita `unknown` (decisão de 29/09) para não matar a fonte. Com o
   CDN no chão, o player ia para a origem morta em vez de para a REI, que estava viva.
2. **O REI não exportava `resolvePlaylist`** — o relay genérico do canal só sabia usar quem tivesse
   essa função, então ele **nunca podia usar o REI**, que é a fonte preferida e a primeira da lista.
   Somado ao item 1, o relay ficava sem fonte nenhuma mesmo com o REI de pé.
3. **Sem teto por fonte** — com o CDN morto, `resolvePlaylist` do ETC levava **27s** e o do EMB
   **12,5s** (eles esperam o CDN morto responder para descobrir que está morto). Como rodam em
   paralelo, o relay pagava o maior: **27s**, contra os **12,3s** do gateway. A correção trocava
   "player quebrado" por 504.

**A correção:** cada candidato é **provado** antes de virar resposta (tem que devolver `#EXTM3U` e
pelo menos um segmento), os três formatos de retorno são lidos (`entry`/`url`/`src`), a prova é
com o `Referer` que cada fonte exige, tudo em **paralelo** com teto por fonte (`TV_PROVA_PLAYLIST_MS`
4s, `TV_RESOLUCAO_PLAYLIST_MS` 5s) e o resultado fica em cache por 60s. A preferência continua sendo
do dono: vence a primeira fonte **na ordem dos provedores** que prova, não a mais rápida.

**Medido depois:** com o CDN das duas fora, `hbo`, `cnnbrasil` e `afazenda` passam a escolher a REI
(que estava de pé) em ~7s, em vez de entregar um link morto.

**O que NÃO resolveu, dito com clareza:** o CDN deles continua fora do ar — isto não conserta a
origem, só faz o addon parar de escolher a origem morta quando existe outra viva. E o
`Anonymous Proxy detected` no CDN de segmentos da REI é bloqueio de IP de datacenter: **não dá para
provar daqui** se o aparelho do usuário passa.

### A BORDA GUARDAVA O 404 POR 4 HORAS (decisão 140) — esta é a causa do "todos os players pararam"

**O defeito de verdade, e era meu (indireto).** Medido no header que o Cloudflare devolve:

```
HTTP/2 404
cache-control: public, max-age=14400      ← a zona do BeamUp REESCREVE o no-store
age: 77
cf-cache-status: UPDATING
```

A rota `/stream/hls/<canal>` manda `Cache-Control: public, max-age=25` (cacheável, de propósito,
para o cache local) e **a zona do BeamUp reescreve para `max-age=14400`**. Então um **404
transitório** — uma fonte caída por 30s, enquanto o REI oscilava — ficava guardado na borda por
**4 horas** e continuava sendo servido para todo mundo depois de a origem voltar. O servidor
estava bom; o cache é que não.

Para o usuário é indistinguível de "o addon está quebrado": o ícone de interrogação é o que o
player mostra quando recebe um link que não resolve — e o link que ele recebia era um 404 de
4 horas.

**A correção:** o relay manda `CDN-Cache-Control: no-store` e `Cloudflare-CDN-Cache-Control:
no-store` — que é o cabeçalho que o Cloudflare respeita para o TTL **da borda**, separado do TTL
da origem. E **nenhuma resposta de erro** (>= 400) fica guardada, em rota nenhuma.

**Medido depois:** `cf-cache-status: BYPASS`, e o canal inexistente responde **404 em 0,44s**.

**Armadilha que veio junto:** sem uma guarda de "esse canal existe no catálogo", o relay pagava as
3 fontes com o teto de 5s cada mais a prova, e o gateway devolvia **504** (que é pior que 404, e
não se distingue de queda). Agora canal inexistente sai em **0 ms**.

## E2E completo: as 12 fontes, provadas de ponta a ponta (decisão 141)

O dono: *"as fontes estão todas quebradas [...] quero quatro fontes de filmes e séries funcionando e
as quatro fontes de anime funcionando e uma fonte de dorama funcionando e as três fontes de live TV
funcionando, que um e2e completo de ponta a ponta"*.

**`node e2e-completo.js`** é a medida. Ele **sobe o servidor de verdade, chama as rotas que o Stremio
chama** e, para cada player, prova três coisas:

1. **a fonte entregou** (o player tem URL);
2. **o link responde** — a URL é buscada de verdade, com os **mesmos cabeçalhos que o player
   manda** (`behaviorHints.proxyHeaders`), porque sem isso o teste dá falso negativo em fonte que
   funciona: o DGO responde **403 sem o `Referer`** e ele está justamente nesses cabeçalhos;
3. **o título está normalizado** — nome, temporada/episódio, fonte, qualidade e dublado/legendado
   fazendo sentido sozinhos.

E separa **o que é nosso do que é da origem**, que é a diferença entre "eu conserto" e "eles
consertam": `5xx`/`403` do CDN deles é `ORIGEM RECUSA`; lista vazia com o motor em 0 falhas é
`DEDUP` (outra fonte já entregou o mesmo arquivo — o KKT é failover do BLZ), que **não é defeito**.

Duas correções que o próprio E2E impôs no começo: a repetição (cache frio não é defeito — o DGO
devolveu 0 na 1ª chamada e 2 na segunda) e a leitura de `{streams}` **e** `{data}` (a rota do
Stremio e a `/api` embrulham o mesmo resultado).

### Normalização do player: nome canônico e peças separadas

O defeito medido: **o mesmo seriado saía com nomes diferentes conforme a fonte** — "Breaking Bad: A
Química do Mal" no BLZ e "Breaking Bad" no SPT — e o usuário via linhas quase iguais na lista sem
saber que eram o mesmo conteúdo. Agora:

- o **nome canônico vem do metadado** (TMDB/AniList), que é o mesmo para todo mundo; o do painel é
  só um palpite do site e perde;
- o texto da tela é remontado a partir das peças (`jogador.tituloDe`), uma informação por linha;
- a `/api/streams` devolve **`player` com as peças nomeadas**: `nome`, `ano`, `temporada`,
  `episodio`, `episodioRot`, `qualidade`, `fonte`, `fonteId`, `fonteNome`, `idioma`, `dublado`,
  `legendado`, `aoVivo`, `guia` — sem precisar abrir o texto e adivinhar.

**O TEXTO DA TELA É EM CASCATA — uma informação por linha (decisão 142).** O dono: *"eu quero que
no player das fontes não fiquem as coisas escritas uma do lado da outra e sim em cascata"*.

```
🌊 Matrix (1999)          <- o que é, e o ano
🌎 Português              <- em que idioma
720p                      <- em que qualidade
BLZ                       <- de onde vem
```

**Por que:** com tudo grudado por `·`, a tela do celular cortava a linha pelo meio e o usuário perdia
justamente o **fim** — que é a fonte, a informação que diz de onde vem o vídeo. Numa tela estreita
não há como ler "🌎 Português · 720p · BLZ" sem que uma das três desapareça. A ordem é a que o olho lê:
o que é, onde estamos (S01E01), em que idioma, em que qualidade, de onde vem — e, na TV, o que está
no ar. O nome curto da lista (`name`) também perdeu o `·`: `Mirror 720p BLZ`.

**`idioma` tem três valores, não dois**: `portugues`, `legendado` e **`desconhecido`**. Stream sem
informação de áudio vai para `desconhecido`, porque afirmar "Legendado" num stream que talvez seja
dublado é mentira — e `getAudioInfo` antigo fazia exatamente isso.

## Fonte não morre: o último catálogo bom de cada provedor (decisão 144)

O dono: *"deixe as fontes robustas para que elas não morram nunca"*.

**O risco medido:** quando `getCatalog()` de um provedor **lançava**, o código devolvia lista vazia e os
canais **daquele** provedor sumiam do catálogo — e como a lista é filtrada pelo REI, uma falha dele
derrubava a lista inteira. Bastava uma oscilação de 30 segundos para o catálogo aparecer sem 60
canais, sem o usuário ter feito nada. É o caminho pelo qual um addon "perde" fontes aos poucos, sem
ninguém perceber.

**A correção:** cada provedor guarda o **último catálogo bom** (`mirror-tv:catalogo:<id>`, SQLite,
30 dias, sobrevive a restart) e uma falha passa a **servir esse** em vez de lista vazia. A fonte só sai
do catálogo quando o fornecedor **apaga o canal de verdade** — que é o único caso em que tirar é o
certo. No log: `[tv] catalogo <id> falhou (...): servindo o ultimo bom, N canais`.

## Cloudflare Tunnel: endereço que não depende do BeamUp (decisão 149)

O dono pediu túnel depois do incidente do app2 — o registro DNS dele **sumiu** e o endereço passou a
cair no wildcard, sem aviso e sem erro no log.

**O que o túnel entrega:** um endereço fixo que não depende do DNS do BeamUp, com WAF e proteção
contra DDoS da Cloudflare na frente, e sem precisar de IP público. Tunel `mirror`
(`75e655a3-0986-49a6-86b3-7416d3227bc6`), com duas entradas em `~/.cloudflared/config.yml`:
o endereço do túnel → app1 (VOD) e `tv.<id>` → app2 (cluster de TV).

**O que ele NÃO faz, e é o mais importante:** os 403 das origens. O túnel muda o caminho de
**entrada** até o addon; quando o servidor busca uma fonte de TV, a origem continua vendo o IP dele.
MEDIDO, o worker chega na origem e ela devolve `Upstream 403` — as origens barram IP de datacenter
**e** o edge da Cloudflare. O vídeo é baixado pelo aparelho de quem assiste, do IP residencial de
quem assiste, e por isso o 403 nosso não é o seu.

**Duas coisas que só se descobre fazendo:**

- **O `cfargotunnel.com` é só IPv6.** A Cloudflare devolve um endereço sintético (`fd10:...`) e
  **nenhum registro A**. Numa máquina sem IPv6 o endereço simplesmente não conecta — foi o que
  aconteceu aqui, então **o túnel não pôde ser provado ponta a ponta**; o que está provado é a
  parte que dá para medir: config validada (`tunnel ingress validate` → OK) e 4 conexões
  registradas em São Paulo (gru08/gru13/gru20, protocolo quic).
- **O CNAME do `tv.` foi criado na zona `mirrorcluster.eu.org`, que está `pending`.** Zona pendente
  não resolve publicamente, então esse endereço só passa a funcionar depois de a zona ativar.

**O BEAMUP NAO DEIXA INSTALAR NADA — e isso e medido, nao suposição.** O dono pediu para instalar
nginx e o tunnel na maquina do BeamUp. A resposta do servidor, palavra por palavra:

```
Hi c12e41ddc21b! You've successfully authenticated, but Beamup does not provide shell access.
```

O unico comando aceito e `logs`; `config`, `shell`, `ps`, `cat`, `ls` e `sudo` devolvem todos
`001cERR unsupported command`. **Nao ha terminal, nem gerenciador de pacote, nem administracao** — e o
unico acesso SSH que o agente tem em maquina do dono e esse. Por isso as pecas ficaram prontas no
repositorio para rodar em uma VPS de verdade:

- `deploy/cloudflared-tunnel.service` — o servico systemd do tunnel (roda pelo token, sem navegador),
  ja com as protecoes de endurecimento porque ele e' so conexao de saida e nao precisa de nada.
- `deploy/nginx-tunel.conf` — o nginx na FRENTE do tunnel, para quando voce quiser um nome seu. O
  tunnel nao precisa dele: se usar o endereco `<id>.cfargotunnel.com`, o `cloudflared` fala direto
  com a origem e a WAF da Cloudflare ja esta na frente. O nginx so entra para trocar o endereco pelo
  seu nome de dominio.

**O aviso que importa no nginx:** o `proxy_read_timeout` tem de ficar ACIMA do tempo de resposta do
app. O gateway do BeamUp corta em ~12,3s e o addon tem teto de 9s; com o nginx cortando antes, o
erro 504 aparece como "fonte caiu", que e como o dono perdeu o dia.

**O TUNEL ESTA INSTALADO E DE PE — na VPS, nao no BeamUp.** O dono pediu "instale nginx e o tunnel
na maquina do beamup"; o BeamUp nao deixa (ver acima). Mas MEDIDO, a maquina onde o agente roda **e a
VPS do proprio dono**: `ORIGIN IP 144.33.21.1`, `nginx 1.24.0` instalado, site `mirror-kak`
habilitado — exatamente a maquina do `deploy/nginx-kak.conf`. La ha `sudo` sem senha e o
`cloudflared` ja instalado, entao o tunel foi instalado como servico:

- `/etc/systemd/system/cloudflared-tunnel.service`, **habilitado e ativo**, 4 conexoes registradas
  (gru02, gru11 x2, gru18, protocolo quic).
- O token de execucao fica em `/etc/cloudflared/token` (600, so root) e o servico usa
  `--token-file`. **Nao use `$(cat ...)` no `ExecStart`: o systemd NAO roda shell**, entao o
  comando chega literalmente e o cloudflared responde `Provided Tunnel token is not valid`.
  Foi o que aconteceu em 6 reinicios seguidos ate trocar para `--token-file`.

**O QUE FALTA PARA O ENDERECO FUNCIONAR (e nao e do tunel):** o endereco `<id>.cfargotunnel.com` da
Cloudflare e' **so IPv6** — a Cloudflare devolve um endereco sintetico `fd10:...` e **nenhum registro
A**. MEDIDO: nem a VPS tem IPv6 global (so `fe80::`), entao nao da para provar daqui, e um acesso so
IPv4 tambem nao entra. O endereco que funciona precisa estar em uma zona **ativa** — e a zona do dono
nao esta:

```
dig @1.1.1.1 mirrorcluster.eu.org NS   ->  (vazio)
```

A zona tem os nameservers da Cloudflare configurados (`dimitris.ns.cloudflare.com`,
`keyla.ns.cloudflare.com`) mas **o registro da `.eu.org` nao tem nenhum NS apontando para eles** — por
isso `status: pending`, e por isso o CNAME do `tv.` nunca resolveu. **Enquanto a zona nao ativar,
existe tunnel e nao existe endereco.** Ativada a delegacao, `addon.mirrorcluster.eu.org` no tunnel
funciona por IPv4 e IPv6 e **nao precisa de nginx**.

## O túnel temporário (decisão 150) — o que o dono pediu de verdade

O dono corrigiu: o túnel é para ser **temporário, um proxy de entrada que muda a cada reinício** —
não um endereço fixo. E sim: é o `trycloudflare`, que não precisa de domínio, nem de zona, nem de
DNS.

**O túnel com nome foi desinstalado.** A arquitetura do dono: a **única** máquina que passa dados e
vídeo é o **BeamUp**. O túnel com nome apontava para o BeamUp a partir da VPS `144.33.21.1`, o que
fazia a VPS gastar banda **nos dois sentidos** sem ganhar nada — o BeamUp já está atrás da
Cloudflare (`server: cloudflare`, `cf-ray: ...-GRU`), ou seja, WAF e DDoS já existem lá.

**Instalado:** `/etc/systemd/system/cloudflared-rapido.service`, ativo, com
`--url https://c12e41ddc21b-mirror.baby-beamup.club`.

**O `--http-host-header` é obrigatório (medido):** sem ele o gateway do BeamUp recebe o `Host` do
endereço temporário (`xxx.trycloudflare.com`), não reconhece nenhum app e devolve **404 em todas as
rotas** em 0,3s — o túnel conecta e a resposta vem vazia, que parece "fonte caiu".

**Medido, app estável, lado a lado:**

| rota | direto (BeamUp) | pelo túnel |
|---|---|---|
| `/health` | 200 · 0,25s | 200 · 0,94s |
| `/manifest.json` | 200 · 0,26s | 200 · 0,49s |
| `/install` | 200 · 0,56s | 200 · 0,51s |
| `/catalog/tv/…all.json` | 200 · 0,48s | 200 · 0,52s |
| `/api/streams/tv/hbo` | 200 · 0,52s | 200 · 0,50s |

O endereço é novo a cada reinício do serviço (medido: 2 endereços no mesmo dia) e o dono pega o
atual com `./deploy/endereco-rapido.sh` (`--json` para script, `--novo` para trocar).

**Uma armadilha de leitura:** logo depois de subir, o túnel deu 504 em tudo — **não era o túnel**, era
o **app do BeamUp reiniciando** (medido: `uptime 0min` e dois 504 seguidos, depois 200 com uptime
crescendo). O vínculo do SSH do BeamUp (`Permission denied (publickey)`) também caiu no meio da
sessão, então essa parte ficou sem log — se o tunnel "quebrar" do nada, checar o uptime no
`/health` antes de mexer no tunnel.

**CUIDADO: O TUNEL COMO ENDERECO DO ADDON COME BANDA DA VPS. MEDIDO.** O dono perguntou, e a
resposta e' sim, e e' grande. O que passa pelo tunel depende do que a rota entrega:

| tipo de stream | onde o video passa |
|---|---|
| REI e EMB | **pelo relay** — os segmentos passam pela VPS |
| ETC (variante "Direto") | direto da origem, o aparelho baixa nela |

Medido no relay de TV, um segmento **real** do `rei:hbo`:

```
stream/hls/rei:hbo.m3u8   -> #EXT-X-TARGETDURATION:7
1o segmento               -> 5.188.800 bytes (5,2 MB) em 0,40s
#EXTINF                   -> 5,3s e 5,8s
```

Conta: **2,6 GB por hora por pessoa** assistindo pelo relay (5,2 MB a cada ~5,5s). O relay aceita
**60 conexores por host** (`maxPerHost`), o que daria **157 GB/hora** se esse teto fosse batido.

**A regra:** o video **nao deve** passar pelo tunel. Como o relay monta a URL a partir do `base` do
pedido, se o Stremio passar a usar o endereco do tunel, os segmentos passam a sair por ele — e a
VPS paga a conta. Por isso o endereco do addon **continua sendo o do BeamUp**, e o tunel fica
instalado e de pe (custa zero enquanto ninguem entra por ele), util como endereco estavel de
operacao. Para o dono: `curl` no relay mostra `X-Mirror-Cache` e o consumo fica visivel em
`/health -> relay`.

**Um detalhe do relay que engana:** o segmento vem com **extensao trocada** (`.ttf`, `.css`, `.otf`
no lugar de `.ts`) e o `ffprobe` recusa, mas **o ffmpeg toca** — o conteudo e' MPEG-TS valido. Nao
concluir "quebrado" pela extensao.

## A quarta fonte de TV: reidoscanais (decisão 153)

O dono: *"quero só que adicione como mais uma fonte igual o ETC é"*. Registrada como `rcd` (sigla
**RCD**), **última** na ordem — o REI continua primeiro (dono da lista e da EPG, decisão 126) e o
RCD **soma**, porque a regra do dono é nunca retirar canal.

**O que a origem entrega (medido):** `api.reidoscanais.st/channels` → 200, 160KB de JSON, **110
canais**, **110/110 com logo**, cada um com `description`, `category`, `embeds[]` (com fornecedor e
qualidade) e — o melhor — o **`epg` já pronto dentro do JSON**, com programa atual, título,
descrição e horário. Não há XMLTV para baixar.

**A cadeia do vídeo tem três saltos:** `embed_url` (`rdcanais.net/<slug>`) → o `<iframe>` da página →
o `.m3u8` dentro da página do player, achado pelo `lib/extrator.js`. O **token do último salto vive
poucos minutos**, então a cadeia roda a cada pedido, como no REI.

**PROVADO CONECTANDO (não só resolvendo) — o que o dono pediu:**

```
AMC           PLAYLIST 10 seg | 1o seg HTTP 206  16384B  sync=150  (MPEG-TS válido)  1942ms
Animal Planet PLAYLIST 10 seg | 1o seg HTTP 206  16384B  sync=138  (MPEG-TS válido)   245ms
```

`sync` é a contagem do byte `0x47` do MPEG-TS — é o que separa "respondeu 200" de "é vídeo de
verdade". Os 110 canais catalogam e a cadeia resolveu em **4 de 6** da amostra; os 2 que falharam
deram `player sem m3u8` (a página do player deles não traz `.m3u8`), que é falha da origem.

**E uma correção importante de uma medição antiga:** o `cdn-sp2.satlabscloud.com.br` **agora
responde** com playlist e segmentos válidos. Antes (decisão 145) ele dava `403` do nosso IP. Ou seja:
o 403 **não é definitivo** — a origem oscila. Isso vale para os outros 403 também, e é o motivo de a
regra ser "só sai da lista com 2 confirmações" e nunca na primeira.

**A bagunça que eu fiz e limpei:** o scrapor nasceu com `new RegExp("^(fonte)?")` (casa vazio e não
tira prefixo) e um `require("./reidoscanais")` de si mesmo dentro do `catch`. Agora tem um
`limpaId()` só. E `prio` é **0..9** no registro — eu tinha posto `10` e o teste de padrão pegou.

## O servidor virou só catálogo: `mirrorhub` (decisão 154)

O dono: *"Nuvio é o único cliente e os players passam a vir exclusivamente do plugin"*. As 10 fontes
de VOD/anime (`shg ron aon atb blz kkt spt vzr dgo rtd`) foram para `nuvio/src/scrapers/`. **O
servidor não carrega mais nenhuma delas** — e o ganho não foi de economia, foi de **`-136MB` de RSS**.

### O que saiu

`src/core/sources.js` deixou de ser o registro das fontes e virou **só o motor**:

- as **10 chamadas a `engine.use()`** — cada uma arrastava o scraper no boot e, no pedido, catálogo
  de painel, base do KAK e sonda de qualidade por 10 fontes que o Nuvio nem consulta;
- os **`require` dos 10 scrapers** — `otakulogia/animesdigital/aon/anitube/xtream/kakito/playerflix/
  vizer/doramogo/redetoons`. **Os ARQUIVOS continuam em `src/scrapers/`** (outros módulos e os testes
  os referenciam); o que saiu foi o registro, não o arquivo;
- **`warmup()` e `scheduleWarmup()`** — o único trabalho delas era `kakito.preloadPlaylist()` +
  `xtream.preloadLists()`, que pré-carregavam base e catálogo de painel. Sem fonte que os use, o
  único efeito era RAM e disco no boot, de graça para ninguém;
- **`aqueceVod()` e a trava `vodAquecido`** no `server.js` — existiam só para disparar o warmup;
- a env **`TV_ONLY`** ficou sem uso (o nome continua no registro de `core/nomes.js`).

### O que ficou

O motor existe (o `/health` reporta `capacity.scraperEngine`, disjuntor e trava de pedido seguem
valendo), `buildContext` continua exportado — é o contrato de `run` — e a TV tem registro
**próprio** em `core/tv-sources.js`, que nunca passou por `sources.js`. Catálogo/meta de TV,
catálogo/meta de VOD (TMDB), EPG, relay, proxy, fontes de TV, páginas e diagnóstico: **intactos**.

### O atalho do caminho de stream

`handleStreamsCore` respondia `{streams: []}` de qualquer jeito quando não havia fonte — mas só
**depois** de um punhado de trabalho que existia para alimentar fontes que não existem mais: busca
no AniList, catálogo do painel, sonda de qualidade. Agora o corte vem logo depois do ramo de TV:

```javascript
if (!temFonteDeVod()) { /* cache 60 s */ return { streams: [] }; }
```

O ramo de `tv:live:` fica **antes** dele — é o caminho vivo, e é o que o `/nuvio/stream` usa.

### RAM: medido, mesma sequência de pedidos, depois que o aquecimento termina

| | Antes | Depois |
|---|---|---|
| RSS | 272 MB | **136 MB** |
| heap usado | 81 MB | **31 MB** |
| `heapTotal` | 109 MB | **38 MB** |
| `external` | 40 MB | **10 MB** |
| `paineis.db` gravado | 15 MB | **não é gravado** |
| `iptv.db` aberto | sim | **não** |
| `capacity.scraperSources` | 10 | **0** |

`node memoria.js` mede o boot novo; **`node memoria.js --vod`** mede o boot antigo, para refazer a
conta. Sem `--vod` o script nem abre o `iptv.db`.

### E o conserto que não era pedido: **um 404 derrubava o servidor inteiro**

Isto apareceu no meio da validação e é o achado mais importante da decisão. A guarda da decisão
140 ("nenhum erro pode ficar guardado 4h na CDN") estava num `res.on("finish")` — e o `finish`
dispara **depois** dos headers irem. Todo `setHeader` ali era tarde:

```
[fatal] uncaughtException: Cannot set headers after they are sent to the client
    at ServerResponse.<anonymous> (/home/ubuntu/mirror/src/server.js:1741:9)
```

O `uncaughtException` do servidor chama `process.exit(1)`, então **toda resposta >= 400 matava o
processo**. Reproduzido em 3 s com um `curl` num canal inexistente — e confirmado **no código
antigo** (`git stash` + mesmo curl), ou seja: **não é regressão desta decisão, é a forma como a
140 foi escrita**. Para o Nuvio isso é fatal: canal que não está no mapa, id errado, `/stream/hls` de
um canal que a triagem tirou — cada um desses é um 404, e cada um derrubava o catálogo.

O conserto está em **`src/lib/cache-erro.js`** (`proibeCacheDeErro`), com teste próprio em
`test/cache-erro.test.js`: a guarda entra no **`writeHead`**, que é o último ponto em que o
cabeçalho ainda é nosso. Medido: 404 sai com `Cache-Control`, `CDN-Cache-Control` e
`Cloudflare-CDN-Cache-Control` = `no-store` (o que a 140 queria, e ela nunca conseguiu fazer), 200
continua `public, max-age=120`, e o servidor continua de pé depois dos erros.

### Testes: 2 mudaram de propósito

| Teste | O que era | Por quê |
|---|---|---|
| `fontes do motor: todas declaradas e sem id repetido` | afirmava que `blz`/`rtd` estão no motor e que anime = `[aon atb ron shg]` | o motor não tem mais fonte; virou `decisao 154: o motor do servidor nao tem fonte de VOD` — checa `engine.size === 0`, `temFonteDeVod()`, que `sources.js` não requer nenhum dos 10 scrapers, e que a **TV continua registrada** em `tv-sources.js` |
| `borda: NENHUM erro… (decisão 140)` | travava o **código quebrado** (`res.on("finish", …)`) | agora afirma o contrário: que o `finish` **não** pode estar lá, e que o servidor usa `proibeCacheDeErro`. O comportamento de verdade (header no fio + processo vivo) ficou no `cache-erro.test.js` |

`node --test test/` = **271** (269 + 2 novos do `cache-erro`). Verde.

### Testes: 24 mudaram na 155, e **1 arquivo novo** (247 no total)

`**Não apaguei teste para fazer passar.**` Cada um foi reescrito para o comportamento novo, e
quatro ganharam nome de "decisao 155" para ficar óbvio o que está travando.

**Apagados — cobriam UM módulo/função que não existe mais** (não há o que reescrever; o espelho
deles vive hoje no plugin, que é onde o vídeo trafega): `parseCatalog` e `getCatalog` do
embedtv, `rewriteM3u8`, `getStreamKey`, `isPtBrChannel` como teste de relay, `mascara e
opcional`, `maskUrl assina`, `embedcanais: extrai o id`, os 4 da triagem (orçamento de fonte,
triagem de fundo, 2ª confirmação, prova de morte), `ETC: porta nova`, `cadeia do REI`,
`relay de TV`, `resposta de TV: o REI vem primeiro`, `registro de TV: ownerOf`, `previa do
canal`, `KAK saiu da TV`, `a variante sem cabecalho` (extrator), e **12 testes de relay** em
`caminho-do-byte.test.js`.

**Reescritos:** `panelStreamVariants` · `os helpers de borda` · `relay BR nao e ponte` ·
`videoBases` · `segurança: headers` · `catálogo de TV: a LISTA é só do REI` ·
`normalização de canal` · `decisao 154: o motor` (→ 154 **e** 155) · `camada 1: a lista e a
PROVA DE MORTE` · `camada 2: o TTL do stream de TV` · `a resposta degradada` ·
`o cache de streams` · `o manifesto do Nuvio` · `as 4 rotas do adapter` ·
`o stream do Nuvio` · `a ponte repassa busca` · `lista de stream de TV` ·
`o preview do REI` · `emoji do stream` · `entrega: so RTD e DGO` · `portão: nenhum fonte`
(2 usos → 1 no `server.js`) · `reset de cache` (3 entradas da lista saíram) ·
`nenhum modulo chama uma funcao` (a lista de arquivos foi corrigida, **não** dynamicizada).

**Novo: `test/server-carrega.test.js` (2 testes).** Ver a seção da 155 — a barreira lia o
`server.js` como texto e não via `require` quebrado nem `app.listen` apagado.

## Proxy em Worker: o 403 não é geografia (decisão 152) — medido e fechado

O dono mandou a documentação da Cloudflare sobre usar Worker como proxy reverso para mascarar o IP
do app. A ideia é boa e foi testada. **O resultado é negativo, e agora é conclusivo.**

**Por que a medição anterior não valia:** o AGENTS já registrava que o `[placement] mode = "smart"`
do RTD *"é aceito e gravado, mas não se aplica nesta conta"*. Sem saber de onde o worker sai, um
`Upstream 403` não prova nada — podia ser geografia. Por isso o RTD foi publicado com **região fixa**
`aws:sa-east-1` e medido de novo:

| worker | origem | resultado |
|---|---|---|
| `mirror-rtd` região fixa SP | `cdn10embed.xyz` (ETC) | **`Upstream 403`** |
| `mirror-rtd` região fixa SP | `cdn-sp2.satlabscloud.com.br` (reidoscanais) | **`Upstream 403`** |
| `mirror-rtd` região fixa SP | `redetoonstv.win` (controle) | **200 · 14.989B** |

O controle passando prova que o worker **está** buscando; as duas origens continuam recusando mesmo
saindo de São Paulo. **Conclusão: o 403 não é de geografia, e o proxy em Worker não resolve.** Não
gastar mais tempo com placement.

**Duas descobertas operacionais no meio disso:**

- **Worker novo não executa nesta conta.** Publicar funciona (o `wrangler` responde "Deployed" com
  `Current Version ID`), mas a invocação responde `404 error code: 1042` — inclusive num `fetch`
  para `example.com`, ou seja, não é o código. E a API lista **18 scripts sem nenhum dos novos**.
  Worker que **já existia** continua rodando normal depois de republicado.
- **Já existe um proxy reverso funcionando na conta:** `avmirror-proxy` (07/09), com lista própria e
  mais estreita (`{"error":"host not allowed: <host>"}`). `avmirror-api` responde 503. São de um
  projeto anterior e nenhum dos dois esta ligado no Mirror hoje.
- **Erro meu que vale registrar:** `Host` é cabeçalho **proibido** em Worker — `headers.set("Host", …)`
  lança e derruba a invocação com `530 error code: 1042`. O Host certo vem sozinho, porque o `fetch`
  aponta para a URL da origem.

**Dois segredos separados (o que evita refazer o login):** o `cert.pem` serve só para **criar** o
túnel (é o que a autorização no navegador produz — o token da API que temos **não** tem essa
permissão, e a API responde `Authentication error`). Para **rodar** não precisa de navegador
nenhum: basta o token de execução, que o `cloudflared tunnel token <id>` gera.

## A página não espera a TV (decisão 147) — por que o dono viu "o addon caiu"

**O sintoma:** o dono abriu `https://c12e41ddc21b-mirror.baby-beamup.club/` e o Firefox disse que
não conectava. **A causa, medida:** a raiz responde `301` para `/install`, e **`/install` levava
12,8 segundos** — bem no limite de **12,3s** em que o gateway corta. `/tv` devolvia **504 em 12,2s**.

**Não era o addon quebrado.** As três rotas de página (`ROTAS.instalacao`, `ROTAS.painel`,
`ROTAS.tv`) estavam declaradas na **linha 2042**, e o `repassaTv` na **1807** — ou seja, a página
pagava o preço do cluster de TV **antes** de ser servida. E o cluster **não existia mais**: o
domínio `c12e41ddc21b-mirror2.baby-beamup.club` tinha perdido o registro no DNS e caía no wildcard
(`baby-beamup.club.baby-beamup.club`).

A prova de que não era a página: `/install.html` respondia em **0,04s** e `/install` — *o mesmo
arquivo* — em **12,8s**. Só mudava a rota.

**A correção:** as páginas saem **antes** do repasse. Uma página estática não tem por que depender
de TV. Medido local com `TV_BASE_URL` apontando para o domínio morto: `/install` **12,8s → 0,009s**,
`/tv` **504 → 0,004s**, `/dashboard` 0,003s.

**A armadilha do `?chan=`:** a página de TV antecipada **não sabe escolher o canal** (isso é da rota
de baixo, que consulta as fontes), então ela chama `next()`. Um `redirect` para a própria URL seria
laço infinito — foi o primeiro erro que fiz aqui.

**O que a decisão 138/126 já garantia:** o cluster de TV ser Backup não é ponto único de falha — com
ele fora, o `repassaTv` cai no `next()` e **o app1 serve a TV localmente**. Medido depois da queda
do DNS: `/api/streams/tv/hbo` continua **200 em 0,30s**. O que quebrava era só a página.

## O aquecimento voltou a ser sequencial (decisão 146)

A nota da decisão 136 dizia que o paralelo já não custava memória *"porque cada pedaço é cortado e
soltado"* — **estava errado**. Cortar em pedaços evita que o **item** fique, mas não evita que os
**6 arquivos de origem** fiquem abertos ao mesmo tempo (o maior tem 33 mil itens), e o Node mantém os
6 Buffers e as 6 árvores de parse vivos até a última gravação.

Medido em produção, com os 6 em paralelo:

```
[paineis] Space/series: 8169 itens | rss 114 -> 258 (gravado)
[paineis] Autos/vod:   31509 itens | rss 113 -> 272 (gravado)
```

**272MB** é o caminho mais perto de estourar o teto de 300MB que o dono pediu — e é logo depois de um
deploy, que é quando tudo rebaixa. Medido local: **150MB (paralelo) → 133-136MB (sequencial)**, ao
preço de **6,9s → 14s**, e o aquecimento roda em segundo plano.

Coletar entre catálogos **não** ajuda (medido: `RSS 172MB -> 172MB (caiu 0MB)`) — é arena, não lixo.

### O botão de emergência estava quebrado junto

`xtream.js` chamava `seriesCache.delete(key)` no **caminho de emergência** (SQLite fora → catálogo na
RAM) e o `makeCache` só devolvia `{ get, set }`. Um `TypeError` derrubava justamente o botão que
existe para o disco falhar na hospedagem: o dono perdia a economia **e** a funcionalidade.
Corrigido: `makeCache` devolve `delete` também. Reproduzido em 2/2 antes, 0/2 depois.

## Gêneros de TV: 7 baldes, e o menu vem deles (decisão 126)

O filtro de categoria casa por nome exato, então o gênero cru da fonte tinha que cair dentro de uma lista fechada. Medido antes: as metas carregavam **19 gêneros crus** ("Notícias" *e* "Noticias", "Abertos" *e* "Canais Abertos", "Documentarios" *e* "Documentários", "Filmes", "Séries", "Geral", "Inglês", "MiamiTV", "Realitys", "24 Horas", "Adulto", "Desenhos") contra um menu escrito à mão com 10 opções — e **6 das 10 estavam quebradas**: "Abertos" devolvia 10 e escondia os 40 "Canais Abertos", "Filmes e Séries" devolvia 1 e escondia 137, "Eventos" e "Portugal" devolviam 0. Agora `BUCKETS`/`normalizaGenero()` em `core/tv-sources.js` são a fonte única e o manifesto monta o menu com `["Todos", ...tvSources.BUCKETS]`. Medido depois: Esportes 114, Variedades 108, Abertos 50, Filmes e Séries 38, Infantil 20, Noticias 13, Documentarios 2, Todos 327.

## O servidor virou SÓ CATÁLOGO: nem player de VOD, nem de TV (decisão 155)

O dono, 02/10/2026: ***"nada no servidor senão catálogo, todas as fontes são via plugin"***.
A 154 tinha tirado as 10 fontes de **VOD**. A 155 tirou o resto do caminho de vídeo: as **4 de
TV**, o **relay** e o **proxy**. O que sobrou no servidor é leitura, e nada mais.

### O que saiu

| Saiu | Era | Onde está |
|---|---|---|
| `/stream/hls/:file` | relay de TV (`text/plain`→`mpegurl`, token novo a cada ida) | `nuvio/src/scrapers/reidosembeds.js` |
| `/stream/proxy`, `/stream/proxy.m3u8` | máscara de URL do VOD (`MASK_STREAMS`) | `nuvio/src/scrapers/` |
| `/stream/proxy-check` | medir se a WAF de uma origem barrava o servidor | não tem mais o que medir |
| `/seg/etc/:file` | segmento da ETC, que exige `Referer` de servidor | idem |
| `src/lib/stream-relay.js` | o relay | — |
| `src/lib/proxy.js` | máscara, cifra, `workerDe` | `core/nomes.js` (`workerDe`) |
| `src/lib/etc.js` | playlist/segmento da ETC | — |
| `src/routes/segmentos.js` | a rota `/seg/etc/*` | — |
| `src/scrapers/embedtv.js`, `embedcanais.js`, `reidoscanais.js` | 3 fontes de TV | `nuvio/src/scrapers/` |
| `PROVIDERS`, `getStreams`, `resolvePlaylist`, `membersOf`, `ownerOf` | registro e motor de player de TV | — |
| `agendaTriagem`, `provadosMortos`, `contagemDeProvas`, `TV_MS_POR_FONTE` | a triagem (131 s) e a prova de morte | — |
| `existePreview`, `completaPrevia` | a prévia (frame de vídeo, decisão 63) | — |
| `maskTvUrls`, `cifraOrigens`, `maskStreamUrls`, `headerlessVariant`, `NEEDS_REFERRER` | máscara de stream | `nuvio/src/scrapers/` |
| `probeStreamQuality`, `probeViaWorker`, `qualityCache`, `reachCache` | sonda de resolução e alcance | `src/lib/video-probe.js` fica |
| `fillMissingHlsQuality`, `ordemTv`, `sortStreamsForResponse` | classificação da lista de stream | `src/lib/anime-ranking.js` fica |
| `TV_STREAM_CACHE_TTL`, `TV_STREAM_CACHE_DEGRADADO_MS` | TTL de link de TV (90 s) e degradado (10 s) | — |
| `aqueceStreamsDeTv`, `PRIORIDADE_TV` | aquecimento de streams de TV (decisão 111) | — |
| `videoBases()`, `VIDEO_BASE_URL` | round-robin do embrulho de vídeo entre app1/app2 | `nuvio/src/scrapers/xtream.js` |

**`reidosembeds.js` CONTINUA** — e foi enxuto ao que ele é de verdade: `loadCatalog`,
`getCatalog`, `getMeta`, `genreFor`. Saiu `resolveSrc`, `resolvePlaylist`, `getStreams`,
`temSegmentos` e a cadeia de 4 saltos. Ele é a **fonte de metadado, logo e guia**.

### O que ficou, e por que o servidor ainda existe

1. **A lista de canais** — `/nuvio/*` (formato Nuvio, `id` numérico), `/catalog/tv/*`,
   `/meta/tv/*`, `/api/channels*`. O Nuvio **não tem lista de canal nativo**: ela sempre veio
   de um addon.
2. **O guia** — `src/lib/epg.js` (decisões 55/56/121). O plugin não tem onde buscar o XMLTV.
3. **O logo** — o `/api/channels` do REI tem logo em **100% dos 327** (medido).
4. **Meta de VOD** — `/meta/*` e `/api/vod/*` via TMDB/AniList.
5. **Páginas e diagnóstico** — `/install`, `/dashboard`, `/tv`, `/health`, `/metrics`, p2p.

### `core/tv-sources.js` agora é catálogo + meta, e a lista é SÓ do REI

`METADADOS` (no lugar de `PROVIDERS`) tem **um** provedor. Isso **não muda a lista**: ela já era
só do REI desde a decisão 138 ("o catálogo é apenas do REI dos embeds"), e `chavesDaLista` já
descartava tudo que o REI não declarava. O filtro virou identidade, de propósito.

**E o efeito para o dono é MELHOR, não pior.** A regra dele era *"não retirar canal"*, e ela era
garantida por duas coisas frágeis: a lista não saía do REI, e a prova de morte só tirava na 2ª
confirmação (decisão 134, depois de **90 canais** terem sumido com uma só). As duas saíram.
Agora **ninguém no servidor pode encurtar a lista** — nem por prova de morte, nem por erro de
rede, nem por oscilação da origem. A defesa contra fonte morta mudou de lugar: é o plugin, na
tela, com o player do aparelho — a prova mais honesta que existe, e a que o dono vê.

**Detalhe que quebra se ninguém olhar:** a chave do catálogo é `normKey(nome)` e o slug do REI é
outro (`argentinanewses` no catálogo, `argentinanews` no REI — medido em 79 dos 327). O REI só
entende o slug, então `buildGroup` guarda o par em `group.slug` e o `getMeta` o usa. Sem isso,
abrir um canal pelo id do catálogo daria *channel not found*.

### O ganho medido — e por que o cluster de TV perdeu o motivo de existir

A peça cara do servidor era o catálogo de TV: **284 canais × 4 fontes, concorrência 48**, para
decidir quem entrava na lista. Custo medido: **127 s**, contra os 12,3 s em que o gateway corta.
Sem player, "montar o catálogo" passou a ser *ler a lista do REI*:

| | Antes | Depois |
|---|---|---|
| catálogo de TV, frio | **127 s** | **1,17 s** |
| busca e categoria | 42 s (504) | **0 ms** (o memo filtra) |
| canais na lista | 284 (a triagem podia encolher) | **327** |
| EPG | 143 canais, 3.939 programas | **igual** (não mudou) |
| RSS de pé, catálogo e guia aquecidos | — | **85 MB** (heap 20 MB, external 3 MB) |

**O cluster de TV foi estreitado, não desligado.** O dono decide topologia; desligar `TV_BASE_URL`
deixaria o app2 como cópia do app1, e isso é mudança de produção. O que a 155 fez foi tirar do
repasse as rotas de **stream** (`/stream/tv/*`, `/api/streams/tv`): elas respondem
`{streams:[]}` sem tocar em origem, então a ponte seria mais lenta **e** mais um ponto de
falha. Repassam o **catálogo** (`/catalog/tv/*`, `/api/channels*`) e a **meta** do canal.

### `/nuvio/stream` — as DUAS coisas que foram feitas, e por quê

1. **`stream` saiu do `resources` do manifesto.** É a parte do servidor que o cliente lê primeiro,
   e um addon que se anuncia como recurso `stream` promete um player que não existe.
2. **A rota CONTINUA registrada**, respondendo `{"streams":[]}` com 200 e `no-store`. O manifesto
   vive em cache (120 s na borda, e o Nuvio guarda o que leu), então um cliente com o manifesto
   antigo vai **pedir** essa rota. Um 404 vira "erro do addon" na tela; `{streams:[]}` vira
   "nenhuma fonte" — a mesma resposta, e o mesmo formato, das outras duas rotas de stream.

### Os dois defeitos que a 155 criou e que os testes NÃO pegaram

**A barreira de testes lia `server.js` como TEXTO** (`readFileSync` + regex). Texto não executa,
então nenhuma das centenas de verificações dela podia ver um `require` quebrado. Duas vezes isso
aconteceu, e as duas com sintaxe **certíssima** — `node -c` passava:

1. `segmentos.registrar(app)` sobrou para um arquivo apagado → `ReferenceError` no boot. O
   servidor não subia, e a barreira ficava **verde**.
2. Pior: uma deleção por linha levou junto o **`app.listen(...)`** e o guard de memória. O
   processo saía com **código 0**, sem escutar, sem erro — e os 247 testes passavam.

Por isso existe **`test/server-carrega.test.js`**: ele **sobe o servidor de verdade**, num processo
separado, e exige a linha `[Mirror] listening on`. É a única verificação que pega as duas. E o
segundo teste dele varre `src/` inteiro procurando `require` de módulo inexistente — a cobertura
que o teste de função-chamada-sem-definição não dá (ele é por lista de arquivos, e varrer tudo
acusaria ~27 falsos positivos que já existem no código).

**Armadilha do `/*` dentro de comentário:** o limpador de comentário do teste de função-chamada
abre bloco em `/*` e fecha no primeiro `*/`. Um `` `/stream/*` `` escrito **dentro de um `//`**
engolia as 600 linhas seguintes e apagava da varredura a definição de `aqueceGuiaDeTv` — o teste
acusou chamada sem definição numa função que existia. **Nunca escreva `/*` dentro de um `//`.**

---

## O plugin Nuvio: o que o player decide, e o que só o aparelho prova (02/10/2026)

As 15 fontes rodam em `nuvio/` e o **catálogo continua do addon** (`src/routes/nuvio.js`, rotas
`/nuvio/*`) — o plugin só resolve stream. Detalhe: [`nuvio/STATUS.md`](nuvio/STATUS.md) §1b,
[`nuvio/ARQUITETURA.md`](nuvio/ARQUITETURA.md) §6 e [`nuvio/medicoes.md`](nuvio/medicoes.md).

### 1. O Nuvio tira o MIME do **caminho** da URL — não do `content-type`

Lido `PlayerMediaSourceFactory.kt` (linhas 976–1070), que é a autoridade:

| ordem | regra |
|---|---|
| 1 | `inferMimeTypeFromUrl` — o **caminho** (`.m3u8` → HLS, `.mp4` → progressivo) |
| 2 | só se o caminho não disser nada: `inferMimeTypeFromQuery` — chave `format`/`ext`/`type`/`mime` com valor de manifesto, ou valor `m3u8`/`mpegurl`/`hls` |
| — | `proxyHeaders.response` do scraper é **sempre nulo** — não dá para injetar o cabeçalho |

O REI entrega a playlist como `…/__index.txt` com `text/plain`, e **o caminho diz "arquivo de
texto"**: o player tentava baixar o manifesto como vídeo. **`sinaliza()`** (`nuvio/src/lib/hls.js`)
acrescenta `&format=m3u8` a quem termina em extensão de texto. Regras (todas com teste):
**idempotente** · **preserva a query** · **não toca em `.mp4`/`.ts`** · **não repete aviso já
existente** (`?type=hls`, `?ext=m3u8` — repetir criaria `format=m3u8` duas vezes) · `""`/`null`
voltam iguais.

- **Ferramenta `nuvio/tools/mime.js`**: aplica a regra do Kotlin às URLs reais das 4 fontes de
  TV. Antes: `rei`/`emb` → "progressivo" ✗. Depois: **`application/x-mpegurl (HLS ✓)`** nos 4.
- **`nuvio/tools/prova-formato.js`**: o parâmetro é aceito em silêncio — **mesmos bytes** com e
  sem ele nos saltos da cadeia do REI.
- Os **4 emissores de TV** saem por `url: sinaliza(...)`; o teste varre os 4 e falha se o
  `require` existir sem uso.

### 2. Orçamento de `fetch` tem de cobrir a origem que RECUSA devagar

Medido: a origem do REI leva **10,2 s** para devolver 404 num canal morto. Com o probe de 8 s o
`fetch` estourava e o erro subia → o chip dizia **"fonte com erro"** em vez de **"sem fonte"**
(`1041`, `1101` lancavam `timeout de 8000ms`).

`reidosembeds.js`: `MS_PLAYLIST = 13e3` (cobre os 10,2 s) buscado por **`restante(p, MS_PLAYLIST)`**
— o orçamento **restante** do sandbox, que pode passar de 8 s — e `TETO_MS = 20e3` para a cadeia
inteira (canal morto não pode prender o chip por meio minuto). A 2ª tentativa só roda se couber
um probe inteiro, e falha nela → `[]`.

- **A régua (decisão 131 preservada):** rede/timeout/5xx no 1º probe **sobe erro**; `[]` só quando
  a origem **respondeu** e não tem playlist.
- Depois: `1021 → [] 4281ms`, `1041 → [] 11956ms`, `1101 → [] 13513ms`, `HBO → 1 stream 1814ms`.

### 3. Worker é derivado da sigla, e só entra onde a origem recusa

`painel.workerDe(sigla)` → `mirror-<sigla>`; **nunca escrito à mão** (um teste varre
`nuvio/src/` e falha com qualquer `mirror-<x>` literal). Uso hoje: a **reserva do ATO** e as
variantes que precisam de `Referer`.

Reserva do ATO: o `player_api.php` devolve **200 / 235 B de "Welcome to nginx!"** para IP de
datacenter, e o **mesmo pedido pelo worker devolve o JSON**. `infoDe` refaz pela reserva **só na
recusa** (página de erro), o `recusaram` não paga o direto duas vezes, e **404 nunca aciona a
reserva**. **`ato` de 0 → 3 streams.** O **vídeo** não tem caminho: `…/movie/…mp4` devolve os
mesmos 235 B direto (com `Range`, com `Referer`) e **`403 Upstream 403` pelo worker**.

### 4. Medido e barreira

```
VOD/anime/dorama (nuvio/tools/bateria.js): 14/15 com link vivo | 0 lançou erro | 52,8 s
  (ato entrega 3 streams; o VÍDEO dele é o 235 B — só o aparelho prova)
TV (nuvio/tools/bateria-tv.js, 16 canais × 4 fontes):
  rei 13/16 com stream, 13 link vivo, 0 erros, médio 3364 ms   (antes: 2 erros + 1 silêncio)
  emb 6/16 · etc 6/16 · rcd 4/16                               (iguais ao antes)
  rei sem stream: 1021/1041/1101 — playlist morta na origem deles

node --test test/   # 285  (259 + 18 do contrato de apresentação + 7 do prazo de corpo + 1 repartido, todos SEM rede)
```

Os 12 novos: contrato do `sinaliza` · os 4 emissores assinando · os tetos do orçamento do REI ·
o REI sem `Referer` · a cadeia do REI com **origem falsa** (viva → stream sinalizado · 404 → `[]`
com ≥2 sondas · 404 na cadeia → `[]` · **rede → rejeita**) · derivacão do worker + varredura ·
reserva do ATO (recusa → reserva, recusa não paga duas vezes, 404 → sem reserva).

### 2ª rodada de 02/10/2026 — o contrato de tela, o prazo de corpo e a qualidade real

Detalhe em [`nuvio/STATUS.md`](nuvio/STATUS.md) §1c e em `CONTEXTO.md`. As cinco coisas que
mudam para quem mexe no plugin:

1. **O Nuvio monta a tela em três lugares** e isso dita o contrato: linha 1 = `name` + `" - "` +
   `quality` (o **app** anexa a qualidade); linha 2 = `description ?: title`; badge =
   `addonName` do **manifesto** (`maxLines = 1`). Sem `quality` o app escreve
   `stream_quality_unknown` = **"Desconhecido"** em pt-BR — e **13 das 15 fontes** devolviam
   sem ele. Mandar `language`/`size` **esconde** o `title`, então não se manda. E
   `LocalScraperResult` é data class do Moshi: campo a mais pode quebrar o parse em runtime.

2. **`nuvio/src/lib/apresentacao.js` é o único lugar que monta o objeto de stream**; as 15
   fontes passam por `apresenta()` (TV por `aoVivo()`), e um teste falha se alguma montar na
   mão. A `sigla` vem do scraper porque `core/fontes.js` é tooling-only.

3. **`nuvio/src/lib/http.js`: o prazo cobre os headers E o corpo.** O defeito mais geral da
   rodada — `Promise.race([fetch, estouro])` termina nos headers e limpava o relógio no
   `finally`, deixando o `res.text()` sem limite. Medido no DGO: headers 0,23 s, corpo 15,1 s.
   **DGO 21,3 s → 5,7 s.**

4. **`nuvio/src/lib/painel.js`: direto e reserva em paralelo escalonado (2,5 s)** — ATO
   **9,9 s → 4,1 s**. E **o relógio nunca é limpo antes do `await` da outra ponta** (limpar
   deixava a reserva esperando um timer morto). Em `fonte-painel.js`, o catálogo gzip virou
   **corrida** com o shard (era `await catalogo` e *depois* `await shard`, e o BLZ gastava 12 s
   de 15 s num catálogo que nem responde).

5. **403/429 de IP de datacenter não é canal morto, em TV e em VOD.**
   `lib/hls.js::provaPlaylist()` é a régua única das 4 fontes de TV (descarta 404/410/451 e
   2xx sem segmento; não descarta 403/429/5xx/timeout/rede) — **RCD passou de 0 para 1 stream**,
   porque o vídeo é baixado pelo aparelho, do IP residencial dele. `tools/provar-links.js`
   segue a mesma régua (`INDECISO`/`BLOQUEADO` ≠ `MORTO`), senão a bateria acusa de morta uma
   fonte que o aparelho toca.

`nuvio/tools/bateria-completa.js` é a bateria do pedido (15 fontes × N casos: tempo, entrega,
contrato, qualidade, link vivo, e "o canal não existe nesta fonte" separado de "a fonte tem e
não entregou"). Medido depois: **16/16 casos tentados entregam stream, 0 erro, 0 vazio.**

**Só se prova no aparelho (3 coisas, documentadas em `nuvio/STATUS.md` §4):** o teto de 1 MB do
sandbox (bytes de rede ou corpo decodificado) · o bloqueio de IP de datacenter (vídeo do ATO, CDN
do RCD) · a sessão do REI segurar um episódio inteiro com token de 300 s.

---

## Scrapers ativos

> **As tabelas de anime/VOD/dorama/TV abaixo descrevem as fontes que o MIRROR tem, não as que o
> SERVIDOR executa** (decisões 154 e 155). No servidor **não sobra fonte nenhuma**: nem de VOD,
> nem de TV. O que o servidor ainda usa do REI é **metadado** (catálogo e logo) e o **guia** —
> o registro disso é `METADADOS` em `core/tv-sources.js`, com um provedor só. Todas as 14 fontes
> de player rodam em `nuvio/src/scrapers/` — o desenho de como cada uma foi portada está em
> [`nuvio/CONTRATO.md`](nuvio/CONTRATO.md).

### Índice por categoria (decisão 122)

A categoria de cada fonte é declarada **uma vez** em `src/core/nomes.js` (`FONTES[chave].conteudos`, ordem em `CONTEUDOS`); `categoriasDasFontes()` deriva o índice e o `/health` devolve em `fontes`. Dois testes travam a lista — mudou a fonte, mudou lá.

| Categoria | Fontes | O que entrega |
|-----------|--------|---------------|
| Anime | SHG, RON, AON, ATB, RTD | episódios de anime (dublado/legendado); RTD entra também pelos desenhos/animes dublados |
| Séries | SPT, BLZ, SPC, ATO, KKT, RTD, VZR | séries não-anime |
| Filmes | SPT, BLZ, SPC, ATO, KKT, RTD, VZR | filmes — **as mesmas fontes de série**: nenhum painel tem catálogo só de série ou só de filme |
| Doramas | DGO | séries KR (`originCountry` vazio ou `KR`) |
| TV ao vivo | EMB, ETC, REI | 284 canais (REI = metadados/logos/guia, não entrega vídeo) |

`cas` não está na tabela: é o nome de reserva de stream sem fonte, não entrega conteúdo.

### Anime
| Scraper | Tipo | Descrição |
|---------|------|-----------|
| SHG (Otakulogia) | GraphQL API | Dublado PT-BR, vídeos MP4 |
| RON (AnimesDigital) | HTML scraping | PT-BR / Legendado |
| AON (animesonline.io) | HTML scraping | PT-BR / Legendado — caminho 100% direto (sem query params p/ evitar challenge CF): índice `/anime/list-mode/` → série → ep → token anidrive → decode nativo (JSON+XOR/atob) → MP4 googlevideo com UA browser |
| ATB (anitube.biz) | API REST WP | PT-BR / Legendado — **categorias WP por anime** (`/wp-json/wp/v2/categories?search=`) + posts da categoria (`per_page=100`, página = `count-ep+1` porque a API ordena por data **decrescente**); vídeo = parâmetro `d=` de `api.anivideo.net/videohls.php` (playlist de mídia, sem variantes → quality `unknown`; segmentos MPEG-TS com extensão `.webp`, sem auth/referer); **fallback por token** quando o WP não casa a query ("shippuden" ≠ "Shippuuden"); 2 requests frios, 0 quentes |

### Séries e Filmes (as mesmas fontes servem os dois)
| Scraper | Tipo | Descrição |
|---------|------|-----------|
| BLZ | API REST | Filmes e séries MP4 (kakito.xyz) |
| SPC | API REST | Filmes e séries MP4 (telaplay93.top) |
| ATO | API REST | Painel Xtream `4x4u29c.autos` — filmes/séries MP4 (31k/9,6k itens). **No servidor não roda** (decisão 154); o `/stream/proxy` e o `VIDEO_BASE_URL` saíram na 155, então o embrulho é do plugin |
| SPT | API REST | Filmes e séries HLS (playerflix.ink) |
| KKT | M3U + SQLite | VOD filme/série via iptv.db (kakito.xyz) — db64MB é gitignored (**prod nasce com `/tmp` vazio**); M3U `get.php` via **cadeia relay BR → worker `/proxy` → direto** (timeout60s/candidato). É **failover do BLZ**: mesmo arquivo kakito (dedup por host+path ignora `:80`/`:443` — some da resposta quando o BLZ já serviu). Origin kakito hoje:302→`voltm.uk`→400 (externo) |
| RTD | API REST + JSON | RedeToons — `play-link` `contract=3` por id TMDB (mp4 assinado, dub/leg) + `catalog-index` (portão: o id tem ou não no catálogo). **A API sai por `redetoonstv.win`**: o alias `redetoons.win` tem **TLS quebrado em todo caminho** (medido 30/09/2026: `EPROTO` direto, **525** via worker, **409** em http) e ficou só como **Referer** do vídeo e último recurso. Sempre **worker primeiro** — `/proxy?url=` no índice e `/rde/seg?ref=&url=` no play-link (injeta o Referer) — com fallback direto. **O RTD só atende quem chama DO BRASIL** (regra de país: do Brasil 200, da prod 403, e via worker era 403 também porque o worker roda no data center de quem chamou) → `wrangler.toml` fixa o worker em `[placement] region = "aws:sa-east-1"` (decisão 123) e a rota `/colo` devolve 302 com o colo no caminho, que é o que dá para ler pelo `proxy-check`. `play-link` **exige `Referer`** (sem → `403 {"error":"forbidden"}`); o índice não. **Entrega: link direto do CDN** com `Referer: https://redetoons.win/` + UA em `proxyHeaders` (decisão 49) — medido **206** (682 MB) do Brasil; a variante `🔗 sem precisar de Referer` vai pelo worker `/relay/s/<b64>?ref=` e também mediu **206**. **Esconder o link atrás do `/stream/proxy` da VPS não serve**: o servidor baixaria o vídeo de fora do Brasil e levaria 403 (medido) — vídeo nunca passa pela VPS, e a prod não tem caminho nenhum para a Oracle |
| VZR | URL derivada | **vizer.autos** — a URL do vídeo é **derivada só do id TMDB**: `nixplay.lat/{movie\|series}/{bucket}/{token}/{tmdb}[{S:3}{E:3}].mp4` (filme = `{tmdb}.mp4`; série = `{tmdb}` + temporada 3 dígitos + episódio 3 dígitos) → 302 para **Cloudflare R2** com URL assinada de 5h. Bucket/token em `VIZER_PATH` (default no código). **`Referer` é a pegadinha**: com qualquer valor o `nixplay` responde **403**; ausente ou `""` funciona — daí o stream sair com `behaviorHints.proxyHeaders.request = { Referer: "" }` (o R2 aceita qualquer Referer; a restrição é só no hop redirecionador). Conteúdo ausente volta `206` + `text/plain` (detectar por content-type). Catálogo ~57k filmes / ~15,7k séries; acerto medido 17/20 em títulos_BAD; probe médio ~250ms. **O `vizer.autos` em si é CF-bloqueado do egress DE** (403) — por isso o scraper **não toca no site**, só monta a URL |

### Doramas
| Scraper | Tipo | Descrição |
|---------|------|-----------|
| DGO | HTML scraping | **Doramas** (doramogo.net) — busca `/search/?q=` → `/series/<slug>` (lista de eps) → página do ep (`var urlConfig`) → path `<Inicial>/<slug>/<NN>-temporada/<MM>/stream.m3u8` nos hosts `ondemand.madfirebox.shop` (primário) e `forks-doramas.madfirebox.shop` (fallback), **ambos entregados** (mesmo `bingeGroup` p/ dedup); **`Referer: https://www.doramogo.net/` é obrigatório** (403 sem) → vai em `behaviorHints.proxyHeaders`; só é chamado p/ série com `originCountry` vazio ou `KR` (não polui as outras). **`mydoramas.net` é o MESMO CMS** (classe CSS `doramogo-search-result-card`, mesmo `urlConfig`, mesmo CDN) — entra só como **2º host de busca** quando o doramogo não devolve nada (catálogos idênticos hoje, ganho = redundância) |

### TV ao vivo

**O REI é o dono da TV (decisão 126)**: o catálogo do addon é o do REI, o EPG é o do REI (`/api/guia`) e o stream principal do canal é o do REI. A ordem dos provedores é `PROVIDERS = [rei, emb, etc]` e ela decide três coisas: o dono de fallback (`ownerOf`), a ordem das fontes na lista de streams do canal e a ordem em que o catálogo é montado. **A EMB e a ETC não saem**: elas entram *dentro* do canal do REI, como players adicionais, quando o mesmo canal também existe lá (medido: `cnnbrasil`, `bandnews` e `hbo` com REI + EMB + ETC; `sbt` e `disney`, que só o REI tem, com REI). A resposta de TV é ordenada por `ordemTv()` em `server.js`, **não** por `SOURCE_PRIORITY` (o REI tem `prio: 9` no registro porque no VOD ele não existe, e isso colocava o stream dele em último lugar).

**A lista é do REI**: os canais que só a EMB/ETC têm ficam **fora** do catálogo (medido: 60 de 387 — eventos esportivos de uma ocorrência só, tipo MLB/Liga dos Campeões, e "A Fazenda 18"). Eles continuam existindo para o canal do REI, que é o que usa. Se o REI não responder nada (a API dele dá 429 em rajada), a lista cai para a união das três fontes e o log avisa — TV escura é pior que lista longa.

| Scraper | Tipo | Descrição |
|---------|------|-----------|
| EMB | HTML scraping | TV ao vivo (embedtv.lat) — 145 canais |
| ETC | API JSON + redirect | TV ao vivo — 147 canais. `apisinalpublico.vercel.app/canais.json` (só `name/url/image`; id = `?id=`) → `sinalpublicoetv.vercel.app/?id=X` → iframe `sinaldvd.github.io/tv/player.html?id=X` → `m8q2v7r4k1-cloudflare-net.vercel.app/{id}.m3u8` **com `Referer` do player** (sem ele o 302 vai para um 404) → 302 → `t5r4e3w2q1y0ty.s23-cloudfront-net.lat/sinalpublico/{md5}/file.txt` (estável, **sem Referer**). O **worker NÃO relaya** esse CDN (**666** da rede Cloudflare) ⇒ entrega 2 variantes: mascarada pelo `/stream/proxy` do addon e direta |

### Metadados
| Fonte | Uso |
|-------|-----|
| AniList | Metadados de anime (título, episódios, sinopse) |
| Kitsu | Metadados de anime para ids `kitsu:` (título, episódios) |
| TMDB | Metadados de filmes e séries |
| Cinemeta | Fallback de resolução IMDb/TMDB |

## Nomes das fontes (exibição)

> **Gerado de `FONTES` em [`src/core/nomes.js`](src/core/nomes.js)** — o registro único.
>
> **As 13 fontes de VOD continuam registradas aqui de propósito** (decisão 154): o registro é o
> dicionário de **nomes** — rótulo, sigla, prioridade, worker por fonte — e ele é usado pelo
> proxy/relay (`workerDe`), pelos testes e pelo `/health → fontes`. O que saiu foi o **registro do
> motor** (`src/core/sources.js`), não o dicionário. `emb/etc/rei/rcd` são as únicas que o
> **servidor** executa; as de VOD rodam no plugin.
> Não edite a tabela à mão nem o código: a fonte se declara **uma vez** lá e o
> resto (rótulo, sigla, prioridade, prefixo de TV) é derivado. Um teste
> (`todo nome de env, rota e fonte passa pelo registro core/nomes.js`) falha se
> algum nome for escrito fora do registro.

| Fonte | Label | Tipo | Conteúdos |
|-------|-------|------|-----------|
| shg | CDN VOD \| SHG | vod | anime |
| ron | CDN VOD \| RON | vod | anime |
| aon | CDN VOD \| AON | vod | anime |
| atb | CDN VOD \| ATB | vod | anime |
| spt | CDN VOD \| SPT | vod | filme, série |
| blz | CDN VOD \| BLZ | vod | filme, série |
| spc | CDN VOD \| SPC | vod | filme, série |
| ato | CDN VOD \| ATO | vod | filme, série |
| kkt | CDN VOD \| KKT | vod | filme, série |
| rtd | CDN VOD \| RTD | vod | anime, filme, série |
| dgo | CDN VOD \| DGO | vod | dorama |
| vzr | CDN VOD \| VZR | vod | filme, série |
| emb | CDN TV \| EMB | tv | tv |
| etc | CDN TV \| ETC | tv | tv |
| rei | CDN TV \| REI | tv | tv |
| cas | CDN RSL \| CAS | http | — (não entrega conteúdo) |

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `PORT` | Automática | Porta injetada pelo Dokku (fallback 3000; local `.env` = 7000) |
| `PUBLIC_BASE_URL` | **Sim (BeamUp)** | URL pública HTTPS do app (`beamup config:set`) |
| ~~`VIDEO_BASE_URL`~~ | **Saiu (155)** | era o round-robin do embrulho de vídeo, que existia só para a rota `/stream/proxy`. Removida do registro, do `Dockerfile`, do `ecosystem.config.js`, do `beamup-start.js` e do `.env.example` |
| `DATA_DIR` | Não | Diretório para dados (iptv.db, caches) |
| `TMDB_API_KEY` | Recomendada | Chave API TMDB (gratuita em themoviedb.org) |
| `REDIS_URL` | Opcional | URL do Redis para cache compartilhado |
| `IPTV_SOURCES` | Opcional | URLs M3U customizadas (separadas por `|`) |

## Como testar

> **Node local = 18 (`/usr/bin/node`), não o 22.** O `better-sqlite3` foi compilado (09/2025) contra o ABI do **Node 18**; rodar com o Node 22 (`/tmp/node-v22.*`) faz `sqlite-cache.js` **despejar core (SIGSEGV, exit 139)** logo no boot — o processo morre sem mensagem nenhuma no log, só `[dns] Cloudflare DNS ativo` e nada mais. Parece bug de código e não é: `require('./src/lib/sqlite-cache')` isolado reproduz. Para confirmar em 5s: `/usr/bin/node -e "require('./src/lib/sqlite-cache')"` (node18 → `opened cache.db`; node22 → core dump).

```bash
# Testes unitários (barreira: 285)
node --test test/

# Verificar sintaxe
node -c src/server.js

# Testar anime
node -e "const s = require('./src/scrapers/otakulogia'); s.streamsFor('Naruto', 1).then(r => console.log(r.length))"

# Testar IPTV / VOD
node -e "const s = require('./src/scrapers/kakito'); s.streamsFor('Matrix', 1, 'movie').then(r => console.log(r.length))"
node -e "const s = require('./src/scrapers/xtream'); s.streamsFor('Matrix', 1, 'movie').then(r => console.log(r.length))"

# Testar TMDB
node -e "const s = require('./src/scrapers/tmdb'); s.getMovieDetail(603).then(r => console.log(r.title))"

# Testar TODAS as fontes VOD uma a uma (itens variados + probe de URL por stream)
node vod-sources.js

# Auditoria E2E de TODAS as fontes (latência por caso, probe Range, validação de match, ffprobe playback, EMB)
node audit-sources.js

# Teste de carga (usuários virtuais; LOAD_BASE/LOAD_TOTAL/LOAD_CONCURRENCY — exige 0 erros)
node load-test.js

# E2E fluxo do user (server local de pé: kill porta7000 → rm /tmp/cache.db → subir antes)
node e2e-flow.js

# Iniciar servidor
PUBLIC_BASE_URL=http://localhost:7000 node src/server.js
```

## Defeitos medidos em 29/09/2026 e o que fazer (leia antes de mexer em base/URL/catálogo)

Sete rotas montavam a URL pública com `` `${req.protocol}://${req.get("host")}` ``. **O gateway do BeamUp reescreve o `Host` para só o nome do app** (`c12e41ddc21b-mirror2`, sem domínio) e o `x-forwarded-host` chega **vazio** — a URL de TV ao vivo saía `https://c12e41ddc21b-mirror2/stream/hls/hbo.m3u8` e **não tocava**. **Use sempre `basePublica(req)`** (`src/server.js`): `runtimeBase` → `PUBLIC_BASE_URL` → host do request **só se tiver ponto**; senão string vazia. No cluster de TV o `runtimeBase` já é o `TV_BASE_URL` completo. **Nunca monte a base na mão.**

- **Busca e categoria de TV NÃO podem pagar a triagem.** Cada termo digitado é uma chave nova de cache, então nunca há cache hit, e a triagem dos ~283 canais nas 3 fontes leva **64-85s** (acima dos 12,3s do gateway). `catalogForCore` chama `catalogoDeTv()`, que **filtra a lista inteira já guardada** (`mirror-tv-live::tv::`, TTL 24h) e só cai na triagem se ela não existir. `BUSCA_TTL` (memo em memória) é 5min — se voltar a 60s, a busca volta a remontar a cada minuto.
- **O chute do EMB não é prova de vida.** `playlistVerdict` devolve `"unknown"` para qualquer erro ≠404/410/451, e o chute `{PLAYLIST_FALLBACK}{slug}.txt` responde **502** para slug inexistente. Só `"ok"` vale no chute; `"unknown"` ainda vale na URL vinda da página. Sem isso, canais que **não existem em fonte nenhuma** (`globo`, `record`, `band`) entram no catálogo e não tocam.
- **A lista de canais tem que sobreviver ao restart.** `triagemGuardada` vai para o SQLite (`mirror-tv:triagem`, TTL 30 dias) e a lista é `o que já passou` **somado** a `o que passou agora**, inclusive quando a composição muda. Medido: 284 canais no 1º boot e 284 no 2º.
- **RSS alto aqui é arena, não vazamento.** `global.gc()` não baixa nada (157 → 156MB). `MALLOC_ARENA_MAX=2` no `Dockerfile` derruba 11%. Antes de otimizar código, meça com `process.memoryUsage()` **e** com `--expose-gc`: se o heap é pequeno e o RSS é grande, é arena.
- **Um `curl` que "toca" não prova que o video é entregável**: `ffmpeg` com `-ss` antes de `-i` lê o arquivo inteiro e acha o tempo, então passa mesmo quando o servidor devolve 200 em vez de 206. Para provar entrega de faixa, leia os **headers** (`Content-Range`/`Accept-Ranges`) ou use `-ss` **depois** de `-i`.

## As duas camadas de cache (o que está valendo, medido)

`test/cache-streams.test.js` (9 testes) trava os numeros — se alguem mexer num TTL fora da faixa, o teste falha.

| camada | o que guarda | TTL | onde |
|---|---|---|---|
| **1. metadados/catálogos** | `/catalog` de VOD, `/meta`, info do TMDB/AniList | VOD **15min**, meta **10min**, info **30min** | `CACHE_TTL` / `META_CACHE_TTL` / `INFO_CACHE_TTL` |
| | catálogo de TV (lista de canais) | **24h** | `TV_CATALOG_TTL` |
| | lista de canais aprovada (triagem) | **30 dias**, no SQLite | `CHAVE_TRIAGEM` em `core/tv-sources.js` |
| | guia do dia (`?date=`) | segue o TTL do catálogo + `epgPronto` | `catalogForCore` |
| **2. streams** | link final (VOD) | **15min** | `STREAM_CACHE_TTL` |
| | link final (TV) | **1min** | `TV_STREAM_CACHE_TTL` |
| | resposta **degradada** (faltou uma fonte) | **10s** | `TV_STREAM_CACHE_DEGRADADO_MS` |

- **Resposta degradada tem TTL curto de propósito**: guardar a lista sem uma fonte pelo TTL inteiro é o relato "Globo News veio sem a REI". Curto o bastante para a fonte voltar no clique seguinte.
- **O cache é no SQLite**, não só em memória (`sqliteCache`): sobrevive a restart e é compartilhável. O `Map` de memória cobre só o caminho quente.
- **A trava de requisição simultânea existe para streams E catálogos**: `inflightStreams` e `inflightCatalogs` guardam a promessa; quem chega depois devolve a **mesma** promessa (medido: 50 pessoas no mesmo filme = **5 chamadas de scraper**, não 50). Acima de `MAX_INFLIGHT_STREAMS` (300) a promessa é devolvida sem entrar na trava — o pedido é atendido, só não serializa.
- **O que NÃO expõe link velho**: `hasExpiredSignedUrl` (assinatura vencida no cache é ignorada) e o TTL degradado curto. Medido depois da mudança: filme, série e anime com link de cache **tocam** (120 frames cada).

## Convenções de código

- **Registro único de nomes — [`src/core/nomes.js`](src/core/nomes.js)**: TODO nome do projeto se declara **uma vez** lá e o resto importa. Nunca escreva `process.env.X`, um caminho de rota ou um rótulo de fonte direto no código:
  - **fonte** → `FONTES` (chave, sigla, tipo, motor, prioridade, prefixo de TV). `source-names.js` só deriva `SOURCES`/`SOURCE_PRIORITY` e `sources.js`/`tv-sources.js` derivam id/rótulo/kind. Mudou a fonte, mudou lá.
  - **rota** → `ROTAS` (+ `PREFIXOS` para trechos usados no meio da URL, como `"/api/"`). `app.get("...")` com caminho escrito à mão faz o teste falhar.
  - **env var** → `VARIAVEIS` + `ENV.NOME` (leitura, ao vivo — nunca congela na carga) e `defineEnv("NOME", v)` (escrita). `process.env.X` direto fora de `nomes.js` faz o teste falhar.
  - Padrão de escrita: chave de fonte = 3-4 letras minúsculas; sigla = a mesma chave em maiúsculas; rótulo = `"<grupo> | <sigla>"`; rota = minúsculas, plural no coletivo, sem verbo; env = MAIÚSCULAS prefixadas pelo dono (`XTREAM_*`, `KAKITO_*`, `TV_*`, `REI_*`, `BR_*`); arquivo = kebab-case; função = verbo + substantivo (o arquivo escolhe o idioma e mantém).
  - Três testes em `test/mirror.test.js` guardam isso: `todo nome de env, rota e fonte passa pelo registro core/nomes.js`, `nomes das fontes seguem o padrao...`, `ROTAS nao tem caminho repetido...`
- **RAM: catálogo dos painéis em disco, lido peça a peça** (decisão 136, meta do dono: 150MB, nunca 300MB). `memoria.js` mede o boot etapa por etapa: `xtream.preloadLists()` custava **206MB sozinho** (RSS 46 → 263MB; não era vazamento — forçando coleta o mesmo processo caía para heap de 20MB). Agora o catálogo vai para `src/lib/catalogo-paineis.js` (SQLite, o mesmo desenho que o KKT usa para 192 mil canais com 7MB) e a resposta do painel é consumida **em pedaços** (`browserFetch` ganhou `porPeca`), lida com contagem de **chaves** (o painel tem array dentro do item — `category_ids:[671]` — e a versão que contava `{` e `[` juntos tirava 0 item de 5 de 6 catálogos). **Medido: RSS 263-330MB → 119-130MB, pico 342MB → 124MB, heap 78-97 → 12MB, boot seguinte 60MB, com os mesmos streams** (`XTREAM_CATALOGO=memoria` compara os dois caminhos). O `cleanup` de 30s também passou a coletar de verdade: `global.gc` **nunca existe** em produção (`--expose-gc` é recusado em `NODE_OPTIONS`), e `src/lib/memoria.js` pega o `gc` em tempo de execução.
- **Pegadinha que custou tempo**: `.split("//")` numa string quebra o teste de "função chamada sem estar definida" — o `//` dentro da string é lido como comentário pela limpeza do teste, sobra uma aspa desbalanceada e engole a definição da função seguinte. Use `replace(/^https?:\/\//, "")`.
- **Nenhuma fonte devolve item errado** (decisão 135): `src/lib/portao-correspondencia.js` fecha a busca quando o melhor resultado não casa com o pedido. **Medido em produção: `movie/tmdb:603` (Matrix) respondia com `otakulogia:futari-wa-precure` e Batman com Boruto** — a causa era `searchItems.find(exato) || searchItems[0]` no SHG (e o mesmo padrão em dois pontos do `server.js`): sem casamento exato, aceitava o **primeiro** resultado da busca e devolvia o episódio 1 dele. O motor chama as fontes com **variantes de título**, então quase toda variante caía nesse caminho. Regra: sem correspondência, `[]`. O casamento é o `matchVodTitle` (já ignora qualificador e reprova continuação) **mais** o marcador de continuação que ele deixava passar ("Naruto: Shippuden"), e o detalhe também é conferido. Três testes com os pares **reais** que saíram da produção.
- **Reset de cache existe** (decisão 134): `POST /admin/limpar-cache` (mesmo token do diagnóstico) apaga o SQLite, as caches em memória, as travas de pedido, os disjuntores e o catálogo de TV em memória, e devolve **antes/depois**. Medido: ele **não pegava as provas de morte da TV** (moram em memória, `provadosMortos`) — o reset dizia "disco 0, memória 0" e o catálogo ficava com 227 de 327; eram **90 provas** no app1 e 38 no app2.
- **Canal de TV só sai da lista na 2ª confirmação** (decisão 134): com uma confirmação, **90 canais saíram do catálogo (327 → 227)** porque o REI devolve 200 com playlist sem segmento para canal que funciona minutos depois. `TV_MORTES_PARA_TIRAR` (padrão 2); prova de vida continua imediata. Preço dito com clareza: com os 327, 67% dos canais têm player; com os 227, 92%.
- **Triagem de fundo para com gente assistindo** (decisão 134): medido, com ela rodando canal de 0,5s ia para 10-11s e o gateway cortava o 1º clique em **504** (30 dos 327). Agora ela espera entre fatias (`setCargaDeUsuario` → `inflightStreams + inflightCatalogs`).
- **Orçamento por fonte de TV: 6s** (decisão 134): medido no REI — quem entrega leva **até 3,4s**, o que trava leva **23-25s**, e o gateway corta em 12,3s (esses canais nunca resolviam). `TV_MS_POR_FONTE` (padrão 6000). Medido depois: 5 canais que davam **504 sempre** passaram a `200` em 6,8-7,8s, e quem funciona segue em 0,3-1,9s.
- **A página `/tv` estava morta** (decisão 132): o script embutido abria uma IIFE e **nunca a fechava** — `})();` não existe em nenhum commit, então o navegador descartava o script inteiro (sem player, sem P2P, sem telemetria). `test/paginas.test.js` **executa o parser** (`new Function`) em todo script embutido das 3 páginas. E o P2P usava a **API v3** numa lib v4: agora é `HlsJsP2PEngine.injectMixin(Hls)` (subclasse) com config em `hls.p2p`, **import map + módulo ESM** (a v4 é só ESM), eventos em `hls.p2pEngine` com nome `onSegmentLoaded`/`onPeerConnect`, distinção de par por `downloadSource === "p2p"`, e escuta do **`onStreamRegistrationError`** (stream não registrado carrega **sem P2P e em silêncio**). O player só nasce depois do módulo; com P2P desligado nasce na hora. Estado do motor vai para a tela e para o `/health`.
- **Credenciais: registro, teste e régua** (decisão 133): 16 variáveis marcadas `segredo: true` no registro (um teste falha se alguém criar uma com cara de credencial e não marcar), `test/segredos.test.js` falha se um arquivo de ambiente for versionado, e o `/health → credenciais` diz `definida`/`ausente` **sem nunca mostrar o valor**.
- **Scraper que engole erro vira prova de morte** (decisão 131): o catálogo de TV caiu de **327 para 217** em produção porque o REI devolvia `[]` quando o host respondia **429**, e a triagem lê `[]` como "respondeu e não entregou" = **prova de morte por 24h**. Três camadas engoliam: `temSegmentos` (`catch { ok = false }` + guardava o `false` no cache), o `catch { return [] }` da segunda tentativa e o `src` vazio. **Regra**: só o que foi **de fato consultado** e veio vazio vira `[]` (404/410 e playlist sem segmento — o `src` deles rotaciona); timeout, rede, **429** e 5xx **sobem como erro**, e aí o servidor marca degradado e a triagem conta "não deu para saber". Chave das provas: `mirror-tv:triagem-mortos:v3`.
- **O `Range` não chega no app em produção** (medido 01/10/2026, headers `X-Relay-Range: -` e `X-Relay-Upstream: 200 sem-cr`): quem corta a faixa é a **Cloudflare na borda** (medido `206` + `Content-Range` certo num arquivo de 3 GB), e o **gateway nginx do Dokku** é o que não repassa o header. Consequência: a correção de faixa do relay vale onde o app recebe `Range` (dev, `/stream/hls`, cliente direto), **e não é a causa do defeito "link copiado buga"** — aquele segue sem causa confirmada.
- **Caminho do byte com teste** (decisão 130): `test/caminho-do-byte.test.js` roda **sem rede externa** (servidor HTTP local) e **achou 2 defeitos reais**: (a) `provaDe` **condenava a playlist mestre** (não tem segmento próprio, e saía da lista sendo link bom) — agora só condemna a que não aponta para nada; (b) o relay **deixava a origem ignorar `Range`** (faixa fechada pequena ia por passagem direta, e origem que ignora devolvia 200 com o arquivo inteiro — o defeito "link copiado buga") — agora o relay **corta a faixa sozinho** e marca `X-Faixa-Cortada: 1`. Cobertura: `prova-viva` 24→**100%**, `stream-relay` 12→**82%**, geral 59→**64,56%**. O stream compartilhado é provado por **contagem na origem** (2 pessoas = 1 ida). **Pegadinhas do teste**: `localtest.me`/`nip.io` resolvem para `::1` também (o servidor escuta nos dois), `127.0.0.1.nip.io` cai no filtro de IP privado, o relay tem rate limit por host (1100ms — esperar a resposta, nunca tempo fixo) e o duplo de cliente tem que marcar `headersSent` no primeiro `write`.
- **Alerta de fonte caída** (decisão 129): `/health → fontesSaude` classifica as 10 fontes em `caido` (disjuntor aberto **e** sem sucesso ha 30 min), `degradado`, `parado` (faz tempo que ninguem pede — **não é defeito**) e `ok`. O motor já guardava `lastOk`/`lastError`/`fails`; o que faltava era o `stats()` expor e o classificador. **`tempoEsgotado` nunca vira `caido`** (o motor trata como fonte lenta; contar tirava a fonte da lista 5 min mesmo entregando). Com `ALERT_WEBHOOK_URL` no ambiente avisa **só na transição**, no máximo 1x/30min.
- **Cache de segmento na borda** (decisão 127): o `/relay/s/` do worker guarda em `caches.default` com a **URL do próprio worker** como chave (o caminho tem o base64 da origem e o `?ref=`), TTL de 60s, e **nunca cacheia `Range`**. Resposta traz `x-mirror-cache: HIT|MISS`. **Não vale para TV**: o worker não alcança os CDNs de TV (erro 666, o mesmo de `WORKER_BLIND`).
- **P2P tem telemetria** (decisão 128): a página `/tv` manda `POST /p2p/report` a cada 5s (`canal`, `pares`, `segmentos`, `dePares`, `erros`) e o `/health` responde em `p2p: {canais, pares, segmentos, dePares, pct, detalhe}`. O que entra é clampado (teto por número, canal com 40 caracteres, 60 canais) porque o endpoint é público, e o corpo usa `express.json` **só** em `/p2p` (o projeto não tinha parser de JSON). **O motor ainda não liga** (o `p2p-media-loader` não completa o manifesto com o hls.js atual) e 2 dos 3 trackers públicos estão mortos — então o número no `/health` é a **prova** de quando passar a passar, e não opinião.
- **Worker é por fonte** (decisão 124): o plano grátis da Cloudflare dá cota **por worker**, então uma fonte que estoura derrubaria as outras. Escolha o worker com `workerDe(fonte)` / `getCdnProxy(fonte)` (de `core/nomes.js`) e **nunca escreva `mirror-<fonte>` no código** — a URL é derivada. Fonte desconhecida cai no genérico `mirror-cdn`, que segue publicado como reserva. Todo caminho que fala com o worker precisa saber a fonte: `relayM3u8Url`/`proxyHttpUrl`/`urlOculta`/`animeHlsUrl` em `lib/proxy.js`, `headerlessVariant`/`cifraOrigens`/`maskStreamUrls`/`probeViaWorker` no `server.js` e os scrapers (`redetoons`→rtd, `playerflix`→spt, `xtream`→blz/spc/ato, `kakito`→kkt, `embedtv`→emb)
- **CommonJS** (`require`/`module.exports`), NÃO ESM
- Sem comentários no código (a menos que solicitado)
- User-Agent em `src/lib/ua.js`
- Cache com `makeCache(maxSize, ttlMs)` de `scraper-utils.js` (chave de valor nulo = miss; `missCache` guarda 404/slug-errado por 30min no AON e no cinemeta)
- Requests externos via `browserFetch()` (fetch nativo com headers de browser + **UA rotacionada por host** via `uaFor()`, estável por host para não quebrar handshake; fila por host **sem delay** — `enqueue(host, fn, 0)`, rate opcional `rateMs` por chamada, cap de **500** na fila; redirects com cap e slot liberado antes de recursar; abort/timeout **sempre rejeitam** — nunca devolve promise pendurada)
- Multi-candidato (animesdigital/xtream/allSettled): falha de UM candidato **não** aborta os demais — throw final só quando **todos** falham (aí sinaliza degradação); sucesso parcial volta normalmente
- **`Range` que a ORIGEM ignora (29/09/2026)**: sintoma = "toca, passa uns minutos, tela branca e uns barulhos, e para", tambem ao pular posicao e **ao copiar o link**. O painel `kakito -> voltm.uk` ignora `Range`. O worker (`/p/`) agora **corta a faixa sozinho** (206 + `Content-Range` real; o total vem do `content-length` **ou** do `content-range` da origem) e o **arquivo inteiro saiu do cache automatico da borda** (`no-store`), senao a borda devolvia o filme inteiro para quem pedia faixa. **Nunca devolver 206 com corpo vazio**: alem de 32MB do inicio volta 200 com o arquivo todo. O `x-mirror-faixa` na resposta diz qual caminho foi usado.
- **NUNCA entregue H.265/VP9/AV1 como se fosse universal** (`xtream.js` + `lib/mp4-codec.js`, 29/09/2026). Sintoma medido: **tela branca + barulho ensurdecedor** — o aparelho nao decodifica o video, a tela some e o audio continua sozinho, reinterpretado. O codec sai do **mesmo buffer** que a sonda ja lia para a duracao (custo zero). Regra: havendo um H.264, so ele fica; se todos forem de codec fechado, todos ficam; codec desconhecido nao e condena. Medido: **0 de 31** depois (era 3 de 23).
- **Prova de vida antes de entregar** (`lib/prova-viva.js`): medido, 4 de 53 links devolvidos estavam mortos. As sondas de qualidade devolviam `null` para "morreu" e para "nao deu para saber" — indistinguiveis. Agora so sai o que responde 403/404/410/451, 5xx, `text/html` ou playlist sem segmento. **Timeout NUNCA condena** (link lento ainda funciona). Revalidacao do cache em `lib/revalida-cache.js`: link guardado que morre e invalidado em segundo plano, sem o pedido esperar.
- **Segunda chance em tropeco de rede** (`scraper-engine.js`): reexecuta **uma** vez se o erro e de rede (`ECONNRESET`, `socket hang up`, 5xx…) E a chamada voltou rapido. Nao repete timeout (o orcamento ja foi), nem "nao encontrei o titulo" (resposta legitima). Medido: 45 pedidos iguais em 9 fontes -> 45 devolveram.
- `browserFetch({ peekBytes })`: le so o inicio de um arquivo gigante e desliga. Existe porque o **kakito ignora `Range`** e devolve 200 com o arquivo inteiro, e sem isso a sonda nunca tinha cabecalho nos arquivos de 1GB.
- **ACHE A URL DO VÍDEO COM O MOTOR, NUNCA COM REGEX** (`src/lib/extrator.js`, 29/09/2026). `coletar(html, {base})` devolve **todos** os candidatos já pontuados e ordenados; `resolver(pagina, {ms, maxPaginas})` segue a cadeia inteira (iframe → player → `ref`) sozinho. **Não escreva mais `/https?:\/\/[^"']+\.m3u8/`** — 4 defeitos medidos vieram disso: (a) **barra escapada** `https:\/\/` (o SPT escreve assim e nenhuma regex achava), (b) **`&amp;` na query** (REI — a query vai errada e o site responde 404, que parece fonte morta), (c) `.txt` como playlist (só a chave de config diz que é vídeo), (d) `?d=<a url>`. Site novo = adaptador fino (onde fica a página do episódio), não um scraper novo. Convertidos: RON, SPT, DGO. **Descoberta ≠ entrega**: achou o `.txt` do REI, o `/stream/hls/rei:` continua sendo quem serve como `application/vnd.apple.mpegurl` (cru não toca).
- Interpretar HTML com `src/lib/html.js` (`parse`, `seleciona`, `um`, `textoDe`), não com regex — regex quebra quando o site troca a ordem das classes, que foi o defeito do RON. Cuidado: `src` como **atributo** não é chave de config (o REI põe a página seguinte em `src="…/__play/…"` e o motor aceitava a página como vídeo).
- Cada scraper exporta `streamsFor(query, episode, type, ...)` que retorna array de stream objects (VOD/xtream/kakito/playerflix aceitam `year` como último parâmetro p/ matching por ano)
- Matching/qualidade/texto: usar `src/lib/match.js`, `quality.js`, `text.js` — VOD compara título + ano (`matchVodTitle(name, query, isSeries, year)`, `adjustScoreForYear`); anime AON usa `scoreSerie` (**palavra extra fora da query reprovada**: −40/palavra, corte <50, stop-list + anos/números isentos, dublado +25) — spinoff de mesmo prefixo ("Dragon Ball Super", "Naruto Shippuden" p/ "Naruto") reprova e não serve episódio errado
- **Nome do catálogo contido na consulta NÃO casa (decisão 113)**: o `scorePair` do `match.js` tem dois ramos que devolviam placar de corte sem ser título de verdade — (a) `q.includes(n)` dava **70**, que é exatamente o corte de série do `xtream` (`>= 70`), então `Golden Time` servia **"Time"**; agora só devolve **90** se o que sobra da consulta for ano/qualidade/temporada (`Friends 1994 → Friends` continua passando), senão **60**; (b) a sobreposição de palavras usava `nw.includes(w) || w.includes(nw)` sem filtro, e **`"dragon".includes("o")` é verdadeiro** — a palavra "o" do candidato casava com qualquer coisa (deu 70 para `The Clubhouse…` em `House of the Dragon`); os dois lados agora passam por `palavraForte` (≥4 letras). E `streamsForSeries` (xtream) **também exige `matchVodTitle`** junto do placar: ele rejeitou 6 dos 8 shows errados medidos e manteve todos os certos. Sem isso o painel entrega show errado **só quando não tem o título verdadeiro** — que é justamente quando a pessoa mais percebe. Medido: 9 dos 71 pares (painel×consulta) serviam show errado como único resultado
- **Filmes xtream (BLZ/SPC): probe de duração + `filterConfirmedYear`** — `probeVodFile` faz Range `bytes=0-262143` (+ tail 512KB só p/ `.mp4`) e lê `mvhd` (`parseMp4Duration`, v0/v1) via `browserFetch().buffer()`; pipeline em ordem: descartar `alive===false` (**400**/403/404/410 **e `content-type: text/html`** — página de erro do origin, ex.: kakito→`voltm.uk` 400 ou HTML200; com retry 400ms; se TODOS mortos → mantém candidatos) → dedupe por `size>1MB` → runtime estrito (se ≥1 casou com `runtime`, mantém SÓ validados; senão mantém o conjunto) → `filterConfirmedYear(scored, title, year)` **por último**. Probe ≤6 candidatos, cache 10min, single-flight; série não tem probe (só ano)
- Streams HTTP: usar `makeHttpStream()` de `src/lib/stream.js` e montar o `title` com `vodTitle()` (fonte no formato `"blz"` → exibida como `BLZ`)
- **Qualidade de TODA fonte VOD = resolução real lida do vídeo** (`src/lib/video-probe.js`, decisão 36): nenhuma fonte inventa mais qualidade. `probeResolution(url)` resolve a playlist (m3u8 → variantes → mídia → 1º/2º segmento), faz **Range de 160KB** e extrai a resolução por dois caminhos: **H.264 em TS** (PAT→PMT→PID de vídeo→PES→NAL tipo 7→SPS com Exp-Golomb; sem PMT nos primeiros bytes ele **cai para o fallback de varrer todos os PIDs**) e **MP4** (varrer `avc1/avc3/hvc1/hev1/vp09/mp4v` e pegar a **maior** área válida — o `ftyp` do RTD tem preâmbulo não-padrão e o `avc1` real aparece centenas de bytes depois; o offset de width/height dentro do VisualSampleEntry **varia 2 bytes** entre arquivos, então o código varre `+20..+28` e valida por proporção). `videoResolutionToQuality(w,h)` classifica **pela LARGURA** (1280x736 = 720p, 1920x832 = 1080p — crop vertical não engana, ao contrário de `resolutionToQuality` que usa o maior lado). O server chama isso em `fillMissingHlsQuality` → `probeStreamQuality` (cache por URL, 400 entradas) **depois** do probe HLS de playlist (barato), então BLZ/SPC/ATO/SPT não gastam nada e só RTD/ATB/DGO pagam o probe. Sem o 1º segmento com IDR (o DGO corta no meio do GOP) o `maxTargets: 2` tenta o segmento seguinte
- Em falha de fetch/rede os scrapers LANÇAM o erro (nunca `return []` silencioso) — o servidor marca o resultado como degradado e cacheia por 60s em vez do TTL cheio de 6min (assinaturas SPT moram ~10-15min; TTL maior devolvia URL expirada → play dava 410)
- **Scraper lento não é descartado**: se o budget estoura com promessas pendentes, o settle tardio chama `patchLate()` → re-roda `buildResult()` e sobrescreve o cache com os streams atrasados
- **Host que exige `Referer` vazio**: o `nixplay.lat` (fonte VZR) responde **403 para qualquer valor** de `Referer` e aceita ausente ou `""` — como o `browserFetch` sempre manda Referer, o scraper passa `headers: { Referer: "" }`, que sobrescreve o default (o merge é `{...defaults, ...opts.headers}`). Sem isso a fonte inteira devolve `text/plain` e parece quebrada
- **Link direto por padrão (decisão 49)**: os streams saem com a **URL da origem**, não mascarados — o vídeo é baixado da **máquina de quem assiste**, então a origem vê o IP da pessoa (mais privado) e o servidor não gasta banda nem depende de egress. O `Referer` que cada origem exige vai em `behaviorHints.proxyHeaders` (o Stremio envia em celular/TV/desktop). **A máscara continua disponível**: `MASK_STREAMS=on` liga. Ligada, o stream vira `{addon}/stream/proxy?k=<token>&u=<b64>&r=<b64>` (HMAC-SHA256 de `exp|origin|referer`, `PROXY_SECRET`, TTL 6h, `timingSafeEqual` — sem token válido a rota devolve 403), HLS vai para o relay do worker, e a rota `/stream/proxy` tem **resgate**: se o servidor não alcança a origem (`originReachable`, cache 5min) ele responde 302 — pelo worker quando o worker alcança (`workerCanReach`), direto quando não. Com a máscara desligada, `maskStreamUrls`/`maskTvUrls` não rodam, `applyStreamProxy` devolve a URL crua, o relay de anime HLS não é aplicado, `playerflix` não relaya, `embedtv` não gera a variante Relay e `/stream/hls` devolve a playlist crua.
- **Probe de qualidade tem limite de rede**: a medição real (`probeResolution` e, se falhar, `probeViaWorker`) precisa que o **servidor** leia ~1 MB do vídeo. Isso funciona da VPS DE e em rede local, mas **da prod o `cnn.radiogaucha.fun` (RTD) responde `Upstream 403`** — a prod não alcança nenhum host do RTD e o PoP do Cloudflare que a atende é recusado pela WAF. Resultado: **RTD aparece sem rótulo de qualidade na prod** (o vídeo toca). Não é bug: mesma URL (md5 conferido) e mesmo `ref` dão 206 de um lado e 403 do outro. `probeViaWorker` tenta `/proxy` 2× + `/relay/s` antes de desistir. Para destravar: `BR_RELAY_URL` (o relay BR foi feito para isso) ou trocar a origem do probe.
- **Link de origem sempre direto e nunca `localhost`**: os streams vão com a **URL da origem**. `videoBases()` (xtream) só aceita base `http(s)://host` válida e devolve **lista vazia** quando não há — lista vazia significa "entregar o link direto", nunca `http://localhost:PORT` (que ia para o cliente e quebrava). A rota `/stream/proxy` usa **`req.protocol + req.get("host")`** como reserva, nunca `localhost`. `panelStreamVariants` só cria a 2ª variante quando a URL **realmente** muda.
- **Fonte que exige `Referer` ganha 2ª variante**: RTD (206 com / **403 sem**) e DGO exigem `Referer`. O servidor adiciona uma variante `🔗 sem precisar de Referer` passando pelo **worker** (`/relay/s` para MP4, `/relay/m` para HLS, com `?ref=`), que injeta o Referer — é o que faz essas fontes tocarem no **Nuvio/web**, que ignora `behaviorHints.proxyHeaders`. Só entra para `NEEDS_REFERRER` (rtd, dgo) para não poluir a lista.
- **Fonte que o site bloqueia para datacenter vira falha explícita**: o `play-link` do RTD responde `{"error":"turnstile_required"}` (3/3) — o vídeo ainda toca, mas o servidor não descobre vídeo novo. O scraper **lança** `rtd bloqueado (turnstile)` (antes devolvia `[]` e o motor achava que a fonte estava saudável, chamando sem parar). Mesma política do `kakito.xyz`, que devolve `MySQL: Connection refused` (6/6, direto e via worker) para IP de datacenter.
- **Catálogo de painel IPTV tenta 3× (decisão 54)**: `fetchListWithRetry()` (xtream) refaz o catálogo de filmes/séries de cada painel 3 vezes (250ms, 500ms) antes de desistir. Sem isso os 4K "desapareciam" — não era filtro, era o painel respondendo vazio (`MySQL: refused` / `vod_streams: []`) e o item sumindo só naquela consulta. Com o retry o mesmo título sai **constante** (medido: 12 streams e 3× `2160p` de SPC+ATO+KKT).
- **Worker: `?ref=` em TODAS as rotas que pegam origem** (`/proxy`, `/rde/seg`, `/relay/s` e `/relay/m`). Já quebrou uma vez: a variante "sem Referer" apontava para `/relay/s?ref=…` e a rota **ignorava** o parâmetro ⇒ 403 e o stream não tocava. O `/relay/m` precisa **repassar** o `ref` para os segmentos que ele reescreve, senão a playlist relayed perde o Referer no primeiro segmento.
- **Cuidado com `require` não importado**: `src/server.js` usa `browserFetch` e já usou sem importar por meses — o `ReferenceError` sumia no `catch` e só quebrava em prod (onde o probe direto falha por geo). O teste "todo require destruturado do server existe no modulo de origem" cobre isso; ao mexer no import do `server.js`, rode `node --test test/`.
- Proxy/relay: usar `src/lib/proxy.js` (`applyStreamProxy`, `relayM3u8Url`)
- AniList: as buscas de título são **sequenciais com fallback** (1 request no caso comum, até 4 só se as anteriores falharem) e a **2ª query de anime só roda se a 1ª voltou vazia** (`runAnimeQueries`)
- `matchVodTitle` ignora qualificadores (clássico/HD/remasterizado/dublado) mas **não** sequelas (Naruto Shippuden, Goblin Slayer, Matrix Reloaded seguem reprovados)
- Concorrência: streams/catálogo com **single-flight** (dedup de promise em voo) + **stale-while-revalidate** (`sqliteCache.getStale()`, grace 1h no `cleanup()`) — usuário nunca espera re-scan; streams com `expires=` no passado **nunca são servidos** (nem do cache nem do stale — `hasExpiredSignedUrl()` força recompute síncrono); xtream tem **circuit breaker por painel** (2 falhas → pulado5min — painel morto não segura o `allSettled` nem estoura o budget); resolução de id que falha cacheia vazio 60s (não martelar AniList → 429); fase de scrapers recebe o budget restante (`SCRAPER_TIMEOUT_MS − elapsed`)
- Anime: `isLikelyAnime()` **OU** gênero TMDB 16 (Animation) + origem JP (`getTvDetail` expõe `genreIds`/`originCountry`)
- JSON exceto `/stream/`: `Cache-Control: public, max-age=120`; `/stream/` (json + redirect do relay) e `/health` + `/metrics`: `Cache-Control: no-store` — a zona Cloudflare do BeamUp faz **edge-cache de JSON até 4h** e reescreve `Cache-Control` do origin para `max-age=14400` (`cf-cache-status` HIT/MISS visíveis); sem `no-store` o edge congela streams (saiu HIT de 70min com URLs relativas de um boot antigo) **e o `/health`** (uptime aparente congelado — o health sem header era cacheado pelo edge). **Armazenar**: entradas antigas no edge só expiram pelo TTL (não há purge — é a infra do BeamUp).
- UI: `public/install.html` + `public/dashboard.html` em preto `#08080a`/vermelho `#e50914`, CSS puro **sem CDN**; `public/logo.svg` = símbolo do Stremio (Simple Icons CC0) em vermelho sobre escudo preto

## Formato do objeto stream

```javascript
{
  id: "fonte:identificador:episodio",
  type: "series" | "movie",
  name: "Mirror 1080p",
  title: "🎬 Matrix (1999) · 1080p · BLZ",   // vodTitle() — filme: nome+ano+qualidade+fonte
  // title: "🎬 Breaking Bad · S01E01 · 720p · SPC",  // série: nome+SxxEyy+qualidade+fonte
  // title: "📺 HBO · EMB\n🌎 Português",     // tv ao vivo: nome+fonte inline; o ranker reescreve e add a linha de idioma
  url: "https://...",          // HTTP stream (HLS/mp4)
  episode: 9,
  season: 1,
  dubbed: true/false,
  portuguese: true/false,
  subtitle: true/false,
  quality: "1080p",
  size: 0,
  sources: ["fonte"],
  subtitles: [{ lang: "por", url: "...", title: "PT-BR" }],
  behaviorHints: { notWebReady: false, bingeGroup: "mirror", live: true },
}
```

Helpers em `src/lib/stream.js`: `makeHttpStream()` cria o objeto com os padrões do projeto; `vodTitle({ name, year, type, season, episode, quality, source })` monta o título padronizado (emojis `🎬` + `·` como separador; `source` maiúsculo). `notWebReady` é derivado dos `headers` (o padrão: com headers → true, sem → false) mas pode ser **passado explicitamente** — obrigatório para URL `http://` **sem** headers (o KKT entrega `http://kakito.xyz:80/...` cru; o Stremio recusa/instala em clientes Android/TV sem a flag). O ranker (`rankAnimeStreams`) re-escreve títulos mas mantém a linha quando já contém a fonte; o server acrescenta a linha de idioma (`🌎 Português` / `🧩 Legendado`) — as flags `dubbed/portuguese/subtitle` também entram na assinatura do dedup de display.

## Deploy (BeamUp / Dokku)

```bash
# 1. Chave SSH — MEDIDO 02/10/2026: o repo GitHub vivo e' mrrobots777/mirror (remote `novo`).
#    `devavmirror/mirror` NAO EXISTE mais (`gh repo view` -> "Could not resolve") e o remote
#    `origin` aponta para ele: `git push origin` falha com "Repository not found".
#    O ssh do github.com usa id_ed25519_mr777 (config: Host github.com) — a chave antiga
#    id_ed25519_mirror ja esta em devavmirror e o GitHub recusa a mesma chave em 2 contas (422).
ssh-keygen -t ed25519 -C "mrrobots777"
gh auth login                    # scopes: gist read:org repo + admin:public_key
gh ssh-key add ~/.ssh/id_ed25519_mr777.pub -t mirror-workstation

# 2. Sincronizar as chaves GitHub no servidor dokku (obrigatório depois de add/renovar chave)
beamup config a.baby-beamup.club devavmirror

# 3. Publicar no GitHub (branch main -> `master` + `gh-pages`; `main` ja faz tracking de
#    `novo/master`, entao o comando simples resolve). O `gh-pages` e' o que o Pages le:
#    em modo `workflow` o ambiente so aceita deploy pela branch `gh-pages`.
git push --force-with-lease novo HEAD:master
git push --force-with-lease novo HEAD:gh-pages

# 4. Deploy do servidor — o push NÃO auto-deploya
git push beamup HEAD:master --force        # build usa o Dockerfile (= beamup deploy)
git push dokku@a.baby-beamup.club:e75602c18409/mirrorhub2 HEAD:master --force   # cluster de TV — manter em sync

# 5. Verificação
curl https://e75602c18409-mirrorhub.baby-beamup.club/health
ssh dokku@a.baby-beamup.club logs e75602c18409-mirrorhub -n 50   # = beamup logs
```

- **CI em todo push** (`/.github/workflows/testes.yml`): sintaxe do server/scrapers CommonJS,
  sintaxe do worker (**ESM — `node -c` nele dá SyntaxError**, por isso o passo separado), a
  barreira `node --test test/` e um **piso de contagem** (hoje **285**) para pegar teste que
  "sumiu". Rode local com `node --test test/` antes de pushar.
- **O site do plugin** (`https://mrrobots777.github.io/mirror/`) é publicado por
  `/.github/workflows/publicar-pages.yml` — vê `nuvio/STATUS.md` §5 (duas armadilhas medidas
  lá: `path` do artefato tem de ser `nuvio/public`, e o environment só aceita `gh-pages`).
- **ATENÇÃO — o que está no GitHub e o que está na prod podem divergir.** Medido 02/10/2026:
  a prod respondia `capacity.scraperSources: 10` e ainda entregava `streams` de TV, ou seja,
  rodava o código **pré-154/155**, enquanto o repositório já tinha as duas decisões. O push
  para o GitHub **não** faz deploy (item 4).

- **Hash novo (decisão 154): `e75602c18409`**, apps **`mirrorhub`** (app1, VOD/catálogo) e
  **`mirrorhub2`** (cluster de TV). O nome antigo `c12e41ddc21b-mirror`/`-mirror2` está nas
  decisões antigas deste arquivo como registro histórico do que foi medido — não é o endereço
  atual.
- `git ls-remote beamup` → `unsupported command` (só push/receive-pack é aceito).
- **O scheduler executa `node /start web`** — o `Dockerfile` copia `beamup-start.js` → `/start` (`COPY` + `chmod +x`); sem isso o container entra em loop de `Cannot find module '/start'` e a URL responde 504. O lançador loga argv/env no boot (`[beamup-start] ...`).
- Env do container = **só a do `Dockerfile`** + `PORT` injetada (6009): `config:set` aceita **1 variável por chamada**, reporta sucesso mas **não reinicia nem injeta** no serviço — valor novo exige novo deploy. Por isso `PUBLIC_BASE_URL` está fixada no `Dockerfile` (sem ela o gateway reescreve `Host` para `localhost`, o guard do auto-detect rejeita e as URLs saem **relativas** → quebra TV ao vivo).
- **Gateway/Cloudflare responde 504 em ~12s** → `ENV SCRAPER_TIMEOUT_MS=9000` (default do código = 20s, usado em local/PM2). Request frio de catálogo/meta/stream pode 504 na 1ª chamada e cacheia em background — repetição responde em <1s.
- Healthchecks do Dokku no deploy: port listening + uptime 10s + `beamup-lint` (valida manifesto Stremio).
- Servidor: `process.env.PORT || 3000`, bind `0.0.0.0` (o Dokku injeta a porta).
- Credenciais IPTV/TMDB/worker têm default no código — nenhuma env extra obrigatória (`REDIS_URL`/`ADMIN_TOKEN` opcionais).
- Container: `Dockerfile` (CMD node direto p/ SIGTERM chegar no app, `USER node`, `DATA_DIR=/tmp`, `NODE_OPTIONS=350`, `SCRAPER_TIMEOUT_MS=9000`, `PUBLIC_BASE_URL`). Shutdown drena conexões (cap 60s).
- Sem browser no projeto (scrapers HTTP) — flags de headless (`--no-sandbox` etc.) só se adicionar Playwright/Puppeteer.

### Arquivos de deploy
| Arquivo | Descrição |
|---------|-----------|
| `Dockerfile` | Build do addon (BeamUp/Dokku) — inclui `/start`, `SCRAPER_TIMEOUT_MS`, `PUBLIC_BASE_URL` |
| `wrangler.toml` | Config do worker genérico `mirror-cdn` (`npx wrangler deploy`). Leva `[placement] region = "aws:sa-east-1"` (decisão 123) — **medido: a dica é aceita e gravada, mas não se aplica nesta conta** (até Tóquio deu WAW), então o RTD depende do Smart Placement do `mirror-rtd` |
| `deploy-workers.sh` | **Um worker por fonte** (decisão 124): publica os 16, e a lista sai do registro único (`WORKERS` em `core/nomes.js`) — nunca escreva `mirror-<fonte>` na mão. `./deploy-workers.sh rtd` publica um só. Só o RTD recebe `[placement] mode = "smart"`. Credencial: `CLOUDFLARE_API_TOKEN` ou `~/.cloudflare-token` (token **de conta** — `/user/tokens/verify` diz "Invalid API Token" mesmo com token bom) |
| `deploy/nginx-kak.conf` | **nginx na FRENTE do painel, servindo de CDN** (`144.33.21.1:8443`, relay passou para `8444`). `proxy_cache_lock` (1 ida a origem por arquivo, 6 pessoas -> 1) + `keepalive 4` (nunca rajada) + cache em disco 12 GB. Chave de cache **sem o token**. `/cdn/` so aceita `/hlsr/<token>/MirrorPrincipal/…` (403 no resto) |
| `br-relay.js` | Relay BR na porta8443 (RTD/KKT contra WAF/geo; **só dev** — prod sem caminho Oracle) — systemd `mirror-br-relay` no dev |
| `beamup-start.js` | Lançador copiado para `/start` (scheduler BeamUp roda `node /start web`) |
| `Procfile` | `web: npm start` (fallback p/ buildpack herokuish) |
| `Dockerfile.relay` | Build do relay (app opcional) |
| `DEPLOY.md` | Passo a passo BeamUp |
| `ecosystem.config.js` | Config PM2 legado (addon) |
| `relay-ecosystem.config.js` | Config PM2 legado (relay) |
| `deploy.sh` | Deploy PM2 legado |
| `relay-deploy.sh` | Deploy PM2 legado (relay) |
| `sync-iptv.sh` | Sync iptv.db entre VPSs |
| `cluster-health.sh` | Monitor de saúde |
| `.env.example` | Template de config |

### O nginx na frente do painel (decisao 107)

O relay **nao escuta mais na 8443**: ele desceu para a **8444** e o **nginx ficou na 8443, na frente dele**, repassando `/token`, `/pl/verificar` e `/pl-stats`. Motivo: nao abrir porta nova (a 8443 ja estava liberada e nao depende da Oracle security list) e o nginx passar a ser a primeira coisa que o mundo ve.

```bash
sudo cp deploy/nginx-kak.conf /etc/nginx/sites-available/mirror-kak
sudo ln -sf /etc/nginx/sites-available/mirror-kak /etc/nginx/sites-enabled/mirror-kak
sudo rm -f /etc/nginx/sites-enabled/default
sudo mkdir -p /var/cache/nginx/kak && sudo chown -R www-data:www-data /var/cache/nginx
sudo systemctl reload nginx
```

**O que o nginx compra, medido:** 6 pessoas no mesmo canal no mesmo instante = **1 ida a origem e 5 do disco** (6/6 com video em 1 s); 2a leitura do mesmo arquivo em **36 ms**; e o cache **sobrevive a rotacao de token** porque a chave ignora o token que esta dentro do caminho. **O que ele NAO compra:** mais canais diferentes ao mesmo tempo — isso e o teto de 2 conexoes e os 26 Mbps do painel, e nao ha truque de servidor que mude.

Pegadinhas ja pagas (nao repetir):
- `proxy_pass` **nao aceita URI dentro de location de expressao regular**. A restricao de caminho do `/cdn/` e por `location ~`, entao o `/cdn` e tirado com `rewrite ^/cdn(?<rest>/.*)$ $rest break;` e o `proxy_pass` fica sem barra.
- **Recusa nao se guarda em cache.** `proxy_cache_valid 403/404` transforma um tropeco do painel (que e momentaneo) num estado grudento; apareceu `X-Mirror-Cache: STALE` servindo 403 com a origem ja recuperada. So `200` entra.
- **Sem `slice`.** Com fatia de 1 MB o nginx pede o arquivo a origem uma vez POR FATIA (3 pedidos para 2,88 MB) e ignora `Range`. E o pior formato possivel contra um painel de 2 conexoes.
- `Range` volta 200 inteiro, nao 206, porque **a origem ignora `Range`**. Nao e bug.
- **A lista do relay vem com URL ABSOLUTA** (`http://206.109.57.195/hlsr/...`). Para montar o `/cdn` tem que passar por `new URL(u).pathname`; colar a URL inteira da 404.
