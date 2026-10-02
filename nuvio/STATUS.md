# STATUS — MirrorStream (plugin Nuvio)

Data da medição: **01/10/2026** (rodada da reorganização, mesma dia da tabela anterior), com a
**rodada de 02/10/2026 em §1b** (MIME do player, orçamento do REI, reserva do ATO), a
**rodada de 02/10/2026 (2ª) em §1c** (contrato de apresentação, prazo de corpo, qualidade real,
prova de TV) e **§5 atualizado com a publicação**. Barreira de testes hoje: **285**.
Servidor de teste: **IP de datacenter** (a origem que barra datacenter reprova aqui e
funciona no aparelho — está anotado linha a linha).
Build: `node build.js` → `dist/` com **15 `.js` + `manifest.json`**, e o `manifest.json` é
**gerado de `src/core/fontes.js`** (não existe mais escrito à mão na raiz).

---

## 0. Reorganização: o código no mesmo estilo do addon

O plugin passou a ter as três camadas do addon (`src/core`, `src/lib`, `src/scrapers`) e **um
registro único das fontes**, no espírito do `src/core/nomes.js` + `src/core/sources.js` do
repositório do Mirror. **Nada mudou de comportamento** — mesma assinatura `getStreams`, mesmos
endpoints, mesmos tempos (a bateria §1 foi rodada antes e depois; a contagem é idêntica).

### O registro — `src/core/fontes.js`

A fonte se declara **uma vez**:

```js
blz: {
  sigla: "BLZ",
  arquivo: "painel-blaze.js",
  tipos: ["movie", "tv"],
  conteudos: ["filme", "serie"],
  descricao: "Filmes e séries via BLZ (kakito)",
  idx: "blz"
}
```

E o resto deriva:

| quem deriva | o que tira do registro |
|---|---|
| `build.js` | o `manifest.json` inteiro (nome, versão, scrapers, `supportedTypes`) e a lista de entradas do esbuild |
| `build.js` | a conferência: fonte do registro sem arquivo **ou** arquivo em `src/scrapers/` fora do registro = build falha |
| `teste.js` | o caminho do módulo (`src/scrapers/<arquivo>`) e o do bundle (`dist/<chave>.js`); fonte fora do registro = erro de uso |
| `tools/gerar-indice.js` | quais fontes têm shard (`idx`) e em qual arquivo ler a credencial do painel |
| `medicoes.md` / esta tabela | `sigla`, `rotulo` (`CDN VOD | BLZ`), `conteudos`, `prefixo` |

**`manifest.json` virou saída de build.** Ele é escrito em `dist/manifest.json` e copiado para
`public/manifest.json` — as duas raízes que o Nuvio lê. **O `manifest.json` da raiz foi
removido**: duas cópias do manifesto eram justamente o que o registro substitui, e só o
`public/` (a raiz do GitHub Pages) e o `dist/` (build) têm de ter um.

### `kkt`: saiu do registro, e por quê

O `kkt` **não existe no plugin** e agora está escrito nesta linha, não em três lugares ao
mesmo tempo. Motivo: é o **mesmo painel do `blz`** — `kakito.xyz`, mesmas credenciais, mesmos
arquivos — lido de outra forma no addon (M3U de 48,8 MB em SQLite local). Como scraper
separado ele só entregaria o mesmo arquivo duas vezes, e o dedup do addon (por host+path)
já colapsa os dois. Indexá-lo seria 48,8 MB de M3U para os mesmos arquivos — o que
`tools/gerar-indice.js` já recusava com `[indice] kkt NAO foi indexado`. Ficam **15 fontes**,
que é o número real de fontes de verdade.

### `_exemplo`: removido

`src/_exemplo/` e `dist/_exemplo.js` eram o placeholder do harness. O `build.js` agora
**apaga de `dist/` e `public/`** qualquer `.js`/`manifest.json` que não esteja no registro, então
a contagem de arquivos do `dist/` voltou a ter sentido: **15 `.js` + `manifest.json`**.

### Onde foi o quê

| antes | agora | quem usa |
|---|---|---|
| `src/<fonte>/index.js` (15 dirs) | `src/scrapers/<arquivo>.js` (15 arquivos) | `build.js`, `teste.js`, `tools/gerar-indice.js` |
| `src/_utils/` | `src/lib/` | todo mundo |
| `src/_utils/canais.js` | `src/lib/canais.js` (gerado por `tools/gerar-canais.js`) | `src/lib/canal.js` |
| `src/_utils/canal.js` | `src/lib/canal.js` | as 4 fontes de TV |
| `src/_utils/fonte-painel.js` | `src/lib/fonte-painel.js` | `painel-blaze`, `painel-space`, `painel-autos` |
| `src/_utils/painel.js` | `src/lib/painel.js` (cliente `player_api.php` do Xtream) | `fonte-painel.js` |
| `src/_utils/indice.js` | `src/lib/indice.js` (leitor do índice estático) | `fonte-painel.js`, `tools/gerar-indice.js` |
| `src/_utils/prazo.js` | `src/core/sandbox.js` (`novo()` + tetos do runtime) | `fonte-painel.js` e as 4 fontes de TV |
| `src/_utils/http.js` (`8e3`/`6e4` escritos à mão) | `src/lib/http.js` lendo `TEMPO_FETCH_PADRAO_MS`/`TEMPO_FETCH_MAX_MS` | todos |
| `1048576` escrito à mão em 4 fontes | `TETO_CORPO_BYTES` de `src/core/sandbox.js` | `doramogo`, `playerflix`, `redetoons`, `vizer` |

`canal.js` e `canais.js` continuam dois arquivos: o **primeiro** é a lógica de busca do canal
(escrito à mão) e o **segundo** é o mapa gerado por `tools/gerar-canais.js`. Juntar os dois
significa que o gerador sobrescreveria a lógica.

### O que o build recusa

`node build.js` falha alto (não avisa e segue) em quatro casos, porque cada um deles é a forma
de o registro deixar de ser a fonte da verdade:

| recusa | por quê |
|---|---|
| fonte do registro sem `src/scrapers/<arquivo>` | fonte sem código — o build não gera um scraper vazio |
| `src/scrapers/<arquivo>` fora do registro | código que o Nuvio nunca vai chamar, porque não está no `manifest.json` |
| manifesto com contagem ou campo diferente do registro | o manifesto é gerado; divergir dele é bug do gerador, não do manifesto |
| `sigla` ≠ chave em maiúsculas, `conteudo` fora da lista, `tv` sem `channel`, fonte sem descrição | as invariantes que o resto do plugin e a tela de Plugins do Nuvio assumem |

Estrutura agora:

```
nuvio/
├── CONTRATO.md, STATUS.md, medicoes.md
├── package.json, build.js, teste.js
├── src/
│   ├── core/       # fontes.js (REGISTRO ÚNICO) + sandbox.js (tetos do runtime)
│   ├── lib/        # http tmdb text match quality html extrator url-resolver ua
│   │               # canais canal fonte-painel painel indice
│   └── scrapers/   # 15 arquivos, um por fonte (nome do arquivo no registro)
├── tools/          # gerar-indice.js, gerar-canais.js, provar-links.js,
│                   # teste-rota-worker.js, atualizar-indice.yml
├── public/         # saída do GitHub Pages: manifest.json, <fonte>.js, idx/, PLANO-PUBLICACAO.md
└── dist/           # build: 15 <fonte>.js + manifest.json
```

---

## 1. Tabela final — as 15 fontes

`node teste.js <fonte> <id> <tipo> [s] [e]` com `PROBE=1` (Range de 2 KB na `url`, com os
mesmos headers que o player manda). Tempo = o `getStreams` inteiro, do TMDB até a URL na mão.
Medida **depois** da reorganização; a coluna `antes` é a mesma bateria rodada antes dela, e
**ninguuma contagem mudou**.

| fonte | arquivo | caso | streams | tempo | a URL responde? | veredito |
|---|---|---|---|---|---|---|
| SHG | `scrapers/otakulogia.js` | `30984 tv 1 1` (Bleach) | 2 | 2,3 s | **206** ×2 | **ok** |
| RON | `scrapers/animesdigital.js` | `30984 tv 1 1` | 2 | 3,3 s | **206** ×2 | **ok** |
| AON | `scrapers/aon.js` | `30984 tv 1 1` | 1 | 3,3 s | **206** | **ok** |
| ATB | `scrapers/anitube.js` | `30984 tv 1 1` | 1 | 3,3 s | **206** | **ok** |
| SPT | `scrapers/playerflix.js` | `603 movie` (Matrix) | 1 | 1,9 s | **200** | **ok** |
| BLZ | `scrapers/painel-blaze.js` | `603 movie` | 1 | 3,8 s | **206** | **ok** (lento) |
| SPC | `scrapers/painel-space.js` | `603 movie` | 2 | 1,1 s | **206** ×2 | **ok** |
| ATO | `scrapers/painel-autos.js` | `603 movie` | **0** | 9,3 s | — | **ORIGEM RECUSA** |
| RTD | `scrapers/redetoons.js` | `603 movie` | 1 | 0,8 s | **206** | **ok** |
| DGO | `scrapers/doramogo.js` | `94796 tv 1 1` (Pousando no Amor) | 1 | 2,0 s | **206** | **ok** |
| VZR | `scrapers/vizer.js` | `603 movie` | 1 | 1,8 s | **206** | **ok** |
| REI | `scrapers/reidosembeds.js` | `hbo channel` | 1 | 2,0 s | **206** | **ok** |
| EMB | `scrapers/embedtv.js` | `hbo channel` | 1 | 1,2 s | **200** | **ok** |
| ETC | `scrapers/embedcanais.js` | `hbo channel` | 1 | 1,3 s | **206** | **ok** |
| RCD | `scrapers/reidoscanais.js` | `globonews channel` | 1 | 0,6 s | **200** | **ok** |

**14 de 15 com stream e link vivo, e nenhuma contagem caiu na reorganização** — a bateria
antes/depois é idêntica item a item, só o tempo muda (rede). **Nenhum estourou o orçamento de
15 s** (o pior caso é o ATO, e ele só espera o painel recusar). Não há 16ª fonte: `kkt` saiu do
registro (§0) e `_exemplo` foi removido.

### ATO: o que aconteceu, medido

O painel `4x4u29c.autos` responde a este IP com **200 e 235 bytes de "Welcome to nginx!"**
(3 de 4 tentativas; a 4ª dá timeout de 8 s). O `get_vod_info` do Matrix devolve essa
página em vez de JSON. Via worker (`mirror-ato` `/proxy?url=`) o mesmo pedido **devolve o
JSON correto** — ou seja, é o IP, não a credencial nem o `vod_id`.

O provider já trata isso certo: reconhece a página de erro, conta como "não deu para saber",
e devolve **`[]` de propósito, sem inventar stream** (`src/lib/painel.js`, log
`[ATO] a origem devolveu pagina de erro (235 B)`). **Não é defeito do parser** — do IP.

### Segundo canal por fonte de TV (o que a tabela não mostra)

| fonte | canais que entregaram stream + link vivo |
|---|---|
| REI | `hbo`, `globonews`, `cnnbrasil`, `sbt` |
| EMB | `hbo`, `globonews`, `cnnbrasil` (`sbt` não existe na fonte) |
| ETC | `hbo`, `globonews`, `cnnbrasil` (`sbt` não existe na fonte) |
| RCD | `globonews` (`hbo` e `cnnbrasil` existem no catálogo de 110 mas o CDN `cdn-sp2.satlabscloud.com.br` responde **403** a este IP → `ORIGEM RECUSA`) |

### Portão (nenhuma fonte entrega episódio de outro anime)

`matrix` e `breaking bad` devolvem **`0` — e não é erro** em todas as de anime/dorama:
`aon 603 movie` → `[]`, `atb 603 movie` → `[]`, `aon 1396 tv 1 1` → `[]`, `atb 1396 tv 1 1` → `[]`.
Episódio que não existe (`aon 30984 tv 1 999`, `atb 46260 tv 1 999`) também `[]`.

---

## 1b. Rodada de 02/10/2026 — o MIME da playlist, o orçamento do REI e a reserva do ATO

Três defeitos medidos e corrigidos, e **a barreira de testes foi de 247 para 259** (12 novos
em `test/nuvio-fontes-tv.test.js`, todos sem rede).

### a) O Nuvio tira o MIME do **caminho** da URL — e a playlist do REI termina em `.txt`

`PlayerMediaSourceFactory.kt` (linhas 976–1070) decide o tipo do stream assim: primeiro
`inferMimeTypeFromUrl` (o caminho: `.m3u8` → HLS, `.mp4` → progressivo), e **só se o caminho
não disser nada** ele olha a query (`inferMimeTypeFromQuery`: chave `format`/`ext`/`type`/
`mime` com valor de manifesto, ou `m3u8`/`mpegurl`/`hls` como valor). `proxyHeaders.response`
é sempre `nulo` para scraper — o Nuvio manda o `proxyHeaders.request` do scraper, mas **a
resposta não pode ser injetada**. Ou seja: **o tipo tem de estar na URL.**

O REI entrega a playlist como `…/__index.txt` com `content-type: text/plain`. Medido com
`FONTES=rei,emb,etc,rcd node tools/mime.js` (que roda a mesma regra do Kotlin): **rei e emb
caíam em "arquivo progressivo"** e o player tentava baixar o manifesto como vídeo.

Correção: `sinaliza()` (`src/lib/hls.js`) acrescenta `&format=m3u8` a quem termina em extensão
de texto e **não** toca em quem já diz o formato nem em arquivo de vídeo (`.mp4`, `.ts`). É
idempotente e preserva a query existente. Depois: `rei/emb → application/x-mpegurl (HLS ✓)`,
`etc/rcd → application/x-mpegurl (HLS ✓)`, "nenhuma URL levaria o player pelo caminho errado".

**Provado inofensivo** (`tools/prova-formato.js`): o `format=m3u8` é aceito em silêncio —
mesmos bytes de corpo com e sem o parâmetro (medido nos saltos da cadeia do REI).

Os **4 emissores de TV** passaram a sair por `url: sinaliza(...)`, e o teste novo varre os 4:
um `require` sem uso falharia no teste.

### b) A origem do REI leva **10,2 s** para dizer 404 — o probe de 8 s transformava isso em erro

Canal morto do REI não responde "não existe": espera **10,2 s** e aí devolve 404. Com o probe
de 8 s o `fetch` estourava, o erro subia, e o chip da tela dizia **"fonte com erro"** em vez de
**"sem fonte"**. Medido antes: `1041 Canal Goat 3` e `1101 Eurosport` lancavam
`timeout de 8000ms`.

Correção em `reidosembeds.js`: `MS_PLAYLIST = 13e3` (cobre os 10,2 s medidos) buscado com
`restante(p, MS_PLAYLIST)` — o orçamento **restante do sandbox**, que pode passar de 8 s — e
`TETO_MS = 20e3` para a cadeia inteira (um canal morto não pode prender o chip por meio
minuto). A 2ª tentativa (o `src` deles rotaciona) só roda se couber um probe inteiro, e uma
falha na 2ª volta `[]` — a 1ª já tinha dado a resposta.

| canal | antes | depois |
|---|---|---|
| `1021 Apple TV 6` | erro de timeout | **`[]` em 4281 ms** |
| `1041 Canal Goat 3` | erro de timeout | **`[]` em 11956 ms** |
| `1101 Eurosport` | erro de timeout | **`[]` em 13513 ms** |
| `1140 HBO` | 1 stream | **1 stream em 1814 ms** |

A regra da decisão 131 ficou intacta: **rede/timeout no 1º probe ainda sobe como erro** (teste
novo `falha de REDE sobe como erro — nunca vira lista vazia`); o que passa a ser `[]` é o 404
que a origem **respondeu**.

### c) A reserva do ATO — o painel devolve 235 B de nginx para IP de datacenter

O `player_api.php` do `4x4u29c.autos` responde **200 com 235 bytes de "Welcome to nginx!"** daqui,
e o **mesmo pedido pelo worker `mirror-ato` `/proxy?url=` devolve o JSON de verdade**. Agora
`painel.infoDe` tenta direto e, quando a resposta é a página de erro (recusa da origem, não
tropeço), refaz pela reserva — e **a recusa não se paga duas vezes** (o `recusaram` pula o
direto da próxima vez). **404 nunca aciona a reserva**: não há o que refazer.

Resultado na bateria: **`ato` 3 streams** (era `0`). O **vídeo** continua sem prova daqui —
`http://4x4u29c.autos:80/movie/…mp4` devolve os mesmos 235 B (direto, com `Range`, com
`Referer`, e **403 `Upstream 403` pelo worker**). Ver §4.

### d) Resultado medido

```
VOD/anime/dorama (bateria, com prova Range 2KB):
  shg 2/2 vivos · ron 2/2 · aon 1/1 · atb 1/1 · spt 1/1 · blz 1/1 · spc 2/2
  ato 3 streams / 0 prováveis (235 B) · rtd 1/1 · dgo 1/1 · vzr 1/1
  → 14/15 com link vivo | 0 lançou erro | 52,8 s no total

TV (16 canais × 4 fontes):
  rei 13/16 com stream | 13 com link vivo | 0 erros | médio 3364ms   (antes: 2 erros + 1 silêncio)
  emb  6/16 | etc 6/16 | rcd 4/16                                   (iguais ao antes)
  → os 3 sem stream do REI são `1021/1041/1101`, que não têm playlist viva na origem
```

`node --test test/` = **259** (247 + 12 novos).

---

## 1c. Rodada de 02/10/2026 (2ª) — o pedido: velocidade, 100% das fontes, limpeza e o nome na tela

O dono pediu: *"uma bateria de exames e testes ponta a ponta para melhorar a velocidade de
resolução e fazer com que todas as fontes [funcionem] 100%, quero que elas sejam sempre
pesquisadas e que se achar apareça o player, também quero uma limpeza e otimização do código
como também quero que normalize o nome original das fontes como aparece dentro do Nuvio com o
plugin instalado"*.

**Antes e depois, medido pela bateria nova (`tools/bateria-completa.js`):**

| | antes | depois |
|---|---|---|
| fontes que lançaram erro | 0 | **0** |
| casos tentados que entregaram stream | 12/15 | **16/16** |
| `blz` (Matrix) | **0 stream em 15,0 s** | 1 stream em 23,6 s |
| `ato` (Matrix) | 2 streams, 9,9 s | 3 streams, **4,1 s** |
| `vzr` (Matrix) | **0 stream** | 1 stream |
| `dgo` (Pousando no Amor) | 1 stream, 403 sem `Referer` | 1 stream, **5,7 s**, link vivo |
| `rcd` (HBO 2) | **0 stream** | 1 stream |
| linha 1 escrevendo "Desconhecido" | 13 das 15 fontes | **4** (as que a origem recusa deste IP) |

### a) O nome na tela: o contrato de apresentação (`src/lib/apresentacao.js`)

**O que o app faz com o objeto**, lido em `StreamRepositoryImpl.toPluginStream` e
`Stream.getDisplayDescription`:

- a **linha 1** é `name`, e o app **acrescenta `" - <quality>"`** — e quando `quality` vem
  vazio escreve o rótulo de localização `stream_quality_unknown`, que em pt-BR é
  **"Desconhecido"**;
- a **linha 2** é `description ?: title`, e `description` só existe se o scraper mandar
  `size` ou `language`;
- o **badge** lateral é `addonName`, que vem do `name` do **manifesto**, com `maxLines = 1`.

Medido: **13 das 15 fontes devolviam stream sem `quality`**, então quase toda linha da tela
dizia "Desconhecido" — e a sigla aparecia três vezes (no `name`, no fim do `title` e no badge).
Agora existe **um lugar só** que monta o objeto, e ele é `apresenta()`:

```
linha 1   Matrix (1999) - 1080p        <- o app acrescenta a qualidade
linha 2   Legendado · S01E03 · BLZ      <- uma informação por peça, a sigla no fim
badge     BLZ                            <- vem do manifesto
```

A sigla vai no fim do `title` **além** do badge porque o app tem a opção *"agrupar por
repositório"*: com ela ligada o badge das 15 fontes vira só "Mirror", e sem a sigla no `title`
a origem sumiria da tela.

Duas regras que esse módulo impõe:

- **não se manda `language` nem `size`.** O app monta `description` como `"size • language"` e
  usa `description ?: title` — mandar os dois **esconderia** o `title`, que é a linha 2.
- **campo desconhecido não entra.** `LocalScraperResult` é um data class do Moshi, e campo a
  mais pode fazer o parse falhar em runtime. O conjunto aceito é fechado e travado em teste.

### b) A qualidade é a resolução REAL, lida do vídeo

`src/lib/qualifica.js` + `src/lib/video-probe.js` (porta do `video-probe.js` do addon):
**160 KB de Range**, SPS em MPEG-TS e VisualSampleEntry em MP4, com **prazo de 3 s** —
medido, não arbitrado: no SPC a leitura leva **358–514 ms** e acha 1920×800 (1080p); no BLZ a
origem demora 20 s até responder um Range, e 3 s é o ponto em que o vídeo também ia demorar
para o usuário.

**Três defeitos da porta, todos medidos:**

1. `ms` era `undefined` no `probeVideoInfo` e o `catch` engolia o `ReferenceError` devolvendo
   `null` em **1 ms** — nenhuma fonte recebia qualidade;
2. a sonda ignorava o **`#EXT-X-MAP`** do fMP4, que é onde a resolução está (o SPT serve
   `init.mp4` + segmentos `.js`): lia o segmento de mídia e não achava nada;
3. o teto era **por requisição**, não da sonda: o DGO fazia 3 leituras de 3 s = **12,2 s**.

Nada é inventado: se a leitura falha, o campo continua vazio e a linha repete o que o app
escreve. E a resolução de um stream **não** é propagada para os outros da mesma fonte — um
painel pode ter 720p e 1080p do mesmo filme, e preencher os dois com uma leitura seria
mentira (regra da decisão 36 do addon).

A sonda é aplicada pela **build** (`entradaDe()` embrulha os 15 `getStreams`), não por
lembrete em cada fonte: são 15 arquivos, e "lembrar de chamar" é o que se esquece na 16ª.
`MIRROR_QUALIDADE=nunca` desliga.

### c) O prazo de uma chamada cobre os headers **e** o corpo

O defeito mais geral da rodada. `pegar` resolvia `Promise.race([fetch, estouro])` — que termina
quando os **headers** chegam — e limpava o relógio no `finally`, então o `res.text()` ficava
**sem tempo limite**. Medido no DGO (`forks-doramas.madfirebox.shop`): headers em **0,23 s** e
corpo de 24 KB pronto em **15,1 s**. A fonte pagava 15,6 s com um teto de 8 s, e um
`getStreams` podia passar do orçamento do Nuvio sem ninguém perceber.

Agora os métodos de corpo são embrulhados para estourar no mesmo prazo, e o `abort` do fetch é
traduzido para `timeout de Xms em <url>` (sem isso o chamador via só "aborted").

**DGO: 21,3 s → 5,7 s**, e a fonte continua entregando. O ganho é de todo o plugin.

### d) A reserva do painel em paralelo escalonado (`src/lib/painel.js`)

`get_vod_info` responde em **20,0 s** no BLZ (3 rodadas: 20,06 / 20,01 / 20,14 s), **0,05 s** no
SPC e **não responde** no ATO deste IP. A versão antiga pagava o timeout inteiro do direto
antes de tentar a reserva: ATO levava 9,9 s para entregar 2 streams. Agora os dois correm em
paralelo com a reserva **escalonada em 2,5 s** — origem rápida ganha sem gastar uma chamada no
worker, origem travada não espera o timeout. **ATO: 9,9 s → 4,1 s.**

Os detalhes dos candidatos passaram a ser pedidos **em paralelo** (`CONC_DETALHE`): em
sequência seriam 3 × 20 s = 60 s no BLZ, acima do teto do Nuvio.

E o catálogo gzip especulativo parou de **roubar o orçamento**: a versão antiga fazia
`await catalogo` e **depois** `await shard`, então o BLZ gastava 12 s de 15 s num catálogo que
ele nem usa (nem responde em 12 s), sobrava 2,9 s para o `get_vod_info` que leva 20 s, e a
fonte devolvia `[]` depois de 15 s. Agora é uma **corrida**: o primeiro que entregar item vence
e o perdedor é solto sem `await`.

### e) 403/429 de IP de datacenter não é canal morto (TV)

As 4 fontes de TV tinham cada uma a sua `contaSegmentos` e o seu tratamento de status, e as
quatro divergiam. Agora é `provaPlaylist()` em `lib/hls.js`:

- **descarta**: 404/410/451, ou 2xx sem `#EXTM3U` e sem segmento;
- **não descarta**: 403, 429, 5xx, timeout, rede.

Medido no RCD (`cdn-sp2.satlabscloud.com.br`): a cadeia de 3 saltos resolve e entrega
`index.m3u8?token=…` — um token de verdade — mas a playlist responde **403 a este IP**. Como o
vídeo é baixado pelo aparelho do usuário, do IP residencial dele, isso não prova que o canal
esteja morto. **RCD passou de 0 para 1 stream em HBO 2**, e o canal aparece na lista.

É a régua do resto do projeto (decisões 131/134) e a que a própria ferramenta de medição passou
a usar: `provar-links.js` separa `INDECISO` (429) e `BLOQUEADO` (recusa a datacenter) de
`MORTO`, senão a bateria acusa de morta uma fonte que o aparelho toca.

### f) O VZR estava jogando fora um stream vivo

`provaDeVida` seguia o redirect e condenava o link pelo `content-type`. Medido: a origem
responde 302 para um CDN assinado e esse CDN responde **429** a este IP — o VZR devolvia `[]`
para Matrix. Agora a prova **não segue o redirect** (302 para CDN assinado é prova de vida) e
**429 nunca condena**.

### g) A bateria nova — `tools/bateria-completa.js`

É a "bateria de exames" do pedido: as 15 fontes, N casos cada, medindo **tempo**, **entrega**,
**o contrato que o app vai ler**, **qualidade real** e **link vivo**. E separa **"o canal não
existe nesta fonte"** de **"a fonte tem e não entregou"** — defeitos de natureza oposta (na
rodada anterior, 6 dos 12 casos de TV eram o primeiro caso e a bateria os contava como falha).

```
casos: 19 | canal nao existe nesta fonte: 3 | tentados: 16
com stream: 16/16 | lancou erro: 0 | devolveu vazio: 0
sem nenhum link vivo comprovado: 2 de 16   (blz e rcd — a origem recusa este IP)
sem qualidade real: 4 de 16                (blz, ato, dgo, vzr — todos por recusa do IP)
```

As 4 sem qualidade e as 2 sem link vivo são **a mesma coisa**: origens que respondem 403/429 a
IP de datacenter. Do IP residencial do aparelho a leitura funciona — e isso só se prova no
aparelho (§4).

### h) Limpeza

- **`http.js`**: `comPrazo()` embrulha só os métodos que a resposta tem — um duplo de teste ou
  um `fetch` parcial não tem `json`/`blob`, e exigir `.bind` no que não existe estourava a
  chamada inteira.
- **`sandbox.js`**: `sobra()` (quanto resta do orçamento, sem teto de 8 s) separado de `ms()` (o
  que **uma chamada** deve pedir). Misturar os dois dava `Math.min(1, sobra) === 1` num guarda
  "faltam 1,5 s?", que disparava sempre.
- **`fonte-painel.js`**: `montaLinha()` saiu (o contrato faz esse trabalho) e o laço de detalhes
  virou uma chamada só, com os candidatos em paralelo.
- **A `sigla` sai do próprio scraper, não do registro.** `src/core/fontes.js` continua
  tooling-only (não entra em nenhum bundle); o vínculo é travado por teste.
- **Armadilha deste ambiente**: o `node` daqui rejeita `const { x as y }`. Use a forma com
  dois-pontos, que é o padrão do repo.

---
## 2. O que entrou na rodada das fontes

### `src/scrapers/aon.js` (animesonline.io)

O caminho medido em `medicoes.md` era a busca `/?s=` com **JSON-LD `ItemList`** — e a
**REST do WordPress** apareceu melhor ainda, então a fonte usa as duas: REST primeiro, HTML
como reserva. O índice de 718 KB **não é usado**.

| etapa | endpoint | tamanho | tempo |
|---|---|---|---|
| 1 | `wp-json/wp/v2/categories?search=&per_page=20&_fields=id,name,count,slug` | 311 B–1,2 KB | 0,5 s |
| 2 | `wp-json/wp/v2/posts?categories=<id>&per_page=100&page=N&_fields=id,title,meta_box` | 28–35 KB | 0,6 s |
| 3 | `meta_box.ero_embed` → `anidrive.click/token/<id>` | (no corpo do passo 2) | — |
| 4 | `anidrive.click/token/<id>` com `Referer: https://anidrive.click/` | 91 KB | 1,1 s |
| 5 | config XOR → `sources[]` → MP4 do `googlevideo` | — | prova `206` |

Medido e usado:
- **O `meta_box` do post tem o token do player pronto** (`ero_embed: ["[embed id='https://anidrive.click/token/...']"]`) — não precisa raspar a página do episódio. `posts?categories=834&per_page=100&_fields=id,title,meta_box` = 35 KB.
- **A página do anime é de 400–522 KB** (`one-piece` = 522 KB) — passaria do teto de 512 KB da quota `limited`. O caminho REST não abre esse arquivo.
- **`anidrive.click/token/...` responde 404 sem `Referer: https://anidrive.click/`** e 200 (91 KB) com ele. Medido nos dois sentidos.
- A config é `XOR(base64, base64)` dentro de `<script>`; em JS puro com `atob` + `Uint8Array` + `TextDecoder` (todos existem no sandbox), **sem `Buffer`**. Sai 720p + 360p; entra o 720p.
- A URL do MP4 é do `redirector.googlevideo.com` **com `ip=` do cliente que buscou o token** — por isso o token tem de ser buscado **no aparelho**, e é.

Portão: a categoria do site (`"One Piece"`, `"One Piece Dublado"`, `"Naruto Shippuden Dublado"`)
passa por uma pontuação de palavras com lista de paradas, penaliza marca de continuação
(shippuden/boruto/final season/hen) quando o pedido não traz a marca, e reprova
filme/ova/especial/recap/heroines. **Nota de calibragem:** o `−12` do `boruto` que existia no
código original **reprovava a categoria certa** (`BORUTO: NARUTO NEXT GENERATIONS`, ep 1 da TMDB
70881) porque o pedido é literalmente "Boruto: Naruto Next Generations" — tirado.

### `src/scrapers/anitube.js` (anitube.biz)

Caminho medido, sem desvio:

| etapa | endpoint | tamanho | tempo |
|---|---|---|---|
| 1 | `wp-json/wp/v2/categories?search=&per_page=20&_fields=id,name,count,slug` | 1,2 KB | 0,5 s |
| 2 | `wp-json/wp/v2/posts?categories=<id>&per_page=100&page=N&_fields=id,title,slug,date` | 3,3–17 KB | 0,3–1,1 s |
| 3 | `wp-json/wp/v2/posts/<id>?_fields=content` | 2,1–2,7 KB | 0,3 s |
| 4 | `<video src="api.anivideo.net/videohls.php?d=<url do CDN>/index.m3u8">` | — | — |

Medido e usado:
- **A segunda aba do post é um `src` em base64** (`/aHR0cHM6.../387/bg.mp4`) que é a URL de uma
  página do Blogger, não um vídeo. Decodificado: `https://bulbova.blogspot.com/2024/12/narut-shipp-dub.html`,
  e essa página **não tem `.m3u8` nenhum** (o `extrator` não acha vídeo nela). O provider
  descarta base64 que não seja `.m3u8` e não vai atrás por ele.
- **`videohls.php?d=` não é a playlist** — é a *página* do player (STCode/JWPlayer, HTML).
  O que é a playlist é o valor de `d=`, que é o `.m3u8` do `cdn-sv01.maximaimg.online`.
  Medido: `videohls.php` dá **302 para `/404`** sem `Referer` e **200 HTML** com ele; o
  `d=` direto dá **200 `application/vnd.apple.mpegurl`** e o 1º segmento dá **206 `video/MP2T`**.
  O provider entrega o `d=` (o `.m3u8`), que é o que o player sabe tocar.
- **A página de posts é calculada, não varrida**: `per_page=100` + `page=ceil((count−ep+1)/100)`
  — a API ordena por data decrescente. Uma categoria de 501 posts tem um "Todos os Episódios"
  como último item, que **desloca a contagem em 1**; por isso o provider tenta `alvo`, `alvo+1`,
  `alvo−1`, `alvo−2` (3 tries). Sem isso, `Naruto Shippuuden` ep 1 (que está na página 5, não 6)
  voltava `[]` — **medido, antes e depois**.
- `Episódio 020` (zero à esquerda) é lido com `0*(\d{1,4})`; `Naruto Shippuden – Episódio 500`
  e `Naruto 001` estão os dois certos.
- O ATB **não tem busca por título que funcione** (`posts?search=naruto` devolve 3 KB, mas
  `search=One Piece 1180` devolve `[]`), então a entrada é sempre por categoria — igual ao original.

### `src/scrapers/embedcanais.js` — defeito corrigido naquela rodada (não era das duas que faltavam)

O ETC devolvia **`0` em todos os canais**. Causa medida: o `Referer` do player novo é a
**origem final depois do redirect**, não a lista. `embedcanaisdetv.xyz/e/index.php?canal=hbo`
faz `302` para `https://1709.cdnembedcanais.xyz/hbo/`, e o `.m3u8` que está dentro é de
`…cdn10embed.xyz`, que responde **403 sem `Referer: https://1709.cdnembedcanais.xyz` e 200 com ele**.

Correção: `pegarTexto()` passou a devolver `url` (a URL final, post-redirect), e o ETC usa a
origem dessa URL como `Referer` — tanto no caminho novo quanto no CDN de reserva. Medido depois:
`hbo`, `cnnbrasil` e `globonews` deliveram stream com `206` na prova.

Também **removido** o `−12` de `boruto` da pontuação de categoria do ATB, que matava o
próprio anime (ver acima).

---

## 3. O que falta

1. **~~Os 15 `.js` + o `manifest.json` estão no `dist/` e no `public/`; falta publicar.~~**
   **Publicado** (§5): `https://mrrobots777.github.io/mirror/manifest.json` → 200 com 15
   scrapers, build por workflow a cada push e a cada 6 h. Continua valendo: não há fonte
   declarada sem arquivo nem arquivo sem fonte — o `build.js` falha alto nos dois sentidos
   (`fonte do registro sem src/scrapers/<arquivo>` e `src/scrapers/<arquivo> nao esta no
   registro`), e apaga de `dist/`/`public/` o que sobrar.
2. **`manifest.json` não existe na raiz do repo** (§0) — e não precisa: o Pages está em modo
   `workflow` e serve `nuvio/public/` como raiz (§5).
3. **A versão do manifesto não sai do `package.json`.** Hoje `VERSAO_REPOSITORIO` e
   `VERSAO_SCRAPER` são constantes em `src/core/fontes.js` (`1.0.0`), enquanto o
   `package.json` vai em `1.0.1` e o commit em `1.0.1`. O Nuvio compara versão para
   checar atualização, então um dia de release pode não aparecer na tela. **Não foi mexido
   nesta rodada** (é mudança de empacotamento, não de fonte) — pendente de decisão.
4. **O BLZ leva ~24 s** e é o piso de latência do plugin. MEDIDO: `get_vod_info` do
   `kakito.xyz` responde em 20,0 s (3 rodadas) e o **link de vídeo também leva 20,5 s** para
   responder 302. É a origem, não o código — o dono autorizou pagar ~25 s. Se a origem
   normalizar, o teto de 30 s (`TETO_MS` em `lib/fonte-painel.js`) fica folgado.

---

## 4. Os 3 pontos que **só se provam no aparelho**

Tudo acima sai deste servidor, que é **IP de datacenter**. São três coisas que a origem pode
decidir por IP e que daqui não têm como ser resolvidas:

1. **O teto de 1 MB por resposta (512 KB na quota `limited`) — contando bytes comprimidos ou
   o corpo decodificado?** O plugin foi construído para nunca depender da resposta: os
   painéis Xtream (BLZ 4,77 MB, SPC 29,2 MB, ATO 11,9 MB, KKT 48,8 MB) são lidos pelo **índice
   estático** em `public/idx/`, e o maior shard é de 285 KB. Se o teto for sobre os bytes de
   rede, tudo bem com folga; se for sobre o corpo decodificado, ainda cabe, mas o shard do
   `spc` (`c.json`, 285 KB) é o mais próximo. **A mesma dúvida vale para `gzip`**: o BLZ
   comprimido vai a 765 KB, que passaria na quota normal e **não** na `limited`.
   *Medir no aparelho:* abrir um canal/filme na TV e ver se a fonte aparece.
2. **403 de CDN para IP de datacenter.** O ATO é o caso medido e visível: o `player_api.php`
   devolve 200 com **235 B de "Welcome to nginx!"** (§1b) — agora **contornado pela reserva
   pelo worker**, então o *catálogo e o detalhe* vêm. O que **não** contorna é o **vídeo**:
   `http://4x4u29c.autos:80/movie/…mp4` devolve os mesmos 235 B direto, com `Range` e com
   `Referer`, e **`403 Upstream 403` pelo worker** (medido 02/10) — o painel recusa o arquivo
   para qualquer IP controlável, então **a única prova é o aparelho**. E o
   `cdn-sp2.satlabscloud.com.br` do RCD dá 403 daqui. Nenhum dos dois é defeito do parser — o
   `[]` é de propósito e o log diz por quê. **O que não dá para provar daqui é o contrário:**
   que o IP residencial *passa*. Precisa de um canal/filme real aberto no aparelho.
3. **`content-type` da playlist do REI.** O REI entrega o vídeo por um relay com token que vale
   ~300 s, e a resposta muda de forma conforme o salto. A parte que dependia do **servidor**
   foi resolvida sem depender do `content-type`: o Nuvio decide pelo **caminho/query da URL**,
   e `sinaliza()` põe `format=m3u8` nela (§1b) — então o manifesto é reconhecido como HLS
   mesmo vindo como `__index.txt` / `text/plain`. Daqui a prova é `206` com 385 bytes. O que
   só o aparelho diz é se o player consegue **segurar a sessão o tempo de um episódio** sem
   recarregar a playlist no meio (o token expira em 300 s e o `dist/` não pode cachear isso).

Nada disso é bloqueante para instalar — são as três coisas a olhar no primeiro uso real.

---

## 5. Como instalar

1. **`node build.js`** — é ele que gera o `manifest.json` e copia tudo para `public/`.
   Rodar **antes** de publicar.
2. **Publicação: automática, pelo workflow.** O site é **`https://mrrobots777.github.io/mirror/`**
   e o Pages do repo `mrrobots777/mirror` está em **modo `workflow`** (não `legacy`) — quem
   publica é **`.github/workflows/publicar-pages.yml`**, que roda a cada push nas branches
   `gh-pages`/`master` e a cada 6 h, faz `npm ci` + `node build.js` e manda **só `nuvio/public/`**
   como artefato (`upload-pages-artifact` → `deploy-pages`). Por isso **não existe `manifest.json`
   na raiz do repo e não precisa existir**: em modo `workflow` a branch não é servida.
   ```
   nuvio/public/        # é o que vira a RAIZ do site (upload-pages-artifact path: nuvio/public)
   ├── manifest.json    # 15 scrapers (GERADO de src/core/fontes.js — ver §0)
   ├── <fonte>.js       # um bundle por fonte (15)
   └── idx/             # índice estático de blz/spc/ato (~103 mil itens)
   ```
   **Duas armadilhas medidas (02/10/2026), já corrigidas no workflow:** (a) o `path` do artefato
   tem de ser **`nuvio/public`**, não `public` — sem `working-directory` esse passo resolve da
   **raiz do repo**, que é a UI do addon, e o deploy passava publicando 4 páginas e nenhum
   `manifest.json` (o `/manifest.json` dava 404 no ar); (b) o environment `github-pages` só
   aceita deploy pela branch **`gh-pages`** — disparar por `master` é rejeitado com
   "Branch ... is not allowed to deploy to github-pages".
3. **Aponte a base do índice** em `src/lib/indice.js` (`BASE_PADRAO`) para o endereço
   publicado e **rebuild** (`node build.js`) — a base está escrita dentro do bundle.
   Hoje: `https://mrrobots777.github.io/mirror`.
4. **No Nuvio:** Settings → Plugins → **Add repository URL** =
   `https://mrrobots777.github.io/mirror/manifest.json` (o app anexa o `/manifest.json` se faltar).
   O app atualiza o repositório sozinho a cada **6 h**.
5. **Escolher as fontes** na tela de Plugins do Nuvio. As 15 rodam em paralelo, 10 por vez,
   120 s no total — a mais lenta aqui levou 3,8 s (o BLZ).

**Publicado.** `nuvio/` está versionado neste repositório (o repo é `mrrobots777/mirror`, o que o
`origin` antigo `devavmirror/mirror` não existe mais — medido: `gh repo view` responde
"Could not resolve"), o CI **`.github/workflows/testes.yml`** roda a barreira em todo push
(piso **285**; hoje **285**) e o `publicar-pages` sobe o site. Verificado no ar em 02/10/2026:
`/manifest.json` → **200 com 15 scrapers**, `/rei.js` → 200, `/idx/indice.json` → 200.

### Medir de novo a qualquer momento

```bash
# índice estático local (necessário para blz/spc/ato)
python3 -m http.server 8799 --directory public &

# uma fonte
node teste.js aon 30984 tv 1 1

# com prova de que o link responde (Range 2 KB)
PROBE=1 node teste.js aon 30984 tv 1 1

# fonte de TV
PROBE=1 node teste.js etc hbo channel
MIRROR_INDEX_BASE=http://127.0.0.1:8799 PROBE=1 node teste.js spc 603 movie

# conferir o registro e o build inteiro (15 fontes, manifesto gerado)
node build.js

# uma fonte fora do registro mostra o erro de uso, com a lista das 15
node teste.js kkt 603 movie
```
