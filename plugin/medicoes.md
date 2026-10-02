# Medições — Mirror como plugin Nuvio

Medido em **01/10/2026** a partir deste servidor (**IP de datacenter**, egress BR). Tudo com
`curl --max-time 15`, credenciais/URLs lidas de `src/scrapers/*.js` e `src/core/fontes.js`
(defaults de env — nada inventado).

**Regra do sandbox (CONTRATO §3):** corpo da resposta **≤ 1 MB** (512 KB na quota `limited`),
nenhum cache entre invocações, 15 scrapers em 120 s (alvo **< 6 s** por busca).

Legenda da coluna "veredito": **sim** = cabe e tem caminho de busca; **sim (atenção)** = cabe mas
com um porém medido; **não** = não cabe ou não existe busca.

---

## shg — Otakulogia (`api.otakulogia.com`)

Como acha o título: **busca no servidor** (GraphQL POST).

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| `POST /graphql` `searchAnimes(input:{query:"naruto"})` | **4.209 B** | 1,02 s | SIM | **sim** |
| `POST /graphql` `searchAnimes(..."one piece")` | 5.513 B | 0,85 s | | |
| `POST /graphql` `animeCatalogDetail(cid=750)` — ONE PIECE, **877 episódios** | **310.248 B** | 1,27 s | n/a (por cid) | **sim** |

Maior resposta da fonte = o detalhe da série mais longa do catálogo: 310 KB, ainda 3x abaixo do teto.

---

## ron — AnimesDigital (`animesdigital.org`)

Como acha o título: **busca no servidor** (duas vias, as duas pequenas).

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| `/pesquisa/?s=naruto` → 301 → `/pesquisa/naruto/` | **142.155 B** | 0,46–0,70 s | SIM | **sim** |
| `chave/wp/v2/posts?search=naruto&per_page=20` (sem `_fields`) | 29.533 B | 0,39–0,47 s | SIM | **sim** |
| página do anime `/anime/a/nrtshp004` | 204.295 B | 0,62 s | n/a | sim |
| página do episódio `/video/a/321ba11` | 135.774 B | 0,35 s | n/a | sim |

A `/pesquisa/?s=` devolve **20 itens** com `class="itemA"` + `title_anime` (o parser atual casa).

---

## aon — animesonline.io

Como acha o título: o código atual usa **índice inteiro local** (`/anime/list-mode/`) + chute de
slug. **Existe busca** (`/?s=`), mas o parser atual não lê o formato dela.

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| índice `/anime/list-mode/` (2.482 títulos) | **735.648 B (718 KB)** | 0,88 s | — | **atenção**: < 900 KB mas **> 512 KB** da quota `limited` |
| busca `//?s=bleach` | **303.230 B** | 0,79 s | **SIM** | **sim** (ver abaixo) |
| busca `//?s=dragon ball` | 297.573 B | 0,99 s | | 7 itens |
| busca `//?s=naruto` | 296.423 B | 0,48 s | | 12 links de `/anime/` |
| página do anime pelo slug `/anime/naruto-shippuden-dublado/` | 428.102 B | 0,72 s | n/a | sim (504 `epl-num`, 500 `data-index`) |
| página do episódio `/31665/` | 446.152 B | 1,34 s | n/a | sim |
| token `anidrive.click/token/...` | 91.298 B | 1,09 s | n/a | sim |

**A busca existe e é legível — só por outro formato.** A página `/?s=` **não tem nenhum**
`class="series tip"` (0 ocorrências — o parser `parseSeriesIndex` acharia nada), mas traz um
**JSON-LD `ItemList`** com `url` + `name` de cada resultado:

```
{"@type":"ItemList", ... {"url":"https://animesonline.io/anime/bleach/","name":"Bleach"}, ...}
```

Medido: 10 itens (`bleach`), 7 (`dragon ball`). É o caminho do plugin — e dispensa o índice de 718 KB.

---

## atb — anitube.biz

Como acha o título: **busca no servidor** (REST do WordPress).

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| `wp-json/wp/v2/categories?search=naruto&per_page=20&_fields=...` | **1.232 B** | 0,48 s | SIM | **sim** |
| `wp-json/wp/v2/posts?search=naruto&per_page=20&_fields=id,title,slug,date` | 3.321 B | 1,12 s | SIM | **sim** |
| `wp-json/wp/v2/posts?categories=895&per_page=100&_fields=...` | 16.707 B | 0,32 s | por categoria | sim |
| `wp-json/wp/v2/posts/792750?_fields=...content` (aqui mora o `.m3u8`) | 2.102 B | 0,32 s | n/a | sim |

---

## spt — playerflix.ink

Como acha o título: **não busca** — joga pelo **id TMDB** que o Nuvio já entrega.

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| `inc/Ajax.php?type=movie&id=603` (com `Referer` + `X-Requested-With`) | **1.071 B** | 0,56 s | **NÃO** | **sim** |
| `inc/Ajax.php?type=search&id=matrix` | 16 B (`{"status":false}`) | 0,24 s | não existe | — |
| página do embed `v1.watchplay.shop/movie/603` → `v2.watchplay.shop/...` | 2.566 B | 0,49 s | n/a | sim |

---

## blz — Blaze / kakito.xyz (painel Xtream)

Como acha o título hoje: **catálogo inteiro local** (SQLite no servidor, decisão 136).

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| `player_api.php?action=get_vod_streams` | **4.997.977 B** (4,77 MB) | 2,54 s | — | **não** |
| idem, com `Accept-Encoding: gzip` (bytes na rede) | **782.897 B** (765 KB) | 2,07 s | | ver nota |
| `action=get_series` | 4.453.832 B | **11,0 s** | — | **não** (e > 6 s) |
| `action=search&query=matrix` | 453 B | 0,78 s | **NÃO** | resposta = só `user_info`+`server_info`, **zero itens** |
| `action=get_vod_streams&search=matrix` | 4.997.977 B | 2,47 s | não | parâmetro **ignorado** |
| `action=get_vod_streams&tmdb_id=603` / `&query=matrix` | catálogo inteiro | 2,08 s | não | ignorados |
| `panel_api.php?action=search&query=matrix` | 7.444.509 B | 2,58 s | não | devolve catálogo |
| `action=get_vod_info&vod_id=1` | 1.092 B | 0,52 s | não | precisa do `stream_id`, não resolve por TMDB |
| `Range: bytes=0-1000` em `get_vod_streams` | 4.997.977 B (200) | 1,42 s | — | **Range ignorado** |
| `kakito.xyz/` (raiz) | 302 → **google.com** | 1,03 s | — | domínio estacionado: **não há portal web com busca** |

**Nota sobre gzip:** o corpo **decodificado** continua 4,77 MB. Se o teto de 1 MB do sandbox for
sobre o corpo decodificado (o provável — é o OkHttp que lê), o gzip **não salva**. Se for sobre os
bytes da rede, 765 KB **entraria** na quota normal mas **não** na `limited` (512 KB). **Apenas
testável no aparelho.**

---

## spc — Space / telaplay93.top (painel Xtream)

Como acha o título hoje: **catálogo inteiro local**.

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| `player_api.php?action=get_vod_streams` | **30.641.678 B** (29,2 MB) | 2,32 s | — | **não** |
| idem, gzip (bytes na rede) | **7.959.947 B** (7,6 MB) | 3,12 s | | **não** |
| `action=get_series` | 7.938.195 B | 0,47 s | — | **não** |
| `action=search&query=matrix` (também `&title=`, `&name=`, `&type=vod`) | 540 B | 0,04–0,27 s | **NÃO** | só `user_info`+`server_info` |
| `action=get_vod_streams&search=` / `&query=` | 30,6 MB | 1,67 s | não | ignorados |
| `action=get_vod_categories` | **2.127 B** (30 categorias) | 0,06 s | — | sim (pequeno) |
| `action=get_vod_streams&category_id=632` (⚡ Lançamentos) | **688.797 B** / 701 itens | 0,99 s | por categoria | cabe, mas ver "em risco" |
| `action=get_vod_streams&page=1` vs `page=2` | 30.641.678 B (iguais) | 2,19 s / 2,92 s | — | **sem paginação** |

---

## ato — Autos / 4x4u29c.autos (painel Xtream)

Como acha o título hoje: **catálogo inteiro local**, e **a API só é alcançada pelo worker**
(AGENTS: "só egress DE; API via worker").

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| **direto**, `action=get_profile` | 235 B = **página "Welcome to nginx!"** | 0,22 s | — | **IP de datacenter não fala com o painel** |
| **direto**, `action=get_vod_streams` | 235 B (nginx welcome) | 0,21 s | — | idem |
| **direto**, `action=search&query=matrix` | 0 B / **HTTP 000** | **30,0 s (timeout)** | — | trava |
| **direto**, `action=get_vod_categories` | HTTP 000 | 10,0 s (timeout) | — | trava |
| **via worker** `mirror-ato.dev-avmirror.workers.dev/proxy?url=...action=get_vod_streams` | **12.479.225 B** (11,9 MB) | 1,74 s | — | **não**; **o worker ignora `Range`** (mandei `bytes=0-100000`, veio o arquivo inteiro) |
| **via worker**, `action=search&query=matrix` | 485 B | 0,48 s | **NÃO** | só `user_info`+`server_info` |

O caminho do plugin é **direto do aparelho** — e deste servidor o painel devolve página padrão do
nginx ou trava. Não dá para afirmar que o aparelho (IP residencial) recebe a mesma coisa; é o
único ponto da fonte que **não pôde ser provado daqui**.

---

## kkt — Kakito (M3U `get.php`)

Como acha o título hoje: **playlist inteira em SQLite local** (192 mil itens, decisão 136).
É o **mesmo painel do BLZ** (`kakito.xyz`, `MirrorPrincipal`/`ditj7j1h`).

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| `get.php?username=...&password=...&type=m3u_plus&output=ts` | **51.167.632 B (48,8 MB)** | 5,62 s | — | **não** |
| `-r 0-2048` (Range) | 51.167.632 B (200) | 5,62 s | — | **Range ignorado** |
| `Accept-Encoding: gzip` | 51.167.632 B (arquivo idêntico) | 5,65 s | — | **gzip ignorado** |
| `&search=matrix` / `&action=search&query=matrix` / `&category=Filmes` / `&category_id=1` | 51 MB (cortado por `--max-filesize`) | 3,8–5,3 s | **NÃO** | parâmetros **ignorados** |

---

## rtd — RedeToons (`redetoonstv.win`)

Como acha o título: **id TMDB direto** (não precisa de catálogo); o `catalog-index` é só um portão.

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| `api/catalog-index` (portão: quais ids existem) | **34.174 B** | 0,48 s | — | **sim** |
| `api/play-link?contract=3&tmdbId=603&type=movie` (Referer `redetoons.win/`) | **861 B** | 0,73 s | não precisa | **sim** — **HTTP 200 do IP de datacenter** |
| `api/play-link?contract=3&tmdbId=1396&type=tv&season=1&episode=1` | 935 B | 0,56 s | | sim |
| `api/play-link` com `id=` em vez de `tmdbId=` | 23 B (`{"error":"bad_request"}`) | 0,09 s | | parâmetro é `tmdbId` |

---

## dgo — Doramogo (`doramogo.net`)

Como acha o título: **busca no servidor**.

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| `/search/?q=coração` (7 resultados) | **24.883 B** | 0,27 s | **SIM** | **sim** |
| `/search/?q=destino` (4) / `goblin` (1) / `papel` (1) | 17.379–20.963 B | 0,27–0,46 s | | sim |
| `/search/?q=crash landing on you` | 16.979 B | 0,82 s | | "Nenhum dorama encontrado" — **termo fora do catálogo**, não é bloqueio |
| `/?s=crash` | 61.430 B = **home** | 0,29 s | não | `?s=` é **ignorado** — o parâmetro é `q` em `/search/` |
| página da série `/series/o-sabor-do-destino` | 40.419 B | **4,41 s** | n/a | cabe, mas **1ª chamada lenta** (perto do teto de 6 s) |

O parser `parseSearch` casa (`<a href=".../series/slug">` seguido de `<img alt="...">`) — medido no
HTML real.

---

## vzr — Vizer (`vizer.autos` → `nixplay.lat` → CDN)

Como acha o título: **id TMDB** (a API deles devolve a URL; e o caminho também é derivável).

| endpoint-chave | tamanho | tempo | tem busca? | veredito |
|---|---|---|---|---|
| `POST vizer.autos/wp-json/api/v1/player` `type=movie&tmdb=603` | **654 B** | 0,59 s | não precisa | **sim** |
| idem `type=episode&tmdb=1396&season=1&episode=1` | 757 B | 0,57 s | | sim |
| cadeia `nixplay.lat/movie/testelogado-vods/GwXanZ3Dj/603.mp4` | 302 em <0,3 s | 0,28 s | n/a | **sim** |
| … destino `cdn99xn----booster.anipixel.best` **sem Referer** | **HTTP 429** | 0,28 s | | **3 de 3 tentativas = 429** |
| … destino R2 assinado **com `Referer: https://vizer.autos/`** | **206** + `Content-Range: bytes 0-1024/818559482` | 0,47 s | | **funciona** |

**Pegadinha medida:** o AGENTS registra `Referer: ""` para o `nixplay.lat` (403 com qualquer
valor). Aqui, **sem o header veio 429** do CDN deles e **com `Referer: https://vizer.autos/`
veio 206** do R2. Os dois saltos são hosts diferentes — o `Referer` que importa é o do **segundo**
salto. Anotar como está e testar no aparelho; não mudar nada com base só nesta máquina.

---

## TV ao vivo — `rei emb etc rcd` (medido 01/10/2026, 48 canais)

Todas as respostas de TV são **pequenas** — o teto de 1 MB não é problema em nenhuma delas.
O que pesa é o **número de saltos** (a cadeia do REI são 4) e o tempo.

### O mapa de canais (`src/lib/canais.js`, gerado por `tools/gerar-canais.js`)

O NuvioTV só deixa plugin rodar em **id numérico** e o id não tem nome nenhum: o mapa traduz
`1001…` → slug de cada fonte. Gerado de verdade (4 catálogos + home do EMB), nunca à mão.

| fonte | endpoint | tamanho | canais |
|---|---|---|---|
| REI | `reidosembeds.online/api/channels` | **233.093 B** | **327** (numero 1001–1327) |
| EMB | `embedtv.lat/api/channels` | 37.069 B | 147 (`/api`); home tem 145 |
| ETC | `apisinalpublico.vercel.app/canais.json` | 24.975 B | 147 |
| RCD | `api.reidoscanais.st/channels` | 159.165 B | 110 |

`porSlug` tem **396** canais (os 327 do REI + 69 que só outra fonte tem) e `porNumero` vai de
**1001 a 1396**. O arquivo tem **51.264 B** (gzip **9,3 KB**).

**O slug é o mesmo nas quatro para o mesmo canal** — o que muda é o NOME, e foi isso que o mapa
resolver. Medido com a regra do AGENTS (nome normalizado; slug só entre nomes compatíveis por
palavra de 3+ letras ou prefixo):

| fonte | casou pelo nome | casou pelo slug | slug diferente do REI |
|---|---|---|---|
| EMB | 15 | 91 | 16 |
| ETC | 15 | 91 | 16 |
| RCD | 15 | 85 | 15 |

Os 47 slugs diferentes são o que a porta nova **`embedcanaisdetv.xyz`** e os nomes do
`bolodechocolate.fit` exigem — por exemplo `cazetv2`→`caze2`, `discoverytheater`→`discoverytheather`,
`canalbrasil`→`canal-brasil`, `cancao-nova`→`cancaonova`. Sem o mapa, esses 47 dariam `[]` mesmo
tendo o canal.

### Cadeia de cada fonte (medida, com o relógio)

| fonte | saltos | tempo típico | pior medido |
|---|---|---|---|
| **REI** | 4: `v2.rdembed.sbs/<slug>` → `/__play/` → `<iframe>` → `POST <host><ref>` | **1,5–2,5 s** | 4,0 s |
| **EMB** | 2: catálogo → página do canal → `.txt` no CDN (ou o chute `PLAYLIST_FALLBACK`) | **0,8–1,2 s** | 1,2 s |
| **ETC** | 3: `embedcanais.online` (156 canais) → `embedcanaisdetv.xyz` → `.m3u8` | 1,5–2,4 s | 2,4 s |
| **RCD** | 3: `api` → `rdcanais.net/<slug>` → `<iframe>` → `.m3u8` (via `extrator.js`) | 0,3–4,3 s | 4,3 s |

**AETC tem um furo medido:** 23 dos 147 canais dela (`afazenda`, `aparecida`, `bandrj`…) **não
existem** no `embedcanais.online`, e o `?canal=` da porta nova **não aceita o slug antigo** — o
catálogo novo é uma lista de 156 com os **próprios** slugs, e `afazenda` lá é outra coisa. Com a
regra do AGENTS (nome normalizado), 41 canais da ETC **não têm slug** na porta nova: cai para as
3 CDNs antigas, que hoje devolvem **404**.

### A prova de vida, e o que ela não prova (importante)

Medi o **primeiro segmento** de cada canal, com a contagem de byte `0x47` do MPEG-TS
(o preâmbulo de 67–139 bytes do CDN empurra o alinhamento, então a contagem é feita na melhor
das 188 fases — sem isso o RCD dá `sync=0` e parece quebrado).

| fonte | canais testados | playlist **com** segmento | 1º segmento 200/206 | `[ ]` |
|---|---|---|---|---|
| **REI** | 12 | **12/12** (sempre 3) | **7/12** | 0 |
| **EMB** | 12 | **11/12** (5–6) | **11/11** | 1 (`sbt`, não existe no EMB) |
| **ETC** | 12 | **0/12** | — | 12 |
| **RCD** | 12 | **7/12** (10) | **7/7** | 5 |

**ETC: 0 de 12, e o motivo não é a origem.** O CDN `cdn10embed.xyz` responde **403 para o IP de
datacenter** em **5 de 5** combinações de `Referer`/`UA`/`Origin`/`Sec-Fetch`, e as 3 CDNs antigas
respondem **404**. Já está no AGENTS (decisão 152: "o 403 não é de geografia, e o proxy em Worker
não resolve"). O caminho está escrito e correto; **daqui não dá para provar que o aparelho do
usuário (IP residencial) passa** — é a única fonte das 4 que ficou sem prova.

**REI: os 5 "FALHOU" são o `403` de datacenter do CDN de segmentos, não a playlist.** A playlist
responde `200` com 3 segmentos nos **12 de 12**; o que volta `403 text/html` (4.465 B, a página
"Anonymous Proxy detected" do Cloudflare) é o **segmento**, e só de alguns hosts — os mesmos
canais que passaram minutes antes. É o sintoma que o AGENTS descreve: **isto não deve afetar o
usuário**, porque quem baixa o segmento é o aparelho dele. Não dá para provar daqui.

**RCD: o token vive poucos minutos** (o AGENTS já media isso). Os 5 `[]` são `playlist HTTP 403`
(token de origem que recusa) e `player sem m3u8` — o player `pescaplay.store` do `rdcanais.net`
**não traz a URL no HTML** (entrega JWPlayer com `temErro = true` e `streamUrl = ""`), ou seja, é
a página do fornecedor que não tem o vídeo, não o nosso parser. Os 7 que passaram entregam
**H.264 720p** (`ffprobe`: `h264,1280,720` + `aac`).

### O que o `relay` resolvia e aqui não existe

O `relay` (`/stream/hls/`) fazia três coisas que **não têm equivalente no plugin**:

1. servia a playlist como `application/vnd.apple.mpegurl` — o REI entrega `__index.txt` como
   `text/plain`; **medido: o Nuvio/ExoPlayer do aparelho decide**, não dá para provar daqui;
2. reescrevia cada segmento para um endereço que injeta o `Referer` (a ETC e o RCD exigem);
3. dava **token novo a cada ida** (o do REI vale 300 s, o do RCD alguns minutos) — no plugin o
   link é resolvido a cada `getStreams`, que é o mesmo efeito.

O item 2 é o único com perda real: por isso **ETC e RCD devolvem o `Referer` no campo `headers`**,
que é o que o player do Nuvio manda (CONTRATO §2).

---

# Fontes em risco (não cabem em 1 MB / falta busca)

| fonte | quanto passa | por quê | alternativa encontrada |
|---|---|---|---|
| **kkt** | **51,2 MB** (56x o teto) | M3U único, **sem Range, sem gzip, sem parâmetro de busca** (os 4 testados ignorados) | **Sem alternativa pela origem.** É o **mesmo painel do BLZ** (`kakito.xyz` + credenciais iguais) → no plugin, **não manter KKT como fonte separada**: ou ele some, ou vira o mesmo código do BLZ. Baixar 48 MB por invocação é impossível. |
| **spc** | **30,6 MB** (gzip 7,6 MB) | sem busca (`action=search` devolve só `user_info`), sem paginação, sem Range | **Sem alternativa — precisa de estudo adicional.** Único achado: `get_vod_streams&category_id=` devolve **688 KB / 701 itens**, mas não existe índice **título → categoria**; buscar nas 30 categorias = baixar o catálogo inteiro. |
| **ato** | **12,5 MB** (via worker) | sem busca; **worker ignora `Range`**; do datacenter o painel devolve página do nginx | **Sem alternativa — precisa de estudo adicional.** Duas pendências: (1) provar que o **aparelho** alcança o painel direto (aqui não provou); (2) achar busca/índice. Se o worker passar a **respeitar `Range`**, ainda não resolve: JSON não é pesquisável por fatia. |
| **blz** | **4,77 MB** (gzip **765 KB**) | sem busca (`action=search&query=` → 0 itens), Range ignorado | **Meia alternativa:** com `gzip` os bytes na rede ficam em **765 KB** — cabe no teto de 900 KB, **não** na quota `limited` de 512 KB, e **não** se o teto for do corpo decodificado (provável). **Testar no aparelho é a única forma de decidir.** Senão: mesma conclusão dos outros — sem alternativa. |
| **aon** (só o índice) | 735,6 KB | passa dos **512 KB** da quota `limited` | **Alternativa encontrada:** **não usar o índice**. A busca `/?s=<q>` (**296–303 KB**) traz um **JSON-LD `ItemList`** com `url`+`name` (medido: 10 e 7 itens) — parser novo, e dispensa os 718 KB. Reserva: chute de slug (`/anime/<slug>-dublado/`, 428 KB) como o código já faz. |
| **shg** (só o detalhe) | 310 KB no pior caso | — | Não está em risco: ONE PIECE (877 eps) mediu 310 KB / 1,27 s. |
| **dgo** (tempo, não tamanho) | 4,41 s na página da série | perto do alvo de 6 s | Deixar o `fetch` com timeout de 6–8 s e tratar timeout como "sem resultado" (nunca como "fonte morta"). |

## O que NÃO é risco (medido < 900 KB e < 6 s)

`shg` (4,2 KB busca · 310 KB detalhe) · `ron` (142 KB busca · 204 KB anime · 136 KB ep) ·
`atb` (1,2 KB categorias · 3,3 KB posts · 2,1 KB conteúdo) · `spt` (1,1 KB por id TMDB) ·
`rtd` (34 KB portão · 861 B play-link) · `dgo` (25 KB busca) · `vzr` (757 B API) ·
`aon` pela via de busca (303 KB) — **7 das 12 fontes VOD/anime/dorama estão prontas.**

## Resumo do caminho sugerido por fonte em risco

1. **kkt** → unificar com BLZ (é o mesmo painel) ou remover. Nenhum caminho pela origem.
2. **spc / ato / blz** → sem busca na origem. Próximos passos, em ordem de custo:
   (a) **medir no aparelho** se o teto de 1 MB é do corpo decodificado ou dos bytes da rede — se
   for da rede, **blz já entra** (765 KB gzip); (b) verificar se existe endpoint de busca que não
   seja `player_api.php` (testado: `search`, `get_vod_streams&search/query/tmdb_id`, `panel_api`,
   `page=`, `Range` — todos ignorados ou vazios); (c) se nada disso existir, **estudo adicional**:
   só um índice próprio (fora do contrato "só plugin, sem servidor") resolve.
3. **aon** → trocar o índice por `/?s=` + JSON-LD (medido e pronto para portar).

---

# Rodada de 02/10/2026 — MIME, orçamento e reserva

Ferramentas novas em `nuvio/tools/`: `mime.js` (reproduz a regra do Nuvio sobre URLs reais),
`prova-formato.js` (o `format=m3u8` muda a resposta da origem?), `casos.js`, e as baterias
`bateria.js` / `bateria-tv.js`.

## O Nuvio decide o tipo pelo CAMINHO da URL (`mime.js`)

`PlayerMediaSourceFactory.kt` (976–1070): `inferMimeTypeFromUrl` (caminho) primeiro;
`inferMimeTypeFromQuery` (query) só quando o caminho não diz nada; `proxyHeaders.response` é
**nulo** para scraper. `FONTES=rei,emb,etc,rcd node tools/mime.js`:

| fonte | URL | antes | depois (`sinaliza`) |
|---|---|---|---|
| rei | `…/docs/<slug>/__index.txt?token=…` | `.txt` → **progressivo** ✗ | `+format=m3u8` → **HLS ✓** |
| emb | `…/*.txt` | `.txt` → **progressivo** ✗ | `+format=m3u8` → **HLS ✓** |
| etc | `…/*.m3u8` | já HLS ✓ | sem mudança |
| rcd | `…/*.m3u8` | já HLS ✓ | sem mudança |

Saída final: *"nenhuma URL levaria o player pelo caminho errado"*.

Regras do `sinaliza` (travadas em teste): idempotente · preserva a query (`?token=x&format=m3u8`)
· não toca em `.mp4`/`.ts` · não repete aviso que já existe (`?type=hls`, `?ext=m3u8`) ·
`""`/`null` voltam iguais.

## `format=m3u8` é aceito em silêncio (`prova-formato.js`)

Os saltos da cadeia do REI respondem **byte a byte idênticos** com e sem o parâmetro — não é
uma query que a origem rejeita nem um cache que muda. Medido nos 4 saltos.

## A origem do REI recusa em 10,2 s (bateria de TV)

Canal morto: **10,2 s até o 404**, contra o probe de 8 s → `timeout de 8000ms` virava *chip de
erro*. Medido antes/depois (`dist/rei.js`):

| canal | antes | depois |
|---|---|---|
| `1021 Apple TV 6` | erro | `[]` · 4281 ms |
| `1041 Canal Goat 3` | erro | `[]` · 11956 ms |
| `1101 Eurosport` | erro | `[]` · 13513 ms |
| `1140 HBO` | 1 stream | 1 stream · 1814 ms |

Orçamento: `MS_PLAYLIST = 13e3` (buscado por `restante(p, MS_PLAYLIST)`, o que **pode passar de
8 s**) · `TETO_MS = 20e3` · 2ª tentativa só se couber um probe inteiro.

## ATO: 235 B na origem, JSON pelo worker — e o VÍDEO continua recusado

| pedido | resultado |
|---|---|
| `player_api.php` direto | **200 · 235 B** `Welcome to nginx!` |
| mesmo pelo `mirror-ato/proxy?url=` | **JSON correto** |
| `…/movie/…mp4` direto | 200 · 235 B · `video/mp4` |
| + `Range: bytes=0-2047` | 200 · **235 B** |
| + `Referer` + `Range` | rede (falha) |
| + pelo worker | **403 · `Upstream 403`** |
| `https` 443 / `:8080` | rede (falha) |

O catálogo/detalhe passou pela reserva (**`ato` de 0 → 3 streams** na bateria). O arquivo não
tem caminho nenhum daqui: **só o aparelho prova**.

## Bateria completa (02/10/2026)

```
VOD/anime/dorama — MIRROR_INDEX_BASE=http://127.0.0.1:8799 node tools/bateria.js
  shg 2890ms 2/2 · ron 2869ms 2/2 · aon 4237ms 1/1 · atb 3796ms 1/1
  spt 3657ms 1/1 · blz 3502ms 1/1 · spc 1469ms 2/2 · ato 2114ms 3 (0 prováveis)
  rtd 1682ms 1/1 · dgo 2241ms 1/1 · vzr 2091ms 1/1
  rei 1896ms 1/1 · emb 843ms 1/1 · etc 1500ms 1/1 · rcd 366ms 1/1
  → 14/15 com stream vivo | 0 sem título | 0 lançou | 52783 ms

TV — node tools/bateria-tv.js   (16 canais × 4 fontes)
  rei 13/16 com stream | 13 link vivo | 0 erros | médio 3364 ms
  emb  6/16 | etc 6/16 | rcd 4/16        | médios 398 / 620 / 959 ms
  → total 92696 ms
  rei sem stream: 1021 Apple TV 6, 1041 Canal Goat 3, 1101 Eurosport (playlist morta na origem)
```

Barreira: `node --test test/` = **259** (247 + 12 novos, todos sem rede).
