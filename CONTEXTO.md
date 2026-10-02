# CONTEXTO — Mirror (leia isto antes de qualquer tarefa)

> Economia de tokens: este arquivo dá o contexto completo do projeto sem revisar o código.
> Atualize-o SEMPRE que mudar arquitetura, decisões, env ou deploy. Detalhes de código: `AGENTS.md`.

## O que é

Addon Stremio (Node.js >=20, **CommonJS**, Express 5, stremio-addon-sdk) que busca streams de anime, filmes, séries e TV ao vivo. Metadados: AniList (anime), Kitsu (ids `kitsu:`), TMDB (filmes/séries), Cinemeta (fallback IMDb→TMDB). **Sem comentários no código** (convenção).

## Estado atual

- **Versão: 1.0.1** (`package.json` + manifesto). **Histórico git: UM único commit `1.0.1`, branch única `main`.** Regra: NUNCA criar commits novos — toda alteração entra por `git commit --amend` neste commit + `git push --force-with-lease`. **Repo GitHub vivo (medido 02/10/2026): `mrrobots777/mirror` (remote `novo`)** — `devavmirror/mirror` **não existe mais** (`gh repo view` → "Could not resolve"), então o remote `origin` falha com `Repository not found`. `main` faz tracking de `novo/master`; publicar = `git push --force-with-lease novo HEAD:master` **+ `HEAD:gh-pages`** (o Pages está em **modo workflow** e o environment só aceita deploy pela branch `gh-pages`). O ssh do GitHub usa `id_ed25519_mr777` (ver `~/.ssh/config`).
- **Deploy: BeamUp (Dokku)** (repo GitHub **`mrrobots777/mirror`**) — **belmo.io descontinuado** (domínios `onbelmo.uk` mortos, nada deve referenciá-los). **O push NÃO auto-deploya**: o push só publica no GitHub; o deploy é `git push beamup HEAD:master --force` (build a partir do `Dockerfile`, healthchecks + `beamup-lint`) após cada `--amend`+`push --force-with-lease`. App **`e75602c18409-mirrorhub`** (hash novo da decisão 154; o `c12e41ddc21b-mirror` antigo está morto — medido 02/10: `curl` nele devolve `000`), porta injetada ex. 6009, código usa `process.env.PORT || 3000`, bind `0.0.0.0`); `mirror-relay` é app opcional (mesmo padrão). Detalhes/armadilhas: `AGENTS.md` + `DEPLOY.md`.
- **Addon: `https://c12e41ddc21b-mirror.baby-beamup.club`** (`PUBLIC_BASE_URL` fixada como `ENV` no `Dockerfile` — o `config:set` do BeamUp **não injeta** env no serviço; sem base o gateway reescreve `Host`→`localhost`, o guard do auto-detect rejeita e as URLs saem relativas). Domínios antigos (`mirrorhub-dd54`, `mirrorhub-c03e`, `mirror.onbelmo.uk`, `mirror-relay-1025.onbelmo.uk`) estão mortos.
- Caches/dados locais ficam em `/tmp` (`cache.db`, `iptv.db`). Servidor de teste local: porta 7000, log `/tmp/mirror.log`.
- **24/09/2026 — rodada "todas as fontes VOD 100% operantes"**: RTD wrap/ref + fallbacks (decisão 22), **hop BR `br-relay.js` :8443 (systemd `mirror-br-relay`) — WAF do CDN do RTD bloqueia egress DE (decisão 23)**, costura de faixa aberta no relay, match de spinoff KGE/DRV, probe de série xtream, `/stream/proxy-check`, **PPD: `EMBED_TIMEOUT` 16s + patch tardio (24)**, **KKT: cadeia fetch M3U via relay BR + dedup vs BLZ esclarecido (25)**; barreira **56**, `vod-sources` **22/22**, audit **19/19 · ffprobe10/10 · match BAD0**; externos da manhã: API PPD503, CDN kakito flappy (521/404/400 voltm.uk), KGE/DRV403 no search da prod → resolvidos na rodada seguinte (26).
- **24/09/2026 — rodada "corrija tudo o que tiver ao alcance do código" (decisão 26)**: KGE/DRV voltam na prod via **`fetchWithFallback`** (direto → worker `/proxy` → relay BR **`/fetch`** novo no `br-relay.js`), **probe de filme xtream honesto** (400/`text/html` = morto), **`/health`+`/metrics` `no-store`** (edge congelava o uptime), `relayPlayUrl`/`relayFetchUrl` centralizados em `lib/proxy` (wrap RTD + cadeia KKT reusam), allowlist do relay += `animesonline.cloud|animesdrive.cloud`; barreira **58** (+2 testes de wrap), `vod-sources` **22/22**, audit **19/19 · ffprobe 11/11 · probes 29/33 · match BAD0**; `iptv-epg.org` é **403 de todo lugar** (externo — EPG só com XMLTV do kakito via worker). **Prod validada pós-deploy**: streams frios de `tmdb:46260:1:1` já vêm com **`kge`** (nenhum `search HTTP 403` novo nos logs), `/health` = `cache-control: no-store` + `cf-cache-status: BYPASS` (uptime fresco), ffprobe do link KGE vindo da prod OK (`duration=1417.6s`), Matrix = `blz,spc,spt,rtd`, `animes.click`/`mangas.cloud` = **200 do egress DE** via `/stream/proxy-check`; deploy **`cacc150`**.
- **24/09/2026 — rodada "fontes mortas" (decisão 27)**: removidos **`iptv-epg.org`** do `epg.js` (403 de todo egress — fonte bloqueada, não geo) e a **API `popplaydb.vercel.app/api/resolve`** do PPD (503 `DEPLOYMENT_PAUSED`) — **EPG = só XMLTV do kakito via worker** (128 canais, `source-info-name="Kakito"`), **PPD = embed `mgeb.top` puro** (local: 3 streams Matrix); **não removidas** (vivas/flapping externo): KKT (M3U ok, arquivos `voltm.uk` 400 = origem deles, probe filtra), RON (iframe 500 transitório), demais SHG/KGE/DRV/BLZ/SPC/SPT/RTD/EMB = vivas (audit ffprobe 11/11); testes **58/58**; **prod validada pós-deploy**: boot 15:38 `[epg] merged 128 channels from 1 sources`, `/epg.xml` = `source-info-name="Kakito"`/128 canais, Matrix 2º request `blz,spc,spt,rtd,ppd`, nenhum erro `resolveApi`/`IPTV_EPG` nos logs; deploy **`74231cc`**.
- **24/09/2026 — rodada "painel IPTV novo p/ VOD" (decisão 28)**: nova fonte **`ato` = "Autos"** (painel Xtream `4x4u29c.autos`, user `216873`) como **3º painel do `xtream.js`** (envs `XTREAM_AUTOS_*`): API `player_api` completa (xui 1.5.5) — **31.381 filmes + 9.641 séries** (JSON 12,4MB/9,7MB via worker em ~3,5s), episódios `S01E01`, variantes `[L]` = legendado. **Egress: bloqueia datacenter BR (nginx/reset) e vídeo do worker CF (`Upstream 403`); só o egress DE da prod entrega** → `wrapVideo: true` = URLs saem em `${PUBLIC_BASE_URL}/stream/proxy?url=...` (API vai pelo worker no fluxo default). Flags honestas `[L]`→`dubbed:false,subtitle:true` no emit compartilhado do xtream (BLZ/SPC também); fonte `ato` = `CDN VOD | ATO`, prioridade **1**. Validação: testes **59/59** (+1), local Matrix = `blz,spc,ato×3`, Breaking Bad S01E05 = `spc,ato`, **ffprobe via prod**: filme `8176,5s` (136min = Matrix 1999 ✓) e episódio `2889,2s` (48min ✓). **Armadilha**: harnesses BR (`vod-sources`/`audit`) não provam ATO (probe direto BR = nginx/000 — validação é via prod); origin **ignora Range** em faixa fechada pequena (arquivo inteiro), probes ficam safe porque `browserFetch` é lazy.
- **24/09/2026 — rodada "segundo servidor p/ dividir carga" (decisão 29)**: pedido "subir um segundo addon no BeamUp... link atual... carga dividida". **Sem LB no BeamUp**: SSH do dokku whitelist sem `ps:*` (`ps:report`/`ps:scale` = `unsupported command`), CLI `beamup` = só `config/init/deploy/secrets/logs/delete` (sem `create`/`scale`), DNS/Cloudflare do `baby-beamup.club` é da BeamUp → escalar o mesmo app ou balancer no link atual **não existe** p/ nós. **Probe = push em path novo AUTO-CRIA o app**: `git push dokku@a.baby-beamup.club:c12e41ddc21b/mirror2 HEAD:master --force` criou **`c12e41ddc21b-mirror2`** (`https://c12e41ddc21b-mirror2.baby-beamup.club/health` → **200**). **Split por papel (link de instalação continua o do app1)**: app1 = manifest/catálogo/meta/scrape/cache; **vídeo ATO round-robin** entre os dois via `VIDEO_BASE_URL` (`videoBases()` no xtream — wraps alternam host ~50/50; vazio = só app1; base repetida é ignorada); app2 só recebe `/stream/proxy` (mp4 estadoless — **sem dobro de scrape por request**; custo aceito = warm-up de boot/intervalo duplicado nos dois). `ENV VIDEO_BASE_URL` no `Dockerfile` (mesma imagem serve os dois — env injetável não existe no BeamUp); `.env`/`.env.example`/`ecosystem.config.js` += `VIDEO_BASE_URL` (vazio = sem split local). Testes **60/60** (+1 `videoBases`), local com base dupla = hosts `app1,app2,app1` alternados. **Deploy = push nos DOIS remotes** (`beamup` + path `mirror2`). Pendência opcional: `beamup secrets <name> <value>` p/ `PUBLIC_BASE_URL` próprio do app2 (hoje ele minta URLs do app1 — ok no papel de proxy puro de mp4; HLS reescrito aponta p/ app1 e funciona). **Deploy = `a4974a4` → `6a3acef` (instrumentação) nos DOIS apps; prod validada pós-`6a3acef`**: boot dos dois apps loga `VIDEO_BASE_URL` + `[split] video bases: app1 | app2`, streams ATO alternam `mirror`/`mirror2` em id fresco (cache stale do pré-split é servido em SWR e some em ~6min — anômalia "tudo app1" era cache), **ffprobe via URL do app2** = Matrix `8176.469s` ✓, E2E prod **28/28**.
- **24/09/2026 — rodada "remover KGE/DRV, DUAS fontes novas de anime" (decisão 30)**: pedido do dono: remover KGE/DRV e construir **AON** (`animesonline.io`, principal, 100% direto) + **TOP** (`topanimes.net`, redundância). **Remoção KGE/DRV**: `animesonline.js`/`animesdrive.js` deletados, chamadas do `server.js` → `aon/topanimes`, `fetchWithFallback`+`hopBlockedUntil` fora do `scraper-utils`, `shouldRelayAnimeHls` só `ron`/`shg`, allowlist do relay podada (`cnn.radiogaucha.fun|kakito.xyz`), códigos `aon`/`top` em `source-names` (prioridade 2). **AON (`aon.js`, direto)**: índice `/anime/list-mode/` (sem query params — `?s=` é challenge CF) → `pickSeries` (`scoreSerie` −40/palavra extra, corte <50, dublado +25) → série → ep → token anidrive (fallback slug `-dublado`→plain) → config decodificada **nativamente** (JSON literal + XOR/atob via Buffer — `vm.runInNewContext` banido por escape de constructor) → MP4 googlevideo com **UA browser** (Stremio/Lavf/curl/vazio = 403; `&expire=` não casa `hasExpiredSignedUrl` ✓). **TOP (`topanimes.js`)**: busca `/?s=` → série `/animes/{slug}/` (`epnumber` em aspas simples) → ep → players: **Blogger** `video.g?token` → `f.sid`+`bl` da página → POST `/_/BloggerVideoPlayerUi/data/batchexecute` (`rpcids=WcwnYd`) → JSON-duplo parseado por **slice de colchetes balanceado** (a regex com classe de não-aspas capturava o backslash do `\"` de fechamento → sig corrompida → 403 vazio — achado no A/B parse vs regex) → googlevideo itag22/18 MP4; **wrapper alibaba** `sk-{api,ru}.alibabacdn.net` + `&mode=to-salvando-seu-ip` → JSON `midias[]` HLS (SD→1080p/LD→720p/FD→360p). **Egress DE do topanimes = 403** → cadeia `fetchTop` (deadline 12s): direto (`403/429/451` → `blockedUntil` 30min) → allorigins ×2 (flaky ~50%, 6-11s) → wayback (**CDX** `web.archive.org/cdx/search/cdx` p/ frescor — o `available` tem cache/lag e escondia a captura recém-salva; leitura `/web/<ts>id_/` de captura **<48h**; sem captura fresca → save **path-form** `/save/<url encoded>` — o formato `?url=` devolve 200 mas **não salva** (validado: path-form 3/3, query-form 0/2) — na **fila global 2-3s / throttle 10min / backoff 429** e throw `top: ...` → `patchLate`); hop vencedor memorizado por URL (após o 1º save, wayback-first ≈ 2-3s/página). **Validação local**: testes **64/64** (+13 AON/TOP), `e2e-flow` **28/28** com `fontes=[shg,top,aon,ron]`, `vod-sources` **22/22**, `audit` **18/19 · AON 2/2 · TOP 2/2 · ffprobe aon=1384s top=1415s · match BAD 0**. **Prod (25/09)**: E2E **28/28** com `fontes=[shg,aon,ron]` — TOP depende dos terceiros e às ~00:30h os três níveis caíram **juntos** (allorigins 522/408 global, Internet Archive "Temporarily Offline" flapping, direto DE = 403 de sempre) → TOP degrada por alguns minutos e **converge sozinho** quando qualquer camada volta (saves path-form pendentes + throttle 10min); AON responde direto e segura o anime.
- **25/09/2026 — rodada "qualidade honesta + 2 fontes novas + corte de requests" (decisão 31)**: (a) **lote P0**: `makeHttpStream`/`vodTitle` param de `quality="unknown"` (não mente mais 720p) + novo `injectTitleQuality(title, q)` (insere ` · q` **antes** da fonte, preserva `\n`, remove `[1080p]` legado) usado pelo probe HLS do server, que foi movido para **antes** do `streams.sort`; `360p` no `quality.js`; ` · PROXY` antes da fonte no xtream; probe-null cacheado (60s) no xtream; (b) **caches novos**: `pageCache` 10min nas páginas de série/ep do AON (o token segue fresco), `resolveCache` 3min no player do TOP, `m3u8Cache` 3min no embed do SPT, TTL RTD 5→10min e PPD 4→10min (assinaturas valem ~1h/~5h), EPG sem programas → refresh 60min em vez de 15; (c) **fonte nova `atb` (anitube.biz)**: API REST do WP — busca por **categorias** (o site tem categoria por anime/idioma/tipo) + posts da categoria (`per_page=100`, página = `count-ep+1` pq a API ordena por data **decrescente**), vídeo = param `d=` de `api.anivideo.net/videohls.php` (o path base64 `/aHR0…/bg.mp4` é **404**, descartado), playlist de mídia sem variantes → quality `unknown`, sem auth/referer; matching por **cobertura de tokens com prefixo de 4 letras** (o site grafia "Shippuuden" e o WP não casa "shippuden" → `?search=` volta 0 → fallback busca por token único); (d) **fonte nova `dgo` (doramogo.net)**: doramas — `Referer: https://www.doramogo.net/` é **obrigatório** (403 sem) → `behaviorHints.proxyHeaders`; path `<Inicial>/<slug>/<NN>-temporada/<MM>/stream.m3u8` nos hosts `ondemand`/`forks-doramas.madfirebox.shop` (**os dois entregues**); só roda p/ série com `originCountry` vazio ou `KR`; (e) **doramando.com DESCARTADO**: o player `tgp.playerp1.sbs` responde o master mas **o 1º segmento de cada episódio/video só existe ~13s depois** ("Segmento sendo preparado", `retry-after: 2`) — ffprobe passou 1 de 4 e o warm-up (4 tentativas/12s) 1 de 3, então o 1º play falharia; os outros 3 players (abyssplayer/bysebuho/voe) só entregam iframe com JS. Validação: testes **77/77** (+7), `e2e-flow` **28/28** (`fontes` de Naruto E3 já inclui `atb`), `vod-sources` **25/26** (só o timeout PPD Duna), `audit` **23/23 · ffprobe atb=1484s dgo=4981s · probes 37/42 · match BAD 0** (falhas conhecidas: ATO só em egress DE, PPD 403 no mgeb).
- **Pente fino de auditoria COMPLETO neste commit** (libs + server +13 scrapers + relay-server + worker + epg): robustez de erro (throw≠`[]`, catches com log, crash-fix do epg), dedup/cache/chaves corrigidos, backpressure e guards no relay, timeouts/caps generalizados, código morto removido. Validado por **testes37/37** e **E2E fluxo do user28/28** (manifest→catálogo→meta→streams com configs→ffprobe playback). Labels de TODOS os players padronizados (VOD + TV ao vivo no mesmo pipeline do ranker — ver decisão 12). **23/09/2026 — otimização de carga + UI**: single-flight/SWR/cache-negativo (decisão16), anime por gênero TMDB (17), página `/install` + dashboard em **preto+vermelho sem CDN** e logo = símbolo do Stremio (18) — load local `node load-test.js`: **408 RPS, p95 ≤211ms, 0 erros a 50 conc** (antes p95 ~15s em janela de rescan).
- **25/09/2026 — rodada "padronização total de qualidade + investigação froststream" (decisões 36/37)**: pedido do dono: *"todas as fontes de vod tem que ter a qualidade, nome da fonte, nome da obra, se for serie a temp e ep, emojis padronizados; quero uma padronização total no addon e o que puder também otimizar; e em paralelo investigue as fontes de vod do addon https://froststream.cloutteam.com/manifest.json"*. **(a) O que já estava pronto**: o pipeline de labels já era padronizado (`vodTitle` = `🎬 Nome (Ano) · SxxEyy · Q · FONTE` + linha `🌎 Português`/`🧩 Legendado`); a auditoria mostrou que a **única lacuna real era qualidade em 3 fontes** — RTD, ATB e DGO (nenhuma entrega variants/master nem qualidade no nome da URL). **(b) SOLUÇÃO (decisão 36)**: novo `src/lib/video-probe.js` que lê a **resolução real do vídeo** — parser H.264 (PAT→PMT→PID de vídeo→PES→NAL 7→SPS com Exp-Golomb) p/ segmentos TS e varredura de `VisualSampleEntry` p/ MP4, acionado pelo server em `fillMissingHlsQuality`→`probeStreamQuality` (cache por URL) **só depois** do probe HLS de playlist. Ganho: **11/11 fontes VOD com qualidade real**, sem inventar label. Armadilhas encontradas no caminho (todas documentadas no código): o `adaptation_field_control` é `(byte3>>4)&3` (o `&0x10` testado antes tratava payload puro como adaptation field e zerava o parse); o PMT **não vem nos primeiros 160KB** → fallback de varrer todos os PIDs procurando NAL 7; o `assembleVideoStream` precisa **incluir o primeiro pacote** (é onde está o PES header); o `parseSps` tem que ler `pic_order_cnt_type`/`max_num_ref_frames`/`gaps_in_frame_num` antes de `pic_width_in_mbs`; o `avc1` do RTD tem preâmbulo não-padrão e o offset width/height **varia 2 bytes**; o DGO corta o 1º segmento **no meio do GOP** (sem IDR) → tenta o 2º. Validação: testes **74/74**, e2e **27/27**, `vod-sources` **23/23 sem erro**, `audit` **21/21 · ffprobe 13/13 · match BAD 0** (só o ATO falha, egress). Ganho de performance: latência fria do stream caiu de ~8-10s para **~5s** (o probe é paralelo e cacheado). **(c) Efeito colateral corrigido**: `makeHttpStream` ganhou o param `notWebReady` explícito — descobri que o **KKT entrega `http://kakito.xyz:80/...` cru com `notWebReady: false`**, o que faz o Stremio recusar/instalar em clientes Android/TV; agora o kakito passa `notWebReady: streamUrl.startsWith("http://")`. **(d) FROSTSTREAM REJEITADO (decisão 37)**: o recon (subagente) provou que os 3 provedores dele são **as mesmas origens que já temos** — 🌊 Space = worker assinado sobre painel Xtream Space, 🌊 Nova = file-server `/vauth/` com token, e o 🧩 legendado é literalmente **o meu SPC** (`telaplay93.top`, hoje 503) e o kkt de legenda. O segredo HMAC é server-side → **não dá para reimplementar a origem**. Medido: 1 request, sem embed/JS/geo-block, ffprobe OK em 30/32 — ou seja, **funciona**, e foi implementado e validado por completo (2/2 casos, 4/4 probes, ffprobe 8176s) antes de ser **removido**: a decisão é **redundante** (BLZ/SPC/ATO/SPT/KKT já entregam sempre o mesmo conteúdo), traz TTL curto de token (**3h**, e o cache deles serve entrada quase vencida — vi token com 3 min de vida) contra um budget de 9s, e custou latência fria (Matrix 5,9s→9,6s). Mesmo critério do PPD (decisão 35). **Ficou da investigação**: o `video-probe` (o entregável real), o `imdbId` no `info` (`resolveStreamInfo` agora repassa o `imdbId` que o TMDB já devolvia — 4 linhas, útil p/ qualquer fonte por IMDb) e a correção do `notWebReady` do KKT. Lição: o pedido "padronize a qualidade" foi interpretado como "vá atrás de 12 provedores relayed"; a lacuna real eram 3 fontes próprias.

- **25/09/2026 — rodada "fonte nova VZR (vizer.autos)" (decisão 39)**: o dono mandou investigar 4 sites. **3 rejeitados, 1 aceito**. (a) **froststream** — os 3 provedores são as mesmas origens que já temos (o legendado é o **próprio SPC**), token de 3h com cache desalinhado; chegou a ser implementado e validado (ffprobe 8176s) e foi **removido por redundância** (mesmo critério do PPD, decisão 35). (b) **vizer.beauty** — o **addon deixou de existir** (`/manifest.json` virou HTML, o domínio virou site em `www.`) e o `mxcontent.net` tem **token atrelado ao IP** que abriu o embed (quem busca é o cliente, outra IP → 403). (c) **youcinehd.lat** — o fluxo inteiro foi achado (handle no HTML → `/csrf-token` → POST `/__siteplay/start` → 2 `sources`), mas **as duas fontes são Cloudflare Turnstile** (página "Verificação", zero `m3u8` no HTML, `sitekey 0x4AAAAAAE8_yrTzhL7CTZiB`); sem navegador não passa, e resolvido o token ele fica atrelado à sessão — restaria.proxy com navegador a cada play, contra budget de 9s e 504 em 12s. (d) **vizer.autos — ACEITO (VZR)**: WordPress PT-BR, ~57k filmes / ~15,7k séries. O player é `POST /wp-json/api/v1/player-resolve` (`{tmdb, type: movie|episode, season, episode}` — o `type` de série é **`episode`**, não `tv`), mas a URL devolvida é **derivável só do TMDB**: `nixplay.lat/{movie|series}/{bucket}/{token}/{tmdb}[{S:3}{E:3}].mp4` → 302 → **Cloudflare R2** assinado (5h). Como **o `vizer.autos` é CF-bloqueado do egress DE** (403, medido pelo proxy da prod com UA de browser + Referer) e **o `nixplay` responde 200 `video/mp4` do mesmo egress**, o scraper **não toca no site** — só monta a URL. Medido: acerto **17/20 (85%)** em títulos escolhidos, ausente volta `206` + `text/plain`, **ffprobe OK (8177s)**, probe médio ~250ms, **1 request**, sem cookie, sem embed, sem JS. **A pegadinha que quase matou a fonte**: o `nixplay` responde **403 para qualquer valor de `Referer`** e aceita ausente ou vazio — como o `browserFetch` sempre manda Referer, o primeiro lote deu **0/20** e a fonte parecia morta; o stream agora sai com `proxyHeaders.request = { Referer: "" }`. (e) **Ajuste no `video-probe` que a fonte exigiu e que melhorou o resto**: o parse de MP4 passou a ser **estruturado** (`moov/trak` → `mdia/hdlr` = `vide` → `minf/stbl/stsd` → VisualSampleEntry, com 4CC de codec validado) em vez de varrer o buffer; `mp4MetaStart` agora tolera `mdat` maior que o buffer (todo `mdat` é enorme e antes ele era descartado → o probe caía no scan solto e lia **bytes de mídia como se fossem box**, inventando 1536x1434 num arquivo que é 1920x1080); e `moov` **truncado** não é mais parseado (era ele que produzia o valor falso), com releitura só quando `moov.size ≤ 1,5MB`. Ordem final do `probeVideoInfo`: **TS** → `moov` íntegro → `moov` truncado (releitura) → janela após o `mdat` → **scan solto só por último**. Resultado: **5/5 conferido com ffprobe** (era 4/5) e ATB/DGO/RTD continuam exatos. (f) **O idioma da VZR é desconhecido, e isso é declarado**: o `moov` chega a **9,1MB** (tabela de amostras gigante) e as tracks de áudio ficam depois dele, então ler as tags `mdhd` custaria MB por candidato (8s medido) — não compensa. O arquivo **é dual audio** (`por` + original, confirmado por ffprobe), mas como não dá para verificar com request barato, o stream marca `audioUnknown` e o ranker **omite a linha de idioma** em vez de mentir "Original" (estado novo em `getAudioInfo`). Validação: testes **78/78**, e2e **27/27**, `vod-sources` **26/26 sem erro**, `audit` **24/24 · ffprobe 13/14 (só o ATO, egress) · match BAD 0**.
- **25/09/2026 — rodada "RAM < 300MB + TV quebrada" (decisões 41/42)**: (a) **RAM**: o alvo era < 300MB com muitos usuários — medido **266MB idle / 411MB sob carga** e **1495 erros em 3000 requests**. Causas e correções: (i) **cache dos catálogos Xtream guardava a lista INTEIRA** (9,6k-31k itens por painel × 3 painéis, com o campo `plot` de centenas de caracteres) — agora `getVodList`/`getSeriesList` projetam só `name/title/stream_id/container_extension` (`toCompactVod`/`toCompactSeries`) ⇒ **RSS idle 266 → 88MB**; (ii) **`browserFetch` não tinha teto de corpo**: um origin que ignora `Range` e responde 200 despejava o arquivo inteiro em `chunks[]` (um MP4 de 682MB ≈ 1GB de pico) — agora `MAX_BODY_BYTES = 8MB` com abort no `content-length` e no streaming; (iii) **`rateLimitMap` sem limite e chaveado pelo `X-Forwarded-For` cru** (o mais à esquerda, 100% controlado pelo cliente) ⇒ vazamento **e bypass de rate limit**; agora usa `req.ip` (o Express já confia 1 hop) + `RATE_LIMIT_MAX_KEYS = 20000`; (iv) **`hostQueues` sem teto de hosts** (o host vem de `/stream/proxy?url=`, ou seja, do cliente) — `MAX_QUEUE_HOSTS = 2000`; (v) **`inflightStreams` sem teto** — `MAX_INFLIGHT_STREAMS = 300` (depois de criar a promise, então nunca perde requisição); (vi) caches de m3u8 do relay: 50 → 20 e buffer 1MB → 256KB. **Bônus de correção (não era RAM)**: a otimização "a 2ª query de anime só roda se a 1ª vier vazia" estava **morta desde a rodada 33** — `runAnimeQueries` recebia a *função* `animeSink.push` mas testava `onStreams.count` (sempre `undefined`), então as 2 batches de 5 scrapers rodavam **sempre**; agora recebe o objeto e usa `sink.push()`/`sink.count`. Resultado: **12000 requests / 120 concorrência / 0 erros / 431 RPS / p95 455ms / pico de RAM 252MB** (era 411MB e p95 8856ms no stream). (b) **TV quebrada — e EU ESTAVA ERRADO**: o dono avisou que os embeds dele funcionavam, e tinha razão. O `embedtv.lat` **não** havia morrido: o scraper tinha o **host das playlists velho** hardcoded (`...37e7288491.../ss/<canal>.txt` → 404 nginx em todos os canais) e a página nova servia um manifest-isca (`live-chunks.mediacdn.net`, **NXDOMAIN em 4 resolvedores**, e o mesmo `manifest/763` para os 147 canais). O vídeo real estava em `https://52d080a3e172c33fd6886a37e7.s23-cloudfront-net.lat/<hash>/<canal>.txt`. Corrigido com `resolvePlaylist` novo: lê `embedtv.lat/api/channels` → url da página do canal → extrai a playlist por regex → **cache 30min** (`PLAYLIST_FALLBACK` como rede de segurança). **O subdomínio do site gira a cada chamada** (`2fc98c88…` → `7511432a…`), então nada pode ser hardcoded. **ffprobe: HLS 1280x720 ao vivo, 200 OK**. E para **não repetir a falha em silêncio**: `resolvePlaylist` agora **valida a playlist** (Range `bytes=0-255` + confere `#EXTM3U`) e só a usa se responder; se nem a página nem o fallback servirem, devolve `null` e o canal **não é listado** (canal inexistente medido = 0 streams). **Cuidado discovery na prod**: o host das playlists dá **403 para o egress DE** (mas 200 do egress BR), então a validação não pode ser rígida — `playlistVerdict` diferencia **`dead`** (404/410/451/HTML) de **`unknown`** (403/timeout/rede) e só descarta no `dead`; senão a prod parava de listar canal que o cliente BR abre. Ou seja: se o embedtv morrer de verdade, o addon para de anunciar canal morto em vez de entregar 404 — falha visível, não silenciosa. Teto de RAM: `MAX_CATALOG_BYTES = 64MB` separado do teto padrão de 8MB (o catálogo do **SPC tem 29,2MB** e o corte de 8MB quebrou os painéis — pegado pela auditoria, não pelo e2e) e `NODE_OPTIONS` de `--max-old-space-size=350` para **224**: RSS estabiliza em **216-220MB** com 3 rodadas de carga (antes oscilava 257-481MB). Boot frio com 6 títulos = 187MB, sem OOM. Rate limit conferido: 180 liberados / 20 bloqueados em 200 requests do mesmo IP, e 2 IPs alternados não se atrapalham — `req.ip` isola corretamente. Lição registrada: **404 de origem não prova que o serviço morreu** — checar o caminho novo antes de declarar uma fonte morta.

- **26/09/2026 — rodada "mascarar links + fechar o worker" (decisões 43/44)**: (a) **WORKER FECHADO (decisão 43)**: o auditor achou que `/proxy`, `/rde/seg` e os dois `/relay/*` aceitavam **qualquer URL** — proxy aberto (SSRF contra `169.254.169.254` e rede interna) e sem limite de bytes (o `/proxy` sem `Range` baixava o arquivo inteiro: medido **682MB / 90s**). Agora há `ALLOWED_HOSTS` (21 hosts, levantados **empiricamente** das streams reais, não chutados) + `ALLOWED_SUFFIXES` (12 sufixos: `.googlevideo.com`, `.r2.dev`, `.madfirebox.shop`, `.maximaimg.online`, `.123pelicula.com`, `.hclod.qzz.io`, `.watchplay.shop`, `.s23-cloudfront-net.lat`, `.blogspot.com`, `.blogger.com`, `.rdembed.sbs`, `.cloudflarestorage.com`) + `BLOCKED_HOST_PATTERNS` (loopback, RFC1918, link-local, IPv6 ULA/link-local, `.local`/`.internal`) e `targetAllowed` exigindo `https:`. Os 4 guards foram testados **localmente antes do deploy**: **21/21 hosts legítimos permitidos, 0/14 vetores de ataque vazaram** (o teste pegou 3 hosts faltando — `telaplay93.top`, `4x4u29c.autos`, `cnn.radiogaucha.fun` — que teriam quebrado SPC/ATO/RTD). Deploy feito; em produção os ataques dão 403 e kakito/nixplay continuam 200. (b) **MÁSCARA DE LINKS (decisão 44)**: o dono pediu para esconder as URLs das fontes. Implementado como **uma passagem central** (`maskStreamUrls` em `buildResult`), não editando 13 scrapers: cada stream direto vira `{addon}/stream/proxy?k=<token>&u=<b64>&r=<b64>`, com o `Referer` de cada fonte embutido no token. Token = HMAC-SHA256 de `exp|origin|referer` (segredo em `PROXY_SECRET`, TTL 6h) validado com `timingSafeEqual` — assim o proxy **não** pode ser usado como relay aberto por terceiros, e `Referer` adulterado é recusado. Só mascara arquivo direto (`.mp4/.m4v/.mkv/.webm/.mov`); **HLS continua no relay do worker** (máscara de m3u8 deixaria os segmentos vazando). `RATE_LIMIT_PROXY_MAX` 600 → **6000/min**, porque o proxy deixou de ser um extra e virou o caminho de vídeo (cada seek do player é um request). Medido: **ffprobe na URL mascarada = 1280x532 / 8177s**, `Range` 206 com o byte exato (seek ok), token forjado → 403. Regressão: e2e 27/27, 78/78 testes, 8000 req / 80 conc / **0 erros** / p95 413ms / **pico 169MB**. **Chave de desligar**: `MASK_STREAMS=off` volta ao comportamento anterior em uma variável de ambiente.

- **26/09/2026 — rodada "mascarar TODAS as fontes + corrigir o RTD" (decisões 44/45)**: (a) **BUG REAL que explicava a qualidade do RTD**: `browserFetch` era **usado 2× em `src/server.js` e nunca importado** (`probeViaWorker` e o novo `originReachable`). O `ReferenceError` era engolido pelo `catch` ⇒ `probeViaWorker` devolvia `null` ⇒ RTD ficava `quality: unknown` **na prod, mas não localmente** (local o probe direto alcança a CDN, então o fallback nunca era usado). Corrigido no import; existe agora um **teste que varre todo `require` destruturado do `server.js` e falha se algum nome não for exportado** (pegaria essa classe de bug). (b) **Máscara em todas as fontes, inclusive TV**: `maskStreamUrls` agora também manda **HLS pelo relay do worker** (`relayM3u8Url`) e o `MASKABLE` foi ampliado (`ts`, `m3u8`, `videoplayback`, `?itag=`) para pegar o **AON/googlevideo**, que não tem extensão e escapava. A TV parou de entregar a origem: `/stream/hls/:file` passou a redirecionar para o **relay do worker** (antes fazia 302 para a CDN crua). Medido em 5 pedidos (filme, série, anime, TV): **0 origens expostas** e **0 streams sem qualidade**. (c) **RESGATE (o ponto crítico)**: a máscara **quebrou o play** de BLZ/KKT/RTD porque o egress do BeamUp **não alcança** `kakito.xyz` nem `cnn.radiogaucha.fun` (502 do Cloudflare em ~0,3s, sem log no app, uptime parado ⇒ não é timeout nem crash). Antes these fontes funcionavam porque o **cliente** baixava direto do Brasil. Solução: `originReachable()` (probe de 2 bytes com cache de 5min por host+Referer) — se o servidor **não** alcança a origem, a rota responde **302 para a origem** e o cliente toca direto. Regra preservada: **fonte que não toca no 1º play não entra**. (d) **Bug do worker**: o relay reescrevia só as linhas de URL e **pulava todas as linhas `#`** ⇒ em HLS fMP4 o `#EXT-X-MAP:URI="init.mp4"` ficava cru e o player pedia `workers.dev/relay/m/init.mp4` → **502, SPT não tocava**. Agora o relay reescreve `URI="..."` dentro das tags (cobre `EXT-X-MAP` **e** `EXT-X-KEY`, que quebraria HLS cifrado). ffprobe do SPT: 1736x720 / 8318s. Validação: **80/80 testes, e2e 27/27, vod-sources 24/26 (os 2 de sempre), 9/9 streams mascarados tocando com ffprobe, carga 8000 req / 80 conc / 0 erros / p95 388ms / pico 176MB**.

- **26/09/2026 — rodada motor de scrapers + fonte ETC + correções (decisões 46/47/48)**:
  - **(a) MOTOR DE SCRAPERS (46)**: `src/lib/scraper-engine.js` — contrato único (`run(ctx)` com **um objeto de contexto** em vez de 2–7 parâmetros posicionais), timeout por fonte, **circuit breaker** (3 falhas → 5min), single-flight, métricas por fonte e **normalização garantida** (todo stream sai com `id/type/name/url/season/episode/quality/size/sources/dubbed/portuguese/subtitle/subtitles/behaviorHints`). `src/core/sources.js` é o **registro declarativo das 11 fontes de VOD** (adicionar fonte = ~4 linhas). O `server.js` encolheu: 11 imports de scraper, o `Semaphore`, as 6 lambdas do fan-out e o `runAnimeScrapers` saíram; sobrou `engine.start(ctx)`. `/health` expõe `capacity.scraperEngine` com contagem por fonte.
  - **(b) Bugs corrigidos**: `getPublicBaseUrl()` **era usado mas não existia na exports** — se `runtimeBase` fosse vazio o `ReferenceError` subia pelo `buildResult` e devolvia `{streams:[]}` para o pedido inteiro. O `buildResult` **reconstruía o objeto do stream e perdia** `poster`, `isLive`, `audioUnknown` e qualquer `behaviorHint` novo (agora espalha `{...item}` + hints mesclados). O **SHG fixava `season: 1`** (temporada 2 era descartada no filtro) e tinha fallback que **servia episódio 1** quando o pedido não existia. `browserFetch` **seguia redirect e jogava fora a URL final** (agora expõe `res.url`). 4 imports mortos + `isKakito`/`subtitles` variáveis mortas removidas. `notWebReady` no motor passou a ser derivado dos `headers` como o `makeHttpStream` faz (compatibilidade com TV/celular).
  - **(c) Worker**: com `redirect:"manual"` o Cloudflare devolve **status 0** (redirect opaco) e o código tentava `new Response(..., {status: 0})` → *"Responses may only be constructed with status codes in the range 200 to 599"*. Corrigido com `safeStatus()` + `redirectTarget()` em todas as rotas.
  - **(d) e2e instável (50%)**: o `fetch failed` era o **próprio teste** reaproveitando conexão morta depois do `spawnSync` do ffprobe — `e2e-flow.js` agora manda `connection: close` e repete 1×. **5/5 e 27/27 estáveis**; o servidor nunca esteve errado.
  - **(e) FONTE ETC (47)**: `https://embedtv.vercel.app` → API é `https://apisinalpublico.vercel.app/canais.json` (147 canais, só `name/url/image`; id vem de `?id=`). Página do canal `sinalpublicoetv.vercel.app/?id=X` → iframe `sinaldvd.github.io/tv/player.html?id=X` → `m8q2v7r4k1-cloudflare-net.vercel.app/{id}.m3u8` **exige `Referer` do player** (sem ele o 302 vai para `google.com/admin/stream.m3u8` = 404) → 302 → `t5r4e3w2q1y0ty.s23-cloudfront-net.lat/sinalpublico/{md5}/file.txt`, que é **estável** (token de conteúdo) e **não exige Referer** (funciona no Nuvio). Medido: **12/12 canais da amostra tocando**, frame real extraído (1280x720), 24/25 playlists e 23/25 segmentos em amostra maior. **O worker NÃO relaya esse CDN** (devolve **666** da rede Cloudflare, enquanto curl do VPS dá 200) ⇒ a ETC entrega **2 variantes**: mascarada pelo `/stream/proxy` do addon e direta. Gênero inferido por regex no nome (a API não tem categoria). TV total: **145 EMB + 147 ETC = 292 canais**.
  - **(f) REGISTRO DE TV (48)**: `src/core/tv-sources.js` — `PROVIDERS` com prefixo de slug (`etc:`), `ownerOf()` roteia, catálogo/meta/streams/playlist unificados; o servidor não conhece mais o EMB.
  - **(g) Máscara de TV**: `maskTvUrls()` no caminho de TV (que antes não passava pelo `buildResult`) e `/stream/hls` agora **assina** a URL (`maskUrl` com `force`, porque a playlist termina em `.txt` e não casava com `MASKABLE`).
  - **Validação**: 87/87 testes (7 novos: motor, breaker, timeout, gêneros da ETC, registro de TV, catálogo do motor, **compatibilidade com clientes**), e2e 27/27, vod-sources 24/26, carga 8000 req / 80 conc / **0 erros** / p95 465ms / **pico 171MB**.

- **26/09/2026 — link direto por padrão (decisão 49)**: o dono pediu que **todas as fontes entreguem o link direto da origem**, como o RTD — o vídeo passa a sair da **máquina de quem assiste** (a origem vê o IP da pessoa, não o do servidor), o que é mais privado **e** resolve a maioria dos bloqueios de saída. A máscara de links virou **opcional**: liga com `MASK_STREAMS=on`, desliga por padrão. Com a máscara desligada, `maskStreamUrls`/`maskTvUrls` não correm, `applyStreamProxy` devolve a URL crua, o relay de anime HLS não é aplicado, `playerflix.proxyIfNeeded` não relaya, `embedtv` não gera a variante "Relay" e `/stream/hls` redireciona para a playlist crua. O `Referer` que cada origem exige continua em `behaviorHints.proxyHeaders` (é o que o Stremio envia em celular/TV/desktop). Medido: **13/13 links diretos tocando** (BLZ/SPT/RTD/VZR/KKT, SHG/RON/AON, e um 4K), RTD incluso com o Referer. Ganho colateral: BLZ e KKT passaram a **deduplicar de verdade** (são o mesmo arquivo em `kakito.xyz`; antes a máscara criava tokens diferentes e os dois apareciam).

- **26/09/2026 — o probe do RTD é limitado pela rede da prod (limitação, não bug)**: com o link direto (decisão 49) o RTD **toca** (o dono confirmou), mas o **rótulo de qualidade** depende de o servidor conseguir ler 1 MB da CDN. Medido: da minha máquina (VPS DE) o probe worker → **206 → 1280x544 → 720p**, e o servidor local marca **720p**; da **prod** o worker responde **`Upstream 403`** para `cnn.radiogaucha.fun` — a prod não alcança **nenhum** host do RTD (`redetoons.win` e `cnn.radiogaucha.fun` dão 502 do Cloudflare antes de chegar no app) e o **PoP do Cloudflare que atende a prod é recusado pela WAF do RTD**. Não é bug do código: mesmo `code`, mesma URL (md5 conferido) e mesmo `ref` retornam 206 daqui e 403 de lá. Detalhe do RTD: o `play-link` devolve `variants[].mirrors`, e os espelhos **vencem antes** (`exp=` no passado) — por isso o `hasExpiredSignedUrl` importa. O `probeViaWorker` agora tenta 3 caminhos (`/proxy`, `/proxy` de novo, `/relay/s`) antes de desistir, e o log ficou uma linha concisa. **Resultado prático**: RTD aparece sem qualidade na prod; todas as outras 12 fontes têm qualidade. Como destravar: ligar `BR_RELAY_URL` (o relay BR existe exatamente para isso) ou trocar a fonte do probe.

- **26/09/2026 — TOP removido (decisão 50)**: o dono tirou a fonte **TOP (topanimes.net)**. Medido antes de remover: 3 chamadas, 1 sucesso, **0 streams** — o site bloqueia por assinatura de datacenter, e o único caminho de reserva (captura do Wayback) entra em fila e não volta a tempo. Removido em 4 lugares: `src/core/sources.js` (motor), `src/lib/source-names.js` (label/prioridade/manifesto), `test/mirror.test.js` (2 testes, um deles agora **garante que TOP não volte**) e o arquivo `src/scrapers/topanimes.js` (apagado — 408 linhas de código morto). Fontes de anime restam **4**: SHG, RON, AON, ATB. **Nota**: ATB costuma devolver o **mesmo arquivo** que o RON (mesmo CDN `cdn-s01.mywallpaper-4k-image.net`) e o dedup remove — apareceu “faltando” mas é duplicata real.

- **26/09/2026 — KKT: painel online para o dono, fora para o servidor**: o dono testou e o painel `kakito.xyz` funciona da máquina dele. Do servidor o painel responde **`{"error":"MySQL: Connection refused"}`** de forma **consistente (6/6)** tanto no acesso direto quanto **através do worker** — ou seja, o painel recusa o IP de datacenter e devolve um erro de banco falso. Como o **link é direto** (decisão 49), o vídeo *tocaria* na máquina do dono; o que falta é só o **catálogo**, que o servidor precisa ler. Sem acesso ao relay BR (SSH sem chave), não dá para buscar o M3U por ele. A fonte **permanece registrada** e o circuit breaker re-tenta a cada 5 min — volta sozinha se o painel passar a atender o IP do servidor. Alternativa se o senhor quiser: mandar uma **cópia filtrada do M3U** (só `/movie/` e `/series/`) para eu guardar como reserva no repositório.
- **26/09/2026 — auditoria de links + TOP fora + KKT/RTD bloqueados no servidor (decisões 50/51)**: 
  - **Auditoria de todos os links** (filme, série e anime): **nenhum link com IP local** e **9 de 10 fontes tocam sem nenhum header**. Só o **RTD exige `Referer`** (206 com, **403 sem**); o resto (SPC, SPT, ATO, KKT, VZR, SHG, RON, AON) responde igual com ou sem. Para o RTD (e DGO, que também exige) o servidor agora gera uma **2ª variante `🔗 sem precisar de Referer`** que passa pelo **worker** (que injeta o Referer e tem egress bom) — assim o RTD passa a tocar também no Nuvio/web, que ignora `proxyHeaders`.
  - **Vazamento de IP local corrigido**: `videoBases()` caía em `http://localhost:${PORT}` quando `PUBLIC_BASE_URL` não estava setada, e esse link ia para o cliente ( quebrado). Agora `videoBases()` só aceita base `http(s)://host` válida e devolve **lista vazia** → o ATO entrega o **link direto** em vez de embrulhar no `/stream/proxy` (o proxy só é usado com `MASK_STREAMS=on`). `panelStreamVariants` deixou de criar a 2ª variante quando a URL não muda. E a rota `/stream/proxy` passou a usar **o host do próprio pedido** (`req.protocol + req.get("host")`) como reserva em vez de `localhost`.
  - **TOP removido (decisão 50)**: `src/core/sources.js`, `src/lib/source-names.js`, `test/mirror.test.js` (um teste agora **garante que TOP não volte**) e o arquivo `src/scrapers/topanimes.js` (408 linhas) apagados. Anime restam **4** fontes.
  - **KKT: o painel está online para o dono e offline para o servidor**: `kakito.xyz` devolve `{"error":"MySQL: Connection refused"}` de forma **consistente (6/6)** no acesso direto e **através do worker** — o painel recusa IP de datacenter com um erro de banco falso. Como o link é direto, o *vídeo* tocaria na máquina do dono; o que falta é o **catálogo**, que só o servidor lê. A fonte segue registrada e o breaker re-tenta a cada 5 min. Alternativa: o senhor mandar uma cópia filtrada do M3U (só `/movie/` e `/series/`) para eu guardar como reserva.
  - **RTD: a API passou a exigir Cloudflare Turnstile**: `play-link` responde `{"error":"turnstile_required"}` em **3/3** tentativas, direto e via worker; o outro caminho do worker (`/rde/m3u8`) dá `channel not found`. Ou seja, o **vídeo continua tocando** (a CDN aceita com Referer — testei a URL do dono: 206 com, 403 sem), mas **o servidor não consegue mais descobrir vídeos novos**. Antes a fonte devolvia `[]` sem erro e o motor achava que estava saudável; agora o `turnstile` vira **falha explícita** (`rtd bloqueado (turnstile)`), o breaker protege e o `/health` mostra o problema. Passar pelo Turnstile exigiria navegador real (300MB+ de RAM, briga com o teto do dono).
  - **Validação**: 82/82 testes, e2e 27/27, carga 6000 req / 60 conc / 0 erros / p95 376ms / pico 221MB.
- **26/09/2026 — TV unificada (decisão 52) + bug meu no relay (decisão 53)**: (a) **Catálogo de TV unificado**: antes cada canal aparecia **duas vezes** no catálogo (uma entrada do EMB, uma da ETC) e cada entrada só oferecia a **sua** fonte — por isso "às vezes EMB, às vezes ETC". Agora `src/core/tv-sources.js` agrupa os canais dos 2 provedores por **nome normalizado** (`normKey`: minúsculas, sem acento, só alfanumérico) e devolve **1 entrada por canal**, e `getStreams` pergunta a **todos** os provedores daquele canal. Resultado: **161 canais** (antes 292 entradas), **131 com as duas fontes** e só 30 com uma. O `id` passou a ser `tv:live:<nome-normalizado>` e um índice em memória (`groups`) guarda de qual provedor veio cada slug, com fallback para ids antigos. A **prévia** (logo) continua no `poster`/`background` — é ela que o Stremio usa de fundo na tela de play — e agora é repassada para **todos** os streams do canal (`poster` no stream), inclusive os da ETC, que antes podiam vir sem. (b) **Bug meu no worker**: eu tinha criado a variante `🔗 sem precisar de Referer` do RTD/DGO apontando para `/relay/s?ref=…`, mas **`/relay/s` nunca leu o parâmetro `ref`** (só `/proxy` e `/rde/seg` liam) — a origem respondia 403 e a variante **não tocava**. Corrigido: `/relay/s` injeta o `Referer` e o **`/relay/m` repassa o `ref` para os segmentos que ele reescreve** (`URI="…"` e as linhas de segmento), senão uma playlist relayed perdia o Referer no primeiro segmento. Medido: `/relay/s` do RTD passou de 403 para **1280x544**, e o canal Band Sports tocou nas **3 vias** (EMB, ETC mascarada, ETC direta) em 1280x720. (c) **ETC "não conecta"**: o diagnóstico é que os segmentos do CDN da ETC saem com `content-type: application/javascript` (são MPEG-TS disfarçados, `0x47` no início) — alguns players recusam. A playlist e os segmentos são válidos (3/3 íntegros na simulação HLS). O worker **não alcança** esse CDN (`666` da rede Cloudflare, e a prod também não — 502), então o caminho que funciona é o **nosso** `/stream/proxy`, que força `video/mp2t`; por isso a ETC é entregue em 2 vias (mascarada pelo addon + direta).

- **26/09/2026 — os 4K não(sumiram), os painéis é que oscilavam (decisão 54)**: o dono reclamou que os "links grandes" do VOD tinham desaparecido. **Medido: os 4K continuam lá** — Batman (tmdb:155) devolve `2160p` da SPC (rotulada "4K"), da ATO e da KKT, e Interstellar (157336) também. O que o senhor via era **os painéis de IPTV oscilando**: `kakito/telaplay/4x4u29c` às vezes respondem com catálogo vazio ou `MySQL: Connection refused`, e quando o painel não responde o item 4K some **só naquela consulta** (o resultado degradado é cacheado por 60s). Correção: `fetchListWithRetry()` no `xtream.js` faz **3 tentativas** (250ms/500ms de espera) para o catálogo de filmes e de séries de cada painel antes de desistir. Efeito medido no mesmo título: antes oscilava entre **9 e 12 streams e 2–3 4K**; agora **12 streams e 3 4K de forma constante** (SPC + ATO + KKT). Carga: 8000 req / 80 conc / 0 erros / p95 357ms / pico 207MB.

- **26/09/2026 — EPG de TV (decisão 55)**: o dono perguntou do "lugar próprio para EPG". **A especificação oficial do Stremio não tem campo EPG** ( conferi `docs/api/meta/meta.element.md`: só id/type/name/genre/poster/description/year/videos/…) — o jeito que os addons de guia fazem é colocar **"agora no ar" e "a seguir"** na descrição. Nossas duas fontes de TV **não dão programação** (a EMB devolve `id,image,name,categories,preview,url`; a ETC só `name,url,image`), então os dados vêm de fora: **`https://epg.pw/xmltv/epg_BR.xml.gz`** (570KB gz / 6,3MB xml, 334 canais, ~21 mil programas).
  - `src/lib/epg.js`: baixa e descompacta, faz **parse por stream**, guarda **só o que importa** (canais que batem com o nosso catálogo + janela de 90min) em tupla compacta `[titulo, inicio, fim]`, e monta a linha `📺 <agora> até HH:MM` / `⏭️ A seguir: <programa> (HH:MM)`. Medido: **113 canais com programação cobrindo 86 dos 161 nossos**, carga em **0,55s**, custo de memória **~22MB** (pico do servidor 207 → **229MB**, dentro do teto de 300MB). A linha entra na `description` do **catálogo** e do **meta**.
  - **Pegadinhas do XMLTV**: o `<programme>` tem os atributos em **ordem variável** (`channel` antes de `start`), o `display-name` tem atributo `lang`, o título vem com entities, e **o horário já é local (BRT)** — tratar como UTC e converter deslocava tudo 3h (`epochDe()` soma `+3h` e a exibição usa `timeZone: UTC`).
  - Sem EPG o canal aparece normal; se o guia não baixar, `state.status` fica `vazio` e **nada quebra** (degradação silenciosa). `/health → capacity.epg` mostra `status/canais/programs/erro`.

- **26/09/2026 — EPG aparecendo + auditoria individual por fonte (decisões 56/57)**: (a) **EPG não aparecia** por dois motivos: o **catálogo era montado antes do EPG carregar** (2,5s) e ficava em cache 15min ⇒ agora `epg.onCarregar()` dispara `cacheInvalidado()` → `setCacheInvalidator` limpa o cache do catálogo; e o **`rankAnimeStreams` reescreve o título** dos streams, apagando a linha do programa ⇒ o servidor agora **anexa o programa depois da ordenação** (no `title` de cada stream, que é o que o usuário vê na lista de fontes). O casamento do guia ficou mais justo: `endsWith` para o prefixo de cidade (`São Paulo/SP History 2` → `History 2`) e **escolhe o candidato de maior sobreposição** (antes `History 2` herdava o programa do `History`). Resultado: **82/161 canais com guia** (os 79 sem guia são canais de evento específico — `Campeonato Inglês (F) ...` — que nenhum guia tem). (b) **`audit-vod.js` (decisão 57)**: roda as 10 fontes de VOD/anime uma a uma em 8 títulos, faz **probe real** de cada stream (Range, corpo limitado a 4MB, `detectResolution`) e sai o resumo por fonte. Resultado medido: `kkt 5/6 toca` (rápido, 1,4s) · `spt 4/6` · `vzr 4/6` (3 qualidades medidas) · `rtd 4/6` (**4 qualidades medidas, voltou a funcionar**) · `shg 2/2` · `aon 2/2` · `ron 3/3` (4,8s, o mais lento) · `atb 2/2` · **`blz 1/6 com 4 erros** · `dgo 0/1`. Achado importante: **SHG declara 1080p e é 720p; AON declara 720p e era 480p** — quem salva é o probe do servidor, que sobrescreve pelo valor medido.
  - **Os 3 painéis Xtream estão caídos**: `kakito.xyz` (Blaze) → `MySQL: Connection refused`; `telaplay93.top` (Space) → autentica mas devolve **0 itens**; `4x4u29c.autos` (Autos) → **404** (painel não existe mais). Todos são externos. O circuit breaker protege, mas a fonte BLZ fica 1/6.

- **26/09/2026 — EPG NATIVO do Stremio (decisão 56) + painéis Xtream todos fora (decisão 57)**: o dono avisou que o Stremio **criou uma aba própria de guia de canal** e que eu estava colocando o EPG no lugar errado. Conferi no **exemplo oficial do SDK** (`stremio-addon-sdk/examples/epg-livetv.js`) como o nativo funciona e refiz: manifesto com **`behaviorHints.epgProvider: true`**, catálogo de TV com o extra **`date`** (e `skip`), resposta **`metasDetailed`** com `videos` (um item por programa: `id/title/overview/released/startTime/endTime/runtime/releaseInfo`) + `hasScheduledVideos: true`, e o `/meta` do canal com a grade do dia. **Bug que quase passou**: o servidor tem uma **rota Express própria** para `/catalog/:type/:id.json` que roda **antes** do `sdkRouter` — editar o `defineCatalogHandler` não mudava nada, a rota é quem responde.
  - **Janela do EPG mudou** de 90min para **ontem 00:00 → amanhã 24:00** (BRT) para a grade do dia inteiro caber. RSS subiu de 150MB para ~185MB (limite 300MB, ok). Medido: **82/161 canais com grade hoje, 71 amanhã**; catálogo sem `date` = 65KB, com `date` = 660KB.
  - **Os 4 painéis Xtream estão fora, e é externo**: testado **direto** (sem worker, sem retry) — `kakito.xyz` (Blaze) responde 200 mas o **banco do painel** recusa conexão em *todos* os endpoints, inclusive o M3U (`{"error":"MySQL: Connection refused"}`), e às 00:50 de hoje ainda servia 6 linhas ⇒ o banco caiu entre 00:50 e 01:56; `telaplay93.top` (Space) autentica (conta ativa, **31 categorias**) mas **`get_vod_list` e `get_series` devolvem 0**; `4x4u29c.autos` (Autos) devolve a **página de boas-vindas do nginx**; `dns.explouddev.com` (Exploud, que estava com `XTREAM_EXPLOUD_DISABLE=true`) redireciona **tudo pro google.com** = domínio morto. Conclusão: BLZ/SPC/ATO estão sem conteúdo por causa externa, o circuit breaker segura. **Decisão pendente do dono**: manter esperando voltarem ou tirar do registro como foi feito com o TOP.

- **26/09/2026 — TV em cluster separado (decisão 58) + pente fino no TV (decisão 59)**: o dono pediu "outro cluster tipo o mirror2" — **o addon continua o mesmo**, mas as **3 rotas de TV respondem 302 para o app2**; VOD e meta de série ficam no app1. `TV_ONLY=on` no app2 desliga o aquecimento de VOD. Dois cuidados que só apareceram testando: o **id vem `tv%3Alive%3Ahbo`** (o `:` codificado), então o detector de rota de TV precisa **decodificar** o path, e a **base das URLs absolutas tem que vir do request** — senão o app2 devolvia link do app1.
  - **Pente fino (161 canais)**: 161/161 devolvem stream, **131 com as duas fontes** (EMB+ETC), 30 com uma só, **82 com guia hoje** e 71 amanhã. Os ~43 canais que a triagem marcou como mortos se dividem em: **12 eventos que já acabaram** (jogo de futebol encerrado, episodes de A Fazenda) — normal; e **~10 canais com origem caída na fonte** (Star Channel e CazeTV 3 dão **502**; HBO Xtreme, Disney Plus 2/3, Sportv 4, Premiere 3-8, Max 1-3, Prime Video, Paramount Plus 2, SportyNet+ 2/3 dão **404** no CDN da ETC). Vários desses nomes são de **filme/série** (Premiere, Disney Plus, Max), que provavelmente nunca tiveram canal ao vivo.
  - **ERRO GRAVE (o dono avisou: "o tv ao vivo nao carregou nenhum canal"): 302 NÃO FUNCIONA.** O cliente do Stremio/Nuvio **não segue redirecionamento** em `/catalog` e `/meta` — ele recebia o texto `Found. Redirecting to...` e ficava **sem nenhum canal e sem prévia**. Trocado por **repasse interno** (`repassaTv`): o app1 busca o JSON no cluster de TV e devolve **como resposta própria**, com `Cache-Control: no-store`. Só o JSON passa (65KB, ou 660KB com a grade) — **vídeo nunca passa pelo app1**, que era o objetivo. **Bônus de segurança**: se o cluster de TV cair, o repasse chama `next()` e o **app1 serve o TV localmente** (o código de TV está nele), então o split virou **otimização, não ponto único de falha**. Timeout `TV_PROXY_TIMEOUT_MS` (8s), e resposta > 4MB ou vazia também cai para o local.
  - **Por que 73 canais não têm guia (decisão 61)**: não é falha nossa — o `epg.pw/xmltv/epg_BR.xml.gz` que usamos tem **só 334 canais** e **não traz** Canção Nova, MTV, Star Channel, XSPORTS, Masterchef, AE, Record MG/RJ/GO, A Fazenda, nem os canais 24H de desenho. Quebrando os 75 (depois 73) sem guia: **9 eventos de uma partida só** (ninguém tem), **22 nomes de serviço de streaming** (Disney Plus, Premiere, Prime Video, SportyNet+, UFC Fight Pass — não são canais), **13 de Portugal** (o guia é brasileiro; `epg.pw` **não tem** `epg_PT`, e `xmltv.pt`/`telerising`/`xmltvrc` **não são alcançáveis** daqui), **31 outros** que o guia realmente não tem. O internacional `epg.xml.gz` do epg.pw tem **57MB gz** (passa do `MAX_BYTES` de 24MB e explodiria o RAM) — inútil para nós. **Ganho real possível: 2 canais** (Playboy, Sexy Hot) resolvidos tirando o prefixo `24h` no casamento (`norm()` virou `24horas` → remove no fim, para não quebrar o filtro por prefixo). `audit-epg.js` mede isso.
  - **KAKITO como TERCEIRA fonte de TV ao vivo (decisao 79)**: o kakito so era usado como VOD, mas o painel tem a secao live e o dono pediu para usar. `src/scrapers/kakito-live.js` no **mesmo padrao do EMB/ETC** (`getCatalog`/`getMeta`/`getStreams`/`resolvePlaylistUrl`), registrado em `tv-sources` como `{ id: "kak", prefix: "kak:" }`. Medido: **`get_live_streams` = 1282 entradas em 36 categorias**, e `.ts` **e** `.m3u8` tocam. **O painel SERVE m3u8** — o dono avisou e eu ja tinha testado errado: eu testava `.ts` primeiro e, como tocou, **saia do laço antes de tentar o `.m3u8`**; verificado depois, `#EXTM3U` valido e reproduz. **AGRUPAMENTO POR CANAL REAL (decisao 80, pedido do dono)**: o painel repete o mesmo canal por qualidade (`SP - GLOBO SP FHD` / `HD` / `SD`) — **923 das 1280 entradas tinham token de qualidade e GLOBO aparecia 360 vezes**. Como o `buildGroup` guarda **1 membro por provedor**, agrupar no `tv-sources` perderia as qualidades; o agrupamento e feito **dentro do provedor**: `semQualidade()` tira o token do FIM do nome (`FHD|UHD|FULL HD|QHD|HD|SD|4K|2K|2160P|1080P|720P|480P|360P`, com o `-`/`|` opcional antes) e `agrupaPorCanal()` junta o que sobra, guardando cada qualidade em `variantes`. Nome canonico **sem** o token (`SP - GLOBO SP`) e `getStreams` devolve **1 stream por qualidade**, rotulado com o nome original. Medido: **1282 -> 733 canais (549 qualidades agrupadas)**, 285 com 2+ qualidades; as 3 do Globo SP **tocam as 3** e sao **reais** (ffprobe: FHD **1920x1080**, HD **1280x720**, SD **960x540**). **Bonus**: tirar o token fez o nome casar com o guia — **96 -> 353 canais com guia**, e os **133 canais GLOBO casam todos**. Catalogo: **817 canais**, 69 com as 3 fontes, previa 153, RSS 153MB. **ERRO MEU QUE PARECIA GEO (decisao 83, e a licao)**: `kakito-live.js` lia `IPTV_USERNAME`/`IPTV_PASSWORD` com fallback **VAZIO**, enquanto `kakito.js` tem o padrao em codigo e o `Dockerfile` **nao** define as variaveis. Ou seja: **em producao eu estava chamando o painel com usuario e senha em branco**, e o painel respondia 403. Isso **nao era bloqueio de IP** — eu tinha chegado a conclusao de geo (e ate cogitado usar a maquina de dev como ponte) por causa de um fallback faltando. **Licao**: `403` de painel com credencial em `.env` tem que ser testado com a MESMA credencial antes de chamar de geo; e todo scraper novo tem que repetir o padrao em codigo dos outros. **E o geo e real por cima disso**: com a credencial CORRETA, a prod continua 403 na API e no `/live/` (medido), e a borda 403 no `/live/` (a API ela alcanca). So IP BR passa na midia. **A borda entra pela rota CIFRADA `/p/`** (a mesma do VOD, decisao 77) e **nao** pelo `/proxy`: medido que o `/proxy` da 403 saindo do IP da prod, mas o `/p/` responde **200 em 712ms** da prod com a lista inteira. Nao e o IP nem o cabecalho: **e a rota**. **DIRETO, e por que (decisao 82 — "sem usar essa maquina como ponte")**: quem alcanca a **midia de live** do painel e so um **IP brasileiro**. Medido: cliente BR **200**, maquina de dev **200**, **BeamUp 403** (API e `/live/`), **worker 403** em `/live/` (a API ele alcanca: 200 com 371237 bytes em 870ms) — e `?ref=` no worker nao muda. O M3U do painel (`get.php`, 48MB) e so VOD: **zero** entrada de live. Como o dono **proibiu a maquina de dev como ponte**, o caminho e **direto** (decisao 49): o `.m3u8` do painel vai cru no stream e **o video e baixado pelo aparelho de quem assiste**, entao a origem ve o IP da pessoa, o servidor nao gasta banda e **nao ha limite de conexao nosso**. E por que `.m3u8` e nao `.ts`: os segmentos do m3u8 sao tokens do host `206.109.57.195` (`hlsr/<token>`), **sem credencial e sem limite** — o painel so ve 1 requisicao pequena por pessoa e o video vai do host de token direto para o aparelho. **Consequencia que o dono precisa saber**: a URL de live do painel tem **usuario e senha no caminho**, entao no modo direto elas vao para o aparelho de quem assiste. Nao tem como evitar — so IP BR passa e a URL do panel e credenciada. **O LIMITE REAL DO PAINEL: ~2 CONEXOES, E ELE E DA CONTA (decisao 98)** — o dono reportou "assisti um canal KAK e nao abriu". Medido, com ids REAIS do catalogo:
- `1 ao mesmo tempo -> 1/1 ok em 819ms` | `2 ao mesmo tempo -> 2/2 ok em 864ms` | `3 -> 2/3 (um 403 em 545ms)` | `4 -> 1/4` | `12 -> 6/12`
- **Pela PRODUCAO, um canal por vez, sem ninguem testando: 9/10 ok em 0,9-1,8s.** Com as minhas medicoes rodando ao mesmo tempo: 3/12, um por vez. **O painel divide ~2 conexoes entre app1, app2 e meus testes** — por isso o dono via falhar do lado dele enquanto eu media.
- Ha **dois jeitos de recusar**: 403 na hora, e **200 com corpo VAZIO depois de 11,3s** (a conexao trava e o painel larga). O segundo era o pior: corpo invalido era lido como "canal nao existe", a rota respondia **404** e um canal VIVO sumia da tela. **Erro meu, do codigo, nao do painel.**

**O CONSERTO (decisao 98, 4 pecas)**:
1. `tentar()` passou a dizer **por que** falhou: `ok` / `recusado` (403, 429, 5xx, corpo vazio, timeout) / `morto` (404, 401). Corpo vazio e recusa, nao morte.
2. A rota `/stream/hls` responde **503 + `Retry-After`** quando foi recusa, e so **404** quando o canal esta realmente morto. Antes os dois davam 404.
3. **Orcamento unico da origem** (`tvToken.naOrigem`): playlist E segmento passam pela MESMA fila de 2. Antes eram duas filas independentes (2 para playlist, **8 para segmento**) e a soma passava de 10 — por isso o painel recusava metade. `src/lib/fila.js` nasceu disso (extraido do `seg-cache`, que tinha a sua propria copia) e agora e o mecanismo unico de fila do projeto.
4. **Voo unico por canal + cache de 4s na playlist** (`emVoo` + `cachePl`): 5 pessoas abrindo o mesmo canal gastam **1** das 2 conexoes, nao 5. E canal 404/401 fica em memoria 10min (`mortos`) para nao martelar o painel a cada abertura.

**STALE-WHILE-REBUILD NO CATALOGO (decisao 106)** — a verificacao do KAK roda a cada 25s e muda a lista oferecida, o que desmonta e remonta o catalogo. Cada remontagem leva ~32s (triagem de 816 canais) e **o gateway da zona corta em ~12s** — medido: o usuario recebia PAGINA DE ERRO em vez de catalogo. Tres correcoes, todas com medicao:
1. A geracao saiu da chave de cache do catalogo. Enquanto estava nela, **toda** requisicao perdia o cache, porque a geracao mudava a cada remontagem.
2. `cacheGetVelho()` + stale-while-rebuild: havendo versao anterior e remontagem em andamento, devolve a anterior na hora e deixa a nova terminar sozinha. O usuario sempre ve um catalogo.
3. O catalogo unido passou a ser montado no boot (`warmup()`), para o custo ficar fora do caminho do usuario.
Medido local: 1a requisicao 31s (build frio), 2a e 3a **0s**.

**ERRO DE MEDICAO QUE EU FIZ (decisao 106)**: a bateria usava `?g=<timestamp>` na URL do catalogo para "fugir do cache" — e isso quebrava a chave na BORDA, forcando remontagem a cada chamada e produzindo falso 504. O caminho real do usuario (sem parametro) responde **200 com 761 canais em 13s** e depois 0s.

**BATERIA DE SONDAGEM DO CATALOGO DE TV (decisao 105)** — o dono reportou travamento no KAK e pediu bateria completa. Medido:
- **Divergencia descricao x streams: 1 em 673** (era 46 em 60) — a geracao na chave de cache fechou o buraco.
- **99 canais de 773 sem nenhum stream** — apareciam na lista e devolviam nada ao abrir. Causa: a triagem aceitava `resolvePlaylistUrl` como prova de entrega, e isso nao e prova. Agora **todos** os canais passam por `getStreams`, que e exatamente o que o player chama.
- **Divergencia de 0 canais sem imagem.**
- O canal 5548 que o dono abriu: **HTTP 200 em 131ms e TOCA** (o travamento era o painel em punicao, ja passado).

**O 504 QUE O DONO VIU (decisao 105)**: era o **gateway da zona** cortando em ~12s, nao o painel recusando. A cadeia de retry podia passar disso: 4 tentativas x 2,5s + esperas + 6s do relay. Agora ha **orcamento total de 8s** (`KAKITO_ORCAMENTO_MS`): o timeout do relay caiu para 2,5s, cada tentativa usa o tempo que resta, e as esperas sairam de [500,1500] para [300,800]. O que sobra e servido do cache, nao erro.

**ERRO QUE EU MESMO INTRODUZI E CORRIGI (decisao 105)**: eu tinha feito a geracao subir a CADA `getCatalog`. Efeito: a chave de cache mudava sempre, o catalogo nunca era servido do cache e a triagem rodava a cada request — **medido 32s**, muito acima dos 12s do gateway. Corrigido em duas partes: (1) a geracao sobe so quando a COMPOSICAO dos grupos muda (assinatura); (2) o resultado da triagem fica guardado pela assinatura da lista triada. Medido: 1a montagem 32s, seguintes **0s**.

**CATALOGO E STREAMS DESUNIFICADOS — A CAUSA (decisao 104)** — o dono reportou "os catalogos nao estao unificados". Nao era nome repetido (776 canais, 776 nomes unicos, 0 repetidos). Era outra coisa: `getCatalog()` reconstroi o mapa `groups` a cada chamada, mas a RESPOSTA do catalogo fica em cache. Quando a verificacao do KAK mudava um veredito, o mapa perdia um membro e a resposta antiga continuava prometendo a fonte que tinha saido — a descricao dizia "EMB+ETC+KAK" e `membersOf` devolvia so EMB, ou seja **0 streams no player**. Consertado com `catalogoMudou()`: o provedor avisa quando a lista que ele oferece muda, e o catalogo inteiro e remontado (no maximo uma vez por 10 min, para nao refazer 800 grupos a cada lote). Medido: **0 canais com descricao e membros divergentes**.

**ATO: A FONTE PRECISA DE TOKEN QUE NAO TEMOS (decisao 104)** — o painel `4x4u29c.autos` barra o worker (`origem 403`, medido em todos os filmes) e a URL crua devolve 0 bytes. Descobri que `wrapVideo: true` estava no painel mas era anulado por `|| maskDisabled()` — e o link direto e o PADRAO do projeto (decisao 49, coberta por teste), entao mexer ali seria Contraryar uma decisao consciente. Criei uma flag nova, `sempreEmbrulhar`, ignorada pela mascara, e liguei no ATO. **Ainda NAO toca**: a rota agora passa pelo proxy do app e responde `HTTP 200` com **0 bytes**, porque a URL do Xtream precisa de `&token=` obtido no login do painel. Falta a etapa do token. Estado honesto: **ATO quebrado**.

**VIDE LIMITE MEDIDO DO CACHE DE VOD (decisao 104)**: o video de VOD sai por `workers.dev/p/<token>` (rota cifrada), que **nao tinha cache nenhum** — todo espectador ia ate a origem, e o plano gratis do Workers tem 100.000 requisicoes/dia. Tentei cachear e **quebrei o worker** (500 em tudo); reverti e confirmei a volta. O bloqueio e estrutural: Workers guardam 1 GB por objeto e a zona 512 MB, e o filme medido tem **818 MB**; um 4K de 40 GB nao entra. O desenho certo e o proxy pelo app com extensao cacheavel na zona `baby-beamup.club`, que nao tem esse teto — NAO IMPLEMENTADO.

**ETC QUEBRADA: A VARIANTE MASCARADA DEVIA SER REMOVIDA OU CORRIGIDA (decisao 102)** — a ETC dava 404 em 3 de 3 canais. Causa medida: a rota `/stream/hls/etc:<slug>` devolvia **302 para a CDN**, e o player pedia a lista **de novo sem o Referer** — e sem Referer a CDN responde `302 -> https://google.com/admin/stream.m3u8` (portao anti-robo). O Referer estava em `behaviorHints`, que o Stremio respeita mas o ffmpeg nao. `src/lib/etc.js` agora busca a lista com o Referer, experimentando os **3 CDNs** que o player alterna, e reescreve cada segmento para `/seg/etc/<token>.png` — que tambem injeta o Referer e, de quebra, tem extensao que a borda guarda. Medido: **3/3 canais ETC tocando** (antes 0/3). O worker nao serve aqui: a ETC responde `Upstream 666` para a rede Cloudflare.

**COESAO DO CATALOGO DE TV (decisao 102)** — tres problemas medidos e corrigidos:
1. **56 canais sem nenhuma fonte** apareciam na lista e davam "sem fonte" ao abrir. Agora um canal so entra se algum provedor consegue entregar (`resolvePlaylistUrl` e consulta em memoria, nao custa rede).
2. **82% dos canais sem imagem** (medido local: 661 de 806). Agora ha um cartaz de ultimo recurso: `/poster/<chave>.svg`, SVG deterministico com o nome e as iniciais do canal, cor derivada do nome, servido pela borda. **0 sem imagem.**
3. Nomes repetidos: 0. Ids fora do padrao `tv:live:<chave>`: 0.

**ERRO MEU QUE O TESTE PEGOU (decisao 102)**: exportei `salvosNoBoot` sem definir — e o teste que criei na decisao 99 (confere todo `modulo.metodo()` que o server chama) pegou na hora: `tv-token nao carrega: salvosNoBoot is not defined`. Ele ja tinha pego `idadeDaPlaylist`. Valeu o teste.

**O QUE NAO DA PARA PEGAR NO CATALOGO (honesto)**: um canal pode estar no catalogo e ainda assim o fluxo estar morto na origem (medido: "Prime Video 3" falha em EMB e ETC ao mesmo tempo). `resolvePlaylistUrl` so olha o catalogo do provedor, nao a origem — pegar isso exigiria sondar cada canal, e o preco (uma requisicao por canal do catalogo inteiro) nao compensa. Fica assim, e e melhor que o canal sumir: ele aparece e o cliente tenta as outras fontes.

**CATALOGO DE TV VERIFICADO, NAO CREDITADO (decisao 101)** — a regra do dono ("fonte que nao toca no 1o play nao entra") estava escrita mas nao implementada. Medido antes: numa amostra de 90 canais do catalogo, **72 so tinham KAK** — ou seja ~80% do catalogo de 819 canais oferecia um canal cuja unica fonte nao entrega video de forma confiavel, e o KAK sozinho segura ~8 canais diferentes ao mesmo tempo.

**COMO FICOU**: o relay ganhou `POST /pl/verificar`, que para cada canal pede a lista e **le o primeiro bloco do segmento e CANCELA o resto**. Importante: **a origem IGNORA o cabecalho `Range` e devolve os 4,6 MB inteiros** — entao ler o corpo todo custaria 3,4 GB por varredura de 733 canais. Lendo so o primeiro bloco (14.302 bytes medidos) e cancelando, o sweep inteiro gasta ~10 MB. A verificacao confere o byte de sincronise do MPEG-TS (0x47 no inicio, em 188 e em 376) — e o que separa "o canal existe" de "o canal toca".

No addon: `tvToken.confirmado(id)` filtra `kakito-live.getCatalog()` e `getStreams()`. **A semantica e otimista de proposito**: canal nunca verificado entra (senao o catalogo comeca vazio e leva 30 min para encher); canal verificado e reprovado sai; e a varredura nunca para, entao volta se o painel consertar. `iniciarVerificacao` roda no boot: **1 lote de 12 a cada 25s = varredura completa de 733 canais em ~30 min**. Medido: 3 min de varredura = 72 canais (66 ok, 6 ruins), e o catalogo ja caiu de **819 para 813** sozinho.

**BUG QUE A VARREDURA REVELOU (decisao 101)**: `RELAY_TOKEN` ja termina em `/token`, entao a URL da lista era montada como `.../token/pl` e dava 404 — **o relay nunca foi exercido**, e tudo que eu tinha medido ate entao vinha do reserva pela origem. Corrigido com `RELAY_BASE` (tira o `/token` do fim). Isso explica por que o ganho com o relay pareceu pequeno: ele nao estava sendo usado.

**ESTUDO DE PONTA A PONTA DO ETC + RELAY AUTORIZADO (decisao 100)** — o dono autorizou o relay. O que o estudo mostrou, medido:
- **O ETC NAO USA P2P.** As libs `p2p-media-loader-core`/`-hlsjs` estao no `<head>`, mas a config do player e `plugins: [LevelSelector, ClapprPip, ChromecastPlugin]` — sobrou do codigo antigo. **Minha conclusao anterior de que o ETC usava P2P estava errada.**
- **O segredo do ETC e a extensao do segmento**: `https://static.s23-cloudfront-net.lat/assets/<md5>.js` — MPEG-TS de **4,5 MB com nome `.js`**. `.js` esta na lista padrao da Cloudflare, como `.png`. Medido 4 vezes seguidas: `cf-cache-status=HIT`, `age=55`, `max-age=14400`. **A origem e chamada 1 vez por arquivo, nunca mais.** E a MESMA tecnica que eu ja tinha aplicado no KAK com `.png`.
- As outras pecas do ETC: **3 CDNs que rodam entre si** (`m8q2v7r4k1`, `t5r4e3w2q1y0`, `a9b8c7d6e5f4`) e **8 tentativas no cliente com 12s de espera, trocando de CDN a cada falha** (`MAX_RETRIES = 8`).
- `Referer: https://sinaldvd.github.io/tv/player.html` e obrigatorio; sem ele o WAF responde `302 → google.com/admin`.

**O RELAY BUSCA A LISTA (decisao 100)**: `GET /pl/:id` no `br-relay.js`, com cache de 25s por canal, fila de 2 e `/pl-stats`. E o relay porque o WAF **da 403 para a producao (datacenter) e 200 para IP residencial** — medido. Sao **2,8 KB de texto**, nunca video. Medido: **9/10 canais pelo relay**, com `fonte=waf`. No addon, `playlistDe` tenta **relay -> origem**, que e a mesma logica de rotacao da ETC (uma fonte, se recusar, a outra). **Resultado local: 6/6 canais que antes falhavam (5548, 8289, 8288, 8290) passaram**, e a 2a abertura do mesmo canal responde em **9ms**.

**O QUE A PERGUNTA "DA PARA USAR O BEAMUP?" RESPONDE (decisao 99)**: o BeamUp **JA E** a frente equivalente a ETC — a zona dele e Cloudflare, o segmento tem hash de conteudo e a extensao `.png` faz a borda guardar para sempre, e agora a LISTA tambem vai para a borda (`max-age=25, stale-while-revalidate=60`, igual a ETC guarda por 4h). Medido: 2a abertura do mesmo canal em **21ms**. **O que o BeamUp nao pode e mudar o comportamento do painel**: pedir o MESMO canal ao app1 e ao app2 ao mesmo tempo (sao IPs diferentes) deu **o mesmo resultado nos dois** — entao a punicao do painel nao e por IP, e espalhar pelos dois apps nao ajuda. E o **worker nao serve**: ele nao alcanca a origem por IP cru (`error code: 1003`, medido 0/6).

**ERRO MEU QUE VIROU 502 EM PRODUCAO (decisao 99)**: criei `idadeDaPlaylist()` e usei na rota, mas **esqueci de exportar**. Como o server importa o objeto inteiro (`const tvToken = require(...)`), a chamada virou `tvToken.idadeDaPlaylist is not a function` e a rota devolveu 502 — 95 testes passando. **Corrigido, e agora existe teste que pega essa classe inteira**: `test/mirror.test.js` carrega cada modulo que o server importa e confere cada `modulo.metodo()` que o server chama. Verificado nos dois sentidos: passa com o codigo sao, e falha com `tvToken.idadeDaPlaylist() nao existe` quando a exportacao e removida de proposito.

**MEDICAO COMPARATIVA EM PRODUCAO — 8 canais DIFERENTES AO MESMO TEMPO, 12s cada (decisao 98)**
```
EMB: 3/8 tocam   (3 com 404 do catalogo, 2 com "Invalid data")
KAK: 4/8 tocam   (os 4 que falharam deram 5XX = recusa do painel)
painel: { ativas: 0, esperando: 0, max: 2, recusadas: 81 }
```
**O KAK NAO ESTA PIOR QUE O EMB HOJE** — nesta amostra ele foi MELHOR (4/8 contra 3/8). A ideia de que o EMB e ilimitado e verdadeira para os canais que ele tem de verdade, mas o catalogo dos dois tem entrada morta. E o que da a sensacao de "o EMB aguenta" e que os canais dele respondem `cf-cache-status: HIT` ja na primeira vez, enquanto o KAK paga a ida a origem pelo menos uma vez.

**RESPOSTA AO DONO (pergunta direta: "vai ficar ilimitado como o EMB?")**: **nao, e nenhum cache resolve.** O motivo e fisico: TV ao vivo gera um arquivo NOVO a cada ~10s, entao a origem tem de ser consultada pelo menos uma vez a cada arquivo novo. A borda guarda o arquivo depois disso (e por isso mesmo canal, N pessoas = ilimitado), mas o **primeiro** pedido de cada canal sempre vai ao painel, e o painel aceita ~2 conexoes. Quem assiste **canais diferentes** e limitado pelo painel; so quem assiste o **mesmo** canal e ilimitado. A unica forma de mudar isso e do dono do painel (mais conexoes na conta) ou trocar de fonte.

**O QUE ISSO NAO RESOLVE (limite de fisica)**: 2 canais KAK tocando ao mesmo tempo = 2 playlists + 2 segmentos = 4 conexoes > 2 do painel. Ou seja, **2 canais simultaneos e o teto**, e o painel tem 733 entradas porque para ELE o limite nao existe. Quem assiste **o mesmo** canal e ilimitado (a borda guarda o segmento). Quem assiste **canais diferentes** e limitado pelo painel.

**A EXTENSAO `.png` — O DONO DESCOBRIU O SEGREDO (decisao 97)**: a Cloudflare **guarda por extensao de arquivo**, e `.png` esta na lista PADRAO enquanto **`.ts` nao** (para a Cloudflare, `.ts` e TypeScript). E por isso que o **EMB e a ETC servem MPEG-TS com nome `.png`** — assim a borda guarda **sem nenhuma regra configurada, sem cartao, sem R2**. Nos: `/seg/<token>.png`. **MEDIDO EM PRODUCAO, sem regra nenhuma**: `req 1: 3924ms cf=MISS` (buscou do painel), `req 2: 44ms cf=HIT age=0`, `req 3: 17ms cf=HIT`, `req 4: 22ms cf=HIT`. **A borda esta guardando sozinha.**
**O QUE TRAVA A MEDICAO AGORA (e nao e o codigo)**: depois de horas de teste pesado, **o painel passou a recusar quase tudo deste IP** — num teste com 20 canais, so **3** devolveram playlist e os 3 deram 502 na origem. O IP de teste esta esgotado. A arquitetura esta correta e provada no cache da borda, mas **para medir em escala precisa de um IP limpo (ou de uma pausa)**.
**Erro meu**: a rota `/seg/` tirava so `.ts` do nome, entao com `.png` o token chegava com o sufixo e dava 403. Corrigido para `.ts|.png`.

**CAMINHO UNICO `/seg/` COM DUAS CAMADAS (decisao 95)**: o segmento sai sempre por `/seg/<token>.ts` no nosso dominio. Ali tem **duas** camadas de protecao contra o limite do painel: (1) **a borda** da nossa zona, se existir a regra de cache — mesma topologia do CDN do EMB/ETC, que guarda 4h; (2) **o `segCache` do servidor** (fila de origens + 2min), que ja funciona sem a regra. Nos dois casos o painel e tocado **1 vez por arquivo**, e nao 1 vez por espectador. O relay compartilhado segue no codigo como reserva.
**O QUE FALTA E SO ISSO, E E DO DONO (decisao 96)**: a zona `baby-beamup.club` **nao esta na conta Cloudflare com que tenho acesso** (o token so ve `mirrorcluster.eu.org`, que esta **pending** — nameservers `dimitris`/`keyla` nao ativados no registrador). Entao nao consigo criar a Page Rule. Precisa de: (a) criar a regra no painel do BeamUp, ou (b) um token de API com escopo de zona nessa conta, ou (c) ativar o `mirrorcluster.eu.org` apontando os nameservers.
**Aviso honesto sobre minhas ultimas medicoes**: depois de horas de teste pesado no mesmo IP, o painel passou a degradar **ate localmente** (3/10 em 10 canais) e a maquina satura com 10 ffmpeg. Os numeros locais das ultimas horas estao **contaminados pelo meu proprio teste** e nao servem para fechar conclusao. Precisa de uma rodada limpa, de preferencia em outra maquina, para medir de verdade.

**O QUE REALMENTE CONTORNA O LIMITE (decisao 94) — e o que o cache na borda NAO faz**: TV ao vivo nao repete conteudo (segmento novo a cada ~10s), entao **cache de borda nao reduz nenhuma conexao na origem** — foi um desvio meu que nao resolvia o problema. O que resolve e **uma conexao de origem compartilhada por todos que assistem o MESMO canal**: o `sharedStreams` do relay abre 1 ida ao painel e reparte. Medido: 10 clientes no mesmo segmento = `x-shared-stream: 10` = **1 ida**. Entao o Relay voltou a ser o caminho unico dos segmentos (`urlDeSegmento` monta `/stream/proxy?url=`), e o cache da borda saiu do caminho.
**A VERDADE QUE O DONO PRECISA OUVIR, em dois casos**:
  - **N pessoas no MESMO canal**: **ilimitado, e medido** (12/12 tocando com 1 unica ida a origem). E a propriedade do EMB/ETC, e o limite do painel deixa de existir.
  - **N pessoas em N canais DIFERENTES**: **1 conexao por canal, inevitavel**. 12 canais = 12 videos ao vivo diferentes = 12 idas a origem. O relay e o cache nao podem fundir videos diferentes. Medido nesta rodada: **1/12** — e o painel corta acima de ~10-15 simultaneos. Nao e bug, e fisica.
**Erro meu de novo**: o corte que trocou o cache da borda pelo relay levou junto `renovarDoRelay`/`aquecer` e o servidor passou a nao subir (ReferenceError). Restaurado. Tres bugs meus seguidos neste arquivo, todos por edicao em bloco sem teste que pegue referencia de runtime — **e o teste de imports do projeto nao pega isso**.

**CONTORNEANDO O WORKER: CACHE NO CDN DA NOSSA ZONA (decisao 93)**: o plano gratis do Worker tem teto de **100.000 requisicoes/dia**, e TV ao vivo e 1 segmento por canal a cada 10s — 10 canais = 86% do limite, **30 canais = 259% (estoura)**. O contorno e **tirar o cache do Worker**: rota nova `GET /seg/<token>.ts` no **nosso proprio dominio**. O caminho tem o token cifrado, entao o mesmo segmento cai sempre no MESMO endereco (e por isso a borda guarda e reusa), e a resposta vai com `Cache-Control: public, max-age=1800`. A playlist do KAK passou a apontar para `/seg/` — **zero invocacoes de Worker**. `SEGMENTOS_EDGE_CACHE=1` volta para o worker. Medido: `MISS 2469ms -> HIT 37ms -> HIT 33ms`.
**O QUE TRAVA (e nao e codigo)**: a zona `baby-beamup.club` **nao esta na conta Cloudflare que tenho acesso** — o token ve so `mirrorcluster.eu.org`, que esta **pending** (nameservers nao ativados). Entao **nao consigo criar a Page Rule / Cache Rule** que faz a borda guardar de verdade, nem testar `cf-cache-status` no `/seg/`. Precisa de quem controla o DNS do `baby-beamup.club` (o BeamUp) — ou mover o dominio para esta conta. O codigo esta pronto; falta so a regra de cache na borda.
**Erro meu**: escrevi a rota usando `decifraOrigem` sem o import (eu tinha removido antes, quando desfiz a cifra de segmento) — o servidor respondeu 500 em toda `/seg`. Corrigido e revalidado. O teste de require do projeto nao pegou porque o simbolo e usado em runtime, nao no topo do arquivo.

**R2 COM JANELA DE ROLAGEM (decisao 92)**: o codigo esta PRONTO eDeployado, mas **o R2 nao esta habilitado na conta** — a Cloudflare responde `Please enable R2 through the Cloudflare Dashboard` (codigo 10042) e o bucket nunca chega a ser criado. **So o dono habilita**, no dashboard, com metodo de pagamento cadastrado (a Cloudflare pede por causa da taxa de saida). Ate la, o worker roda **sem R2** e usa so a borda — que medido e o que funciona hoje.
O que ficou pronto: binding `SEG` no `wrangler.toml` (comentado para o deploy nao quebrar), e no worker uma janela de **3 minutos** — TV ao vivo nao e arquivo, cada segmento morre em ~10s, entao guardar historico e jogar espaco fora. A conta da **conta em porcao**: 30 canais x ultimos 3 min = ~1,3 GB, folgado nos 10 GB. O que **estoura** e o limite de escritas do plano gratis (1M/mes): 1 canal = 259K (cabe), 5 canais = 1,3M (estoura), 30 = 7,8M (8x). A saida e sempre gratis, que e a vantagem.
**BUG QUE EU QUEBREI E CONSERTEI (registrado)**: escrevi `const r2 = env && env.SEG` sem o guard `typeof env !== "undefined"` que o resto do arquivo usa — o worker passou a responder **HTTP 500** em toda rota `/cdn`. Corrigido e revalidado (MISS 5,26MB -> HIT 276ms). Worker e codigo de modulo: **`env` so existe com o guard**.

**FILA + CACHE DE SEGMENTO NO SERVIDOR (decisao 91)**: o cache da borda resolve o CALOR, mas nao o FRIO. Abrir N canais = N segmentos novos = N buscas ao mesmo tempo para o servidor, que estrangula. `src/lib/seg-cache.js`: **fila de origem** (max 8 ao mesmo tempo, o resto espera), **voo unico** (quem pede o mesmo segmento usa a mesma promise) e **cache de 2min** (a segunda chamada e instantanea). Ligado na rota `/stream/proxy` so para segmentos do KAK. Medido: 12 frios -> max 3 em paralelo, 12 repetidos -> 12/12 do cache.
**O `@32s` DAS FALHAS ERA O MEU PROPRIO TESTE**: eu passei `-rw_timeout 20000000` (30s) no ffmpeg. Com a fila de 3 origens, 30 canais frios levavam ~10s de espera e o ffmpeg desistia aos 30s. Com a fila em 8 e `-rw_timeout 90000000`: **30 canais -> 7/30** (era 0/30, depois 1/30). **Ainda NAO e 30/30 e nada segura 5 minutos — nao chamo de resolvido.**
**A CARGA REAL DE 30 CANAIS AO VIVO (o numero que decide)**: cada canal produz um segmento novo a cada ~10s. 30 canais = **3 segmentos/segundo = ~12MB/s = ~94 Mbps** de origem, 24h por dia, para sempre. E o cache so ajuda quando varias pessoas veem o MESMO canal no mesmo instante — que e o caso normal, mas nao o do multiview.

**TRES BUGS QUE FAZIAM "NAO ESTA SERVINDO BEM" (decisao 90) — todos achados com teste de ponta a ponta**:
  1. **O token nunca era renovado.** So buscavamos token quando nao havia nenhum, entao o primeiro servia para sempre e depois de vencido o relay parava de responder (dava 404). Agora `playlistDe` renova sempre que o token passa de `KAKITO_TOKEN_AVISO` (5min). O relay tem cache de 10min, entao isso e um GET de 2KB de vez em quando.
  2. **O token so era buscado DENTRO do `playlistDe`** — e o `getStreams` decide se oferece o relay ANTES disso (`temToken()`). Num processo novo o token nunca era buscado e o canal ia por link direto para sempre. Agora tem `tvToken.aquecer()` no boot + a cada 4min.
  3. **O worker estourava em cache frio.** Com varios canais frios ao mesmo tempo, o `AbortSignal.timeout(25000)` contra o nosso servidor dava 502 e o canal morria. Subiu para 70s com uma retentativa. Medido: **2/10 -> 8/10** canais diferentes ao mesmo tempo.
**ERRO DE METODO QUE EU COMETI (importante)**: o teste de ponta a ponta pegava o **primeiro** stream do canal, e nos canais com EMB+ETC+KAK o primeiro e do **EMB** — eu estava medindo a fonte errada e perguntando "por que o KAK nao toca?". So depois de filtrar por `\/stream\/hls\/kak%3A` e aparecer a verdade.
**O QUE ESTA MEDIDO AGORA (10 canais diferentes, 45s cada, simultaneos, pelo relay/cache)**: **8/10 seguraram a conexao inteira**. Os 2 que falham sao canais **mortos no catalogo do painel** — de 37 canais que servem playlist, so 10 servem segmento.

**O TOKEN VEM DO RELAY BR (decisao 89, "use essa vps para isso")**: a maquina do relay **e** o `144.33.21.1` (confirmado por IP publico) e e o unico IP que o WAF aceita. Adicionei `GET /token` no `br-relay.js`: faz um GET que **para no 302** e le o `Location` (o `fetchDocument` seguia o redirect, entao nao servia), extrai o token, guarda 10min e devolve JSON. `tv-token.js` busca esse endpoint sozinho (`BR_TOKEN_URL`, default `http://144.33.21.1:8443/token`) e renova antes de expirar; `POST /api/tv/token` continua valendo como alternativa. **Medido ponta a ponta**: o addon pegou o token sozinho, serviu a playlist (`X-Mirror-Token-Age: 1`) e os segmentos apontam para o cache da borda. **O relay nao e ponte de video**: nao passa video, e um JSON de ~2KB de uma vez por janela, com cache de 10min no proprio relay. **O GitHub Actions foi testado e NAO serve** (decisao 88): o WAF barra ele tambem — `SEM REDIRECT: o WAF barrou este IP`. Quatro origens medidas: BR residencial 200, prod 403, borda 403, GitHub Actions 403. O workflow foi removido do repo para nao falhar toda hora.
**O SERVIDOR SE SUSTENTA COM TOKEN (decisao 88) — o BLOCKER ERA SO O WAF**: quatro medições que fecham o problema:
  1. o WAF (`kakito.xyz`) barra IP de datacenter: 403 na prod e na borda, 200 de IP residencial;
  2. a **origem de midia (`206.109.57.195`) NAO barra datacenter** — a prod pega segmento a **46 Mbps** (15x o necessario);
  3. **UM token serve para TODOS os canais** (o token do 2252 abre 2253 e 2254; canal inexistente volta 200 com 0 bytes);
  4. o token e **reutilizavel** (3 pedidos seguidos, 200) e **duro** (vivo em 4+ min).
Entao: um ip brasileiro entrega **um** token, e o servidor passa a montar e buscar a playlist de qualquer canal sozinho — **sem WAF, sem VPS para o video, sem bridge**. `src/lib/tv-token.js` faz: WAF primeiro (funciona quando o processo sai do IP BR) e, se o WAF barra, cai na origem com o token guardado. `POST /api/tv/token` recebe o token; `GET /api/tv/estado` mostra idade. `KAKITO_LIVE_TOKEN` tambem serve por env.
**MEDICAO QUE SEPARA CAPACIDADE DE CANAL MORTO (importante)**: de 37 canais que servem playlist, so **10** servem segmento — os outros 27 estao **mortos no catalogo do painel** (dos 733 announced, muitos nao tocam). Os 10 vivos: **10/10 em tres rodadas seguidas, todos vindos da BORDA (HIT), em 0-1s**. Entao **nao e limite de capacidade**: e canal morto. Antes eu media `0/50` e culpei a maquina de teste — o numero estava certo, a interpretacao nao: os que falham falham **rapido** (1s), nao estouram tempo.
**O QUE AINDA FALTA (unico pedaco)**: o token precisa chegar ao servidor, e o **navegador nao consegue ler o cabecalho `Location` do redirect de outro site** — entao a pagina nao resolve sozinha. Fica um ip brasileiro do lado do servidor (VPS barata: **1 token por janela**, alguns KB, nao GB — mudou tudo depois da medicao 3).

**CACHE DE SEGMENTO NA BORDA (decisao 87, "crie a cdn usando o nginx do beamup e o cache do cloudflare")**: rota nova `/cdn/<token>.ts` no `worker-simple.js` (versao `349d3a21`) + `src/lib/worker-cdn.js`. O token e o **mesmo AES-256-GCM do `/p/`** — o cliente nunca ve a URL de origem. O worker so aceita `206.109.57.195`, caminho `/hlsr/` **e hash de 32 hex** (nao e proxy aberto). **No cache miss o worker busca NO NOSSO SERVIDOR, nao no painel** — porque o painel recusa o IP de borda (medido: `Upstream 403`). TTL de **4h** (`max-age=14400, immutable`), o mesmo do CDN do EMB/ETC. `SEGMENTOS_EDGE_CACHE=0` desliga e cai no relay compartilhado.
**Medido**: 1o pedido `x-mirror-cache: MISS` (3.5MB), 2o e 3o `HIT` — **o cache funciona**. Um canal pelo cache: **12/12 simultaneos tocando**.
**O QUE NAO FUNCIONA — 50 canais distintos: 0/50.** E **nao e limite de capacidade, e falha**: o worker pede ao nosso servidor e a resposta e **`origem 504`** — o servidor, ao buscar o segmento do painel sob demanda, estoura o tempo. Entao hoje **nosso servidor nao serve de origem para o cache**. Consequencia pratica: o cache da borda funciona, mas **so ha um caminho quente** (nosso servidor), e ele nao aguenta buscar 50 segmentos a frio. **O que resolve**: a **VPS brasileira** (que ja e necessaria para a playlist) como origem do cache — ela e BR, esta proxima do painel e le a playlist; com **R2** para guardar o segmento, cada um e buscado **uma vez** em vez de uma vez por pedido.
**MEDICAO QUE NAO VALE (erro meu, registrado)**: a primeira tentativa de 50 canais deu 6/47 e a segunda 0/50, mas **43 das 47 sementes tinham expirado** (TTL de 90s) — o teste media semente morta, nao capacidade. Refiz com `TV_SEED_TTL=900000` e 50/50 playlists vivas, e ai sim deu 0/50 com `origem 504`.
**Alerta de premissa**: o cache da Cloudflare **nao e "infinito"**. O limite de 512MB e **por objeto** (nossos segmentos tem 1,7-3,6MB, folga). O que ele tem e um teto por plano e os termos de uso **reservam o direito de desligar o cache de video** fora de volume comercial. Para addon privado ta tranquilo; se crescer, o caminho seguro e **R2** (10GB gratis, sem taxa de saida). Tambem: **sem extensao de arquivo a Cloudflare nao cacheia** (ela decide pela extensao) — por isso o cache e explicito no worker (`caches.default`), e nao por cabecalho.

**KAK PASSANDO PELO RELAY COMO O EMB (decisao 86 — "faca a fonte kakito ser igual a emb cacheando no cloudflare")**: a peça que faltava era a **playlist**, e ela vem do **navegador** (único IP que o painel aceita).
  - `src/lib/tv-seed.js`: guarda a playlist por `streamId`, TTL 90s. **Valida** antes de guardar: precisa de `#EXTM3U` **e `#EXT-X-TARGETDURATION`**, todo segmento tem que ser `http(s)`, host **só `206.109.57.195`**, caminho `/hlsr/...` **e com o hash de 32 hex** (`/<hash>/<arquivo>.ts`). Não é proxy aberto: é o dono injetando a própria lista.
  - `POST /api/tv/seed` (corpo lido à mão, teto 256KB) e `GET /stream/hls/kak:<streamId>.m3u8`, que devolve a playlist **com as etiquetas do painel intactas** e só as linhas de segmento viradas para `/stream/proxy?url=…`.
  - `kakito-live.getStreams` oferece a via do relay **só quando há playlist fresca** (e marca `· Relay` no título); sem ela o canal continua pela via direta — **não some da lista**.
  - `public/tv.html` entrega a playlist ao servidor e renova a cada 20s (ela é ao vivo).
**Medido**: semear + **12 ffmpeg ao mesmo tempo = 12/12**, e **12 clientes no mesmo segmento = `x-shared-stream: 12`** → **1 ida à origem para 12 pessoas**. O endereço do segmento tem hash de conteúdo, então a resposta é a mesma para todo mundo — é o que a Cloudflare consegue guardar.
**Duas armadilhas que custaram tempo (both medidas)**: (a) a playlist do painel vem com **segmentos relativos** e o 302 para um **token que expira**, sem `cache-control` — o Chrome guardava token velho e a origem devolvia 403; resolvido resolvendo os relativos contra `r.url` + parâmetro anti-cache (o painel ignora) + 3 retentativas. (b) **montar a playlist a mão dá 0/12 no ffmpeg** — sem `#EXT-X-TARGETDURATION` o demuxer recusa; por isso o relay preserva as etiquetas originais em vez de inventar.
**Cache da borda**: ainda não ligado. O caminho já é content-addressed, mas o `Cache-Control` do relay é `max-age=2` (é ao vivo) e o cache da Cloudflare é do zone do dono — é decisão de infra dele, com custo de banda no edge. O que já vale hoje: **1 ida à origem para N pessoas**.
**O QUE ISSO NAO RESOLVE (e o dono perguntou)**: **multiview** (uma pessoa, vários canais) continua 1 conexão por canal — não existe como colapsar vídeos diferentes. Isso é limite do fornecedor, não de cache.
**LIMITE QUE PERMANECE**: `/tv` é **navegador**; o Stremio não toca página web. O canal KAK no Stremio usa a URL `/stream/hls/kak:<id>.m3u8` (que o Stremio toca normalmente) — **a página é só quem alimenta a playlist**.

**PAGINA DE TV COM ENXAME P2P (decisao 85, pedido do dono: "use o sistema deles, crie uma pagina")**: `public/tv.html` + rota `/tv`. `/tv?chan=<id>` escolhe a fonte e redireciona; `/tv?src=<url>&swarm=<id>` abre direto. **O QUE O SITE DO EMB FAZ (medido no codigo deles)**: a pagina do canal cria `new p2pml.hlsjs.Engine({ swarmId: 'embedtv_'+id, trackerAnnounce: [wss://tracker.openwebtorrent.com, ...], simultaneousP2PDownloads: 12 })` e mostra `Peers: N | P2P: 47%`.Ou seja, **rede entre os proprios espectadores via WebTorrent** — quem assiste serve pedaco do video para os outros. A outra metade e o CDN (`cdn1.s22-cloudfront-net.lat/<hash>.png`, `max-age=14400`, `cf-cache-status: HIT`).
**O QUE A NOSSA PAGINA FAZ E O QUE NAO FAZ**: `hls.js@1.6.13` + `p2p-media-loader` (core e hlsjs `@latest` — **a tag `4.0.0` do npm da 404 nos arquivos de build, tem que ser `@latest`**). **Medido em Chrome de verdade (arm64 baixado a mao, puppeteer): sem P2P a pagina TOCA — KAK 1920x1080 e EMB 1280x720, readyState 4, ~40s de video.** **O loader do P2P NAO funciona (medido)**: com `p2p=1` o hls.js nunca completa o manifest (`manifestLoadError`, `status: 0` = o request sai do loader sem resposta), em hls.js **1.4.12, 1.5.17 e 1.6.13**, nas duas fontes, e com flag de WebRTC. Nao e o redirect (o EMB tambem redireciona e falha igual), nao e a versao do hls.js, nao e WebRTC do headless. **Por isso o P2P fica DESLIGADO por padrao e a pagina toca sempre** — naosubi uma pagina que nao abre. **Dois bugs achados no caminho**: (a) `hls.loadPlugin` era a API da v3 e **nao existe** no hls.js atual (dava `hls.loadPlugin is not a function`); na v4 o motor entra como `loader` do hls.js via `engine.createLoaderClass()` + `initHlsJsPlayer(hls)`; (b) a playlist do kakito vem com 302 cujo **token expira** e o 302 nao tem `cache-control`, entao o Chrome reusava token velho e a origem devolvia 403 — resolvido com parametro anti-cache (o painel ignora parametro extra, medido) e 3 retentativas com token novo.
**LIMITE QUE CONTINUA VALENDO**: o Stremio **nao toca pagina web** — o stream do addon segue sendo o link de video. A pagina e um caminho a mais, no navegador. E o P2P so faz sentido se o cliente for navegador.
**ACHADO IMPORTANTE PARA O KAK (decisao 84)**: o token do segmento **nao e preso ao IP** (peguei a playlist aqui e a **producao baixou o segmento com 200 e 2.8MB**), e **o endereco do segmento e o mesmo para todo mundo** (`/hlsr/<token>/<user>/<pass>/<id>/<hash>/<arquivo>.ts`, mesmo `hash` em dois pedidos) — ou seja, a **identidade do segmento bate entre espectadores**, que e o que o P2P precisa. O token e **reutilizavel** (3 pedidos seguidos, 200). O que impede o P2P hoje nao e o endereco: e a ligacao da biblioteca.
**COMO O EMB E QUE O KAK NAO E (decisao 84 — o senhor mandou estudar o embedtv)**: medido os dois lados a lado. **EMB**: a playlist (608b, 5 segmentos) vem de `52d080a3e...s23-cloudfront-net.lat/<hash>/<canal>.txt` e os segmentos de **`cdn1.s22-cloudfront-net.lat/<hash>.png`** — nome de CDN, **hash de conteudo no nome do arquivo**, `cache-control: max-age=14400` (4h) e **`cf-cache-status: HIT`**. Ou seja: 8 pessoas pegam o mesmo endereco, **1 ida a origem** e 7 sao da borda. Medido 8/8. **KAK**: a playlist (5KB) vem de `kakito.xyz/live/...` e **responde 302 para `206.109.57.195`**, um **IP nu com nginx** — `server: nginx`, **sem `cf-cache-status`, sem `cache-control`, sem `age`**. Nao e cache desligado: **nao existe cache**, e nao ha CDN na frente para ligar. Da a **4/8** e depois **0/8** (o painel corta). **O worker NAO resolve (medido, contrary a expectativa)**: adicionei `206.109.57.195` no `ALLOWED_HOSTS` do `worker-simple.js` e subi (versao `61eb0b4a`). Antes o worker nem tentava (`host not allowed`); agora tenta e a **origem responde `Upstream 403`** — o IP de borda da Cloudflare e recusado. Nao adianta `?ref=`, nem rota cifrada `/p/`. **A discoveries que muda o quadro**: o **token NAO e preso ao IP**. Peguei a playlist daqui (token emitido para o IP BR), passei a URL do segmento e a **producao respondeu 200 com 2.8MB** — outro IP, mesmo token. E o token e **obrigatorio**: sem `/hlsr/<token>/` da 404/401 (`Missing parameters`), e nao ha outro formato de query que sirva. **Resumo do alcance**: a **producao alcanca os segmentos** (e poderia repartir com o relay compartilhado, 5 clientes -> 1 ida, ja medido); a **producao nao alcanca a playlist** (403 no WAF do kakito.xyz, com credencial correta); o **cliente BR alcanca as duas**; o **worker nao alcanca nenhuma das duas**.
**CUIDADO — o token de segmento do kakito tambem tem a credencial dentro** (decodificavel): se um dia o KAK voltar a passar pelo relay, o segmento **nao pode ir na playlist do cliente** em base64. **O relay BR (`br-relay.js`) foi chegou a ser ligado e foi desfeito**: a maquina alcança a midia (200) e a prod o alcanca (736ms), mas o dono mandou nao usar essa maquina como ponte. Os helpers `relayPlayUrl`/`relayFetchUrl` de `lib/proxy.js` foram removidos e ha teste travando (`relayPlayUrl` deve ser `undefined`). **Coisas que eu tentei e nao funcionam, para nao repetir**: proxy do painel pelo relay compartilhado (`proxyStream`) — da **502** em prod; borda com `?ref=` — 403; `/fetch` do relay na m3u8 — 502 (`/play` funciona, mas e video);Relay com a porta errada — o gateway da Cloudflare mata em ~12s, entao **toda cadeia precisa de timeout curto e borda PRIMEIRO**.
  - **Cache de TRECOS do painel (decisao 78) — o mecanismo do "sem limite", MEDIDO**: o segredo da fonte do dono nao e a arquitetura, e **fan-out por conteudo**: o endereco do arquivo e o **hash do conteudo** (CDN content-addressed), entao todo mundo que pede o mesmo canal no mesmo momento pede o **endereco identico** e a origem e consultada **1 vez**. Em TV ao vivo isso vem de graca (todo mundo ve o mesmo canal); em VOD cada um ve um arquivo diferente, entao precisa ser construido. **`src/lib/panel-cache.js`**: quebra o arquivo do painel em **trechos de 2MB** e guarda em cache (30min, 600 trechos) com **voo unico por trecho** — 5 pedidos simultaneos do mesmo trecho = **1 ida ao painel**; 20 pedidos seguintes = **0 idas** (1ms, todos do cache). Medido contra os dois painéis: `kakito` 3 pedidos -> 1 busca (arquivo de 1,3GB = 634 trechos) e `telaplay` 3 pedidos -> 1 busca (3,3GB). O tamanho real do arquivo vem do `content-range` da resposta. Ha teste que prova 5->1 e 10->0. **AINDA NAO LIGADO**: os fontes `xtream` (BLZ/SPC/ATO) ainda entregam a URL do painel direto; falta a rota que entrega o link opaco apontando para este relay e um teste de reproducao com player. **Nao burla limite: reduz trafego real na origem** (20 pessoas no mesmo filme = 1 busca por trecho em vez de 20 conexoes inteiras).
** — o dono confirmou a hipotese: o FrostStream retransmite atras de um servidor proprio com `/vauth/<id>.mp4?token=<619 chars>`, e o token **nao** guarda a url (decodifica em bytes aleatorios, sem texto) e **nao** tem usuario/senha dentro — ou seja, e indice/chave do banco deles, e o cliente nunca ve a origem. **Refiz o mesmo padrao, e mais compacto**: em vez de indice, **ciframos a origem com AES-256-GCM** (app e worker com o mesmo `PROXY_SECRET`) e o cliente recebe `https://<worker>/p/<token>.mp4`. O token carrega `{u: origem, r: referer}` cifrado — precisa do `Referer` porque RTD/DGO exigem e o VZR exige Referer **vazio**. **Sem banco e sem chamada extra** (estado so no token), token de **112-192 caracteres** (eles usam 619), **forjado ou adulterado da 403** (a AES-GCM autentica). Worker: `worker-simple.js` ganhou `decifraToken()` + `serveOrigemCifrada()` e a rota `/p/<token>.(mp4|m3u8|ts)`, que valida a origem com `targetAllowed()` (mesma lista de permissao) e repassa `Range`. Vale para **TODO o VOD** **o TV NAO e cifrado de proposito — testei os dois caminhos e nenhum funciona**: (a) o CDN `t5r4e3w2q1y0ty.s23-cloudfront-net.lat` responde **`Upstream 666`** no servidor de borda — e a **rede do proprio provedor de borda recusando**, nao e lista de permissao (descobri depois: o `m8q2v7r4k1...vercel.app` dava 403 "host not allowed", liberei na lista e passou a responder `Upstream 404`, ou seja, alcanca; mas o `666` continua). (b) o `vercel.app` alcanca, mas **a cadeia HLS quebra pelo caminho cifrado** (o ffmpeg morre com 5XX). Entao **proteger a variante direta do TV custaria o video**. Como ela **nao tem credencial nenhuma** (so o host publico do CDN), o preco nao compensa e deixei como esta, com o motivo escrito no codigo. **O relay do TV ja e opaco** (e um codigo, sem senha), entao nenhuma credencial de TV ever e exposta. Se o senhor quiser o TV 100% sem origem visivel, o caminho e **nao entregar a variante direta** (perde 1 opcao por canal, e ela ja era a mais instavel), ou **usar o relay BR** que alcança esses CDNs. **Ressalva honesta**: a variante do RTD que nasce do relay do worker continua com a origem em base64 (`/relay/s/...`) — ela **nao tem credencial**, so o host publico do CDN e um `Referer` publico, entao nao e vazamento de senha; mexer nela criaria risco de recursao no worker. **Verificado**: o token decifra, o worker busca no painel (MP4 valido), **reproduz 4s**, e token forjado da 403. **O repositorio do GitHub e PRIVADO** (a API devolve 404 para anonimo) — a senha no `.env` nao esta exposta publicamente, o dono tem raza.
  - **CREDENCIAIS DOS PAINEIS VAZAM — duas fontes (decisao 76)**: (a) **no `.env` versionado no GitHub publico** — `IPTV_USERNAME`, `IPTV_PASSWORD`, `XTREAM_SPACE_USER/PASS`, `XTREAM_EXPLOUD_USER/PASS` estao no repositorio e em todo o historico. **Esse e o vazamento grave e SO O DONO RESOLVE: precisa TROCAR a senha de cada painel** e nao versionar o `.env`. (b) **na URL que entregamos ao cliente**: o Xtream exige `usuario/senha` no caminho e o Stremio mostra a URL no player — 5 de 9 streams eram `.../movie/MirrorPrincipal/ditj7j1h/11197.mp4`. **Testei se da para fazer como o FrostStream**: eles usam `/vauth/<id>.mp4?token=<opaco>` (token assinado, sem senha) — **nossos 3 paineis NAO tem esse endpoint (`/vauth` = 404)**, so tem `player_api.php` e o caminho com credencial. **Logo: com esses paineis nao ha jeito de esconder a senha do cliente sem fazer os bytes do video passarem por algo nosso.** Roteei os 3 paineis pelo worker (`{worker}/proxy?url=...`) para tirar o video do caminho do nosso app e dificultar inspecao casual, e **comentei no codigo que e cosmetico e NAO seguranca** (a origem vai so codificada no query). **As saidas de verdade, para o dono decidir**: (i) trocar as senhas e tirar o `.env` do git — urgente, resolve o vazamento publico; (ii) URL opaca de verdade: guardar a origem no servidor e entregar so um id aleatorio, fazendo o video passar pelo nosso app/worker (custo: banda do servidor); (iii) trocar de painel por um que aceite token, como o do operador que o dono indicou.
  - **A "fonte propria" do FrostStream NAO e acessivel (decisao 74)**: o dono pediu para verificar o banco/painel que eles usam por tras. Investiguei os tres Hosts que aparecem nos stream deles: `152.233.22.21`, `152.233.36.131` e `142.99.102.25` (caminho `/vauth/<id>.mp4?token=...`, padrao de painel com token assinado), mais o `cache.iptvmais.one` e o relay `workers.dev`. **Todos trancados**: raiz e so a pagina de boas-vindas do nginx, `player_api.php` e `get.php` devolvem **404**, o `cache.iptvmais.one` devolve **403** nos endpoints de painel e **401** em `/api/v1/streams` (exige credencial), e o worker **403** em qualquer outro caminho. Os tokens da URL sao **assinatura por arquivo**, nao credencial de conta. **Conclusao: nao da para usar o painel deles diretamente sem credencial** — o unico caminho suportado e a API do addon, que e como ficou integrado. Se o senhor tiver credencial do painel, ai da para trocar a fonte por um `xtream` direto (seria ate mais rapido, sem o salto extra).
  - **TEMPO ESGOTADO ABRI O DISJUNTOR — corrigido (decisao 75)**: em producao a FrostStream **sumiu da lista** porque o motor tratava `timeout` como falha: 3 lentidases (a API deles tem pior caso de 11,9s) e o disjuntor abriu por 5 minutos, tirando a fonte de todo mundo. **Fonte lenta nao e fonte quebrada**: agora `recordFailure` conta o tempo esgotado em `timeout` e **zera as falhas**, so erro real abre o disjuntor. Vale para **todas** as 11 fontes (o KKT lento tambem nunca mais vai sair da lista). Antes `frost: {calls:5, ok:2, failed:3, timeout:3, breaker aberto}`; depois `frost: {calls:5, ok:5, failed:0, timeout:0, streams:18, breaker fechado}`. Ha teste que **falha antes** e passa depois.
  - **FONTE NOVA: FrostStream (decisao 73)**: o dono indicou `https://froststream.cloutteam.com/manifest.json` (v2.2.7), que tem **banco proprio (CloutDB)**. Achados: (a) o addon e **so fonte** — `resources: ["meta","stream"]`, **zero catalogos**; (b) provedores declarados: **IPTV, CloutDB, RedeFlix, MegaEmbed**; (c) **ele so responde com id do IMDb (`tt:`)** — com `tmdb:` devolve `{"streams":[]}`, e **exige User-Agent de navegador** (sem ele, 403). Testei antes de integrar: **10 de 10 streams decodificaram** (0,4s a 3,9s), servidores de video novos para nos (`cache.iptvmais.one`, `152.233.36.131`, `152.233.22.21`, `142.99.102.25` e relays `workers.dev`). Cobertura medida: **8 de 12 titulos**, com **7/7 tendo id do IMDb** (vem do TMDB) — entrega para filmes/series ocidentais e **zero** para anime, drama coreano e filme antigo, ou seja, **complementa** as outras fontes em vez de repetir. **Nao precisa de casamento de titulo nenhum** (a fonte e por id), o que elimina o problema mais caro do projeto. `src/scrapers/froststream.js` + registro `frost` no motor com `timeoutMs: 2500` e `when` exigindo `tt\d{5,}`; a `imdbId` do TMDB passou a ir no contexto. Motivo do timeout curto: a API deles tem **pior caso de 11,9s** (Avatar) e media de 1,5s, o que estouraria o orcamento de 9s do gateway — com 2,5s ela some sozinha sem atrasar o pedido, e o `patchLate` ainda preenche depois. Cache de 8 min (4 min quando vazio). Resultado: **Matrix passou de 9 para 12 streams**, com 7 fontes (blz, spc, spt, ato, rtd, frost, vzr). `sources=frost` filtra certinho.
  - **Duplicacao eliminada com prova (decisao 72)**: (a) **4 scorers de serie** (aon/animesdigital/anitube/doramogo) nao eram copias, eram algoritmos diferentes — a unificacao correta era extrair as **regras** (as mesmas penalidades de spin-off, o mesmo bonus de temporada e de numero final), nao forcar um algoritmo so. As regras foram para `lib/match.js` (`penalidadeQuandoAusenteNaConsulta`, `penalidadeSempre`, `bonusTemporada`, `bonusNumeroFinal`, e as regex `PEN_*`), e o **anitube e o animesdigital** passaram a usa-las, cada um com o **seu** peso e a **sua** regex (`shippu?den` no ATB, `shippu?uden` no RON). O `aon` (conjunto de palavras) e o `doramogo` (cobertura frouxa) ficaram como estao porque o algoritmo e genuinamente diferente. **Como provei que nao mudou nada**: `score-snapshot.js` roda **2281 combinacoes** de titulo x consulta x temporada nas 4 fontes e **byte a byte deu identico** antes e depois. (b) As **5 copias** de "buscar com redirect + timeout + teto de corpo" viraram `getText`/`getGzText` em `scraper-utils.js`; o `epg.js` e o `epg-rei.js` (que eram copias quase literais, um ate com o `baixo()` identico) agora usam o helper. (c) As **7 copias** de "tentar candidatos em ordem" viraram `firstSuccessful(candidatos, fn)`; aplicado no `embedcanais` (3 portas) e **verificado com chamada real** (HBO -> 2 streams), porque helper sem uso seria exatamente o codigo morto que a auditoria apontou.
  - **Duas coisas que a propria fotografia pegou**: (1) o `bonusNumeroFinal` compartilhado comecava a **remover "Episodio N"** e no ATB isso **perdia o sinal** (o numero do post e o marcador de temporada la) — diff de 3 casos; corrigido com `removeEpisodio: false` no ATB, e a fotografia voltou a bater; (2) a remocao do "Episodio N" estava **sem a flag `i`** e so funcionava porque o ATB ja passa tudo em minusculo. **Licao: a fotografia de comportamento pega o que o teste unitario nao pega** — igual a `audit-vod.js` para rede.
  - **Fila de otimizacao executada (decisao 71)**: ataquei os 18 achados da auditoria. **Feito e medido**: (1) `epg.js` — `parse` era O(programas x canais), agora monta `id -> chave` e fica O(programas); `logoDe` varria os **137 logos** chamando `norm()` a cada uso (2x por canal no catalogo), agora usa indice normalizado; `stats()` era O(total de programas) e o `/health` e `no-store`, agora memoiza 5s; `start()` nao era idempotente e o `if (setInterval.unref) setInterval.unref()` fazia unref do **global** (o timer de 15min mantinha o event loop vivo) — agora guarda e faz unref do timer certo. (2) `xtream` re-pontava o catalogo inteiro a cada pedido (3 `matchScore` x ~40k itens x 3 paineis, bloqueando o event loop): agora o nome vem **pre-normalizado** (`key`) e um filtro barato (`preFiltra`) corta antes do scoring caro, com **teste que garante que o filtro nunca descarta algo que o `matchScore` aceitaria**. Medido: kkt 1447->**179ms**, vzr 1766->**436ms**, rtd 2094->**519ms**, spt 2396->**626ms**. (3) `probeViaWorker` repetia a **mesma URL 2 vezes com 1MB cada** (~27s num host que da prod sempre responde 403): agora 2 tentativas de **160KB**. (4) Falha do probe de qualidade **nunca era cacheada** (reprobeava a cada pedido por 6min): agora cacheia `false` e a eviccao e FIFO em vez de `clear()`. (5) `redetoons` repetia 2 tentativas de 4s do indice a cada pedido quando ele estava fora: cache negativo por 10min. (6) `anitube` baixava o **HTML inteiro de 100 posts** na listagem: agora a listagem vem sem `content` e o post escolhido e buscado sozinho (1 request) — `buildStream` virou async. (7) AniList pedia `relations` (o grafo inteiro, o campo mais pesado da query) e `averageScore/format/seasonYear/bannerImage`, que **nenhum consumidor usa**: query enxuta. (8) `sqliteCache.cleanup` preparava o mesmo statement 5x por chamada. (9) `/meta` nao tinha cache (era N+1 no TMDB a cada pedido): agora 10min em redis+sqlite — medido **0,73s -> 0,006s**. (10) `resolveStreamInfo` antes do check de cache (ja feito na decisao 69). **Codigo morto removido**: `src/lib/semaphore.js` (0 require), `onEprPronto` (nunca exportado, ramos morto), e as duas ferramentas `vod-sources.js`/`audit-sources.js` que **quebravam no require** porque exigiam `topanimes` (fonte removida) — as 10 ferramentas do repo agora passam no `node -c`. `matchaAlgumTitulo` saiu do export. **NAO removi `relay-server.js`**: ele e `COPY`ado pelo `Dockerfile.relay` e verificado pelo `relay-deploy.sh`, entao e legado mas vivo.
  - **DUAS REGRESSOES QUE A AUDITORIA DE FONTE PEGOU (vale a lição)**: (a) troquei o import de `matchKey` no `xtream` e o **BLZ inteiro quebrou** com "matchKey is not defined" — o `node --test` **nao pegou** (nao ha teste do xtream com catalogo real), foi o `audit-vod.js` que achou; (b)baixei `MAX_CATALOG_BYTES` de 64MB para 12MB (o pico no heap e 2x o corpo por causa do `Buffer.concat`) e o **painel SPC passou de "body too large"** — o catalogo dele e maior que 12MB, ate maior que 24MB. **Revertido para 64MB**: era um ganho especulativo que quebrava fonte que funcionava, e a protecao de memoria da decisao 70 ja cobre o risco. **Regra: `audit-vod.js` roda DEPOIS de mexer em qualquer scraper, sempre.**
  - **Memoria perto do limite (decisao 70)**: o app1 chegou a **273MB** em producao (limite do container = 300MB). Investiguei: o **heap era so 46-64MB** — nao era vazamento, era **marca d'agua de alocacao** (o RSS nao volta, mesmo com `global.gc`, que alem disso **nao existe** porque o Dockerfile nao passa `--expose-gc`). O culpado era o cache guardando **ate 500 catalogos de TV de 660KB** (a chave inclui o `search` livre e o `date`, entao qualquer `?search=` guardava um payload enorme). Correcoes: `MAX_CACHE_SIZE` 500 -> **200**; **busca por texto com TTL de 60s**; `cacheSet` ficou **consciente do tamanho** (`tamanhoAprox`) — payload acima de 200KB so pode ter **6 entradas** e, ao entrar um payload grande, os antigos grandes saem; e o **vigia de memoria passou a reagir ao RSS** (`MEM_RSS_LIMIT_MB`, padrao 220) e nao so ao heap, que nunca chegava a 128MB. Medido estavel em **223-227MB com heap 46-64MB** depois de 40 catalogos com datas e buscas diferentes.
  - **STREAM ERRADO PARA O USUARIO (decisao 68, o mais grave que achei)**: o "voo unico" do motor em `scraper-engine.js` guardava a promise por **`source.id` somente**, sem o conteudo. Dois pedidos **simultaneos de episodios diferentes** (ou de series diferentes) pegavam a promise um do outro e saiam com **os streams do conteudo errado** — exatamente o defeito que o dono mais odeia (episodio errado). Corrigido para `${source.id}:${key}:${episode}:${season}`. O ganho de cache continua (o mesmo conteudo ainda compartilha). Ha teste que **falha antes** e passa depois.
  - **Arquitetura e otimizacao (decisao 69)**: uma auditoria do codigo inteiro (leitura, sem editar) deu 18 achados. JA CORRIGI: (a) o voo unico acima; (b) **`completaPrevia` meu** rodava **em serie** — ate 322 requisicoes enfileiradas no primeiro catalogo depois do boot, com timeout de 12s cada, capable de dar 504 no gateway; agora roda **em paralelo (8x)** com `emParalelo()` e timeout 3,5s, e marca `false` **antes** de sair pra rede (destrava chamada repetida em paralelo). Catalogo de TV respondendo em **88ms**. (c) **`resolveStreamInfo` rodava ANTES do check de cache**: num cache 100% cheio o pedido ainda pagava 1-3 chamadas de TMDB/AniList. Agora o `info` tem cache proprio (`info:${type}:${baseId}`, 30min, redis+sqlite) — medido:Matrix 5,9s (frio) e depois **15ms/8ms**. (d) **cache de catalogo**: `MAX_CACHE_SIZE` 500 -> **200** e **busca por texto com TTL de 60s** em vez de 15min (a chave inclui o `search` livre, entao qualquer `?search=` guardava um catalogo de 660KB). **Ficou na fila para depois** (valem, mas nao cabem agora): `epg.parse` e O(programas x canais) e `logoDe` e O(137) com `norm()` por item (o `todosLogos()` ja existe e esta morto); `probeViaWorker` repete a MESMA URL 2x com 1MB cada (~27s num host que em prod sempre da 403); falha de probe de qualidade nunca e cacheada; `MAX_CATALOG_BYTES` 64MB (pico de 2x no heap); `xtream` re-pontua o catalogo inteiro a cada pedido (3 `matchScore` x ~40k itens x 3 paineis, bloqueando o event loop); `/meta` de serie faz N+1 no TMDB sem cache de servidor; `setInterval.unref()` no EPG faz unref do **global** e o intervalo de 15min mantem o event loop vivo; `sqliteCache.cleanup` usa `DELETE ... LIMIT`, que o better-sqlite3 nao liga por padrao (a tabela pode crescer para sempre em `/tmp`); `anitube` baixa `content` (HTML inteiro) de 100 posts; AniList pede `relations` que ninguem usa; `/health` e O(EPG). Tambem: `semaphore.js` e arquivo morto, `vod-sources.js` e `audit-sources.js` quebram porque exigem `topanimes` (fonte removida), e `relay-server.js` duplica `src/lib/stream-relay.js` inteiro.
  - **Casamento de titulo nas 11 fontes (decisao 67)**: montei `match-bench.js` (37 casos com titulo real, incluindo o que **nao pode** casar: sequelas, spin-offs, remake de outra epoca) e medi **26/37**. Causas reais: `normalizeLoose` **nao tirava pontuacao** (hifen, dois-pontos, apostrofo e ponto falhavam) e **ano na consulta** nao era removido. Adicionei `canonico()`/`canonicoCompactado()`/`stripYearLoose()` em `text.js` e uma segunda rodada de comparacao em `matchVodTitle` (comparacao canonica + prefixo com resto vazio/ano/`S01`) => **34/37**. As 3 que faltam eram **traducao** ("A Origem" vs "Inception", "Interestelar" vs "Interstellar", "Pantera Negra" vs "Black Panther"): isso nao e problema de matching, e de **busca** — a fonte procura a string e o catalogo esta no outro idioma. Solucao: o contexto agora carrega `titles` (variantes, com `original_title` do TMDB) e o **motor repete a fonte uma vez por variante quando ela volta vazia** (`scraper-engine.js`) — uma unica mudanca vale para as 11 fontes e so custa uma requisicao no caso que estava quebrado. `info.titles`/`info.originalTitle` ja vinham prontos do `tmdb.js`, so faltava ligar. **Nao quebrei as rejeicoes**: "Naruto" ainda nao casa com "Naruto Shippuden", "Matrix" nao casa com "Matrix Reloaded", "Dune 1984" nao serve para "Dune" de 2021.
  - **Emoji do stream (decisao 65)**: VOD = **onda** e TV ao vivo = **nuvem**. `vodTitle()` e o ranker usam `stream.type === "tv" ? "☁️" : "🌊"`, e os provedores de TV (`embedtv.js`, `embedcanais.js`) montam `☁️ ${name} · EMB`. Achei um bug junto: a **linha do nome da fonte no ranker tinha emoji fixo** e o TV saia com o emoji de VOD. Deixei `📡` (genero), `🔴` (ao vivo), `📺` (linha das fontes e guia) e `⏭️` como estavam.
  - **Rotulo de audio (decisao 66)**: o dono pediu para **nao existir "Original"**. Agora `getAudioInfo` so devolve **"Português"** (com audio PT) ou **"Legendado"** (resto), e `audioUnknown` continua omitindo a linha. Bandeiras 🌍 e 🧩.
  - **PREVIA (decisão 63) — o senhorqueria "a previa do canal como a thumb de video do yt"**: a prévia **não é o logo**. Descobri que a fonte EMB já entrega `background` num `.prev.png` que é **JPEG 1280x720** (frame real do sinal) e que **a gente estava jogando fora**: `buildGroup` só guardava `logo` e `metaOf` fazia `background: group.logo`. Consertado: `group.preview` separado, `background` = prévia, e `getStreams` repassa a prévia para os streams (é a imagem de fundo da tela de play). Para quem não tem, deriva `<logo>.prev.png` e **verifica antes de usar** (GET Range 2KB, cache 24h) — **9 dos 17** restantes passaram; sem a verificação apareceria link quebrado. **155/161 com prévia de vídeo** (era 0).
  - **`globetvapp/epg` — o melhor nome de canal do Brasil, e morto (decisão 62)**: achei o repositório `github.com/globetvapp/epg`, que tem o Brasil em 4 arquivos (`Brazil/brazil1..4.xml.gz`, **2,1MB no total**, 1.365 canais, 46.461 programas) com os **nomes brasileiros perfeitos** (`CANÇÃO NOVA HD.br`, `Star Channel HD.br`, `Xsports.br`, `MTV Brasil.br`, 66 variantes de Record, 59 de Band, 51 de SBT) que o `norm()` do nosso `epg.js` casa certo (`CANÇÃO NOVA HD.br` → `cancaonova`). **Mas o repositório morreu em 31/12/2025**: o último commit é `2025-12-31T04:01`, os programas vão só até `20260102` (**9 meses parados**) e o README ainda promete "atualizado todo dia". **Todos os forks estão iguais** (`maopequena/epgs`, `sachin700-s/epg`, `NocturnalSpecimen/epg` — mesma data; `CharlyMike/epg` não tem a pasta). Ao plugar as 4 fontes o parse corretamente descartou tudo (`BRG1:+0 ... BRG4:+0`) — a janela de datas protegeu. **Fontes revertidas** (custariam 2MB por carga à toa), mas o **merge de todas as fontes foi mantido** (antes o código parava na primeira que funcionava, então fonte nova nunca entrava).
  - **Busca por guia maior (decisão 62) — resultado negativo, para não repetir**: baixei e analisei o guia internacional `epg.pw/xmltv/epg.xml.gz`: **15.744 canais**, **453MB** descomprimido, 57MB compactado. Ele **tem** Record, SBT, Band, MasterChef, MTV, Benfica TV, Canal 11 — mas **não tem** Canção Nova, Star Channel, XSPORTS, A Fazenda. Se ele fosse mesclado, resolveria 15 dos 73 sem guia, **mas 10 casariam com o canal ERRADO** (`Premiere 1` → `bcupremiere1hd` que é búlgaro, `Prime Video` → `prime`, `XSPORTS` → `foxsportsnews`, `Disney Plus 1/2/3` → `disney`): mostrar programa errado é **pior** do que não mostrar. Só ~5 casariam certo. Custo: 57MB por carga (2,7GB/dia a cada 30min) e precisa de **parse em streaming** (ler o gzip em pedaço, nunca o arquivo inteiro, ou estoura os 300MB). **Guia de Portugal não existe alcançável**: `epg.pw` não tem `epg_PT`/`epp_PT`; `xmltv.pt`, `i.telerising.es` e `xmltvrc.com` **não respondem** (HTTP 000) daqui; 5 repositórios de GitHub testados deram 404. **Se for usar o internacional, tem que ser com lista de nomes aprovados**, casando só Benfica TV, Canal 11, Masterchef, Discovery ID e MTV.
  - **Prévias: 155 de 161 carregam; 6 quebradas** (`PT - Benfica TV`, `PT - Canal 11`, `PT - Eleven 1/2/3`, `Globo Novelas`). Todas apontam para `img.faz-o-eli.online` e dão **404** — o site da fonte não tem esses arquivos. A ETC **não tem** esses canais, e o servidor de logos dela (`d1r94zrla0glo-cloudflare.vercel.app`) também não tem os nomes (testado, até `hbo.png` dá 404). Corrigido o bug de vir `https://img.faz-o-eli.online/.png` (logo sem nome de arquivo, vinha do HTML da fonte) — agora a URL inválida é descartada. `audit-previa.js` **baixa e valida** cada logo (tamanho + assinatura de imagem), porque ter o campo preenchido não quer dizer que a imagem carrega.
  - **A base das URLs de TV no app2**: como o Dokku entrega só o nome do app, o app2 não consegue derivar o próprio endereço público do request — mas o `TV_BASE_URL` **é** o endereço público dele. No primeiro request que chega no cluster de TV o servidor assume `runtimeBase = TV_BASE` (e loga `[split] este app e o cluster de TV: base = ...`); app1 nunca entra nesse caminho. Sem isso os streams do app2 saíam apontando para `/stream/hls/...` **no host do app1**.
  - **Achado importante do Dokku/BeamUp**: o `Host` que o app recebe **não é o domínio público, é só o nome do app** (`c12e41ddc21b-mirror2`, sem `.baby-beamup.club`) e o `x-forwarded-host` chega **vazio**. Por isso a trava anti-laço tem que comparar o **primeiro rótulo** do domínio — e não o host inteiro (o app1 é `c12e41ddc21b-mirror`, que é prefixo do `...-mirror2`, então comparar por `startsWith` inteiro faria o app1 se achar o cluster de TV e parar de redirecionar).
  - **O Dokku reescreve o cabeçalho `Host`** (a AGENTS já avisava que sem `PUBLIC_BASE_URL` ele vira `localhost`), então a proteção contra laço que comparava só o `Host` **não segurava em produção: o app2 redirecionava para si mesmo** e o catálogo de TV não abria. Agora `ehOProprioClusterDeTv()` olha `host`, `x-forwarded-host` (do Express e do cabeçalho cruo) e ainda compara a URL montada com o destino — **dupla trava**, e há teste para o caso do Dokku.
  - **Cuidado ao separar**: `tv.warmup()` (que sobe o **EPG**) estava dentro de `scheduleWarmup()` (o aquecimento de **VOD**). Com o aquecimento sob demanda, o app2 **nunca carregava o EPG** e a grade saía zerada — o e2e pegou (3 checks vermelhos). Agora `aqueceTv()` é chamado **sempre** no boot, e o VOD é que só aquece na primeira requisição de VOD.
  - **Dois erros meus de leitura custaram tempo** (documentados na AGENTS): canal ao vivo **não tem duração**, então exigir `duration > 0` dá falso negativo; e **vários ffmpeg em paralelo saturam o relay** e dão falso negativo. Verdade é `probe-tv.js` (decodifica 4s), com `PROBE_CONC=1`. Cultura, HBO, TCM, MTV, SBT, Premiere 3 **tocam** de verdade.

- **28/09/2026 — REI não tocava + cache de stream de TV inexistente (decisão 111)**: o dono reportou "o REI não tá tocando, o Stremio fica trocando de player indefinidamente e o stream não inicia". **Três defeitos somavam**: (a) a rota `/stream/hls/:file` **não conhecia o prefixo `rei:`** — caía em `resolvePlaylist`, que só entende EMB/ETC, e devolvia **404 `channel not found`**; a variante relay do REI estava morta desde que a fonte entrou; (b) a única via que restava era a URL direta, que é **`__index.txt` com `text/plain`** — `.txt` não é reconhecido como HLS pelo player; (c) o token da playlist vale **300s** e a TV ao vivo recarrega a playlist a cada poucos segundos, então mesmo que tocasse, morria sozinho em 5 minutos. **Correção**: ramo `rei:` novo na rota — busca o texto da playlist com `resolveSrc` e entrega como `application/vnd.apple.mpegurl`; cada ida do player volta nessa rota e **ganha token novo**. Não precisa reescrever segmento: medi que as 3 URIs da playlist são **absolutas, em outro host e sem token** (206 + MPEG-TS com sync `0x47` **até sem nenhum header**), então o `Referer` do iframe é irrelevante na mídia. **Prova**: ffmpeg **sem nenhuma flag especial** → 180 frames em 6s, ffprobe `h264 1280x720 + aac`. **Regra do dono aplicada no código**: a origem devolve dois defeitos que um teste ingênuo não pega — `500`/`404` no próprio host e, pior, **200 com playlist vazia (0 segmentos)**; playlist vazia é exatamente o sintoma relatado (cliente recebe lista, não há URI para baixar, tenta de novo e troca de engine em loop). `temSegmentos()` agora só emite o stream do REI se a playlist tiver `#EXTM3U` **e** ≥1 URI, com cache de 45s. Medido: `agtv`, `amazonsat`, `agromais`, `appletv` **saíram da lista**; amostra de 16 canais → **11 tocam na origem**, e os 5 que falham são conteúdo ausente lá (404/500/vazio) — não nosso. **(d) Cache de stream de TV não existia**: a rota `tv:live:` retornava direto, sem passar pelo `sqliteCache` nem pelo redis (só o VOD usava) — por isso o **mesmo canal aberto 3 vezes seguidas custava 9,4-9,9s cada**. Adicionado `TV_STREAM_CACHE_TTL = 90s` (90s e não 6min porque o JWT do REI vale 300s) + stale-while-revalidate no mesmo padrão do VOD. **(e) Aquecimento dos canais mais abertos**: `warmup()` só aquecia **catálogo + EPG, nunca streams**. Novo `aqueceStreamsDeTv()` no boot (20s depois, conc 4, teto 70) priorizando por **família do canal** (Globo/SBT/Record/Band/Cultura, Sportv/ESPN, CNN/Jovem Pan, HBO/Star/TNT) — o projeto não guarda contagem de acesso, e casar por expressão sobrevive a canal novo. **Resultado medido local**: `hbo` 1ª vez **216ms**, `globonews` **16ms** (antes ~10s), 2ª/3ª **12-25ms**; aquecimento `70/70` (depois `67/70`, com os canais quebrados sendo filtrados). **Por que o app1 também aquece**: é a cache daqui que o `repassaTv` usa quando o cluster de TV demora — sem ela o app1 refazia os ~10s e estourava a parede de 12,3s do gateway (foram os 504). **2º ciclo — o dono disse "o REI ainda não inicia"**, e os três achados valem mais que o primeiro: **(1) O bug de verdade: o `resolveSrc` não guardava na cache no ramo comum.** Quando o `src` vem direto no HTML do player (o caso usual) a função retornava **sem gravar nada** — só o ramo do POST, lá embaixo, escrevia na cache. Ou seja a cadeia de **4 saltos** rodava **a cada clique**, e um salto lento levou a **12,5s**; o gateway corta em **12,3s**, o pedido morria como **504** e o player nunca começava. Corrigido: ambos os ramos gravam, TTL **90s → 240s** (o JWT vale 300s), e `idadeUrl` + `REPREQ_MS=150s` disparam **atualização em segundo plano** — a cadeia passou a rodar só quando **ninguém está esperando** por ela, e uma falha nessa atualização **não apaga** o `src` que ainda funciona (senão um tropeco derrubaria a fonte para quem está assistindo). Medido: 1ª rodada de 5 canais **1900ms**, 2ª **0ms**. **(2) A variante direta dava 403 em tudo.** Testei 5 combinações (sem `Referer`, com `Referer` exato, com UA de browser, com os dois, só o host) e o nginx deles recusou **todas** — enquanto a validação passava, porque ela usa `browserFetch`, que tem headers de navegador e atravessa. Validávamos por um caminho que funciona e o player usava outro; as duas opções do canal podiam falhar no clique. **`getStreams` agora só emite o relay** (medido tocando **5/5**: afazenda7, arte1, bloomberg, bandba, agrocanal); a direta fica só se faltar `PUBLIC_BASE_URL`, onde não há relay possível. **(3) O `src` deles rotaciona.** O caminho do `__index.txt` deixa de existir no host (`404 not found`) e, com o TTL de 240s, o link morto continuaria valendo — o canal ficaria vazio sem parar, sem log nenhum. Agora, quando `temSegmentos()` rejeita, o `getStreams` **invalida a cache de `resolveSrc` e refaz a cadeia uma vez** antes de desistir (medido: `afazenda7` estava morto e recuperou; `6/7` canais da amostra voltaram a emitir stream). Custo: um GET a mais por chamada de canal, e o servidor guarda a lista 90s. **(4) O `Referer` quebrava o player web**: ele virava `notWebReady: true` e escondia o canal no Nuvio/navegador — removido, porque nem a playlist nem os segmentos pedem cabeçalho nenhum (medi: playlist 200 com e sem, segmentos 206 com e sem, CORS `*`). `notWebReady` agora é `false`. Testes **98/98**.

- **28/09/2026 — API de VOD criada (completa a de TV, decisão 110)**: o dono pediu "uma API só do Mirror" para simplificar buscas e chamadas. Só existia a de TV (`/api/channels`, `/api/channels/categories`, `/api/channels/:slug`), e **não havia nenhuma forma de buscar filme/série no Mirror** sem falar com o TMDB direto. Agora: `GET /api/vod/search?q=&type=movie|series&limit=&page=` (busca, devolve `tmdb:<id>`), `GET /api/vod/genres` (19 gêneros de filme / 16 de série), `GET /api/vod/:type/:id` (detalhe — a série já vem com **todos os episódios** em `videos`, no formato `tmdb:<id>:<temp>:<ep>` pronto para a rota de stream) e `GET /api/streams/:type/:id?season=&episode=` (**streams unificados**: um endpoint só para `movie`, `series` e `tv`, reaproveitando `handleStreams()` — mesmo cache, mesmo ranking, mesma lista do Stremio). Mesmo formato `{success, data}` da API de TV. Medido local: busca Matrix → `tmdb:603`; GoT → 73 episódios; `/api/streams/movie/tmdb:603` → **10 streams**, série S01E01 → **8**, `tv/hbo` → **1**. Fontes novas em `tmdb.js`: `search()` e `genres()`, com cache próprio de busca (150 entradas / 10min) para não ser ejetado pelas consultas de detalhe.

- **28/09/2026 — registro único de nomes (decisão 112)**: o dono pediu para "normalizar nomes, nomes fantasias, códigos etc. para que tudo seja escrito no código seguindo um padrão de organização, nomenclatura e estrutura". Medido antes de mexer: **466 funções** com mistura de idiomas; **cada fonte escrita 5 vezes** (`chave`, `id`, `code`, `name`, `label` em `source-names.js`, com `code`/`name`/`label` todos deriváveis); **`top` documentado em 4 lugares da AGENTS mas não existia mais em nenhum arquivo** (`topanimes`/`fetchTop` = 0 ocorrências — havia teste afirmando `SOURCE_PRIORITY.top === undefined`); **`rei` faltava no registro** (caía em `getSourceDisplayName → "CDN Torrent"` e em `SOURCE_PRIORITY ?? 9`); `etc` faltava na tabela da AGENTS. **Criado `src/core/nomes.js` — o registro único**: `FONTES` (chave → sigla/tipo/motor/prioridade/credencial/prefixo, de onde derivam `SOURCES`/`SOURCE_PRIORITY`/`EXPOE_CREDENCIAL`/rótulo), `ROTAS` + `PREFIXOS` (os **25 caminhos** do Express + `src/routes/segmentos.js`, e os trechos usados no meio da URL) e `VARIAVEIS`/`ENV`/`defineEnv` (**115 nomes de env**). `source-names.js` virou só lógica (deriva de `FONTES`); `sources.js` ganhou `fonte(chave, defs)` — id/rótulo/kind saem do registro e dá **throw** se a fonte não estiver nele; `tv-sources.js` monta `PROVIDERS` a partir de `FONTES` (mantendo a **ordem emb→etc→rei**, que decide o `ownerOf` de fallback). **180 leituras de `process.env` em `src/` viraram `ENV.NOME`** (25 arquivos; as 2 escritas viraram `defineEnv`; `tv-split.js` precisou do require no topo porque lia env na linha 1). Cuidado pago: o require do registro **tem que vir antes do primeiro uso** — a 1ª tentativa morreu com `ReferenceError: Cannot access 'ENV' before initialization` na linha 20 do `server.js` (o teste agora varre isso). **3 testes novos** (registro completo, padrão das fontes, rotas sem repetição) → **101/101**; smoke local: boot limpo, `/health`, `/manifest.json`, `/api/vod/search` → `tmdb:603`, `/api/vod/genres` 19/16, `/api/vod/movie/tmdb:603` → Matrix, `/api/streams/tv/hbo` → 1 stream, `/api/channels` → **284 canais** (36,7s no pedido frio). Docs: AGENTS com nova seção "Registro único de nomes" nas convenções + tabela de fontes regerada (saiu `top`, entraram `etc`/`rei`) + árvore; removidas 3 menções mortas ao TOP.

- **28/09/2026 — corte do matcher entregava série errada (decisão 113)**: o dono reportou "várias fontes de VOD sumiram, fui testar no anime Golden Time". **Medido antes de mexer — não era a normalização**: o motor continua com as 10 fontes idênticas (rótulo/tipo/tempo campo a campo), `aon.js`/`animesdigital.js`/`match.js` não tinham nenhuma env convertida, manifesto com as 16 fontes. **Golden Time é anime** (gênero 16 Animação + origem JP → `likelyAnime = true`), então por desenho só o balde de anime roda (`shg, ron, aon, atb, rtd`) — BLZ/SPC/ATO/KKT/SPT/VZR **nunca são chamados para anime**. Das 5, três estavam caídas **por causa externa**: **RON** = `animesdigital.org` fora (**HTTP 522** do Cloudflare, 19,4s), **AON** = Golden Time não existe no catálogo deles (índice de 735 KB tem "Golden Kamuy", não "Golden Time"), **RTD** = bloqueado na prod (`rtd bloqueado` — HTML/challenge, egress de datacenter; funciona do dev). Restavam SHG + ATB = exatamente os 2 que a prod devolveu. **Ao medir isso apareceu o defeito de verdade**: `matchScore("Golden Time","Time") = 70` e o corte de série é `>= 70`, então o painel **servia a série errada** — em teste real, 9 dos 71 pares (painel×consulta) tinham **show errado como único resultado** (`Golden Time→"Time"`, `House of the Dragon→"The Clubhouse Um Ano com o Red Sox"`, `Money Heist→"Heist"`, `My Hero Academia→"A Academia"`, `Squid Game→"The Game"`). **Duas causas no `scorePair`**: (a) `q.includes(n)` (nome do catálogo **contido** na consulta) devolvia **70** = passava batido no corte; agora só passa se o que sobra da consulta for **ano/qualidade/temporada** (90), senão **60** — assim `Friends 1994 → Friends` continua valendo e `Golden Time → Time` cai; (b) a sobreposição de palavras usava `nw.includes(w) || w.includes(nw)` sem filtro, e **`"dragon".includes("o")` é true** — a palavra "o" do candidato casava com qualquer coisa, dando 70 para `The Clubhouse...`. Agora os dois lados passam por `palavraForte` (≥4 letras), que o `preFiltra` já usava. **Terceira camada**: `streamsForSeries` passou a exigir `matchVodTitle` junto do placar — ele rejeitou **6 dos 8 shows errados** e manteve **6 dos 6 certos**. **Medido nos 3 painéis reais (5.588 + 6.627 + 9.659 séries)**: pares com resultado 71 → 62 (corte) → **57** (com o gate), os 5 que esvaziam serviam só show errado **e as outras fontes cobriam o título de verdade** (`Bleach`, `The Office`, `Dark`, `Naruto`, `Demon Slayer` continuam vindo dos outros painéis); `House of the Dragon` → vazio porque **nenhum painel tem o título** (31/54/51 nomes com "dragon", 0 aceitos). **Topo trocado**: `Space "The Boys"` deixou de servir "Boys ll Planet" e passou a servir "The Boys - 2019". Caminho real do scraper validado: `Golden Time→vazio`, `The Office→The Office`, `Naruto→Naruto`, `Dark→Dark`, `Bleach→Bleach`, `Demon Slayer→Demon Slayer: Kimetsu No Yaiba`. **Teste de regressão novo** → **102/102**; `match-bench.js` **34/37 inalterado** (as 3 falhas são as pré-existentes de tradução).

- **30/09/2026 — TV = EMB + ETC + REI, metadados do REI e guia do XMLTV do REI (decisão 121)**: pedido do dono "tirar o KAK da TV, metadados/logos virem do REI e EPG vir pela API do REI". **KAK saiu da TV** (`FONTES.kak` fora do registro, `MODULOS = { emb, etc, rei }`, sem `relayLive`/`/live/kak` — removidos `kakito-tv.js`, `live-kak.js`, `relay-live.js`, `epg-rei.js` e os 2 testes). **Logo/metadado vem do REI** quando o canal existe lá (`grupoRei.logo` no catálogo, REI 1º no `getMeta`), com fallback para quem já tinha; **0 canais sem logo** (REI 224 / faz-o-eli 57 / vercel 3). **O `preview_url` do REI é morto (403/404)** → nunca vira `background`; `makeMeta` usa `background: logo` e o `/meta` usa `group.preview || group.logo || out.poster`. **EPG: uma fonte só, `reidosembeds.online/api/guia` (XMLTV, 3.972 programas / 143 canais)** no lugar do `epg.pw` + da raspagem de HTML — heap do guia **+71MB → ~0** (medido `RSS apos EPG: -10MB`); `display-name` passa por `decodeEntities` (senão `A&amp;E` ficava fora do guia). `VERSAO_CATALOGO = "2026-09-30-rei-meta"`. **Barreira: 191 testes.**

- **30/09/2026 — fontes separadas por categoria (decisão 122)**: pedido do dono "separe em categorias fontes de anime, série, filme, dorama e TV" (alcance escolhido por ele: registro + docs + /health). `FONTES[chave].conteudos` no registro único + `categoriasDasFontes()`; `/health` ganhou `fontes` com as 5 listas; AGENTS reorganizada em `Anime` / `Séries e Filmes` / `Doramas` / `TV ao vivo` + índice das 5 categorias; 2 testes novos → **193**.

- **30/09/2026 — RTD só atende quem chama do Brasil: um worker por fonte (decisões 123/124)**: pedido do dono "RTD via worker ou borda, ou de forma direta mas escondendo o link fazendo como as outras fontes" e depois "crie um worker para cada fonte" (isolar cota). **Medido: a regra do RTD é de país, não de formato** — do Brasil `catalog-index`/`play-link` respondem **200**, da prod **403**, e **via worker o mesmo 403** porque o worker roda no data center de quem chamou (Brasil → worker → RTD = 200; prod → worker → RTD = 403); proxies públicos de EUA/Europa (allorigins, codetabs, isomorphic-git, jina) também **403/522**. O alias `redetoons.win` tem **TLS quebrado em todo caminho** (`EPROTO`/525/409), então a API passou a sair pelo `redetoonstv.win`. **A prod fica na Polônia** (colo WAW — e não FRA, como se supunha). `wrangler.toml` tem `[placement] region = "aws:sa-east-1"` (a dica é aceita e gravada na conta, mas **não se aplica aqui** — `aws:ap-northeast-1` deu WAW igual, então não é o identificador) e a rota **`/colo`** no worker (302 com o colo no caminho: o `/stream/proxy-check` só devolve corpo quando a resposta não é 2xx, então o redirect é o único jeito de ler o colo da prod). **Um worker por fonte** no registro único (`WORKERS`/`workerDe`) + `deploy-workers.sh`, todos com o mesmo código, e o do RTD com Smart Placement e o "aquecimento" que dá o sinal de 2 subrequests. Barreira: **198**. O **deploy do worker eu mesmo fiz** com um token novo que o dono mandou (o antigo, de 25/09, já estava morto; o novo está em `~/.cloudflare-token`, e `GET /client/v4/accounts` é o jeito de conferi-lo porque `/user/tokens/verify` diz "Invalid API Token" para token de conta).

## A triagem do catálogo estava prendendo canal bom (decisão 111)

Foi o achado mais caro do dia, e não tem a ver com o REI em si: `tv-sources.getCatalog()` só coloca no catálogo quem passa numa **triagem** — chama `getStreams` de cada um dos ~800 canais com `TRIAGEM_CONC=48`. Dois defeitos encadeados:

1. **`groups` era preenchido só com os aprovados.** `membersOf()` lê `groups` para descobrir de qual provedor o canal veio; quando o canal não estava lá, caía no fallback `ownerOf` (provedor[0] = **EMB**). Um canal que só existe no REI passava a ser consultado **só na EMB** — e a EMB não tem ele — então devolvia `0 streams` **para sempre**, mesmo com a fonte do REI saudável.
2. **O resultado da triagem só se atualizava quando a composição mudasse** (canal novo ou removido). A triagem nova rodava mas era **descartada** se a lista de provedores fosse a mesma. Como a triagem do boot disparou 48 cadeias em paralelo e o host deles recusou, o erro do boot virou definitivo.

**Efeito medido na prod**: catálogo com **259 canais** e `sbt`, `disney`, `sony`, `gloobinho`, `sonymovies`, `sbtpi`, `bandmg`, `bandba`, `bandpb` **fora dele** — e todos devolvendo `0 streams` (`sbt` ainda com timeout de 40s). Local, com a mesma build, eram **281** e todos funcionavam. A diferença entre as duas máquinas era só o resultado da triagem no boot.

**Correção**: `buildGroup` roda para **todos** os seeds (a filtragem por `chavesBoas` passa a valer só para a lista exibida), e quem passou na triagem **desta** chamada é **somado** ao conjunto guardado mesmo com a composição igual. Nunca removemos quem já passou — é a regra do dono de não retirar canal.

**Medido depois do deploy**: catálogo **259 → 283**; os 10 canais testados passaram de **0/10 para 10/10** com stream, e `bandmg` — que nem aparecia na lista — agora entrega stream e **o ffmpeg decodifica**. Os 3 que voltaram vazios na primeira medição (`gloobinho`, `sonymovies`, `sbtpi`) recuperaram sozinhos 45s depois: é a origem rotacionando, não o catálogo.

## Arquitetura (detalhes na árvore do `AGENTS.md`)

- `src/server.js` — handlers (manifest/meta/catalog/stream), parse de config, rate limit, gzip, cache, `/resolve`, `/stream/hls`, `/stream/proxy`.
- `src/scrapers/` — **embedtv** (TV ao vivo), **otakulogia/animesdigital/aon/topanimes/anitube** (anime: SHG/RON/AON/TOP/ATB), **xtream** (BLZ/SPC/ATO), **playerflix** (SPT), **kakito** (KKT VOD), **doramogo** (DGO: doramas), **tmdb**, **cinemeta**, **kitsu**, **anilist**.
- `src/lib/` — match, quality, text, source-names, proxy (`relayPlayUrl`/`relayFetchUrl` p/ hop BR), stream, stream-relay, epg, redis, scraper-utils (`browserFetch`, `makeCache`, fila por host sem delay: `enqueue(host, fn, 0)` + `rateMs` opcional + cap500), semaphore (`Semaphore(20, 15000)` → `/health capacity.scraperQueueTimeout`), anime-ranking, ua.
- Testes: `node --test test/` (**77 testes** = barreira). Manuais: `vod-sources.js` (todas as fontes VOD uma a uma + probe de URL — **25 casos desde25/09: inclui RTD, ATB e DGO**), `audit-sources.js` (**auditoria E2E de TODAS as fontes**: latência por caso, probe Range de cada link, validação de match, ffprobe playback por fonte + EMB/EPG — consome `e.partialStreams` do xtream), `e2e-flow.js` (fluxo completo do user — requer server local com protocolo kill→`rm /tmp/cache.db`→subir) e `load-test.js` (carga com usuários virtuais — X-Forwarded-For por user, exige0 erros).

## Decisões firmes (NÃO reverter sem pedido explícito)

1. **TV ao vivo = EmbedTV** (embedtv.lat). IDs `tv:live:<slug>`. Playlist direta determinística `PLAYLIST_BASE<slug>.txt` em `resolvePlaylist` — **NUNCA validar buscando server-side**: o edge dá 502 para a saída do servidor e a página do player (`var src`) devolve o host morto `live-chunks.mediacdn.net` (DNS inexistente), que envenena o cache e derruba todos os canais. Os segmentos da `.txt` são URLs `.css` **camuflados que servem vídeo de verdade** (h264/aac — não rejeitar pelo nome; os hashes rotacionam, playlist nova sempre vale). 2 streams/canal: primário `/stream/hls/<id>.m3u8` (302 → `.txt` direto no cliente, VPS fora do caminho de dados) e fallback **worker relay** `relayM3u8Url()` (egress Cloudflare — `/stream/proxy` não serve para emb porque o egress do servidor não alcança o `.txt`). Catálogo `mirror-tv-live` (145 metas) com seções do EmbedTV + EPG.
2. **Kakito (KKT) só VOD.** Catálogo IPTV, NetTV (NTV) e FrostView **removidos** — `tv:frost:`/`ntv` não voltam ao manifesto.
3. **IDs `kitsu:`/`kitsuNNN`** resolvidos via API Kitsu em `src/scrapers/kitsu.js` (o prefixo é anunciado no manifesto).
4. **`behaviorHints.configurable = false`** — decisão do dono (botão Configure escondido de propósito; o config completo continua funcional).
5. **Scrapers LANÇAM erro em falha de fetch** (nunca `return []` silencioso). O servidor então: marca **degradado → TTL 60s** (vs 6min do resultado cheio), preserva `e.partialStreams` e loga `[streams] scraper falhou`. Lista de painel xtream vazia = erro (throw). Erro do xtream agrega **TODOS** os painéis com nome (`xtream panel failed: Blaze: timeout; Space: <motivo>` — antes só o1º, escondendo o estado real do SPC).
6. **KKT e BLZ são o MESMO backend kakito.xyz** — mesma URL de stream (só scheme/porta diferem: `https://:443` vs `http://:80`). `streamDedupKey` (hostname+pathname) deduplica **por URL pura** (sem sufixo `|quality` — rótulo de qualidade divergente não pode reabrir duplicata) + **dedup por assinatura de display** (fonte|qualidade|título completo|flags de áudio) para streams HTTP, que mata URLs diferentes com label idêntico (rows duplicadas de painel, variants RON/KGE). Variantes de áudio (line2 `🌎 Português` vs `🧩 Legendado`) NÃO são duplicata — flags entram na assinatura. "BLZ sumindo em séries" é **esperado**: o conteúdo chega via KKT (rótulo trocado, arquivo igual).
7. Cinemeta: probes série+filme **paralelos** + cache negativo 60s. IDs mortos → ~2ms na 2ª chamada.
8. Rate limit por IP: API **180/min**, `/stream/proxy` + `/stream/hls` **600/min**. Chave = **1º IP do `X-Forwarded-For`** quando presente, senão `req.ip` — atrás do Cloudflare, `req.ip` com `trust proxy=1` resolve pro **IP do edge** (~9 baldes de 180/min que o load-test estourava com 429; agora cf/gateway preservam o XFF do client por append e o teste usa XFF por usuário virtual → prod **2000 req/50 conc = 0 erros**; trade-off: quem setar XFF arbitrário muda de balde — a contenção L3/L7 fica com o CF). Gzip (`compression`) em JSON.
9. Warm-up de EPG + catálogo no boot (1,5s). Timeout global de scrapers: `SCRAPER_TIMEOUT_MS` (**20s** default; **9000** na imagem BeamUp — o gateway/Cloudflare responde 504 em ~12s); fase de scrapers usa o **budget restante** já gasto na resolução de id. EPG: single-flight + cache de tentativa vazia (60s) + `getEpgBounded()` (race **400ms**) no meta/catálogo de TV — as fontes falham do BeamUp e o meta não pode esperar o fetch (senão 504 eterno).
10. Manifest `mirror-tv-live` mantido no mesmo ID (preserva config de usuários).
11. **Matching VOD por título + ano** (`src/lib/match.js`): `extractYear` prefere ano entre parênteses, ignora números que não são ano (limite 1900..ano atual+1 — `2049` de Blade Runner não é ano; dígitos do próprio título via query descartados) e `adjustScoreForYear` dá +5 se o ano bate e **cap em 50 se difere** (abaixo dos cortes 90 filme / 70 série) — homônimos como It, Peter Pan, Pinóquio, A Onda só retornam o ano certo. `info.year` (TMDB `release_date`/`first_air_date`, cinemeta `releaseInfo`) entra no `cacheKey` de stream (evita colisão de homônimos no cache de6min) e é passado como último parâmetro nas chamadas de xtream/kakito/playerflix. Guardas extras: KKT rejeita série em pedido de filme (`wantMovie && isSeriesEntry`); serieScore usa `scored.slice(0,3)` candidatos até achar o episódio; temporada pedida é **estrita** (sem fallback pra outra temporada); servidor filtra `stream.season !== season`.
12. **Labels de stream padronizados** em `vodTitle()` (`src/lib/stream.js`): filme = `🎬 Nome (Ano) · Qualidade · FONTE`; série = `🎬 Nome · SxxEyy · Qualidade · FONTE` (fonte = sourceKey maiúsculo: BLZ/SPC/SPT/KKT/SHG/RON/KGE/DRV/EMB). `cleanLabel` remove do nome sufixos Episódio N / SxxEyy / temporada N / dublado / legendado / tags `[ ]` / qualidade no fim. `rankAnimeStreams` **não** re-add a linha `🌊 fonte` quando o título já a contém. **TV ao vivo (EMB) usa o MESMO pipeline**: EmbedTV monta `📺 Nome · EMB` / `📺 Nome · Relay · EMB` (fonte inline, sem `💧`/`☁️`), a branch `tv:live:` roda `rankAnimeStreams` (sort, `name: Mirror Q` e linha `🌎 Português`) e stripa `_isPtBr`/`rankingScore`; o ranker é **type-aware** (prefixo `📺` se `type==='tv'`, senão `🎬`; strip inicial cobre `📺`/`💧`) e agrupa qualidade via `normalizeQuality` (aliases `fhd`/`hd` entram no bucket certo). Todo player: linha 1 = emoji+contexto·[Q]·FONTE, linha 2 = `🌎 Português`/`🧩 Legendado`/`🎵 Original`.
13. ~~AnimesDrive (DRV)~~ **REMOVIDA (rodada 24/09-7, decisão 30 — KGE/DRV fora a pedido do dono; anime hoje = AON+TOP, ver decisão 30). Registro histórico:** **AnimesDrive (DRV) — só série, branch anime** (`src/scrapers/animesdrive.js`; WordPress 7.1 + DooPlay/DooPlayer, **sem Cloudflare**). Fluxo: busca RSS `/search/{q}/feed/rss2/` (só links `/anime/`, dedup por slug) → score `scoreItem` (threshold **50**, top2, desempate por comprimento) → página `/anime/{slug}` com cards `data-episode-number='N'` (**numeração absoluta** — T1 de One Piece termina em61, JSON-LD bate T23/E1178) → página `/episodio/{x}` lê shortlink `?p=NN` + JSON-LD (`episodeNumber`/`seasonNumber` — divergiu do pedido = candidato rejeitado) + abas `button.animeq-player__server[data-animeq-switch=N][data-source-name]` → slot `N+1` de `GET /wp-json/dooplayer/v2/{postId}/tv/{N}` (`type:"mp4"` → `searchParams.get("source")` do wrapper `/jwplayer` já decodificado1x (duplo encoding `%2520`→`%20` ok); `type:"iframe"`/`embed_url:null` = descartar). Abas `Legendado/Dublado` viram flags (`dub → dubbed+portuguese`, else `subtitle`), abas `SD/HD/FHD` → qualidade480/720/1080 senão default720p. **`animes.click` exige `Referer: animesdrive.cloud`** (sem =403, com =206; worker `/proxy` não repassa Referer) → URL embrulhada em `${PUBLIC_BASE_URL}/stream/proxy?url=...` com regra de host nova no server (rate600/min, mas mp4 sai200 sem Range — seek limitado, aceito só p/ slot SD). Hosts `mangas.cloud`/`aniplay.online` diretos. DRV deduplica as próprias URLs antes de devolver; no server o dedup por URL pode escondê-lo quando KGE traz o MESMO arquivo (mesmo CDN — perda zero; DRV aparece quando KGE erra/URL difere). Pena de cauda: título `"... 3"` com temporada pedida ≠3 → −30 (rejeita K3 em S1, aceita em S3); "Todos os Episódios" −15; filme/ova/especial −40; boruto −40; dublado −8; shippuden divergente −30 (`cmpKey` colapsa letras duplas → "Shippuuden"="Shippuden"). Ids: `animesdrive:{slug}:{ep}:{slot}`. Falha de fetch LANÇA (busca/página/página-ep) e só retorna `[]` se falha + falha em todos os slots; `scored` vazio = `[]` (dado, não erro). Filme `/filme/` NÃO implementado (branch só rota p/ série).
14. **SPC (`get_series`/`get_series_info`) HABILITADO** (`hasEpisodes: true`). Armadilha: painel devolve `episode_num` como **string** (`"2"`) — SEMPRE `Number()` antes de comparar (`===` com número falha silenciosamente; BLZ devolve número, SPC string). Lacuna real: SPC id51554 (BB) não tem S01E01 — o loop de candidatos acha via id14048; id51554 começa em E02.
15. **Pente fino de robustez (não reverter)** — mudanças todas validadas por teste unitário/E2E:
    - **server**: `parseConfig` com try/catch de decode; `Semaphore(20, 15000)`; `streamDedupKey` inclui `u.search`; `cacheKey` inclui `type:baseId` (sem colisão); filtro de qualidade via `normalizeQuality` (`"4k"`→2160, antes NaN); episódio `Number()` nos dois lados; **Range do cliente repassado** em `/stream/proxy`; `defineMetaHandler` try/catch → `{meta:null}`+log; catalog/meta/season catches com log; `getTvSeason` degrade por temporada (`.catch`+log).
    - **meta kitsu AGORA FUNCIONA** (branch kitsu em `resolveMeta` + `getKitsu` enriquecido: poster/background/sinopse/ano) — ver Armadilhas.
    - **scraper-utils**: fila `MAX_QUEUE_PER_HOST=500` (reject de fila cheia), rate por `q.lastRun` (antes sempre0 → rate inoperante), `browserFetch` enfileira com rate0 (só concorrência2/host, sem delay1,1s p/ caber no budget20s), redirect com marcador que **libera o slot antes de recursar** (evita deadlock FIFO), **abort/timeout sempre rejeitam** (antes podia nunca rejeitar → leak de slot), `probeHlsQuality` memoiza `null` em sentinela.
    - **stream-relay**: `segmentCache` **removido** (código morto — só era lido, nunca populado; `getStats` sem `segmentCacheSize`, dashboard mostra só M3U8); backpressure (pause upstream quando `write`→false / resume no drain), `destroy()` idempotente, `entry.lastAccess` atualiza no data, `resolveRedirects` com guard de protocolo + IP privado, **`rewriteM3u8` resolve relativas no diretório da playlist** + reescreve qualquer `URI="..."` (antes só EXT-X-MAP com base vazia), guard `clientRes.destroyed`, direct path com `incHostConcurrency`+`release` once+`status(statusCode)`+Content-Range/Accept-Ranges; exports `rewriteM3u8`/`getStreamKey` (**`getStreamKey` inclui `u.search`**).
    - **relay-server**: código morto removido (shared-streams e segmentCache nunca populados), `activeRelayCount` **real** (inc + release once — antes só saía do gate), gate `MAX_RELAY_STREAMS` efetivo, Range/Content-Range/Accept-Ranges repassados, cap de fila500, `resolveRedirects` com protocol+IP privado (SSRF do `/test` coberto), `decHostConcurrency` zera em0, `enqueue` fila cheia reject.
    - **worker**: timeout em TODO fetch (`AbortSignal.timeout`:15s m3u8 /30s proxy /15s rde-seg); `/relay/m` reescreve **qualquer linha não-`#`** (antes só `.ts` — m4s/extensões novas passavam cru); `rewriteProxy(body, origin, baseUrl)` resolve relativas contra a URL base; `decodeURIComponent` guardado (URL malformada →400, não exception); `resolveStreamUrl` distingue **5xx/rede (`lastError`→throw→502)** de **404/ausência (→`[]`→404 canal)**.
    - **epg**: `res.on("error")` no `httpGet` (**sem isto download falho = uncaughtException derrubava o processo**), cap de5 redirects + `res.resume()`, `getEpg` guarda stale `epg` e mapa de nome por **identidade `_src`** (antes `_size`==tamanho — troca de canais com mesmo tamanho ficava stale).
    - **scrapers**: xtream `fetchJson` throw (rede/JSON/não-2xx) com **allSettled por painel** — painel que falha NÃO anula o que respondeu (`partialStreams` preservado); playerflix redirect cap5 + status não-2xx throw + payload inválido throw + allSettled-all-rejected throw; tmdb throw em rede/5xx (**null só em 404**) com log; cinemeta **miss-cache só em miss real** (rede lança; probes com status distinto); kitsu throw+log; otakulogia usa `upstreamCid` direto (evita re-search) e `[]` negativo só com TTL curto em "episódio sem vídeo"; animesonline3×`!ok`→throw + dedup por URL; animesdigital `!ok`→throw em todas as fetches + **isolamento por candidato** (falha de UM candidato não aborta os demais; throw final só se streams vazio + erro) + dedup por URL; animesdrive slots vazio (`!slots.length`) conta como falha com erro sintético (antes `okCount` subia antes de `slotToUrl` → falha silenciosa) e **throw final se streams vazio + `firstError`** (antes exigia `fetchFailures >= scored.length`); kakito refresh periódico via **tabela staging** (`channels_new`→swap transacional→recria índices; throw se `totalCount===0`; em falha dropa staging e retry em60s), timeout do playlist **60s com `unref()`** (antes120s com timer leak), `LIMIT 1000`, keywords PT-BR sem `"br"`/`"ge "` (falsos positivos) e filtro `live/anime` vale só em URL **não-VOD**; embedtv catches com log.
16. **Performance de concorrência (validado por `load-test.js`)** — streams e catálogo usam **single-flight** (`inflightStreams`/`inflightCatalogs`: N requisições iguais = **1** resolução+scan upstream) e **stale-while-revalidate**: `sqliteCache.getStale()` lê o valor expirado (o `cleanup()` mantém rows por **grace de1h**; `get()` **não** apaga expirado), serve stale na hora e revalida em background (`refreshingStreams`) — usuário **nunca espera re-scan**. Resolução de id que falha cacheia **vazio60s** (`negativeKey`, evita martelar AniList→429). Fase de scrapers recebe o **budget restante** (`SCRAPER_TIMEOUT_MS − elapsed`, mín2,5s) p/ não estourar o gateway. JSON (exceto `/stream/`) responde `Cache-Control: public, max-age=120`. Resultado: 2000 req/50 conc → RPS **96→408**, p95 global **≤211ms** (era ~15s em janela de rescan), **0 erros**; prod reproduziu **0 erros** (2000/50) depois que a chave do rate limit passou a usar o XFF do cliente (decisão8).
17. **Detecção de anime por gênero TMDB** — além de `isLikelyAnime()`, série com `genreIds` contendo **16 (Animation)** + `originCountry` **JP** entra no pipeline de anime (campos expostos por `getTvDetail`). Corrige títulos fora da keyword-list (Frieren: 0→5 streams). `getEpgBounded()` race = **400ms** (o fetch das fontes nunca resolve em ~1s; enriquecimento de EPG cai na próxima janela de cache — meta/catálogo frios caíram de2,5s→~0,05s).
18. **UI preto+vermelho (paleta do addon)** — `public/install.html` (página principal; `/`→`/install`) e `public/dashboard.html` com fundo `#08080a` + acento `#e50914`, **CSS puro sem CDN** (Tailwind CDN removido — render sem blocking de script externo), grid sutil, glow vermelho, responsivo + `prefers-reduced-motion`. **Logo = símbolo do Stremio** (path do Simple Icons, CC0) em vermelho sobre escudo preto (`public/logo.svg`, usado na página e no campo `logo` do manifesto).

20. **Probe de duração/liveness do SPC + `filterConfirmedYear` (corrige match errado — ex.: Mayday 2026 → só `6071388`)**: `streamsForMovie` sonda os **6 maiores scores** com Range `bytes=0-262143` (+ tail `bytes=size-524288..` só p/ ext `.mp4` com `size>262144`), timeout 3s, retry único c/ 400ms para 403/404/410, 5xx/timeout/erro → `null` (=desconhecido, mantido); `parseMp4Duration` lê `mvhd` v0/v1 do `moov` no **Buffer** via `browserFetch().buffer()` (nunca `arrayBuffer().buffer` — risco de bytes do pool vizinho). Pipeline `applyProbeFilters` em ORDEM: (1) descartar `alive===false` (se TODOS mortos → mantém os candidatos), (2) dedupe por `size>1048576`, (3) runtime estrito — se ≥1 casou com `runtime` (tolerância `max(300s, 8%)`), mantém **só** validados; se nenhum casou, mantém o conjunto; nunca vazio. **`filterConfirmedYear` roda por ÚLTIMO** (só confirma ano depois do probe — antes dele o arquivo errado sobrava). `probeCache`=10min c/ single-flight; probe só p/ filme; `runtime` vem do TMDB (`info.runtime` → 7º arg de `streamsFor`). `getVodList`/`getSeriesList` ganharam flag `force` e **re-warm a cada 50min** (`setInterval(preloadLists)` no boot — `vodCache` TTL 1h ≫ budget 9s de prod, sem re-warm o SPC sumiria a cada expiração no cold start).

21. **Nova fonte RTD (RedeToons, alias `redetoons.win`)**: API `GET /api/play-link?contract=3&tmdbId=..&type=movie|tv[&season&episode]` → `{contract:3, variants:[{quality:"dublado"|"legendado", url, mirrors}], is_legendado, missing?}` com URL mp4 assinada (`?exp=` ~12h + `sig`); **`mirrors[]` podem vir com `exp` vencido → usar só `variants[].url` primário**. **Dois gates de acesso**: (A) **`Referer` obrigatório** — sem ele → 403 JSON `forbidden` (UA/Accept irrelevantes; só Referer ligado já passa, curl puro falha); (B) **geo-bloqueio no primário `redetoonstv.win`: só egress BR passa** (container DE → CF block page 403; worker no colo FRA → 403; colo GRU/BR e dev local → 200; não é ASN, é país). **Resolução = usar o alias `redetoons.win`** (`site-config.known_domains`, mesmo backend): testado do **container(DE)** via `/stream/proxy`, `catalog-index` → 200 e `play-link` via worker `/rde/seg` (Referer do primário aceito no alias) → **200 com variants** — sem ponte BR (caixa sem porta aberta e dokku sem `GatewayPorts` p/ túnel reverso). Scraper vai pelo worker `mirror-cdn.dev-avmirror.workers.dev` — `catalog-index` via `/proxy` (índice completo `{payload:{tv:[ids],movie:[ids]}}`, cache 30min, **filtra misses ANTES do play-link** — evita o 403-texto do worker virar falso degradado) e play-link via **`/rde/seg`** (endpoint existente que já envia `Referer: <origem do target>` = exatamente o gate A); fallback direto se o worker cair (`browserFetch` manda `Referer` da origem do alias por default). Semântica: 404 ou 403-JSON → `[]`; 403-texto → throw (degradação auto-curável em 60s). Wrangler **sem auth** nesta máquina (e exige Node ≥22; aqui é 18) → worker não redeployável, usar só endpoints existentes. `download-link` exige Supabase+Turnstile → **não usado** (play-link é anônimo). Scraper `redetoons.js` roda p/ `info.id` `tmdb:NNN` (filme, série e anime-com-id-TMDB — id autoritativo, sem matching de título), flags dub/leg por variant; `hasExpiredSignedUrl` checa `exp=` além de `expires=`; fonte `rtd` = `CDN VOD | RTD`, prioridade 1; 2 casos RTD no `audit-sources.js`. Barreira de testes: **56**.

22. **Rodada 24/09 — playback RTD + match de spinoff + probe de série** (pedido: "rede toons não carrega... golden time"): **(a) Wrap/ref** — toda URL do RTD sai embrulhada em `${PUBLIC_BASE_URL}/stream/proxy?url=..&ref=https://redetoons.win/` (CDN de arquivo exige Referer deles; Stremio não manda) e o server injeta `Referer` quando `req.query.ref` casa `^https://[a-z0-9.-]+\.[a-z]{2,}/?$`. **(b) Fallbacks RTD** — `fetchIndex`/play-link tentam o worker e, em `!ok`/403/5xx/throw, caem p/ chamada direta pelo container (403 transitório deles durante deploy derrubou o RTD ~40min em 24/09; agora volta sozinho). **(c) Bug-raiz do playback** — a origem `cnn.radiogaucha.fun` **clampa faixa aberta (`bytes=N-`) em 4 MiB** (e faixa gigante `0-<total>`) → ffmpeg morria com `Stream ends prematurely at 4194304`; faixa **fechada ≤64 MiB** passa inteira (provado início/meio/fim). Fix = `relayStitchedRange` (`stream-relay.js`): faixa aberta ou fechada >64 MiB → repicada em janelas fechadas de 32 MiB (`STITCH_CHUNK`) encadeadas; headers `206` + `Content-Range bytes N-<total-1>/<total>` + `Content-Length total-N` (`X-Relay-Mode: stitch`); bytes da costura validados por sha256 contra a origem na fronteira de 32 MiB. **(d) Match de spinoff** (KGE `scoreTitle` −15/palavra extra; DRV `scoreItem` −25/palavra; stop-list + anos/números isentos; `searchAnime` pool5→12): "Dragon Ball" rejeita Super/Kai/GT, "One Piece" rejeita Gyojin Tou-hen. **(e) Série xtream com probe de vida** (`probeSeriesEpisode` Range 1KB → `filterAliveEpisodes`: morto → próximo candidato ≤3; todos mortos → mantém fallback, nunca pior que antes). Resultado: testes **56/56**, `vod-sources` 22 casos, audit **18/19 streams · probes27/30 · match BAD0 · ffprobe 10/10** (RTD `duration=8177s` via costura). Externos/pendentes: BLZ+KKT (`kakito.xyz` 521), PPD série (`mgeb.top` bimodal + API Vercel pausada).

23. **Rodada 24/09 (2) — causa-raiz do "Golden Time não carrega" = WAF geo no CDN do RTD + hop BR** (pedido: "...rede toons não carrega tava testando no addon o anime golden time"): o `play-link` do RTD resolve bem (worker `/rde/seg` + fallback alias direto), mas o **mp4 do `cnn.radiogaucha.fun` bloqueia o egress da prod (DE)** com 403 "Attention Required | Cloudflare" — matriz prova: egress **BR (este dev)** + `Referer: https://redetoons.win/` + UA browser → **200**; mesmo do BR sem/bloqueando Referer, com UA `curl/8.x` ou com Referer-cnn → **403**; URL expirada → 403. Não é JA3 nem `Range` (o gateway da prod **remove `Range`** — H1.1/H2, ú custom header que passa é esse — e o mp4 é faststart `moov@36`, ffprobe passa com 200 cheio). **Fix = `br-relay.js`**: serviço Express na **porta8443** (única porta com entrada livre na Oracle security list;8080 é do code-server), systemd `mirror-br-relay` (`enable --now`, `Restart=always`), expõe `/play?k=<token>&u=<url>` com token `mr-rtd-7f3c9a2b`, allowlist só `cnn.radiogaucha.fun`, rate 60/10s/IP, e chama `proxyStream()` com `Referer: https://redetoons.win/` + UA Chrome + Range do cliente (reusa a costura de decisão22 — faixa aberta segue em janelas de32MiB). `redetoons.wrapUrl()` embrulha toda URL RTD nesse hop (`BR_RELAY_URL`/`BR_RELAY_TOKEN`/`BR_RELAY_PORT` env com default em código; `BR_RELAY_URL=""` = wrap antigo) e marca `behaviorHints.notWebReady=true` (server repassa no rebuild — estava hardcoded `false`); sem relay o play direto do link da prod ainda falha. URLs do cnn expiram **~1h** (`exp` = fetch+3600, não12h) — cache de stream de6min cobre. Endpoint novo `/stream/proxy-check` (sempre JSON200, echo de headers/corpo do403 p/ diagnóstico, guard contra IP privado). Validado: ffprobe via relay `duration=1422s` mov,mp4; stitch `206` `X-Relay-Mode: stitch` com `Content-Range` total correto; continuidade na fronteira de32MiB sha256 idêntica à origem; negativas do relay404/404/429; testes **56/56**; `vod-sources` **19/22** (RTD filme+série Golden Time **206 via relay**; falhas = BLZ×2 kakito521 + PPD série timeout, externas); audit `ffprobe10/10 · probes27/30 · match BAD0 · 18/19`.

24. **Rodada 24/09 (3) — PPD vivo de novo + salvamento de scraper tardio** (pedido: "ppd ta fora do ar, painel baze não funciona?"): **(a) Painel Blaze/BLZ estava OK** — teste manual `player_api.php` → `auth:1`, **14.914 VODs**, séries ok; as falhas anteriores (521 → lista vazia) foram transitórias do `kakito.xyz` (KKT também voltou). **(b) PPD**: API `popplaydb.vercel.app` segue **503 DEPLOYMENT_PAUSED** (externo), mas o **embed `mgeb.top` funciona** e entrega mp4 R2 assinado (`X-Amz-Expires=18000` = 5h, id `videos-veo/..._tmdb_<id>_...`) — só é **lento**: ~10,3s filme / ~13,3s série (via worker/egress EU = 11,6s — é o servidor deles, não geo) contra `EMBED_TIMEOUT=6000` → scraper abortava e devolvia `[]` (motivo do "PPD fora do ar"). **(c) Fix1 — `EMBED_TIMEOUT` 6000 → 16000** (`popplaydb.js`). **(d) Fix2 — patch tardio no `server.js`**: o pós-processamento virou `buildResult()` (fecha `all` → filtra/ranqueia → grava cache) e, quando o **budget estoura** (promessas ainda pendentes), o settle de cada scraper tardio chama `patchLate()` → re-roda `buildResult()` sobre o mesmo `all` e **sobrescreve o cache** (debounce `patching`/`pendingPatch`) — antes o resultado tardio era **descartado** e todo compute com PPD pendente esperava o budget cheio **e** cacheava degradado60s sem o PPD. Fluxo prod (budget9000): 1º request sai sem PPD (~6-9s) → patch aos ~11-16s → **2º request (TTL6min) com PPD**. Local/budget20s: PPD já vem no 1º. **(e) Validação**: `SCRAPER_TIMEOUT_MS=6000` simulado — log `[streams] cache reposto com resultados tardios`, 2º request `sources: blz,spc,spt,rtd,kkt,ppd`; ffprobe do PPD `h264 · duration=8177s` (Matrix) ok; **`vod-sources` = 22/22** (0 vazios; PPD série 15,3s probe206; BLZ/KKT de volta); testes **56/56**.

25. **Rodada 24/09 (4) — KKT na prod: db não vai na imagem → cadeia de fetch da playlist pelo relay BR** (achado durante verificação; pedido original "todas as fontes100%"): **(a) Causa-raiz do KKT ausente na prod** — `iptv.db` (64MB) é **gitignored** (não vai no build); container nasce com `/tmp/iptv.db` vazio e depende100% do fetch da M3U `get.php` do kakito, que **falhou em TODO preload de hoje** (521 às05:41, 404 às10:50 via worker) → `nenhuma fonte carregada` → zero streams KKT em prod (local sempre passou porque usa o db de22/09 já populado — `DATA_DIR=/tmp` local tem cópia). **(b) Fix = cadeia de candidatos** em `streamM3uInsert` (`kakito.js`): **relay BR (`/play?k&u`) → worker `/proxy` → direto**, cada um com seu AbortController60s, `res.ok` quebra a cadeia, throw final = último erro (semântica de degradação mantida). Relay: `ALLOWED_HOST` += `kakito.xyz` e `REFERERS` por host (cnn→redetoons, kakito→própria origem) em `br-relay.js`. **(c) Validado**: `get.php` via relay → **200 M3U10,9MB/2,4s** (negativas404 intactas); e2e local com db **vazio** → preload via cadeia → `+40765 canais` → request com `kkt`; testes **56/56**. **(d) Externo/pendente**: os **arquivos** do KKT seguem quebrados do lado do kakito — `movie/...mp4` →302 `voltm.uk` → **400 `failed to get stream URL: sql:…`** (origin deles hoje:521/404/400 — mesma crise; audit probe KKT = `200 text/html` é esse flap); e **KGE/DRV na prod dão403 no search** (egress DE bloqueado pelos sites de anime — mesma classe do gate C do RTD; `shg`/`ron` funcionam) — carregar as buscas pelo relay BR é candidato a próxima rodada. **(e) Diag do KKT na prod (deploys `fa6dcf6`/`e970aba`)**: log `[iptv] kkt busca "Matrix" movie: rows=6 streams=1` + `[streams] diag kkt: all=1 filtered=1 deduped=0` → o kkt **chega inteiro e morre no `deduped`** porque BLZ e KKT são o **mesmo arquivo** (`kakito.xyz:443/movie/…/11197.mp4` vs `:80/…` idêntico — `streamDedupKey` = host+path+search, ignora porta/esquema): **comportamento correto** — KKT é failover que só aparece quando o painel BLZ não serviu. Logs diagnósticos (`kkt busca`, `diag kkt`) mantidos por valor de ops.

26. **Rodada 24/09 (5) — "corrija tudo o que tiver ao alcance do código": egress KGE/DRV, probe honesto, /health no-cache**: **(a) `fetchWithFallback(url, opts)`** (`scraper-utils`): direto `browserFetch` → **worker `/proxy`** → **relay BR `/fetch`**; **403/429/451 ou throw** no direto = `blockedUntil` 30min por host (próximas chamadas pulam o direto — medido: cadeia bloqueada responde em591ms, só hops com cooldown291ms); hop vence com `<400`, senão devolve o **1º** hop com falha (ou o direto/erro original — a mensagem do scraper `search HTTP 403` é preservada). Substitui `browserFetch` em TODOS os fetches de `animesonline.js` (busca/anime/episódio) e `animesdrive.js` (RSS/página/dooplayer) — a prod (egress DE) dava **403** nos dois; worker e relay passam (busca KGE 200/70KB e RSS DRV 200/23KB validados nos DOIS hops). **(b) `br-relay.js`**: `ALLOWED_HOST` += `animesonline\.cloud|animesdrive\.cloud` + endpoint novo **`/fetch`** = GET bufferizado (redirect≤5 só https, cap4MB, UA Chrome, `Accept-Encoding: identity`, forward content-type/range/encoding, `Cache-Control: no-store`, mesmo token/rate/allowlist do `/play` — negativas404/404) — separado do `/play` porque página/API não pode consumir slot/shared-stream de vídeo. Bug-caçado no caminho: `fetchDocument` **sem `req.end()`** → TCP/TLS conectava mas a request nunca era escrita → timeout exato de15s (`fetch timeout` três vezes seguidas); com `req.end()` → **200/0,87s**. **(c) `relayPlayUrl()`/`relayFetchUrl()` centralizados em `lib/proxy.js`** (defaults `BR_RELAY_URL=http://144.33.21.1:8443`/`BR_RELAY_TOKEN`; `BR_RELAY_URL=""` = hop desligado): `redetoons.wrapUrl` e a cadeia `streamM3uInsert` do kakito passam a usá-lo (URL idêntica à anterior — teste wrap intacto); `/play` revalidado após restart (M3U kakito 12MB/2,5s). **(d) `/health` e `/metrics` → `Cache-Control: no-store`** no middleware do server (JSON sem header era edge-cacheado pelo CF — uptime congelado na observação). **(e) `probeOnce` do xtream honesto**: `content-type: text/html` no200 **e status400** → `alive:false` (antes HTML200 passava como vivo e link morto do kakito aparecia válido; agora some quando há concorrente vivo — TODOS mortos segue mantendo; série já checava HTML via `probeSeriesEpisode`). **(f) Validação**: testes **58/58** (+2 de `relayPlayUrl`/`relayFetchUrl`), sintaxe10 arquivos, `vod-sources` **22/22**, KGE/DRV locais2 streams cada, cadeia bloqueada/`cooldown`/`/fetch`/`/play` medidos. **(g) Externos restantes (fora de alcance)**: `iptv-epg.org` **403 de TODO lugar** (BR direto c/ UA Chrome+Referer, worker, relay — fonte bloqueada, não geo; EPG só com XMLTV do kakito via worker =200), API PPD503 (Vercel), CDN kakito `voltm.uk`400; `animes.click` (slot SD do DRV) ainda não confirmado do egress DE — checar com `/stream/proxy-check` pós-deploy.

27. **Rodada 24/09 (6) — fontes mortas retiradas** (pedido: "todas as fontes estão funcionais? as que tão mortas pode retirar tipo a de epg"): **(a) EPG — `iptv-epg.org` REMOVIDO de `lib/epg.js`** (`IPTV_EPG_URL` + entrada do `Promise.allSettled` fora): 403 de TODO egress testado (egress BR direto c/ UA Chrome+Referer, worker `Upstream403`, relay) = fonte **bloqueada, não geo**; `fetchEpg()` fica **só com o XMLTV do kakito via worker** (200/16KB → **128 canais**), `source-info-name="Kakito"` (era `Kakito+IPTV-EPG`), `generateXmltv` intacto (~21KB); `getEpgBounded`/meta/catálogo sem mudança. **(b) PPD — API `popplaydb.vercel.app/api/resolve` REMOVIDA** (503 `DEPLOYMENT_PAUSED` desde 23/09): `resolveApi`/`linksFromApi`/`RESOLVE_URL`/`API_TIMEOUT`/`apiSkipUntil`/cooldowns e o `tried` (write-only pós-remoção) fora; **PPD = embed `mgeb.top` puro** — `embedPaths`/`extractUrls` seguem exportados (os únicos usados pelos testes), local `streamsFor('603')` = **3 streams**, `EMBED_TIMEOUT=16000` + `patchLate` (decisão 24) intactos; se a Vercel voltar, reintroduzir o fallback. **(c) NÃO removidas** (vivas ou flapping externo = fora do alcance do código): **KKT** = M3U carrega (prod 42k canais) mas arquivos `voltm.uk` 400 da **origem deles** (probe já filtra — decisões 25/26), **RON** = `iframe HTTP 500` transitório do resolver deles; SHG/KGE/DRV/BLZ/SPC/SPT/RTD/EMB/Cinemeta/TMDB/AniList = vivas (audit ffprobe 11/11, Cinemeta 200). **(d) Validação**: sintaxe ok + testes **58/58** + EPG 128 canais e PPD 3 streams rodando local.

30. **Rodada 24/09 (7) — KGE/DRV fora, AON+TOP entram** (pedido: "remover KGE/DRV e construir DUAS fontes novas de anime"): **(a) Remoção sem retorno sem pedido explícito** — scrapers, `fetchWithFallback`, `scoreTitle`/`scoreItem` e hops do relay fora; **(b) AON = caminho 100% direto** (egress DE ok) — busca só por paths limpos do índice (`/anime/list-mode/`), NUNCA query params (challenge CF), decode do config SEM `vm` (escape via constructor) — formato novo do site = throw/degradação, nunca executar JS alheio; **(c) TOP = cadeia de hops aprovada direto→allorigins→wayback, NENHUM hop toca a Oracle** — os hosts dos players (blogger.com, sk-*.alibabacdn.net, googlevideo, peliculaplay) não são topanimes e vão direto da prod; **(d) barreira de testes = 64** (13 testes AON/TOP). Fluxo detalhado na linha da rodada acima e no `AGENTS.md`.

31. **Rodada 25/09 (8) — qualidade honesta, 2 fontes novas e corte de requests** (pedido: "3 fontes novas" + "otimização e cache p/ não esquentar as fontes"): **(a) Nunca inventar qualidade** — sem informação real, `quality: "unknown"` e o título **não** mostra qualidade (`vodTitle`/`makeHttpStream` filtram `unknown`); o probe HLS do server (1500ms, antes do sort) preenche depois via `injectTitleQuality`. **(b) Cache antes de rede** — página de série/ep (AON), resolve do player (TOP), embed do SPT, TTLs de RTD/PPD e EPG sem programas foram estendidos com TTL abaixo da validade das URLs assinadas. **(c) `atb` (anitube.biz) e `dgo` (doramogo.net) entram; `dmd` (doramando.com) fica de fora** — o player do doramando só materializa o 1º segmento do episódio ~13s depois, e o warm-up passou 1 de 3; **regra do projeto: fonte que não toca no 1º play não entra** (vale mais uma fonte a menos que um stream quebrado). **(d) Fonte de nicho só roda onde faz sentido** — o `dgo` só é chamado para série com `originCountry` vazio ou `KR`, para não pagar 1 request em toda série não-anime. **(e) StreamBetter continua descartado** — não reabrir. **(f) BUG corrigido no caminho**: `isLikelyAnime` classificava dorama KR como anime (título alternativo CJK do TMDB) e servia anime no lugar do conteúdo certo — o país do TMDB agora tem veto sobre o palpite por título.

## Armadilhas novas desta rodada
- **anitube**: a busca `?search=` do WP só devolve os ~20 posts mais recentes ⇒ para animes longos (Naruto 501 eps) os episódios antigos somem. A saída é a **taxonomia de categorias** (`/wp-json/wp/v2/categories?search=`, o site mantém `Naruto Shippuuden - Dublado PT-BR` com `count=501`) e a página = `ceil((count - ep + 1) / 100)` — **a API ordena por data descrescente**, então a conta invertida é obrigatória (senão o E1 nunca aparece). Também: o `?search=` do WP **não casa "shippuden" com "Shippuuden"** ⇒ para query com 2 palavras o fallback busca por token único. E `?search=Episódio N` não é confiável (casa 5 com 50).
- **anitube (vídeo)**: o `api.anivideo.net/videohls.php?d=` é só player — o que toca é o valor do `d=` (CDN `maximaimg.online`/`mywallpaper-4k-image.net`, **sem UA e sem Referer**). Os segmentos são MPEG-TS reais com extensão `.webp` (`file` = "MPEG transport stream data") — não é imagem, o ffmpeg toca. O path base64 `/aHR0cHM6…/387/bg.mp4` devolve **404**: descartar.
- **doramogo**: `Referer: https://www.doramogo.net/` é obrigatório (403 sem) ⇒ sempre em `behaviorHints.proxyHeaders`. O path do vídeo sai do `var urlConfig` inline + a primeira letra do slug em maiúscula; `tipo: "filmes"` usa `…/stream/stream.m3u8` (sem pasta de temporada). Os dois hosts (`ondemand` e `forks-doramas.madfirebox.shop`) respondem igual — entregar os dois dá redundância de graça.
- **`mydoramas.net` = o mesmo doramogo**: mesma estrutura de rotas, mesma classe CSS (`doramogo-search-result-card`), mesmo `var urlConfig` e mesmos hosts `ondemand/forks-doramas.madfirebox.shop`; o catálogo é **idêntico** (as séries que só aparecem na home de um aparecem nos dois quando se procura). Por isso entrou como **segundo host de busca** do `dgo` (só é consultado quando o doramogo volta vazio — custo zero no caminho quente, ganho = não cair se um dos dois sair do ar), e **não** como fonte nova.
- **doramando (descartado)**: `cinehud.top/episodio/<id>` devolve 4 players, 3 deles são iframe de terceiro (abyssplayer/bysebuho/voe) que só montam o player via JS; o único direto é o `tgp.playerp1.sbs` (master com 1080p/720p) e ele responde **`503 "Segmento sendo preparado. Tente novamente."` + `retry-after: 2` até ~13s**, por vídeo **e por variante** (o 720p de um episódio aquecido continuava 503).
- - **`vizer.beauty` — engenharia reversa completa (fonte DESCARTADA, não está no código)**: é um Videobox com tudo em JSON. Busca `GET /?do=buscarContent&q=<termo>` que **exige o header `X-Requested-With: XMLHttpRequest`** (sem ele o WAF devolve 403 "you do not have permission"); player em `do=playerData&id=`; episódios em `do=episodesList&id=&season=`. O `playerData` devolve 4 hosts (bysebuho / playmogo-do DoodStream / mixdrop / streamtape) com tokens em `servers_dub` e `servers_leg` (o campo vem com **`&amp;`**, precisa decodificar antes do split). **Só o MixDrop serve**: o HTML dele tem um **Dean Edwards packer** (`eval(function(p,a,c,k,e,d)`) que desempacota para `MDCore.wurl` = `https://<host>.mxcontent.net/v2/<id>.mp4?s=..&e=..&_t=..`, MP4 direto (2 requests por episódio, 7/10 filmes e 3/3 episódios de série na medição). **Descartado por 3 motivos medidos**: (1) o `mxcontent.net` **exige User-Agent de browser** (curl/node → 403, Chrome → 206); (2) **o token é atrelado ao IP que abriu o embed** — URL gerada no BR e consumida no BR dá 206, mas via worker CF (IP diferente) dá 403, então o cliente do Stremio nunca toca; (3) do **egress DE da prod o CDN de vídeo dá timeout** (`[relay] direct connect error: timeout`), então nem `/stream/proxy` resolveria. Só funcionaria se o vídeo passasse pelo `br-relay` BR, o que é decisão de infraestrutura, não de scraper.
- **`isLikelyAnime` erra em doramas com título CJK**: o TMDB devolve `alternative_titles` em chinês/japonês/coreano (ex.: o Goblin KR tem `鬼怪`, `不死神靈`, `トッケビ`, `쓸쓸하고 찬란하神-도깨비`) e o regex de CJK do `isLikelyAnime` casa **qualquer** ideograma/kana ⇒ o dorama caía no bloco anime e servia **Goblin Slayer no lugar de Goblin**. Corrigido no `server.js`: `originAllowsAnime` = país vazio OU com `JP` — país conhecido fora do JP **anula** o palpite por título (o `animeByGenre` já exigia JP); com país desconhecido o heurístico antigo continua valendo.
- **`/tmp/opencode` não é gravável** nesta máquina — usar `/tmp` ou `~/tmp-opencode` nos scripts de recon.

32. **Rodada 25/09 (9) — deduplicação + fonte VIZ (vizer.beauty)**: **(a) `src/lib/text.js` cresceu** com `ascii/words/slugify/decodeEntities/looseMatch/looseCoverage/extraWords` — as 4 cópias (aon, topanimes, anitube, doramogo) foram removidas (−123 linhas); `looseMatch` compara os 4 primeiros caracteres porque o anitube grafia "Shippuuden" e o WP não casa "shippuden". **(b) `popplaydb.SCRAPE_BUDGET` passou a ler `SCRAPER_TIMEOUT_MS`** (era 32s fixo — o PPD nunca cabia no budget de 9s da prod e só aparecia no 2º request; agora entrega entre 6-8s). **(c) `vizer.beauty` foi ESTUDADO e DESCARTADO** (ver armadilhas abaixo).

**PPD (popplaydb) REMOVIDO (decisão 35, 25/09/2026).** Motivo: os links que ele entrega dão **403 no probe direto** (o `mgeb.top` recusa o link direto; só o `hls.php` alternativo abre) — o cliente pode pegar o primeiro link e ele não tocar, o que é pior que não ter a fonte. Medido antes de remover: **redundante** — em Matrix, A Origem, Interestelar, Breaking Bad e Duna as outras fontes (BLZ/SPC/ATO, KKT, SPT) sempre entregaram, o PPD nunca foi a única opção. Risco aceito: ele era o último recurso se o `kakito` (backend do BLZ+KKT) e o SPT caírem juntos. Removidos `src/scrapers/popplaydb.js`, o wiring, o registro em `source-names` e os testes.

**EPG REMOVIDO DO CÓDIGO (decisão 34, 25/09/2026).** Não existe fonte de EPG funcional: o XMLTV do kakito entrega **128 canais com `id=""` e 0 `<programme>`**, o `embedtv.lat` não tem grade nenhuma (0 ocorrências de epg/grade/xmltv), o "player" de TV ao vivo é um HLS cujos segmentos são arquivos `.js` (sem `x-tvg-url` no M3U), o `iptv-epg.org` dá 403 de todo egress e a API atual do `iptv-org` removeu o campo `epg_id`. Um EPG sem programa não serve para nada além de custar 1 request/hora e poluir a UI. Removidos: `src/lib/epg.js` (364 linhas), a rota `/epg.xml`, os enrichment de catálogo/meta e o warm de boot. **O `iptv.db` do KKT NÃO foi tocado** (é catálogo VOD, não EPG).

**Qualidade de VOD = resolução real do vídeo, nunca inventada (decisão 36, 25/09/2026).** Regra do dono: *"todas as fontes de vod tem que ter a qualidade"*. Implementado com `src/lib/video-probe.js` (lê o bitstream, não adivinha), acionado pelo server só para quem não tem qualidade. **Não voltar a preencher qualidade por default em nenhuma fonte** — `quality: "unknown"` é resposta honesta e o server completa. `notWebReady` explícito no `makeHttpStream` é obrigatório p/ URL `http://` sem headers (bug do KKT).

**FrostStream REJEITADO (decisão 37, 25/09/2026).** Investigado a fundo (1 request, sem embed/JS, ffprobe OK, sem geo-block — **funciona de verdade**), mas **removido por redundância**: os 3 provedores dele são as mesmas origens que o Mirror já tem (Space = worker sobre painel Xtream; Nova = `/vauth/` com token; o legendado é o **próprio SPC**, hoje 503). O HMAC é server-side → origem não reimplementável. some com a decisão 35 (PPD): fonte que duplica o que já entrega, com TTL curto (3h, e o cache deles serve entrada quase vencida) contra budget de 9s, não entra. **Se o kakito (BLZ+KKT) e o SPT caírem juntos**, ele volta a fazer sentido como redundância — o endpoint é `GET https://froststream.cloutteam.com/stream/{movie|series}/tt<imdbId>[:S:E].json`, aceita **só `tt`** (`tmdb:`/`cs:` são declarados e mortos), `meta`/`catalogs` são inúteis, e o token do worker carrega a expiração **no path** (`/t/<epoch>.<hmac>/`, ~3h de vida) — o `hasExpiredSignedUrl()` precisaria reconhecer esse padrão.

**RTD fica `unknown` na prod — DECISÃO DO DONO, não pendência (decisão 38, 25/09/2026).** O dono foi consultado e preferiu **deixar assim**. Medido nesta rodada: o WAF do `cnn.radiogaucha.fun` exige **duas** coisas juntas — Referer exatamente `https://redetoons.win/` (o próprio origin do CDN e qualquer outro dão 403) **e** IP que não seja o egress DE da prod (box BR com o Referer certo → 206; prod DE com o Referer certo → 403 Cloudflare). Nenhum header contorna. A API do RTD **não expõe resolução** (`quality: "dublado"` é flag de áudio; `mirrors` é a mesma URL) — só dá para ler do vídeo, e a prod não alcança o vídeo. **Nada disso afeta o playback**: a prod entrega a URL crua com `proxyHeaders` e quem busca é o dispositivo do usuário. **Solução já pronta e medida, se um dia houver o egress**: o `br-relay.js` **já** permite `cnn.radiogaucha.fun`, já manda o Referer certo e já repassa `Range` — via relay a resposta real foi `206 · 163840 bytes · 1280x544 · 720p`. Falta só (a) ~10 linhas no `video-probe` para usar o relay quando `BR_RELAY_URL` existir (a prod hoje dá **502** no relay, ele é só dev) e/ou (b) um param `?ref=` no `worker-simple.js` (o `/proxy` **já** repassa `Range`, mas nunca manda Referer; e o `/rde/seg` manda `Referer: <origin>/`, que para qualquer CDN é 403 garantido — bug latente). Não implementar sem o dono pedir.

**RTD: qualidade automática, falta só o deploy do worker (decisão 40, 25/09/2026).** O dono pediu de novo a qualidade do RTD. Ela **já é automática** — nenhuma fonte tem qualidade hardcoded (o `redetoons.js` faz `extractQuality(url) || "unknown"` e quem preenche é o `video-probe` lendo o bitstream). O que falta é **alcance**: o WAF do `cnn.radiogaucha.fun` bloqueia o egress DE. Medido nesta rodada: **RTD é a única das 13 fontes sem qualidade na prod** (as outras 12 preenchem sozinhas: BLZ/SPC/ATO/KKT do painel, SPT do master, e **ATB/DGO/VZR derivadas dos bytes do stream** — que são justamente as "fontes que não dá pra saber pelo stream"). Implementado agora: o `worker-simple.js` ganhou **`?ref=`** no `/proxy` e no `/rde/seg` (o `/proxy` **já repassava Range** mas nunca mandava Referer — por isso ele devolvia `Upstream 403` no CDN do RTD; e o `/rde/seg` mandava `Referer: <origin>/`, que para qualquer CDN é 403 garantido), e o `probeStreamQuality` do server agora, quando o probe direto falha e o stream tem `Referer`, **tenta via worker** com esse Referer (`probeViaWorker`, 1MB de Range). **Testado: o worker no ar ainda devolve `Upstream 403` com e sem `?ref=` — o parâmetro só funciona depois de `wrangler deploy`**, que é decisão do dono. Sem o deploy, o RTD segue `unknown` (e nada pior acontece: o fallback devolve `null`).

**VZR (vizer.autos) é fonte real (decisão 39, 25/09/2026).** Não voltar a chamar o `vizer.autos`: ele é **CF-bloqueado do egress DE** e o caminho é montar a URL do `nixplay.lat` a partir do TMDB. Se o `nixplay` passar a exigir Referer de verdade (hoje aceita vazio/ausente), a fonte morre — o conserto é `headers: { Referer: "" }`, que **tem que continuar no stream**. Bucket/token vivem em `VIZER_PATH` e podem rotacionar.

## Rodada 29/09/2026 — "TV não toca, catálogo não carrega, 300MB sem ninguém usando" (decisões 114/115/116/117)

O dono reportou três coisas ao mesmo tempo: *"a maioria das fontes de vod nao respondem filmes series animes e doramas"*, *"a fonte de live tv o catalogo ta lento e nao carrega"* e *"o addon no painel esta batendo mais de 300mb sem ninguem usando"*. As três eram reais e diferentes entre si. **Barreira: 123 testes.**

**1. A TV ao vivo NÃO TOCAVA — a URL saía sem domínio (decisão 114).** Sete rotas montavam a base com `` `${req.protocol}://${req.get("host")}` `` e o gateway do BeamUp reescreve o `Host` para **só o nome do app** (`c12e41ddc21b-mirror2`, sem domínio; o `x-forwarded-host` chega **vazio**). O cluster devolvia `https://c12e41ddc21b-mirror2/stream/hls/hbo.m3u8` — sem domínio, e o player não tinha onde buscar. A regra do dono é `PUBLIC_BASE_URL` no `Dockerfile` justamente para isso, e o guard do auto-detect (`[a-z]` + ponto) já existia: só que as 7 rotas **não passavam pelo guard**, elas montavam a base na mão. Agora há **uma função só**, `basePublica(req)`, com a ordem `runtimeBase` (que no cluster já é o `TV_BASE_URL` completo) → `PUBLIC_BASE_URL` → host do request **só se for domínio de verdade**, senão string vazia. Medido: `hbo`, `globonews`, `sbt`, `bandrj`, `recordsp`, `cnnbrasil`, `espn`, `foxsports1` com URL de domínio correto e playlist respondendo; amostragem de 20 canais do catálogo: **20/20 tocaram**.

**2. O CATÁLOGO DE TV NÃO CARREGAVA (decisão 115).** `?search=globo` levava **11,5s na app1 e voltava vazia**; no cluster, **64s a 85s** — acima dos 12,3s do gateway. Duas causas somadas: (a) `BUSCA_TTL` era de **60s**, e como **cada termo digitado é uma chave nova de cache** (nunca um cache hit), toda busca voltava a pagar a triagem inteira dos 283 canais nas 3 fontes — e o termo seguinte chegava depois dos 85s, com o memo já vencido outra vez; (b) a **lista inteira já estava guardada** no cache (chave `mirror-tv-live::tv::`, TTL 24h, aquecida no boot) e ninguém filtrava a partir dela. Agora `catalogoDeTv()` (server.js) filtra a lista guardada quando o pedido tem busca ou categoria, e só chama a triagem se ela não existir; `BUSCA_TTL` subiu para 5min. Medido: `?search=globo` **85s → 8,6ms**, `?search=sbt` 64s → 3,4ms, `?genre=Todos` 11ms → 6ms, `?date=` 60ms.

**3. CANAL FANTASMA NO CATÁLOGO (decisão 116).** `playlistVerdict` devolvia `"unknown"` para **qualquer** erro que não fosse 404/410/451, e o `resolvePlaylist` aceitava `"unknown"` como playlist confirmada. O chute do CDN do EMB (`{PLAYLIST_FALLBACK}{slug}.txt`) responde **`502 error code: 502`** para slug que não existe, entrava como "válido", o canal era aprovado na triagem e aparecia na lista — e ao abrir não tinha fonte nenhuma. **Medido: `globo`, `record` e `band` estavam no catálogo de 283 canais sem existir em NENHUMA das 3 fontes** (procurei nos catálogos de EMB/ETC/REI: os canais se chamam `recordsp`, `bandrj`, `cnnbrasil`). Agora o chute só vale com `"ok"`; a URL vinda da **página** do canal continua aceitando `"unknown"` — a regra de não retirar canal fica intacta para quem a página realmente lista.

**4. A LISTA MUDAVA A CADA RESTART (decisão 117).** `triagemGuardada` vivia **só em memória**, então a "decisão 111" (não retirar canal) valia só dentro do mesmo processo: no boot a lista saía só com o que passou **naquela** triagem, e a triagem do boot é a mais frágil (48 cadeias em paralelo, provedor recusa lote frio). Medido na prod: **283 → 252 canais logo após o deploy** — e o dono perdendo canais de um dia para o outro. Agora as chaves aprovadas vão para o **SQLite** (`mirror-tv:triagem`, TTL 30 dias) e a lista é sempre `o que já passou` **somado** a `o que passou agora`, inclusive quando a composição muda. Medido: 284 canais no 1º boot e **284 no 2º boot** (mesmo disco).

**5. RAM: 317MB → 192MB na app1 e 251MB → 179MB no cluster (decisão 118).** Não era vazamento: `global.gc()` **não baixa nada** (medido 157 → 156MB), porque o Node multi-aloca e o glibc segura a memória por arena, e o padrão é 8 arenas por núcleo. `ENV MALLOC_ARENA_MAX=2` no `Dockerfile` derrubou o mesmo cenário de 157MB para 139MB — **-18MB, ou 11% do teto do dono, sem uma linha de código**. Decomposição do RSS (medida, com `MALLOC_ARENA_MAX=2`): base node+sqlite 45MB, **EPG +71MB** (14.064 programas), **catálogo de TV +53MB** (283 canais, dos quais 24MB são heap e o resto arena). **Tentativa revertida**: apertar a janela do EPG para "só hoje e amanhã" — contando o XML inteiro, a janela de 3 dias dá 12.533 programas e a de 2 dias dá **13.341** (o `epg_BR.xml.gz` não tem o dia de ontem, e o `+3h` do fuso empurra o teto para o fim e **soma** programas). O XML fica como estava. O `iptv.db` de 57MB que aparece no cluster **é só do ambiente local**: em produção o cluster tem `TV_BASE_URL` e se reconhece, não aquece VOD e não abre o banco (o log de prod do app2 não tem `[iptv]`).

**6. O VOD responde e toca** — medido na prod depois do deploy: filme 8 streams, série 5, anime 4, dorama 7, todos com `ffmpeg` tocando. O que o dono percebeu como "fonte que não responde" era a **TV**, mais o fato de o `/catalog/movie/top.json` responder vazio (e isso é **por desenho**: o manifesto só declara o catálogo `mirror-tv-live`; VOD entra por busca/meta/stream).

## Rodada 30/09/2026 — "tira o KAK da TV, metadados e guia do REI" (decisão 121)

Pedido do dono: *"tirar o KAK da TV ao vivo, ficar só com EMB + REI + ETC, fazer metadados/logos virem do REI e EPG vir pela API do REI"*. **Barreira: 191 testes** (eram 200 — saíram os 2 arquivos do KAK e entraram 3 testes novos).

**1. KAK saiu da TV.** O KAK era a **3ª fonte de TV** (733 canais Xtream), mas só servia TV: ficou sem função. `FONTES.kak` saiu de `core/nomes.js`, `tv-sources.js` ficou com `MODULOS = { emb, etc, rei }`, e `server.js` perdeu `liveKak`/`relayLive` (requires, `capacity.relayLive`, rota `/live/kak/:hash.ts`). Removidos: `kakito-tv.js`, `live-kak.js`, `relay-live.js` (que só existia para o KAK), `epg-rei.js` (raspagem do HTML do guia, veio o XMLTV) e os 2 testes. O `id` do catálogo de TV continua `tv:live:<chave>` — não muda na API pública.

**2. Logo/metadado vem do REI.** No `getCatalog`, quando o canal existe no REI, `grupoRei.logo` passa a sobrescrever a imagem do grupo; no `getMeta`, o **REI é o primeiro membro consultado** e o `poster`/`background` da meta vêm do grupo (quem tem a melhor imagem). Fallback: quem já tinha a imagem continua mandando. Medido no smoke: 284 canais com **0 sem logo** — `reidosembeds.online: 224`, `img.faz-o-eli.online: 57`, `vercel: 3`. `VERSAO_CATALOGO = "2026-09-30-rei-meta"` (1ª chamada pós-deploy refaz a triagem; pode 504 e cachear em fundo).

**3. O `preview_url` do REI é MORTO — não pode virar `background`.** No `/api/channels` do REI cada canal traz `preview_url`, mas os 327 apontam para o host `xn---bg-09-...rent`, que responde **403 para tudo**; e o `reidosembeds.online/img/<slug>.prev.png` devolve **404**. O logo responde 200. Ou seja: usar o preview do REI seria colocar URL quebrada na tela de play de todo mundo. `makeMeta` do REI agora põe `background: logo`, e o `/meta` usa `group.preview || group.logo || out.poster` — ou seja, a **mesma imagem que o catálogo mostra**. (O preview de verdade na fonte EMB continua funcionando: 155/161 canais.)

**4. EPG vem de `https://reidosembeds.online/api/guia` (decisão 121).** Antes: `epg.pw/xmltv/epg_BR.xml.gz` + a raspagem de HTML do site (`epg-rei.js`). Agora: uma fonte só, XMLTV de **1,25MB** com **3.972 programas em 143 canais** (o epg.pw dava 18.459). `cache-control: max-age=86400` no deles, mas o nosso cache fica 6h (mesma validade de hoje). Logos via `reiApi.loadCatalog()` (o `/api/channels`, cache 30min, mesmo cache do catálogo). **Pegadinha paga**: `<display-name>` vinha com entidade HTML crua (`A&amp;E`) e virava chave `aetampe` → 3 canais ficavam fora do guia; agora passa por `decodeEntities`. `parse` foi exportado para teste. Custo de heap caiu de **+71MB para ~0** (medido: `RSS apos EPG: -10MB`, 22MB de heap total).

**5. Medido no smoke (porta 7001, `DATA_DIR` novo):** boot ok, `/health` sem `relayLive`, catálogo 284 canais, meta do `globonews` com poster `reidosembeds.online/img/globonews.png` + background `img.faz-o-eli.online/globonews.prev.png` (ambos 200) + 15 vídeos do guia, e streams **EMB+ETC+REI** (`globonews` 4, `afazenda2` 3 — só-do-REI continua vivo, regra de não retirar canal). Guia medido: **138 canais hoje / 126 amanhã com programa**.

## Rodada 30/09/2026 — fontes separadas por categoria (decisão 122)

Pedido do dono: "separe em categorias fontes de anime, fontes de série, fontes de filme, fontes de dorama, fontes de TV". Ele escolheu o alcance: **registro + documentação + /health** (não mudar catálogo do Stremio nem quem é chamado).

- **Declarado uma vez em `src/core/nomes.js`**: `FONTES[chave].conteudos` (array) + `CONTEUDOS = ["anime","serie","filme","dorama","tv"]` (a ordem que o índice usa). Derivados `fontesDe(conteudo)` e `categoriasDasFontes()`. **Nunca escreva o índice à mão** — dois testes travam: `cada fonte declara as categorias de conteudo que ela serve` (array existe, só conteúdos conhecidos, sem repetição, TV = só `tv`, e `tv` fora de fonte de TV é erro) e `categorias de fontes batem com o que cada fonte entrega` (deepEqual da lista inteira).
- **Medido do registro (é o comportamento real, não opinião)**: anime = `shg ron aon atb rtd`; série = `spt blz spc ato kkt rtd vzr`; filme = **os mesmos** de série (nenhum painel tem catálogo só de série ou só de filme); dorama = `dgo`; TV = `emb etc rei`. `rtd` é a única que cruza categorias (desenhos/animes dublados → chaves `vod` **e** `anime`). `cas` fica de fora: é o nome de reserva de stream sem fonte.
- **`/health` devolve `fontes`** (top-level, ao lado de `capacity`): `{"anime":["shg","ron","aon","atb","rtd"], "serie":[...], "filme":[...], "dorama":["dgo"], "tv":["emb","etc","rei"]}` — conferido em smoke local porta 7001.
- **AGENTS reorganizada**: índice das 5 categorias logo em `## Scrapers ativos` e as seções viraram `### Anime` / `### Séries e Filmes (as mesmas fontes servem os dois)` / `### Doramas` / `### TV ao vivo` (EMB, ETC e DGO saíram da mistura de "Filmes, Séries e TV ao Vivo"); a tabela do registro ganhou a coluna `Conteúdos`.
- **Barreira: 193 testes** (eram 191).

## Rodada 30/09/2026 — o RTD só atende quem chama do Brasil (decisão 123)

Pedido do dono: "RTD via worker ou borda, ou de forma direta mas escondendo o link fazendo como as outras fontes; depois vamos trabalhar no cache e p2p dos VODs".

### O que foi medido (30/09/2026, com o `/stream/proxy-check` da prod e chamadas diretas do dev)

| caminho | resultado |
|---|---|
| Brasil → `redetoonstv.win` (`catalog-index` e `play-link`) | **200** |
| prod → `redetoonstv.win` (os dois) | **403** Cloudflare |
| Brasil → worker → RTD (`/rde/seg` e `/proxy`) | **200** |
| prod → worker → RTD | **403** (`upstream 403`) |
| proxies públicos de fora (allorigins, codetabs, isomorphic-git, r.jina.ai) → RTD | **403/522** |
| `redetoons.win` (alias) em qualquer caminho | TLS quebrado: `EPROTO` direto, **525** via worker, **409** em http |
| `redetoons.press` (pra onde `redetoonstv.win` redireciona), da prod | **403** |
| vídeo `cnn.radiogaucha.fun` + `Referer`, do Brasil | **206**, 682 MB, MP4 de verdade |
| vídeo + `Referer`, da prod | **403** |
| `play-link` **sem** `Referer`, do Brasil | **403** `{"error":"forbidden"}` (o índice não exige) |

E o caminho do **player de um usuário brasileiro** (é o que decide o play):

| como o link sai | resultado |
|---|---|
| direto + `Referer` em `proxyHeaders` (decisão 49, o que está no ar) | **206** |
| worker `/relay/s/<b64>?ref=` (link escondido no nosso domínio) | **206** |
| worker `/proxy?url=&ref=` | **206** |
| escondido no `/stream/proxy` da nossa VPS (o servidor baixa o vídeo) | **403** — é o mesmo caminho do "prod → vídeo" |

### Conclusões

1. **Não é formato, é geografia.** As três saídas sugeridas (worker, borda, direta escondendo o link) dependem todas de uma chamada que **sai do nosso servidor**, e o servidor está fora do Brasil. O worker não ajuda porque ele roda no data center de quem chamou — chamando da prod ele continuava fora e o RTD respondia 403.
2. **Esconder o link atrás da nossa VPS quebra o RTD** (medido 403): a VPS também está fora do Brasil. O que funciona é esconder atrás do **worker**, que entrega direto para o usuário brasileiro.
3. **O caminho que não custa nada: fixar o worker em São Paulo** — `placement.region = "aws:sa-east-1"` faz o worker rodar no data center mais perto de `sa-east-1` = **GRU**, e a saída vira brasileira. Aí prod → worker → RTD vira 200 e a fonte inteira volta: índice, play-link **e o probe de qualidade** (o RTD hoje é a única fonte sem qualidade na prod, porque o servidor não alcança o CDN).

### O que foi feito

- **`wrangler.toml`**: `[placement] region = "aws:sa-east-1"` (+ o porquê no comentário). Se o deploy reclamar desta linha, o plano é trocar por `[placement] mode = "smart"`.
- **`worker-simple.js`**: rota **`/colo`** — devolve 302 com `Location: .../onde/<colo>/<cf-placement>`. Não é enfeite: o `proxy-check` só devolve o corpo quando a resposta **não** é 2xx, então o redirect é o único jeito de eu ler da prod **onde** o worker processou a chamada (esperado: `GRU`).
- **`src/scrapers/redetoons.js`**: `SITE` (Referer do vídeo, continua sendo o alias `redetoons.win`) separado de `SITES`/`INDEX_URL` (a API, com o `redetoonstv.win` primeiro). Antes o índice saía pelo alias de TLS quebrado e caía em todos os caminhos; os três agora são exportados.
- **2 testes novos**: `RTD: worker fixado em Sao Paulo para a API do RTD` (lê o `wrangler.toml`) e `RTD: a API sai pelo host que responde e o video mantem o Referer`. Barreira: **195** (eram 193).
- **AGENTS**: linha do RTD reescrita (a antinha dizia que o primário era o geo-bloqueado e o alias respondia — era o contrário, e ainda anunciava o hop BR como caminho de prod), linha do `wrangler.toml` na tabela de deploy e barreira corrigida (123 → 195).

### O deploy saiu — e a dica de região NÃO funciona nesta conta (30/09, 18h)

O dono me deu um token novo (o antigo, de 25/09, já estava morto) e eu publiquei. Detalhe que custou tempo: **`/user/tokens/verify` responde "Invalid API Token" para token de conta** — o jeito certo de conferir é `GET /client/v4/accounts`. Token novo salvo em `~/.cloudflare-token` (e `/tmp/cf-token`), ferramenta em `~/.npm/_npx/c943b712072b77c4` (wrangler 4.141.0) rodada com o Node 22 de `/tmp/node-v22.14.0-linux-arm64`, comando pronto em `/tmp/deploy-worker.sh`.

**O que o deploy provou:**

|experimento|resultado|
|---|---|
|`[placement] region = "aws:sa-east-1"`|deploy **aceita** e grava `placement {mode: "targeted", target:[13]}` na conta — mas o worker continuou rodando em **WAW (Varsóvia)**, o colo de quem chama (a prod)|
|mesma linha com `azure:brazilsouth`|idêntico: **WAW**|
|mesma linha com `aws:ap-northeast-1` (Tóquio, só para provar)|**WAW** também → a colocação por região está sendo **ignorada** nesta conta, não é problema do identificador|
|worker dedicado `worker-rtd.js` chamado **do Brasil**|roda em **GRU** (`cf-placement: local-GRU`) e devolve o `catalog-index`/`play-link` com **200**|
|o mesmo worker chamado **da prod**|roda em **WAW** e o RTD responde **403** (como esperado: a saída ainda é polonesa)|

Ou seja: **a prod fica na Polônia** (colo WAW — isso também explica o WAW e não FRA). O `request.cf.colo` é o colo onde o código rodou, e o `cf-placement` da resposta é `local-GRU`/`remote-` — de `/colo` (302) é o jeito mais barato de ler isso da prod, porque o `proxy-check` só devolve corpo quando a resposta não é 2xx.

### O que falta no projeto — e o que foi fechado (30/09/2026, em ordem)

Auditoria: medir em vez de opinião — segue o que existia, com número.

**Fechado nesta rodada (ordem do dono: "faça tudo em ordem")**
1. **`.env` saiu do índice do git.** Ele estava **versionado** (6 linhas com segredo) apesar de
   estar no `.gitignore` — e `.gitignore` não tira o que já está versionado. O arquivo continua
   no disco (é o que roda em dev). Isso **não** desfaz a exposição: para isso é preciso **rotacionar**.
2. **O que precisa ser rotacionado, e por quê (ação do dono, é conta dele):**
   - **senha do painel** (`IPTV_USERNAME`/`IPTV_PASSWORD`): está escrita como **padrão no código**
     (`src/scrapers/xtream.js`, `src/scrapers/kakito.js`) e no `.env` versionado. Só sai do código
     quando existir a variável no ambiente de produção — hoje o `Dockerfile` **não** tem nenhuma
     `IPTV_*`/`XTREAM_*`, e é por isso que o padrão ainda é o que roda. Ordem: criar as variáveis
     na hospedagem → confirmar que o painel continua respondendo → **aí** tirar o padrão do código.
   - **chave do TMDB**: mesma coisa (`.env` versionado).
   - **token da Cloudflare**: o antigo (25/09) já está morto; o novo que você mandou ficou em
     `~/.cloudflare-token` **e nesta conversa** — treat como exposto e gere outro quando puder.
3. **`/stream/proxy-check` deixou de ser um proxy aberto.** Medido: em produção ele buscava
   **qualquer URL, sem credencial** (só bloqueava IP privado). Agora exige `PROXY_CHECK_TOKEN`:
   sem a variável no ambiente, ou sem token, responde **403 e não busca nada**. O token está em
   `~/.mirror-proxy-check-token` e no `.env` de dev. **Para a produção funcionar de novo:**
   `beamup config:set PROXY_CHECK_TOKEN=<valor>` + novo deploy.
4. **Headers de segurança** (medidos **zero** em produção): `X-Content-Type-Options`,
   `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security` em todo caminho, e
   `Content-Security-Policy` nas três páginas (elas têm `<script>` inline e o `/tv` carrega
   hls.js/p2p-media-loader do jsdelivr — apertar isso quebra o player).
5. **Barreira: 202 testes** (um novo tranca os 4 itens acima por texto e registro).

**Ainda aberto (na ordem que o dono pediu)**
6. **RTD** — precisa de saída brasileira (120 medições, todas 403, worker em WAW/Polônia).
7. **P2P** — só na página `/tv`, desligado, com 2 de 3 trackers públicos mortos; e o player do
   Stremio não faz WebRTC, então P2P de vídeo é só no navegador.
8. **Cache de segmento de TV na borda** — N pessoas no mesmo canal = N idas à origem.
9. **Alerta de fonte caída** — `/health` e `/metrics` existem, ninguém é avisado.
10. **Cobertura do caminho do byte** (57,96% no geral; `stream-relay` 12%, `prova-viva` 24%,
    `url-resolver` 25%).
11. **Rate limit compartilhado** — sem `REDIS_URL` no `Dockerfile`, cada app conta por si.
12. **`server.js` com 2.540 linhas**, 37 `catch {}` vazios, pico de RSS de 369MB (teto 300MB).
13. **Histórico**: 1 commit só (sem `bisect`/autoria) e `CHANGELOG` congelado em 1.0.1.
14. **Defeito do "link de VOD copiado buga"**: PENDENTE desde 29/09; medi `/p/` com `Range` →
    **206 correto**, ou seja, não reproduz e ficou sem causa confirmada.

**Corrigido por engano meu, na mesma rodada (registrado para não repetir)**: medi "catálogo de TV
vazio em produção" e era **URL errada minha** (`/catalog/tv/movie/mirror-tv-live.json`); a rota é
`/catalog/:type/:id.json`. E o **KKT funciona na produção** (192.377 canais no boot, medido) — ele
some da resposta por **dedup** contra o BLZ, que é a mesma origem: isso é desenho, não defeito.

## A página /tv estava morta desde sempre — e o P2P usava a API errada (decisão 132)

Duas descobertas na mesma rodada, ambas encontradas por **executar** o código em vez de ler:

**1. O script da página `/tv` nunca rodou.** O `public/tv.html` abre uma IIFE no começo e **nunca
a fechou** — não existe `})();` em **nenhum commit do repositório** (verificado em 7 commits).
Erro de sintaxe = o navegador descarta o script inteiro. Ou seja: a página não tinha player, não
tinha P2P e não mandava o relato de telemetria. Isso explica por que o `/health.p2p` só mostrava
os números que eu injetei com `curl` no teste do endpoint — eu tinha provado o **servidor**, não a
**página**. `test/paginas.test.js` agora **executa o parser** sobre cada script embutido das três
páginas (`new Function`), então esse tipo de morte não volta a passar.

**2. O P2P usava a API da v3 numa biblioteca que é v4.** Lendo a documentação oficial
(medido): em v4 o motor **não** entra como `loader` do hls.js — ele entra por
`HlsJsP2PEngine.injectMixin(Hls)`, que devolve uma **subclasse**, e a configuração vai em
`hls.p2p`; a v4 também é **só ESM**. Era exatamente o sintoma que o próprio código registrava
(`manifestLoadError`, status 0): o hls.js recebia um `loader` que não era loader, e o manifesto
nunca completava. Três coisas foram refeitas:

- as tags UMD viraram **import map + módulo ESM** (`p2p-media-loader-*@4.0.0/dist/*.es.min.js`);
- o player **nasce depois** do módulo carregar (com P2P desligado, nasce na hora — a página
  nunca fica em branco por causa de bônus);
- os eventos são lidos em `hls.p2pEngine` com os nomes da v4, e o que separa "veio de par" de
  "veio da origem" é o `downloadSource === "p2p"`;
- e agora escuta-se o **`onStreamRegistrationError`**: o guia de migração diz que um stream que
  não registra fica "unknown to the core (its segments load without P2P)" **em silêncio**. Era
  esse o pior modo de falha possível — P2P "ligado" e não fazendo nada;
- o estado do motor (`desligado`/`ligando`/`anunciando`/`registro-falhou`/`erro:<motivo>`) aparece
  na tela **e** no `/health`, porque a única prova de que o P2P funciona é o número de quem
  assistiu de par.

**O que continua dependendo de você:** a prova final do enxame precisa de **duas abas do seu
navegador** (com uma pessoa só não há P2P por definição). Assim que você abrir `/tv?p2p=1` em duas,
o `/health → p2p` mostra pares e percentual, e o `motor` diz se o stream entrou no enxame.

## As credenciais: o que dá para medir daqui, e o que é ação sua (decisão 133)

Rotacionar senha de painel, chave do TMDB e token da Cloudflare é **ação de conta sua** — não há
caminho pelo código. O que era meu:

- **`.env` fora do índice** (feito antes) e agora **trancado por teste**: `test/segredos.test.js`
  falha no CI se algum arquivo de ambiente for versionado de novo. O `.gitignore` sozinho não
  resolvia — ele só vale para o que ainda não está no índice.
- **16 variáveis de credencial marcadas** no registro único (`segredo: true`), e um teste falha se
  alguém criar uma variável com cara de credencial (`PASS`, `SECRET`, `TOKEN`, `_KEY`, `_USER`,
  `WEBHOOK`) e não marcar. Ele encontrou 4 que eu tinha esquecido (`XTREAM_EXTRA1/2`).
- **`/health → credenciais`**: diz, de cada uma, `definida` ou `ausente (usa o padrão do código)` —
  **nunca o valor**, nem um pedaço dele (o teste garante). É a régua para o passo que você adiou
  (tirar os padrões do código): só dá para tirar depois que a variável existir no ambiente.

**Prioridade de rotação:** o **token da Cloudflare** primeiro — ele está nesta conversa e no
`~/.cloudflare-token`. Depois a senha do painel e a chave do TMDB.

## RTD: dá para ser direto — a medição separa as duas metades

**O link é direto e funciona.** Medido agora, desta máquina (que está no Brasil), com o scraper
real do projeto:

- a API **responde**: `catalog-index` e `play-link` em **1,3s** (filme) e **0,5s** (série);
- o stream sai com `https://cnn.radiogaucha.fun/...` + `Referer` em `behaviorHints`, e
  **entrega de verdade**: `HTTP 206`, `content-type: video/mp4`, `content-range: bytes 0-2047/3651280991`
  — 3,65 GB, com faixa correta, ou seja, **toca e dá para pular posição**.

**O que não funciona é só a descoberta a partir da produção**, que fica na Polônia e leva 403 por
país. Ou seja: o RTD está pronto e delivering; quem não consegue é o **servidor** quando a
pessoa pede.

**Caminho que existe e é barato (se você quiser):** o vídeo já vai direto do aparelho da pessoa
para o CDN deles — nunca passa pela VPS, nunca passa pelo worker. O que falta é o servidor na
Polônia **descobrir** o link. Como a descoberta só funciona do Brasil, dá para gravar as respostas
da API (2 KB por item) num **KV da Cloudflare** a partir de uma máquina no Brasil, e o worker
servir essa consulta para a produção — que lê KV de qualquer lugar. Isso não é ponte de vídeo:
é só a lista de "qual arquivo existe". O custo é uma dependência operacional (algo precisa
chamar a API do Brasil de tempos em tempos) e o ganho é o RTD funcionando de novo.

## O catálogo de TV perdeu 110 canais em produção — causa encontrada e corrigida (decisão 131)

**Sintoma medido (01/10/2026):** o catálogo de TV caiu de **327 para 217 canais** e o `hbo` passou
a responder `EMB + ETC` **sem a REI**, sem nenhuma alteração minha que explicasse. O log do app
mostrava a pista: `[tv] streams rei: reidosembeds embed HTTP 429` repetido.

**A causa (medida, nãoopacity):** três camadas do scraper do REI transformavam "não deu para
consultar" em "a fonte respondeu e não tem stream":

1. `temSegmentos()` fazia `catch { ok = false }` e **guardava esse `false` no cache** — 429,
   timeout e erro de rede viravam "playlist vazia";
2. `getStreams()` fazia `try { … } catch { return [] }` na segunda tentativa;
3. e a triagem lê corretamente "respondeu e nenhuma fonte entregou" como **prova de morte** por
   24h (`CHAVE_MORTOS`).

Ou seja: a regra da decisão 125 ("erro não é prova de morte") estava escrita e implementada
corretamente na triagem — quem a violava era o **scraper**, que não distinguia as duas respostas.
Com o REI respondendo 429, 110 canais foram marcados como mortos e **saíram da lista**, que é
exatamente o que o dono proíbe ("não retirar canais").

**Correção:** em `temSegmentos()`, 404/410 e playlist sem segmento continuam sendo **prova** (o
`src` deles rotaciona, isso é real), e **timeout, rede, 429 e 5xx agora sobem como erro**. O erro
da segunda tentativa de `getStreams()` deixou de virar `[]`, e `src` vazio passou a ser erro.
Na triagem o comportamento é o de sempre: erro impede a prova; prova de vida continua apagando
prova de morte; e `chavesDaLista` sem dono (REI fora) cai para a união das três fontes.

**A chave das provas mudou para `mirror-tv:triagem-mortos:v3`**: as 110 provas foram colhidas com
a regra errada e não tinham como valer 24h.

## O caminho do byte ganhou teste — e o teste achou 2 defeitos (decisão 130)

A auditoria mediu a cobertura do caminho do byte em 12,15% (`stream-relay`), 24,18%
(`prova-viva`) e 25,38% (`url-resolver`) — ou seja, quase **sem** teste justamente onde um defeito
não dá erro: o stream simplesmente para de tocar na TV da pessoa. `test/caminho-do-byte.test.js`
(subiu **sem depender de nenhuma fonte externa**) roda um servidor HTTP local que responde
exatamente os casos que o código precisa distinguir: morto, lento, página de erro, playlist sem
segmento, faixa 206, cadeia de redirect, redirect infinito e **origem que ignora `Range`**.

**Defeito 1 — a prova de vida condenava a playlist mestre.** A condição era "tem alguma linha que
não é comentário"; uma playlist mestre tem `#EXT-X-STREAM-INF` e variantes, **sem segmento
próprio**, e era condenada como "playlist sem segmento". Toda fonte que devolvesse um master
playlist tinha o link **tirado da lista** sendo que era um link bom — e o problema na VOD é o
oposto (ligar demais), nunca tirar demais. Agora o que condena é a playlist que **não aponta para
nada**, que é o caso do REI que motivou a regra.

**Defeito 2 — o relay deixava a origem ignorar a faixa.** Faixa fechada pequena (até 64MB) ia por
passagem direta: o relay repassava o `Range` e repassava a resposta como veio. Quando a origem
ignora `Range` e devolve **200 com o arquivo inteiro** (é o que o painel ATO faz — medido: pede
`bytes=1000-1999` e responde `200`, `content-length: 3048349935`, `content-range` nulo), quem
recebe o pedido de faixa fica com o filme do começo. Agora o relay **corta a faixa sozinho**
quando a origem responde 200 a um pedido de faixa, e marca `X-Faixa-Cortada: 1`. O worker já
fazia isso no `/p/` (decisão 127); faltava no relay do addon.

**CORREÇÃO IMPORTANTE (medido depois, e muda o diagnóstico): em PRODUÇÃO o app nunca recebe o
`Range`.** Os headers de diagnóstico novos (`X-Relay-Range`, `X-Relay-Upstream`) responderam
`-` e `200 sem-cr` numa chamada com `Range: bytes=0-99`, e o `inbound` do `proxy-check` não tem o
header. O que acontece é que **a Cloudflare serve a faixa na borda**: ela tira o `Range` do
pedido ao app, pede o arquivo inteiro, corta ela mesma e responde `206` com o `Content-Range`
certo (medido: `HTTP/1.1 206`, `Content-Range: bytes 0-99/3048349935`, arquivo de 3 GB). A mesma
faixa no **nosso worker** (`workers.dev`) é cortada no worker (`206`, `x-mirror-faixa: cortada`) —
ou seja, a Cloudflare **repassa** Range, não o tira; quem não repassa é o **gateway do Dokku/nginx**
na frente do app.

Duas consequências, ditas com clareza: (1) a correção do relay está certa e é necessária onde o app
recebe faixa (dev, `/stream/hls`, qualquer cliente que fale com o addon direto), mas **ela não é a
causa do "link de VOD copiado buga" em produção** — ali quem corta é a borda, e o defeito segue
**sem causa confirmada**; (2) o relay hoje abre uma conexão com a origem de 3 GB para servir uma
faixa de 100 bytes que a borda vai descartar. Isso é desperdício real e ainda não foi medido em
número de bytes.

**Resultado medido:**

| arquivo | antes | depois |
|---|---|---|
| `prova-viva.js` | 24,18% | **100%** |
| `stream-relay.js` | 12,15% | **82,35%** |
| `url-resolver.js` | 25,38% | 30% |
| geral | 59,01% | **64,56%** |

O relay compartilhado ficou **provado por contagem, não por opinião**: duas pessoas no mesmo canal
= **1 ida à origem** (o contador do servidor de teste é o que mede isso).

**Armadilhas registradas para quem for mexer nesse teste:** (1) o `localtest.me`/`nip.io` resolve
para `127.0.0.1` **e** para `::1`, e o Node tenta o IPv6 primeiro — o servidor de teste escuta
nos dois, senão dá `ECONNREFUSED` e o teste falha por motivo errado; (2) `127.0.0.1.nip.io` **não**
serve, porque o hostname começa com `127.` e cai no filtro de IP privado do relay; (3) o relay tem
**rate limit por host** (`HOST_RATE_LIMIT_MS = 1100`), então medir em tempo fixo mede a fila e não o
relay — o teste espera a resposta; (4) o duplo de cliente precisa marcar `headersSent` no primeiro
`write`, como o Express faz.

## Alerta de fonte caída (decisão 129)

Medido na auditoria: o `/health` e o `/metrics` mostravam **contadores**, e ninguém era avisado
quando uma fonte parava de entregar. O dono soube pelo relato de quem não achou o episódio.

O motor **já guardava** o necessário por fonte (`lastOk`, `lastError`, `fails`, `openUntil`) — o
`stats()` é que não expunha. Agora expõe, e o servidor classifica em quatro estados:

| Estado | Quando | O que significa |
|--------|--------|-----------------|
| `caido` | disjuntor aberto **e** sem sucesso nos últimos 30 min | sai da lista por 5 min (3 falhas) |
| `degradado` | errou, disjuntor ainda fechado | pode ser só uma falha |
| `parado` | entregou, mas faz mais de 30 min que ninguém pediu | **não é defeito** |
| `ok` | entregou nos últimos 30 min, ou nunca foi chamada | — |

**`tempoEsgotado` nunca conta como queda**: o motor trata timeout como "fonte lenta", e contar
tirava a fonte da lista por 5 min mesmo ela estando entregando. E fonte **nunca chamada** não pode
ser declarada quebrada — foi assim que `dgo` ficou `ok` com 0 chamadas na medição abaixo.

**Medido em produção, 4 pedidos reais (Matrix, Naruto, dorama, Breaking Bad):**

```
rtd  caido      3 chamadas  3 falhas  rtd bloqueado (upstream 403)
shg  ok         1 chamada   9 s desde a última entrega
ron  ok         1 chamada   9 s      aon ok 8 s      atb ok 9 s
blz  ok         3 chamadas  0 s      kkt ok 3 s      spt ok 2 s
vzr  ok         3 chamadas  1 s      dgo ok 0 chamadas (nunca pedida)
```

Isto é a **confirmação ao vivo** do bloqueio do RTD por geografia (decisão 123): a fonte está
`caido` na produção, e o `/health` agora diz isso com nome, número e causa — antes só contava
chamadas.

**O aviso**: com `ALERT_WEBHOOK_URL` no ambiente, o servidor manda um POST **só na transição**
(`ok` → `caido`, e a volta), com repetição mínima de 30 min. Sem a variável, nada sai do servidor
(o dono não tem onde receber) e o resumo fica só no `/health`.

## Cache de segmento na borda (decisão 127) — e o limite medido para TV

O `/relay/s/` do worker **não usava `caches.default`**: cada espectador ia na origem. A chave é a
URL do próprio worker (o caminho tem o base64 da origem e o `?ref=`), então `Referer` diferente
nunca divide cache e as pessoas do mesmo canal dividem. `Range` não entra no cache (a mesma razão
que já valia no `/p/`). TTL curto (60s): o segmento é imutável na sequência, mas o canal pode
trocar de sinal, e é a **playlist** que precisa ser fresquinha.

**Medido**: 1ª busca `x-mirror-cache: MISS` (668 KB da origem), 2ª e 3ª `HIT`, com 693 segmentos
por playlist — N pessoas no mesmo episódio pagam **uma** ida à origem.

**O que NÃO dá para fazer, e por quê:** cache de segmento de TV na borda. O worker **não alcança
os CDNs de TV** (erro 666, o mesmo que já está registrado em `WORKER_BLIND` no `lib/proxy.js`).
Então a economia de TV teria que ser no relay **do nosso servidor** — que já carrega o REI TV e,
por isso, é a exceção conhecida à regra de vídeo não passar pela VPS. Fica como item em aberto,
não como bug.

## Reset de cache: a ferramenta que não existia, e o estado que ela não pegava (decisão 134)

O dono pediu "resete o cache de todas as fontes". Medido: **não havia caminho** — as caches vivem
dentro do container e a única forma de limpá-las era reiniciar o app, derrubando todo mundo junto.
Agora existe `POST /admin/limpar-cache`, com o mesmo portão de token do diagnóstico, e ele devolve
o **antes e o depois** para o efeito ser medido e não acreditado.

O que ele apaga: o SQLite inteiro (link de stream, catálogo de TV, EPG, chaves de triagem), as
caches em memória do servidor, as duas travas de pedido simultâneo, os **disjuntores** das fontes e
o **catálogo de TV em memória**. O que ele **não** apaga, e diz na resposta: as caches internas de
cada scraper (catálogo de painel em memória), que expiram em minutos.

**E o estado que ele não pegava — que só apareceu porque a medição é antes/depois:** as **provas de
morte da TV moram em memória** (`provadosMortos`), não no disco. O primeiro reset respondeu
"disco 0, memória 0" e mesmo assim o catálogo ficou com **227 canais em vez de 327** — o reset
dizia que tinha zerado e não tinha. Medido: **90 provas** no app1 e **38 no app2**, exatamente os
100 canais que faltavam. Hoje o reset apaga as provas e diz quantas apagou.

## Canal de TV só sai da lista na segunda confirmação (decisão 134)

**Medido:** com **uma** confirmação, 90 canais saíram do catálogo (327 → 227). A causa não foi erro
de rede: foi a resposta fraca do REI, que devolve **200 com playlist sem segmento** para canal que
funciona minutos depois (o mesmo sintoma que motivou a prova de vida). Tirar canal da lista com uma
amostra é jogar fora canal bom — e o dono pediu o contrário. Agora o canal só sai na **segunda**
confirmação (`TV_MORTES_PARA_TIRAR`, padrão 2), e **prova de vida continua entrando de imediato**.

O preço, dito com clareza: com os 327 na lista, **67% dos canais têm player**; com os 227, eram
92%. A diferença são canais que a fonte não está entregando agora. A lista é o que a fonte declara,
e a pessoa vê "sem fonte" em vez de o canal não existir.

## A triagem de fundo para quando alguém está assistindo (decisão 134)

Medido: com a triagem rodando, canal que respondia em **0,5s** passava a demorar **10-11s** e o
gateway (12,3s) cortava o primeiro clique em **504** — 30 dos 327 canais. A triagem é trabalho de
fundo por definição, então agora ela **espera**: entre uma fatia e outra, se há pedido em voo, ela
não toca nas fontes (`setCargaDeUsuario` → `inflightStreams + inflightCatalogs`).

## Orçamento por fonte de TV: o 504 virou "sem fonte" (decisão 134)

Medido no REI, com cronômetro: canal que **entrega** leva no máximo **3,4s** (6 de 12 canais);
canal que **trava** leva **23-25s** (a cadeia de 4 saltos, com nova tentativa). Como o gateway corta
em 12,3s, esses canais **nunca** podiam resolver — o clique era sempre 504, nunca "sem fonte".

Agora cada fonte de TV tem **6s de orçamento** (`TV_MS_POR_FONTE`), o que mantém quem funciona com
2,6s de folga e devolve vazio — com o motivo no log — dentro do tempo.

**Medido depois, nos 5 canais que davam 504 em toda tentativa:**

| canal | antes | depois |
|---|---|---|
| agromais | 504 em 12,3s | **200 em 7,6s** |
| appletv3 | 504 em 12,2s | **200 em 6,9s** |
| canalgoat | 504 em 12,2s | **200 em 6,8s** |
| canaluol | 504 em 12,5s | **200 em 7,8s** |
| canalrural | 504 em 12,2s | **200 em 6,8s** |

E quem funciona segue igual: `sbt` 0,5s, `cnnbrasil` 0,3s, `hbo` 0,8s, `disney` 1,9s.

## Nenhuma fonte devolve um item que não é o pedido (decisão 135)

**Este é o defeito mais grave que já apareceu no projeto**, e ele apareceu porque foi medido:

```
movie/tmdb:603  (Matrix)  ->  otakulogia:futari-wa-precure:1x1   (um anime sem relação)
movie/tmdb:155  (Batman)  ->  otakulogia:boruto-naruto-...       (Boruto)
```

A pessoa pede Matrix e dá de cara com um desenho japonês, sem aviso nenhum. A causa não é a busca:
é o que se faz com o resultado dela. No SHG era `searchItems.find(i => i.slug === query) ||
searchItems[0]` — **sem casamento exato, aceitava o primeiro resultado da busca, qualquer que fosse**,
e devolvia o episódio 1 daquele anime. Como o motor chama as fontes com **variantes de título**
("Batman: O Cavaleiro das Trevas" → "Cavaleiro Trevas"), quase toda variante caía nesse caminho. O
mesmo padrão existia em mais dois pontos do servidor (a busca de emergência por slug e a troca de
título pelo resultado do AniList).

**A regra:** `src/lib/portao-correspondencia.js` — se o melhor resultado não casar com o pedido, a
fonte devolve `[]`. Sem stream é honesto; stream do item errado é pior que stream nenhum, porque a
pessoa assiste achando que é o que pediu. O casamento usa `matchVodTitle`, a mesma regra que os
painéis já usam (ignora qualificador, reprova continuação), e fecha o caso que ela deixava passar
("Naruto: Shippuden" para "Naruto"). Detalhe também é conferido: slug que casa no nome mas aponta
para outro anime continua sendo conteúdo errado.

**Medido depois:** 6 filmes, 0 anime errado, fontes de VOD em todas; Naruto 4, Bleach 4, One Piece
3, Death Note 1 — o anime legítimo **não** foi perdido. Localmente: SHG com "Matrix" → 0 stream
(portão fechou) e com "Naruto" → 1 stream correto.

## TV: lista só do REI + canal reunindo os três players (decisão 138)

Tive a informação errada na primeira vez e o dono corrigiu na hora: **o catálogo é apenas do REI
dos embeds** — não são dois catálogos. A tentativa de listar a união das três (decisão 137, 388
canais) foi revertida.

**O pedido de verdade:** *"uma normalização de títulos dos canais para que seja fácil colocar, por
exemplo, dentro do A Fazenda 1, todos os três players desse canal vindo do REI, do EMB e do ETC"*.

O defeito medido é que o mesmo canal tem três grafias e três chaves:

| fonte | nome | chave | slug |
|---|---|---|---|
| REI | `A Fazenda` | `afazenda` | `afazenda` |
| EMB | `A Fazenda 18 - 1` | `afazenda181` | `afazenda` |
| ETC | `A FAZENDA 1` | `afazenda1` | `afazenda` |

O **slug é o mesmo** nas três. Aí está a chave do agrupamento: `agrupaPorCanal` casa primeiro pelo
nome normalizado (seguro) e depois pelo slug, com uma guarda.

**A guarda, medida canal a canal:** de 19 canais que casam só pelo slug, **13 são o mesmo canal**
(A Fazenda 1-5, Disney 1-3, Max, Universal TV, 24H Naruto) e **6 são falso** — a EMB usa o slug do
canal para um **evento** (`ESPN` / "Liga das Nações - Grupo 4 País de Gales Noruega", `SporTV` /
"Euroliga", `ESPN 3` / "MLB Wild Card"). A regra que separa: os dois nomes compartilham uma
**palavra de 3+ letras** ou um é prefixo do outro, comparados no **nome original**.

**As edições não se misturam** porque o slug as separa (`afazenda` ≠ `afazenda2`).

Medido depois: catálogo **327 canais**; `A Fazenda` 1 a 5 abrem com **REI + EMB + ETC**; `A Fazenda
6` e `7` só com REI (as outras fontes têm só 5 edições da 18); ESPN/SporTV/XSports **sem** o evento
de futebol.

### Verificação do REI (01/10/2026) — e a correção do que eu tinha escrito

Eu tinha escrito que o REI **parou de entregar vídeo**. **Estava errado**, e a verificação mostra
o motivo do meu erro: medi uma vez, peguei 500, e generalizei. A origem **oscila**.

**O que está bom:** site 200; `/api/channels` 200 com **327 canais**, todos com nome, nenhum id
repetido, **todos com logo** (40 de 40 da amostra respondem 200 em ~50ms, e os 327 apontam para o
domínio deles, sem link externo quebrado); `/api/guia` 200 com **327 canais e 3.939 programas**,
XML bem formado, em hora BRT.

**O vídeo funciona.** A cadeia inteira passa: página do canal → `/__play/` (que agora vem com
token `?pt=…&pc=…&ib=…`) → player → `__index.txt` → **playlist 200 com 3 a 7 segmentos**, e as
URIs de segmento são absolutas, de outro host e **sem token**. Em produção, `hbo` abre com
**3 players** e o relay (`/stream/hls/rei:…m3u8`) entrega a playlist com 200 e
`application/vnd.apple.mpegurl`.

**Os defeitos, com o número:**

- `preview_url` dos 327 canais aponta para um host que responde **403 para tudo** — o projeto já
  ignora esse campo e usa o logo.
- **A origem oscila**: numa amostra de 20, 12 canals deram player, 3 deram **500** e 5 deram
  playlist **vazia** (o `src` rotaciona; a decisão 111 já trata disso invalidando a cache e
  refazendo a cadeia uma vez). Noutra rodada foram 11 de 14. **Não dá para medir taxa fixa** — a
  origem liga e desliga.
- **O CDN dos segmentos bloqueia IP de datacenter**: do servidor, um segmento volta
  `200 text/html` com "Anonymous Proxy detected" (Cloudflare). **Não deve afetar o usuário**,
  porque o relay entrega só a playlist e os segmentos são absolutos — quem baixa é o aparelho do
  usuário, do IP residencial dele. Não dá para provar daqui.

**Lição para o registro:** "a fonte parou" e "a fonte oscila" levam a consertos errados. A
amostra de 12/20 virou 11/14 trinta segundos depois. Antes de afirmar que uma origem mudou de
forma, é preciso refazer a cadeia do zero e ver se volta.

## TV: relay escolhe quem responde, e a cadeia do REI repete uma vez (decisão 139)

O dono: *"todos os links de todos os players de live TV pararam, fica um ícone quadrado de
interrogação"*. Medi antes de mexer, e **o agrupamento que eu tinha feito não era a causa**:
comparei os dois algoritmos nos mesmos catálogos — 388 grupos, **0 provedores perdidos**.

**A causa medida:** o CDN final da EMB e o da ETC é o **mesmo** (`s23-cloudfront-net.lat`) e estava
fora do ar — **522 em 6 de 6 tentativas, 19,4s cada**; a ETC com o `Referer` certo também dava 522.
A REI, em outra família de CDN, continuava de pé.

**Três defeitos que se somavam:**

1. O relay era `Promise.any` **sem provar** a playlist — devolvia o primeiro que "respondesse", e o
   EMB responde sempre (o `playlistVerdict` dele aceita `unknown` para não matar a fonte). Com o CDN
   no chão, o player ia para a origem morta em vez de para a REI, viva.
2. **O REI não exportava `resolvePlaylist`**, então o relay genérico nunca podia usar a fonte
   preferida. E os três módulos devolvem formatos diferentes (`entry`/`url`/`src`) — ler só `entry`
   descartava o REI inteiro.
3. **Sem teto por fonte**, o relay pagava **27s** (o ETC espera o CDN morto responder para descobrir
   que está morto), contra os **12,3s** do gateway — a correção trocava player quebrado por 504.

**A correção:** a playlist é **provada** antes de virar resposta (`#EXTM3U` + pelo menos um
segmento), os três formatos são lidos, a prova leva o `Referer` de cada fonte, tudo em paralelo com
teto por fonte (`TV_PROVA_PLAYLIST_MS` 4s, `TV_RESOLUCAO_PLAYLIST_MS` 5s) e o resultado fica em
cache 60s. Vence a primeira fonte **na ordem dos provedores** que prova — a preferência do dono, não
a mais rápida.

**E a segunda tentativa da cadeia do REI:** a cadeia falha em ~1 de cada 3 canais, e falha **tanto
em sequencial quanto em rajada** (4/6 nos dois casos) — ou seja, **não é o nosso aquecimento**, é a
origem oscilando. Como era a única fonte de pé, cada falha era um player a menos. Medido: com uma
repetição (só para erro de rede, nunca para 404), a cadeia passou de ~2/3 para **14 de 14** nos canais
que existem na origem.

**Bug que a repetição trouxe:** `p.finally()` devolve uma promise nova que rejeita junto com `p`, e
ninguém pegava — o processo morria com "unhandled rejection" no primeiro erro. Agora é `then` com os
dois lados.

**O que NÃO resolveu:** o CDN das outras duas continua fora do ar. Isto não conserta a origem — só
faz o addon parar de escolher a origem morta quando existe outra viva.

## O texto do player em cascata (decisão 142)

O dono: *"eu quero que no player das fontes não fiquem as coisas escritas uma do lado da outra e sim
em cascata"*.

```
🌊 Matrix (1999)
🌎 Português
720p
BLZ
```

Uma informação por linha, na ordem que o olho lê: o que é, onde estamos, em que idioma, em que
qualidade, de onde vem (e, na TV, o que está no ar). O nome curto da lista ficou `Mirror 720p BLZ`.

**O motivo medido:** com tudo grudado por `·`, o celular cortava a linha pelo meio e o usuário perdia
o fim — que é a fonte. Numa tela estreita não cabe "🌎 Português · 720p · BLZ" sem que uma das três
informações desapareça.

## O E2E completo e o veredito das 12 fontes (decisão 141)

O dono: *"as fontes estão todas quebradas [...] quero quatro fontes de filmes e séries funcionando e
as quatro fontes de anime funcionando e uma fonte de dorama funcionando e as três fontes de live
TV funcionando, que um e2e completo de ponta a ponta"*.

**`node e2e-completo.js`** sobe o servidor de verdade, chama as rotas que o Stremio chama e prova,
para cada player: (1) a fonte entregou, (2) **o link responde** — buscado de verdade, com os
mesmos cabeçalhos que o player manda, (3) **o título está normalizado**. E separa *nosso* de
*da origem*.

### Veredito medido

| fonte | grupo | veredito | número |
|---|---|---|---|
| BLZ | filme/série | **OK** | 14 chamadas, 14 ok, 0 falhas, 67 streams |
| SPC | filme/série | **OK** (3 links OK) | 1 caso sem o título (o painel não tem Breaking Bad) |
| ATO | filme/série | **ORIGEM RECUSA** | 3 de 4 links recusados pelo painel |
| KKT | filme/série | **OK** | 14 chamadas, 14 ok, 0 falhas |
| SHG | anime | **OK** | 3/3 |
| RON | anime | **OK** | 3/3 |
| AON | anime | **OK** | 3/3 |
| ATB | anime | **OK** | 3/3 |
| DGO | dorama | **OK** | 2/2, 4 streams |
| REI | live TV | **OK** | playlist com 3 segmentos |
| EMB | live TV | **ORIGEM RECUSA** | CDN fora do ar |
| ETC | live TV | **ORIGEM RECUSA** | CDN fora do ar |

**Os quatro de anime e o de dorama: 5 de 5.** De filme/série, 3 de 4 (o ATO tem a origem recusando).
De live TV, 1 de 3 (o CDN da EMB e o da ETC é o mesmo e está fora do ar — 522 em 6 de 6).

**"NÃO ENTREGOU" não é defeito**: o KKT é failover do BLZ (mesmos arquivos) e some por dedup quando o
BLZ já entregou — 14 chamadas, 14 ok, 0 falhas. Julgar "não entregou" como quebrado dava 4 de 12
fontes "quebradas" que estavam de pé. Por isso o veredito cruza o E2E com o contador do motor em
`/health`.

### A normalização, e um defeito que ela criou

O defeito medido: **o mesmo seriado saía com nomes diferentes conforme a fonte** — "Breaking Bad: A
Química do Mal" no BLZ e "Breaking Bad" no SPT. Agora o nome canônico vem do metadado, o texto da
tela é remontado a partir das peças, e a API devolve `player` com tudo separado (`nome`, `ano`,
`temporada`, `episodio`, `qualidade`, `fonte`, `fonteId`, `idioma`, `dublado`, `legendado`).

**O que a normalização errou na primeira vez, e o E2E pegou:** o campo `guia` (a programação da TV)
era "tudo depois da primeira linha" — e a linha de **idioma** do título entrava como se fosse guia,
saindo duplicada na tela: *"🌎 Português · 720p · BLZ"* e logo abaixo *"🌎 Português"*. Agora a
guia é filtrada por marcador (📺/⏭️) e o idioma aparece uma vez só.

**E um bug meu no meio disso:** `p.finally()` numa promessa que rejeita cria uma rejeição órfã e
derrubava o processo. Foi o `then` com os dois lados.

## A CAUSA DE "TODOS OS PLAYERS PARARAM": a borda guardava o 404 por 4h (decisão 140)

O dono: *"todos os links de todos os players de live TV pararam, fica um ícone quadrado de
interrogação"*. Ele tinha razão que não era bloqueio de datacenter — e o defeito era de
infraestrutura, nosso.

**O que medi, na ordem, antes de mexer em qualquer código:**

1. Meu agrupamento de canais (decisão 138) — comparei os dois algoritmos nos mesmos catálogos:
   **388 grupos, 0 provedores perdidos**. Não era ele.
2. `browserFetch` (que eu tinha mexido) — a minha alteração é opt-in, o caminho normal está intacto.
3. Descarte de cache por pressão de memória — o log mostra `4 entradas, 0 descartadas`. Não era ele.
4. Log do servidor — nenhum erro, nenhuma exceção.

**A causa, no header que a borda devolve:**

```
HTTP/2 404 | cache-control: public, max-age=14400 | age: 77 | cf-cache-status: UPDATING
```

A rota do relay manda `max-age=25` (cacheável, de propósito) e **a zona do BeamUp reescreve para
`max-age=14400`**. Um **404 transitório** ficava guardado **4 horas** na borda e continuava sendo
servido depois de a origem voltar. O servidor estava bom; o cache é que não — e para o usuário o
sintoma é idêntico a addon quebrado.

**Correção:** `CDN-Cache-Control: no-store` e `Cloudflare-CDN-Cache-Control: no-store` no relay
(o cabeçalho que o Cloudflare respeita para o TTL da borda, separado do da origem), e nenhuma
resposta >= 400 fica guardada em rota nenhuma. Medido depois: **`cf-cache-status: BYPASS`**.

**Armadilha que veio junto:** sem guarda de "o canal existe no catálogo", o relay pagava as 3
fontes (5s cada) + a prova, e o gateway devolvia **504** em vez de 404. Agora sai em **0 ms**.

**O que continua sendo da origem, dito com clareza:** o CDN final da EMB e o da ETC é o mesmo
(`s23-cloudfront-net.lat`) e está fora do ar — **522 em 6 de 6 tentativas, 19,4s cada**. Só o REI
está de pé, e ele oscila (falha ~1 em cada 3, tanto em sequencial quanto em rajada). Por isso
alguns canais ainda abrem com 1 player só.

## RAM: o catálogo dos painéis saiu da memória (decisão 136)

**A meta do dono:** máximo de **150MB**, e nunca passar de **300MB** mesmo com milhares de pessoas.

**Onde a RAM estava (medido, `memoria.js` — script novo, roda o boot e mede etapa por etapa):**

```
início                        rss   46MB
requer o servidor             rss   48MB
kakito (192.383 canais)       rss   57MB   <- 7MB, e o provado do SQLite funcionando
xtream.preloadLists()         rss  263MB   <- 206MB SOZINHO
resto (fontes, TV, EPG)        rss  264MB
```

Não era vazamento: com coleta forçada o mesmo processo caía para **heap de 20MB** e RSS de 168MB.
Ou seja, o app guardava 20MB de catálogo e o resto era lixo esperando o coletor — mas lixo de
200MB ainda é 250MB de RSS no pico.

**As quatro correções, na ordem em que entraram:**

1. **O campo `key` do item foi mexido e voltou.** Eu removi achando que era peso morto; o teste
   "nenhum módulo chama uma função que ele mesmo não define" não reclamou porque o `key` é lido
   pelo `preFiltra`, que mora no `match.js` — e sem ele o código recalcula `matchKey` de **93 mil
   itens por pedido**.
2. **A descrição do item (`title` na API do painel) foi cortada para 160 caracteres.** Ela é usada
   **só para casamento** (`matchScore`/`matchVodTitle`), nunca é mostrada.
3. **O `cleanup` de 30s passou a coletar de verdade.** Ele chamava `global.gc()`, que **nunca
   existe** em produção: `--expose-gc` não é permitido em `NODE_OPTIONS` (o Node recusa: "is not
   allowed in NODE_OPTIONS"). `src/lib/memoria.js` pega o `gc` em tempo de execução
   (`v8.setFlagsFromString` + `vm`), medido 92MB → 69MB num processo só com stringas.
4. **O catálogo dos painéis foi para o SQLite** (`src/lib/catalogo-paineis.js`), lido **pedaço a
   peça** — o mesmo desenho que o KKT já usava para 192 mil canais com 7MB.

**Otimização que teve que ser medida duas vezes (e errada uma):** o `xtream.preloadLists()`
baixa, grava em disco e solta a lista; e a resposta do painel é consumida em pedaços
(`browserFetch` ganhou `porPeca`), porque o texto de um catálogo de 30MB virava Buffer de 30MB +
string de 30MB. O RSS é logado por etapa no boot (`[paineis] … rss X -> Y`), que é como se descobre
onde o pico está.

**Resultado medido, boot que baixa (com `MALLOC_ARENA_MAX=2`, como a produção):**

| | antes | depois |
|---|---|---|
| RSS ao carregar o catálogo | 263-330MB | **119-130MB** |
| pico do boot | 342MB | **124MB** |
| heap depois | 78-97MB | **12MB** |
| boot seguinte (lê do disco) | 250MB | **60MB** |
| catálogo em disco | — | 102.821 itens |

**E o mesmo stream nos dois caminhos** (a prova de que a economia não custou fonte): Matrix 6
[BLZ SPC ATO], Parasita 6, Breaking Bad 2, Game of Thrones 3, Stranger Things 3, Batman 7 —
**idêntico** com o catálogo em disco e com ele na memória, medido com `XTREAM_CATALOGO=memoria`
(que é o botão de emergência, se o disco falhar na hospedagem).

**Um defeito que o próprio corte criou e que só a medição pegou:** a primeira versão perdia o
conteúdo de **array vazio** dentro do item (`"backdrop_path":[]` virava `"backdrop_path":`) e
**1.367 de 9.664 itens** saíam com o texto quebrado — 14% do catálogo. Um catálogo com 14% dos
itens faltando não é "quase tudo": é a fonte não achando filme que ela tem. Há teste para isso.

## O primeiro clique depois do deploy (decisão 136)

**Medido em produção:** o catálogo leva ~25s para ser gravado, e um clique nesse intervalo caía no
caminho de memória — que funciona, mas devolve **menos fonte**, e o detalhe que machuca é que a
resposta fraca entra no cache por 15min. Medido no mesmo item: **2 streams, depois 3, depois 9**.

Duas correções:

1. **O pedido espera a gravação do painel** (com teto de 3s, para nunca passar do orcamento do
   gateway) em vez de sair com o catálogo pela metade.
2. **O boot voltou a ser paralelo.** Ele era sequencial porque os 3 painéis juntos estouravam
   300MB — mas isso era quando cada resposta virava um Buffer de 30MB e uma lista de 30 mil
   objetos. Agora cada pedaço é cortado e solto, e o que fica na RAM é o que o SQLite está
   gravando.

**Medido depois:** boot fecha em **7s** (era 25s), o primeiro clique em t+7s já vem com **6
streams de 3 fontes** (BLZ, SPC, ATO), e o processo fica em **RSS 142MB, heap 6MB, pico 148MB**.

O botão de emergência existe: `XTREAM_CATALOGO=memoria` volta a guardar o catálogo na RAM (mais
RSS, mesma funcionalidade) se o disco falhar na hospedagem.

## A prova da regra: 2.000 usuários, medindo a RAM (decisão 136)

`carga-ram.js` sobe o servidor **local** com o mesmo código de produção e roda o `load-test.js`
(2.000 usuários simulados, `X-Forwarded-For` variando, os mesmos caminhos que o Stremio usa)
medindo o RSS do processo a cada 2s. Roda local **de propósito**: martelar o addon do dono com
2.000 usuários não é como se prova uma coisa.

**Medido (antes dos tetos de cache novos):**

| momento | RSS |
|---|---|
| em repouso, depois do boot | 119MB |
| durante a carga (2.000 usuários, 259 req/s) | até **228MB** |
| 30s depois, sem nenhum pedido | 229MB |
| 70s depois | **165MB** |

Ou seja: **não é vazamento** — a RAM volta sozinha quando o `cleanup` roda (a cada 30s) e coleta.
E o teto de 300MB do dono nunca foi tocado.

**O que fecha o resto do alvo (medido, não chute):** baixar os tetos de cache (`MEM_CACHE_MAX`
4000 → **2000**, `MEM_CACHE_BIG_MAX` 60 → **24**) levou o **pico de 208MB para 167MB** e o repouso
de 165MB para **158MB** — e a latência **melhorou** (p95 350ms → 326ms, p99 789ms → 716ms). Cache
grande não economiza trabalho aqui: o que sai da cache é reconstruído a partir do que a fonte
tem em disco.

**Onde ainda estou acima dos 150MB, dito com clareza:** em repouso o alvo é cumprido
(**112MB e 113MB** medidos nos dois apps em produção depois desta rodada). Sob carga o processo
fica entre **156MB e 167MB** — uns 6 a 17MB acima do alvo, bem abaixo do teto de 300MB. A
ferramenta que faltaria para fechar isso é reduzir a janela do EPG em memória (cada dia ≈ 6MB,
decisão 55/56) e o teto de streams do relay.

## P2P: o que existe, o que não funciona, e como passar a saber (decisão 128)

**O que foi medido, não suposto:**

- O motor de P2P existe **só na página `/tv`** (`p2p-media-loader`), e está **atrás de `?p2p=1`**.
  O motivo está escrito no próprio código: com o loader ligado, o **hls.js não completa o manifesto**
  (`manifestLoadError`, status 0) nas versões 1.4/1.5/1.6 e nas duas fontes. Ou seja, hoje **não há
  enxame rodando em lugar nenhum** — e o hls.js nativo do Stremio não faz WebRTC, então P2P de
  vídeo só pode viver no navegador mesmo.
- Dos **3 trackers públicos** configurados, **2 estão mortos** (medido por announce WebSocket):
  `openwebtorrent` conecta e **fecha sem responder**, `novage.com.ua` dá **erro de WebSocket**, e só
  `webtorrent.dev` responde. A lista da página ficou só com o que responde.
- **O worker não alcança os CDNs de TV** (erro 666, já registrado em `WORKER_BLIND`), então **cache de
  segmento na borda para TV não é viável** com as origens de hoje. O cache de segmento que foi
  entregue é o do `/relay/s/` — o caminho do **HLS de anime**, que passa pelo worker. Medido: 1ª
  busca `x-mirror-cache: MISS` (668 KB da origem) e as seguintes `HIT`, com 693 segmentos por
  playlist — ou seja, N pessoas no mesmo episódio pagam **uma** ida à origem.

**Como fica mensurável (esta rodada):** a página `/tv` manda `POST /p2p/report` a cada 5s com
`pares`, `segmentos`, `dePares` e `erros`, e o `/health` devolve o resumo (`p2p: {canais, pares,
segmentos, dePares, pct}`). O que entra é clampado (números com teto, nome do canal com 40
caracteres, mapa com 60 canais), porque o endpoint é público. Sem isso, "o P2P funciona?" é
opinião de quem abriu a página.

**O que falta para o P2P funcionar de verdade** (próximo passo, e precisa de navegador — que esta
máquina não tem, o browser do harness está desconectado): trocar o `p2p-media-loader` por
**WebTorrent + loader próprio do hls.js** (ou fixar a versão do hls.js que o loader suporta), e só
depois disso fazer sentido o **tracker próprio no worker** (sinalização, um WebSocket por canal,
vídeo nunca passa por nós). O dono precisa abrir `/tv?p2p=1` em **duas abas/navegadores** para o
enxame ter par: com uma pessoa só não há P2P possível por definição.

## Catálogo de TV: o REI é o dono, e nada segura a resposta (decisões 125/126)

### Decisão 126 — REI como fonte de catálogo, EPG e stream (pedido do dono)

> "quero o REI como fonte de EPG e catálogo e também de stream de live TV, mas, caso as outras duas fontes também tenham os mesmos canais que o REI, eles aparecem junto quando clica no canal"
> e depois: "o catálogo do addon só existe o de live TV e o mesmo vai ser alimentado pela fonte REI dos embeds; as outras duas fontes só são acionadas quando se clica em um canal REI e esses canais também estão disponíveis nessas fontes, aí os players delas aparecem dentro do canal REI dos embeds"

- **`PROVIDERS = [rei, emb, etc]`**. A ordem decide três coisas: o dono de fallback (`ownerOf`), a ordem das fontes na lista de streams do canal (`allSettled` preserva a ordem do array) e a ordem de montagem do catálogo. **A EPG já era só do REI** desde a decisão 121 (`/api/guia`), e o logo também (327 de 387 measured).
- **A resposta de TV é ordenada por `ordemTv()`**, não por `SOURCE_PRIORITY` — o REI tem `prio: 9` no registro (porque no VOD ele não existe) e, sem essa regra, o stream do REI saía **em último** mesmo com `tvSources` entregando o REI primeiro. Medido antes/depois: `cnnbrasil`, `bandnews`, `hbo` → **REI + EMB + ETC**; `sbt`, `disney` (só REI) → REI.
- **A lista do catálogo é a do REI.** Medido: a união das 3 fontes dava 387 canais e **60 deles não existem no REI** — eventos esportivos de uma ocorrência só (MLB Wild Card…, Liga dos Campeões (F)…, Euroliga, WNBA) e "A Fazenda 18"/"CAZETV 1". São eles que faziam a lista parecer duplicada e entulhada. As outras duas fontes **não saem do projeto**: `groups` continua montado para todas as sementes, e é por isso que os players da EMB/ETC entram dentro do canal do REI. **Se o REI não declarar nada** (a API dele dá 429 em rajada), a lista cai para a união e o log avisa — TV escura é pior que lista longa.
- **Gêneros: 7 baldes, e o menu vem deles.** O filtro casa por nome exato, e as metas traziam **19 gêneros crus** contra um menu escrito à mão com 10 opções: **6 das 10 estavam quebradas** ("Abertos" devolvia 10 e escondia os 40 "Canais Abertos"; "Filmes e Séries" devolvia 1 e escondia 137; "Eventos" e "Portugal" devolviam 0). Agora `BUCKETS` + `normalizaGenero()` são a fonte única e o manifesto monta o menu com `["Todos", ...tvSources.BUCKETS]`. Medido: Esportes 114 · Variedades 108 · Abertos 50 · Filmes e Séries 38 · Infantil 20 · Noticias 13 · Documentarios 2 · **Todos 327**.

### Decisão 125 — a triagem e a prévia em segundo plano

`getCatalog` levava **131 segundos** (284 canais × 3 fontes, conc. 48) contra os **12,3s** do gateway, e a rajada de 48 cadeias fazia o REI responder **429** (57 linhas numa rodada; o host **não** limita a 5 req/s — 25 pedidos a 200 ms deram 0 × 429). A prévia somava mais 18,3s. Agora:

| | antes | depois |
|---|---|---|
| montar o catálogo | 131s | **84ms** (1,2s app1 / 0,4s app2) |
| canais na lista | 264 | **327** (os do REI) |
| 429 do REI no log | 57 | **3** |

- Triagem em fatias de 24, 8 em paralelo, **sempre somando** (prova de vida não tira ninguém); a prova de **morte** dura 24h e atravessa restart (`CHAVE_MORTOS`).
- A lista deixou de depender de a triagem terminar: é o catálogo da fonte **menos** as provas de morte.
- **Preço, dito com clareza**: nos primeiros minutos após um deploy pode aparecer canal que ainda não toca. O preço alternativo era o catálogo vazio.
- O pedido **sem filtro** passou a ler a lista já montada (antes só `?search=`/`?genre=`/`?date=` liam) — sem isso, o caminho mais usado (a primeira tela da TV) era o único que não tinha cache.

**Erro meu que vale registrar:** medi "catálogo vazio em produção" e era **URL errada minha** (`/catalog/tv/movie/mirror-tv-live.json`, um segmento a mais). A rota é `/catalog/:type/:id.json` e o Stremio pede `/catalog/tv/mirror-tv-live.json`. O catálogo nunca esteve vazio.

## Um worker por fonte (decisão 124) — pedido do dono: "isolar cota"

O plano grátis da Cloudflare dá cota **por worker**. Com um worker só (`mirror-cdn`), uma fonte que estoura o limite derruba as outras 15. O dono pediu um worker por fonte, e a medição mostra um segundo ganho: **cada worker falando com uma origem só é o que permite a Cloudflare puxá-lo para perto dela** (Smart Placement) — que foi o que destravou o RTD.

- **A lista mora no registro único** (`src/core/nomes.js`): `WORKERS` (chave da fonte → nome do worker) + `workerDe(fonte)`, que **deriva** a URL (`https://<nome>.dev-avmirror.workers.dev`, `WORKER_SUFIXO`) e cai no genérico `mirror-cdn` quando a fonte é desconhecida (é o que mantém funcionando qualquer caminho que ainda não passou a fonte) ou quando `CDN_PROXY` está ligado (dev local). **Não escreva `mirror-<fonte>` no código** — derive, senão o teste falha.
- **16 workers**: `padrao` (mirror-cdn) + um por fonte com conteúdo (shg, ron, aon, atb, spt, blz, spc, ato, kkt, rtd, dgo, vzr, emb, etc, rei). `cas` não entrega nada e usa o genérico.
- **`deploy-workers.sh`** publica todos, e a lista dele **sai do registro** (`node -e` lendo `WORKERS`) — não existe worker publicado que o addon não use, nem worker usado que ninguém publicou. `./deploy-workers.sh rtd` publica só um. Todos com o **mesmo código** (`worker-simple.js`), então a divisão não pode divergir de comportamento; o genérico continua publicado como reserva.
- **Só o RTD recebe Smart Placement** (`mode = "smart"`), porque é o único que só responde do Brasil — e `aqueceParaRtd()` no worker faz a **2ª subrequest para o RTD** (um `favicon.ico`, em paralelo, só quando o alvo é host RTD), que é literalmente o requisito da Cloudflare ("more than one subrequest to a back-end resource") para reposicionar o worker.
- **Passou a fonte em todo lugar que fala com o worker**: `lib/proxy.js` (`relayM3u8Url`, `proxyHttpUrl`, `urlOculta`, `applyStreamProxy`, `animeHlsUrl`), `server.js` (`headerlessVariant`, `cifraOrigens`, `maskStreamUrls`, `probeViaWorker`, relay do TV) e os scrapers (`redetoons` → rtd, `playerflix` → spt, `xtream` → blz/spc/ato, `kakito` → kkt, `embedtv` → emb). **O regex de "já mascarado" ficou `mirror-[a-z0-9-]+`** — com o nome fixo `mirror-cdn` ele não reconhecia o worker da fonte e a URL seria mascarada de novo (loop).
- **Barreira: 198** (3 testes novos: um worker por fonte, os helpers escolhendo o worker da fonte, e o deploy + aquecimento travados por texto).
- **Ganho de cache**: o `/p/` e o cache de segmento do worker são por instância, então os workers novos começam frios. Não é perda (o `mirror-cdn` continua de pé com o que já tinha quente) e a cota é o motivo do dono.



## Rodada 02/10/2026 — o plugin Nuvio: MIME do player, orçamento do REI, reserva do ATO

Pedido do dono: *"transforme o projeto em um plugin nuvio scraper funcional 100% com todas as
fontes vod e live tv funcionando e o catalogo sera por meio do addon presente no projeto"*.
A peça é `nuvio/` (as 15 fontes) e o catálogo continua sendo do addon (`src/routes/nuvio.js`,
`/nuvio/*`). Detalhe longo em `nuvio/STATUS.md` §1b, `nuvio/ARQUITETURA.md` §6 e
`nuvio/medicoes.md`.

**1. O Nuvio tira o MIME do CAMINHO da URL — a playlist do REI é `__index.txt`.**
Lido `PlayerMediaSourceFactory.kt` (976–1070): `inferMimeTypeFromUrl` (caminho) primeiro,
`inferMimeTypeFromQuery` (query: chave `format`/`ext`/`type`/`mime` com valor de manifesto, ou
valor `m3u8`/`mpegurl`/`hls`) só quando o caminho não diz nada, e **`proxyHeaders.response` é
sempre nulo para scraper** — não dá para injetar `content-type`. Com o caminho terminando em
`.txt`, o player tratava o manifesto como arquivo progressivo. **Correção:** `sinaliza()` em
`src/lib/hls.js` acrescenta `&format=m3u8` a quem termina em extensão de texto, **não toca** em
`.mp4`/`.ts` nem em quem já diz o formato, é idempotente e preserva a query. **Ferramenta nova
`nuvio/tools/mime.js`** reproduz a regra do Kotlin sobre as URLs reais: `rei/emb` saíam
"progressivo", agora `application/x-mpegurl (HLS ✓)`; `etc/rcd` (`.m3u8`) já saíam certos.
**Provado inofensivo** (`tools/prova-formato.js`): mesmo corpo de resposta com e sem o parâmetro.
Aplicado nos **4 emissores de TV** (`url: sinaliza(...)`), com teste varrendo os 4.

**2. A origem do REI leva 10,2s para dizer 404 — o probe de 8s virava "fonte com erro".**
Medido: `1041 Canal Goat 3` e `1101 Eurosport` lancavam `timeout de 8000ms` (chip de erro) em
vez de lista vazia. **Correção:** `MS_PLAYLIST = 13e3` (cobre 10,2s) buscado por
`restante(p, MS_PLAYLIST)` — orçamento **restante** do sandbox, que pode passar de 8s — e
`TETO_MS = 20e3` para a cadeia (canal morto não pode prender o chip por meio minuto). A 2ª
tentativa só roda se couber um probe inteiro. Depois: `1021 → [] em 4281ms`,
`1041 → [] em 11956ms`, `1101 → [] em 13513ms`, `HBO → 1 stream em 1814ms`.
**A regra da decisão 131 ficou:** rede/timeout no 1º probe ainda **sobe erro**; `[]` só quando
a origem **respondeu**.

**3. Reserva do ATO pelo worker.** O `player_api.php` devolve **200 / 235 B de "Welcome to
nginx!"** para IP de datacenter, e o **mesmo pedido pelo worker devolve o JSON**.
`painel.infoDe` refaz pela reserva só na recusa (página de erro) e **não paga o direto duas
vezes** (`recusaram`); **404 nunca aciona a reserva**. Resultado: **`ato` de 0 → 3 streams**.
O **vídeo** continua sem prova daqui: `…/movie/…mp4` devolve os mesmos 235 B direto (com
`Range`, com `Referer`) e **`403 Upstream 403` pelo worker** — só o aparelho prova.

**Medido (baterias `nuvio/tools/bateria.js` + `bateria-tv.js`):**
- VOD/anime/dorama: **14/15 com link vivo, 0 lançou erro**, 52,8s no total.
- TV, 16 canais × 4 fontes: **rei 13/16 (13 com link vivo, 0 erros)** — antes 2 erros + 1
  silêncio; emb 6/16, etc 6/16, rcd 4/16 (iguais). Os 3 sem stream do REI
  (`1021/1041/1101`) **não têm playlist viva na origem**.
- **Barreira `node --test test/` = 259** (247 + 12 novos em `test/nuvio-fontes-tv.test.js`,
  todos **sem rede**: contrato do MIME, os 4 emissores assinando, os tetos do REI, o REI sem
  `Referer`, a cadeia do REI com origem falsa — viva/404/404-na-cadeia/rede —, derivacão do
  worker com varredura por `mirror-<x>` literal, e a reserva do ATO).

**Só se prova no aparelho (3 coisas, documentadas):** o teto de 1 MB do sandbox (bytes de rede
ou corpo decodificado) · o 403/235 B de origem que recusa IP de datacenter (ATO e o CDN do RCD)
· a sessão do REI segurar um episódio inteiro (token de 300 s).



## O nome é MirrorStream — e o que ainda depende de produção (02/10/2026)

O dono: *"o nome do addon e do plugin é MirrorStream, o plugin também vai ser esse nome e pode
colocar também como endereço do beamup"*.

**O que já está feito no repositório** (nome de exibição — o que o usuário vê na tela):

| onde | antes | agora |
|---|---|---|
| plugin, `manifest.name` (Settings → Plugins do Nuvio) | `Mirror` | **`MirrorStream`** |
| plugin, `author` | `Mirror` | **`MirrorStream`** |
| addon, `manifest.name` / `/health` | `Mirror` | **`MirrorStream`** |
| addon, `manifest.id` | `com.mirror.addon` | **`com.mirrorstream.addon`** |
| stremio, `manifest.name` | `Mirror Stremio` | **`MirrorStream Stremio`** |
| stremio, `manifest.id` | `com.mirror.stremio` | **`com.mirrorstream.stremio`** |
| `package.json` (`name`) | `mirror-stremio-addon` (os dois, colidindo) | `mirrorstream-addon` / `mirrorstream-stremio` / `mirrorstream-plugin` |

**Os `id` são diferentes entre os dois addons de propósito**: dois addons com o mesmo `id` não
convivem — o segundo sobrescreve o primeiro na lista e o usuário perde um sem nenhuma mensagem.
Há teste (`test/produtos-sobem.test.js`) que falha se eles voltarem a ser iguais.

A sigla de cada fonte (`SHG`, `SPT`, `REI`…) **não mudou** — é o badge da fonte no card, com
`maxLines = 1`, e a sigla é o que o usuário reconhece. Ver `nuvio/STATUS.md` §1c.

### O que NÃO foi feito, porque é produção e precisa de decisão

1. **O endereço do BeamUp.** Hoje os apps são `mirrorhub` (catálogo) e `mirrorhub2` (cluster de
   TV), sob o hash `e75602c18409`, e a URL é `https://e75602c18409-mirrorhub.baby-beamup.club`.
   O dono quer **MirrorStream** como endereço. No BeamUp o nome do app **é** o endereço: trocar
   o nome cria um **endereço novo** (`<hash>-mirrorstream.baby-beamup.club`), e os apps antigos
   precisam ser removidos à mão. Isso é operação de produção, não de repositório — e o
   `PUBLIC_BASE_URL`/`TV_BASE_URL` do `Dockerfile` precisam do valor novo.

2. **A URL do plugin.** O repositório é `mrrobots777/mirror` e o Pages publica em
   `https://mrrobots777.github.io/mirror/`. É **dessa URL** que o Nuvio instala o plugin.
   Renomear o repositório para `mirrorstream` deixaria de fora **quem já instalou** — o Nuvio
   busca pelo repositório salvo. Se o dono quiser, dá para publicar **os dois** nomes por um
   tempo.

3. **O deploy em si.** O `Dockerfile` da raiz mudou (`COPY addon/package*.json`,
   `CMD ["node", "addon/src/server.js"]`). **A produção só volta a subir depois de um deploy com
   o Dockerfile novo** — antes disso o build falha por `COPY` não encontrado.
## A separação em três produtos — 02/10/2026

O dono pediu para separar o projeto: **plugin Nuvio**, **addon de catálogo para o Nuvio**, e
uma pasta **`stremio/`** com o addon completo (catálogo **e** streams).

```
nuvio/     plugin       os players rodam DENTRO do app (15 fontes)      [não mudou]
addon/     servidor     só catálogo para o Nuvio: canais, guia, meta    [era a raiz]
stremio/   servidor     addon Stremio completo: catálogo E players      [novo]
raiz       o que é dos três: worker, deploy, .gitignore, docs, Dockerfile do addon
```

**A decisão que muda o desenho:** `stremio/` é a **etapa 1**. Ele já sobe, tem `id` próprio
(`com.mirror.stremio`, diferente do `com.mirror.addon` de propósito — dois addons com o mesmo
`id` não convivem) e serve o catálogo inteiro. A **camada de player dele é a etapa 2**, porque
**o código não está no histórico**: o repo foi compactado em 7 commits (todos "1.0.1") e as
decisões 154/155 apagaram o relay, o proxy, 3 das 4 fontes de TV e o registro das 10 fontes de
VOD. O que sobrou são os arquivos dos scrapers e o motor. A lista do que falta está em
[`stremio/README.md`](stremio/README.md).

### O que a separação quebrou e foi corrigido (tudo coberto por teste)

| defeito | correção |
|---|---|
| `public/` resolvido por `process.cwd()` — no container o cwd é a raiz do repo e as 4 rotas de página apontariam para um `public/` inexistente | `const PUBLICO = path.join(__dirname, "..", "public")` nos dois servidores |
| `nuvio-canais.js` lia o mapa do plugin com `../../nuvio/...` — o addon desceu um nível | `../../../nuvio/...` |
| `Dockerfile` (BeamUp) fazia `CMD node src/server.js` e `COPY package*.json` da raiz | `addon/package*.json`, `addon/beamup-start.js`, `CMD node addon/src/server.js` |
| `cache: npm` da CI procurava `package-lock.json` na raiz, que não existe mais | `cache-dependency-path` com os dois lockfiles |
| `.dockerignore` só excluía o `node_modules` da raiz — o do plugin entrava na imagem do addon | `**/node_modules`, `**/test/` |
| testes liam arquivo **por `cwd`** (passavam por acidente na CI, que rodava da raiz) | todo arquivo abre por caminho absoluto derivado do módulo |

### Onde cada teste mora, e por quê

- **`addon/test/`** (276) — o servidor de catálogo. Inclui os `nuvio-*.test.js`, que exercitam
  `../../nuvio/src` mas ficam aqui porque é daqui que a barreira roda.
- **`test/`** (15) — o que é do **repo**: `.gitignore`, segredos, o worker, o deploy dos workers
  e **`produtos-sobem.test.js`**, que **sobe os dois servidores de verdade**.
- **`stremio/test/`** — reservado para a etapa 2 (os testes da camada de player).

`produtos-sobem.test.js` existe pela lição da 155: **texto não executa**. Duas vezes um
`require` quebrado e uma `app.listen` apagada passaram a barreira inteira — o servidor não subia
e o processo saía com código 0, sem escutar e sem erro. Agora, se um `src/server.js` não
imprimir `[Mirror] listening on`, o teste falha.

### Como rodar

```bash
addon:     cd addon    && npm ci && PORT=7000 node src/server.js
stremio:   cd stremio  && npm ci && PORT=7802 node src/server.js
plugin:    cd nuvio    && npm ci && node build.js          # 15 bundles + manifest

barreiras: node --test test/ && node --test addon/test/
imagens:   docker build -t mirror-addon .                  # Dockerfile da raiz
           docker build -f stremio/Dockerfile -t mirror-stremio .
```

**Atenção ao deploy:** o `Dockerfile` da raiz passou a copiar `addon/`, então a **produção
(BeamUp) só continua de pé depois de um deploy com o Dockerfile novo**. Antes disso, o build
falha por `COPY addon/package*.json` não encontrado.
## Rodada 02/10/2026 (2ª) — o plugin Nuvio: contrato de tela, prazo de corpo e qualidade real

O dono pediu bateria ponta a ponta, velocidade, "100% das fontes sempre pesquisadas e, se achar,
apareça o player", limpeza e **normalizar o nome das fontes como aparece dentro do Nuvio**.
Detalhe em [`nuvio/STATUS.md`](nuvio/STATUS.md) §1c. Aqui fica o que muda para quem mexe no repo.

**O Nuvio monta a tela em três lugares, e isso decide o contrato** (`/tmp/nuviotv/app/src/main/java/...`):

| o que aparece | de onde vem |
|---|---|
| linha 1 | `name` do scraper + `" - "` + `quality` (o **app** anexa) |
| linha 2 | `description ?: title`; `description` só existe com `size`/`language` |
| badge | `addonName` = `name` do **manifesto**, `maxLines = 1` |

**Consequências que valem para o resto do projeto:**

- sem `quality`, o app escreve `stream_quality_unknown` — **"Desconhecido"** em pt-BR. Medido:
  **13 das 15 fontes** devolviam sem ele.
- mandar `language`/`size` **esconde** o `title`. Não mandar.
- com "agrupar por repositório" ligado, o badge das 15 vira só "Mirror" — por isso a sigla vai
  no **fim do `title`** além do badge.
- `LocalScraperResult` é data class do Moshi: **campo a mais pode quebrar o parse em runtime**.
  O conjunto aceito é fechado e travado em `test/nuvio-apresentacao.test.js`.

**`src/lib/apresentacao.js`** é o único lugar que monta o objeto de stream (as 15 fontes passam
por ele). `sigla` vem do próprio scraper porque `core/fontes.js` é tooling-only.

**`src/lib/http.js` — o prazo cobre headers E corpo.** O defeito mais geral da rodada:
`Promise.race([fetch, estouro])` termina quando os headers chegam e limpava o relógio no
`finally`, então o `res.text()` ficava sem limite. Medido no DGO: headers 0,23 s, corpo 15,1 s.
Corrigido: **DGO 21,3 s → 5,7 s**. O `abort` do fetch é traduzido para `timeout de Xms em <url>`.

**`src/lib/painel.js`** — direto e reserva (worker) em **paralelo escalonado em 2,5 s**.
`get_vod_info`: BLZ 20,0 s · SPC 0,05 s · ATO não responde deste IP. ATO **9,9 s → 4,1 s**.
Detalhe dos candidatos em paralelo (`CONC_DETALHE`) — em sequência seriam 60 s no BLZ.
**O relógio nunca é limpo antes do `await` da outra ponta** (limpar deixava a reserva esperando
um timer morto e o `await` não voltava nunca).

**`src/lib/fonte-painel.js`** — o catálogo gzip parou de **roubar o orçamento**: era
`await catalogo` e **depois** `await shard`, e o BLZ gastava 12 s de 15 s num catálogo que nem
responde, sobrava 2,9 s para o detalhe que leva 20 s, e devolvia `[]`. Agora é **corrida**.

**`src/lib/qualifica.js` + `src/lib/video-probe.js`** — a qualidade é a **resolução real lida do
vídeo** (160 KB, prazo 3 s). Três defeitos da porta, todos medidos: `ms` `undefined` engolido
pelo `catch` (null em 1 ms), `#EXT-X-MAP` do fMP4 ignorado (é onde a resolução está), e teto
por requisição em vez do prazo da sonda (12,2 s no DGO). A build embrulha os 15 `getStreams`
(`entradaDe()`), então não há como uma fonte esquecer. `MIRROR_QUALIDADE=nunca` desliga.
**Não se propaga** a resolução de um stream para os outros da fonte — seria inventar.

**`src/lib/hls.js`** — `provaPlaylist()` é a régua única das 4 fontes de TV: **descarta**
404/410/451 e 2xx sem segmento; **não descarta** 403/429/5xx/timeout/rede. Medido no RCD: a
cadeia resolve e entrega `index.m3u8?token=…`, mas o CDN responde **403 a este IP** — e o
vídeo é baixado pelo aparelho, do IP residencial dele. **RCD: 0 → 1 stream.**
`tools/provar-links.js` segue a mesma régua (`INDECISO`/`BLOQUEADO` ≠ `MORTO`).

**`tools/bateria-completa.js`** é a bateria do pedido: 15 fontes × N casos, medindo tempo,
entrega, contrato, qualidade e link vivo — e separando **"o canal não existe nesta fonte"** de
**"a fonte tem e não entregou"**.

```
casos: 19 | canal nao existe nesta fonte: 3 | tentados: 16
com stream: 16/16 | lancou erro: 0 | devolveu vazio: 0
```

**Armadilha do ambiente:** o `node` daqui rejeita `const { x as y }`. Use `:`.

---

## Pendências conhecidas (25/09/2026 — rodada 33 aplicada)

**Aplicado nesta rodada (tudo medido, sem regressão):**
1. **Teto por painel no xtream** (`XTREAM_PANEL_BUDGET_MS`, padrão 8s): o `withPanelBudget` rejeita o painel que estoura, marca `err.budgetTimeout` e **não** conta como falha do circuit breaker (senão um painel lento era dado como morto). Matrix saiu de **9,6s/4 streams → 8s/8 streams**.
2. **2ª query de anime só quando a 1ª volta vazia** (`runAnimeScrapers`/`runAnimeQueries`): 10 scrapers paralelos viraram uma promise só; Naruto E1 frio caiu para ~3,6s e 4 requests a menos.
3. **Cache negativo de 404** nos fallbacks de slug do AON e do TOP (`missCache` 30min): título inexistente passou de 3 requests para **0** na 2ª chamada.
4. **Probe xtream pulado com 1 único candidato** (só em filmes): com 1 candidato o `applyProbeFilters` provadamente não muda nada (se o único morre, a lista volta). Em séries o probe **não** é pulado porque ele descarta episódio morto e muda o resultado.
5. **Enriquecimento AniList sequencial com fallback** (até 4 buscas paralelas → 1, com retry sequencial).
6. **"📎 Sem EPG disponível" removido**: quando o XMLTV não tem programa, o catálogo/meta não recebe mais a linha inútil.
7. **PPD valida o título do embed**: o mgeb devolve `<title>Breaking Bad - T1E5</title>`; se não casar com o nome pedido, o candidato é descartado (conteúdo errado não entra mais).
8. **`matchVodTitle` aceita qualificadores**: "Naruto Clássico"/"Naruto HD Remasterizado" passam a casar com "Naruto" sem deixar passar "Naruto Shippuden", "Goblin Slayer" ou "Matrix Reloaded" (12/12 casos, teste existente continua passando).
9. **Rotação de UA por host** (`uaFor` em `lib/ua.js`): pool de 6 UAs de browser, escolha estável por host (mesmo host → mesmo UA, não quebra handshake nem o BLZ/kakito), aplicada no `browserFetch`.

**PENDENTE — defeito MEDIDO, precisa de decisão do dono (29/09/2026): o link de VOD copiado "buga e faz barulho".**
O relato foi *"quando copia o link de uma fonte vod a transmissao simplismente buga e comeca a pular sem parar e a fazer sons estranhos"*. **Achado e medido: a rota `/p/` do worker (CF) não entrega faixa (Range) quando a origem redireciona.** O sintoma do dono é exatamente esse: o player pede `bytes=5000000-` e recebe **HTTP 200 com o arquivo inteiro de 1,3 GB a partir do byte 0** (em vez de 206 com 101 bytes) — o player escreve os bytes do início do arquivo na posição do seek, e o áudio/vídeo dessincroniza.
- **A origem está innocentada**: seguindo a cadeia do BLZ na mão (`kakito.xyz → voltm.uk → sc2top.com → lb18.cdnf1.top`) com `curl -L -H 'Range: bytes=5000000-5000100'` dá **206 com os 101 bytes certos**. O RTD (sem redirect) pelo mesmo `/p/` dá **206 correto**; o SPC (1 redirect, http→http) também. Quebra só quando a cadeia tem **3 redirects com downgrade https→http**, e aí o `fetch` do worker perde a header `Range`.
- **Nosso `/stream/proxy` resolve** (o `resolveRedirects` refaz a request a cada salto com os mesmos headers) — medido 206 correto no mesmo arquivo. Mas usá-lo significa **vídeo passando pela VPS**, que o dono não quer.
- **Não dá para contornar pelo worker sem deploy**: entregar ao worker a URL **já resolvida** resolveria (sem redirect), mas o host final (`lb18.cdnf1.top`) **não está na allowlist** do worker e o deploy exige `wrangler` + credencial, que não temos aqui.
- **Opção que devolve a decisão 49** (`MASK_STREAMS`): `cifraOrigens()` (server.js) roda **incondicionalmente** e joga todo VOD no `/p/` do worker; se ela parasse, os streams sairiam com a URL da origem — o Range volta a funcionar e o vídeo nem passa pela VPS, ao custo de expor a URL de origem (com o token do painel) ao cliente. **Como decidir isso é do dono.**
- **Encerrando o diagnóstico**: `ffmpeg -ss 600 -i <url worker>` dá `partial file` / `Invalid data` / saída vazia; pelo `/stream/proxy` dá saída limpa. Já o `ffmpeg -ss` **antes** de `-i` passa nos dois (lê o arquivo todo) — por isso o defeito passa despercebido no teste automático e só aparece no player de verdade.

**29/09/2026 — auditoria de TODAS as fontes, uma a uma, em produção (decisões 119/120)**
O dono pediu: *"garanta que todas as fontes estejam funcionando em produção, liste as que tem no projeto, teste uma a uma em diferentes obras, depois teste todas juntas, teste com o fluxo normal do user em produção"*. Foram 12 fontes de VOD (SHG, RON, AON, ATB, SPT, BLZ, SPC, ATO, KKT, RTD, DGO, VZR) e 3 de TV (EMB, ETC, REI), com **ffmpeg contando FRAMES DECODIFICADOS** (nao "sem erro na stderr" — TV ao vivo sempre dá aviso de PPS e o player abre assim mesmo).

**O que a auditoria achou (e o que foi corrigido):**
- **Link de VOD morria no player's mão — o cache servia o que já não existia (decisão 119).** A assinatura do SPT (`vid7...hclod.qzz.io/...?md5=&expires=`) vale **15 minutos**, exatamente o TTL do cache de stream (15min). Com a checagem antiga (`hasExpiredSignedUrl`, 30s de folga) o cache guardava o link e o devolvia "valendo" por quase 15min — e o player levava **`410 Gone`**. Pior: a assinatura via **dentro de base64** (o relay `/relay/m/<b64>` e a cifra `/p/<token>.mp4`), então a checagem nem via o `expires=`. Agora `hasExpiredSignedUrl` **decodifica o base64** e a folga é de **5min** — `test/link-vencido.test.js` tranca os 7 casos. Sintoma medido antes: SPT caindo de 3/3 para 0/3 em auditarias seguidas, por causa do cache.
- **O VOD respondia bem e por isso as fontes pareciam vivas; era o cache que dava link morto.** Depois da correção: **9/9 fontes de VOD** nos 6 filmes + 5 séries + 5 animes que têm fonte, com **128 streams e ZERO sem `sources`**.

**O que é externo e foi medido (não é bug de código):**
| fonte | o que acontece | quem é o culpado |
|---|---|---|
| **DGO** (doramas) | o site está **fora do ar**: `www.doramago.net` responde **HTTP 530 / erro 1016 do Cloudflare deles** (erro de origem) em `/`, `/search/` e `/series`; a origem `ondemand.madfirebox.shop` dá **403**. O scraper **já usa o layout novo** (`/series/<slug>/temporada-N/episodio-NN` + `urlConfig`), então não é layout nem código nosso. | eles (site fora do ar). Levanta sozinho quando o Cloudflare deles voltar. |
| **VZR** em série | a cadeia `nixplay → hubby-dmca → www-fontedecais` termina em **403** no 3º host (medido com 3 UAs, 2 esquemas). Em **filme** a cadeia para no R2 e funciona. | o 3º host deles. |
| **SHG** | 20 dos 28 títulos caem no host bom (`nsrv.classotaku.app` = 200); **3 caem no `gigaclass.top`, que dá 403 sempre** | eles roteiam parte do catálogo para host morto. |
| ~~**RON**~~ | **RESOLVIDO — era NOSSO, não do site.** O vídeo saía em `cdn-s01.mywallpaper-4k-image.net/…/*.mp4/index.m3u8` e esse host não estava na lista de permissões do worker: `/relay/m/` respondia `host not allowed` (o episódio aparecia, a lista abria, o vídeo não). A origem estava viva o tempo todo. Allowlist corrigida e **worker publicado** em 29/09/2026; One Piece foi de 0 para tocar. | nós (allowlist), corrigido. |
| **RTD** | 0 de 3 (o `play-link` exige token Turnstile, que não temos) | já documentado desde a decisão 38. |
| **KKT** | 1 de 3 (o painel entrega, mas o `iptv.db` local da prod está vazio — o db é gitignored) | é infra, não fonte. |
| **ATB** | 1 de 3 títulos (a fonte só tem o que o `anitube.biz` indexa) | cobertura da fonte. |

**TV: 10/10 canais tocam com as 3 fontes.** `globorj`, `recordsp`, `cnnbrasil`, `hbofamily`, `globosp`, `bandnews` → `[emb, etc, rei]`; `sbt` → REI; `espn` → ETC+REI. E o catálogo tem 267-280 canais com o guia de 129 canais com programa.

**Fluxo do usuário (o caminho real, em produção):** manifesto → catálogo → abre canal (Toca, 600 frames) → busca filme (20 resultados) → `/meta` (Matrix, ok) → streams (9 links) → **toca (480 frames)** → replay vem do **mesmo link do cache** e **toca de novo**. **Sem erro em nenhum passo.**

**Barreira: 138 testes** (era 122; +9 de cache, +7 de link-vencido).

**Não resolvível (medido, não é bug de código):**
- **BLZ/SPC ainda são o maior custo da chamada fria** (8s com o teto), porque o probe de MP4 é o trabalho pesado; o teto limita, não elimina.
- ~~**Qualidade `unknown` em RTD/ATB/DGO**~~ → **RESOLVIDO na decisão 36** (o `video-probe` lê a resolução do bitstream; agora sai 0 stream sem qualidade em ATB/DGO). **O RTD fica `unknown` em produção por decisão do dono (decisão 38) — não é pendência, não tentar de novo.**
- **Disfarce além da rotação de UA** (headers por fonte, pacing, cookies) continua não implementado.

## Motor de extração universal (`src/lib/extrator.js` + `src/lib/html.js`) — 29/09/2026

O dono pediu um scraper que funcione em qualquer site. **Feito como motor de extração, não como scraper único** — e a distinção importa (ver "Por que NÃO virou um scraper só", abaixo).

**O mapa que motivou:** 16 scrapers, **13 padrões de extração duplicados** (achar `.m3u8` em qualquer HTML ×3, pegar `iframe` ×4, objeto JS embutido ×3, desobfuscar ×2, "tentar o próximo host" ×5, validar `#EXTM3U` ×5, "provar vida" ×6, "2 variantes sem Referer" ×6, `videohls.php?d=` ×2, fetch que segue redirect ×4, URL por template ×5). E uma descoberta: **`src/lib/url-resolver.js` (384 linhas, 15 tipos de site de vídeo) não era usado por NENHUM scraper** — só por uma rota de API. 384 linhas órfãs.

**Duas bibliotecas, zero dependência nova** (`cheerio`/`linkedom` recusados: o projeto tem 5 deps e nenhuma é leve):

| arquivo | o que faz | medido |
|---|---|---|
| `src/lib/html.js` | interpretador de HTML tolerante (tag sem fechar, atributo sem aspas, classe trocada, acento em entidade, script com `<div>` dentro) + seletor (`tag`, `.classe`, `#id`, `[attr=v]`, `*=`, `^=`, `$=`, descendente, `>`) | 258KB em **77ms**, 12/12 testes |
| `src/lib/extrator.js` | o motor: 6 técnicas, todas medidas em uso real | 4/4 fontes reais |

**As 6 técnicas (cada uma com o site que a provou):**
1. **Coletar e ranquear** em vez de "achar o primeiro" — a página tem logo, capa, preview, trailer e anúncio antes do vídeo; pegar o primeiro é o que entregava trailer.
2. **Scanner de objeto JavaScript embutido** (`literal`/`literalEm`) — fecha o `{`/`[` certo **ignorando aspas**; lê objeto sem aspas (`{file:"x"}`, JSON inválido) e com comentário dentro. Substitui 2 implementações duplicadas (AON e REI).
3. **Página seguinte por qualquer atributo**, não só `<iframe>` — o REI não usa iframe no 1º salto (é `src="…/__play/…"` em elemento qualquer).
4. **`?d=<a url>`** — vídeo escondido dentro de outra URL (mesmo provedor no ATB e no RON, 2 códigos).
5. **Chave de configuração vale sem extensão** — o REI entrega a playlist como `__index.txt` (é `text/plain`); só a chave `"src"` do objeto diz que é vídeo. **E `src` como *atributo* NÃO conta** (senão o motor aceitava a página `/__play` como se fosse vídeo — falso positivo medido).
6. **`ref`**: o player entrega um *endereço para buscar*, não a URL — `{"src":"", "ref":"/NP…/PV0…"}` e só aparece depois de um POST. Custa 1 salto.

**4 defeitos que só apareceram porque o teste é contra site real** (todos medidos, todos nosso):
- `https:\/\/host\/…` — **barra escapada**: qualquer regex que procure `https://` não acha nada. Era o defeito do SPT.
- `&amp;` no meio da query (REI) — sem desfazer, a query chega errada e o site responde **404**, que parece "fonte morta".
- `<meta content="width=device-width…">` virava URL (`https://host/movie/width=device-width…`) e a cadeia caçava lixo antes da página certa.
- `<iframe src="about:blank">` gerava `ECONNREFUSED 127.0.0.1:80` — erro que não diz nada sobre o site.

**Descoberta vs. entrega (separado, e isso é o ponto):** o motor descobre a URL; **como ela é entregue** é outra decisão. Medido: a playlist do REI em `.txt`/`text/plain` **não toca** crua (`Invalid data found`) e precisa do relay `/stream/hls/rei:` servindo `application/vnd.apple.mpegurl` — que o `server.js` já faz. Trocar o motor **não** troca a entrega.

**Medido depois de converter (produção, `21b3b52`):**

| fonte | antes | depois |
|---|---|---|
| RON | 4/8 títulos, 4/4 tocam | **5/8, 5/5 tocam** |
| AON | 4/8 | 5/8 |
| ATB | 3/8 | 4/8 |
| FMA Brotherhood | **1 link** | **4 links** |
| SPT (Breaking Bad) | 4217ms | **512ms** |

Fluxo do usuário completo sem erro: manifesto → catálogo (**281 canais**) → canal [emb,etc,rei] → **PLAY 600 frames** → busca (20) → `/meta` → 9 links → **PLAY 480 frames** → replay do **mesmo link do cache** (229ms) → **PLAY 480 frames**. TV 9/10 canais, 132 streams, 0 sem `sources`. **162 testes** (era 138; +24 do motor).

**Por que NÃO virou um scraper único (resposta ao dono, medida):** as 11 fontes rodam **em paralelo**, então o tempo do pedido é o da fonte **mais lenta**, não a soma — juntar o arquivo não muda quantas requisições saem (continuam 11). E o custo é concreto: hoje `/health` diz **RON 3/3 · SHG 5/6 (1 vai pra host morto deles)**, e foi essa tabela que provou que o RON era defeito nosso. Um bloco só = um número só = perdemos a prova de *qual* fonte quebrou.

**O que faz a API ficar mais rápido (e o dono adiou, decisão de 29/09):** (a) lembrar quais fontes têm quais títulos e parar de perguntar às que nunca tiveram (corta o leque de 11 para 3-4); (b) sair mais cedo quando já achou 1080p dublado (troca velocidade por cobertura — vai contra a regra "fonte que não toca não entra"). Nada disso foi feito.

**Pendência real que sobrou:** a entrega da TV ainda tem 3 ramos em `ROTAS.hls` (`etc:`, `rei:`, resto) no `server.js:2253/2278/2293` — dá para virar **uma tabela**, que é a unificação que tem valor lá. Não foi feito (risco alto em rota que entrega 9/10 canais).

## Tela branca + barulho ensurdecedor em filme (29/09/2026) — era CODEC

O dono reportou que as fontes de painel (BLZ/SPC/ATO) davam **tela branca e barulho ensurdecedor**
"do nada". **Medido: 3 de 23 arquivos eram H.265 (HEVC).** Celular e TV que nao decodificam H.265
mostram a tela branca e continuam tocando **so o audio** — e o audio reinterpretado na taxa errada
e o barulho. Nao era painel quebrado, nem player, nem link morto (os mesmos arquivos davam 288
frames no ffmpeg do servidor, que tem o codec).

**Correcao, com custo zero:** a sonda do painel (`probeOnce`) ja baixava 256KB do comeco do arquivo
para ler a duracao (`mvhd`); o `stsd`, que diz o codec, esta na mesma regiao. O novo
`src/lib/mp4-codec.js` le os dois do **mesmo buffer** — nenhuma requisicao a mais. Medido no
arquivo real de 1,3GB do kakito: `{"codec":"h264","tag":"avc1"}`.

Foi preciso um recurso novo no `browserFetch` (`peekBytes`): o kakito **ignora `Range`** e responde
200 com o arquivo inteiro, entao a sonda nunca conseguia cabecalho nos arquivos grandes. Com o
peek, le 256KB e desliga a conexao. Medido: 261.860 bytes lidos de um arquivo de 1,3GB.

**A regra** (`applyProbeFilters` no `xtream.js`): havendo **um** H.264 na lista, e ele que fica
(H.265, VP9 e AV1 saem). Se **todos** forem de codec fechado, todos ficam — aparelho novo
decodifica, e melhor um link que funciona na maioria do que nenhum link. Codec desconhecido nao e
letrao (seria condenar sem prova).

**Medido depois:** **0 de 31** links de painel em H.265 (era 3 de 23).

**A segunda causa, AINDA ABERTA:** 2 de 23 respostas de faixa vieram **200 em vez de 206** (a
origem ignora `Range` e devolve o arquivo inteiro). O player que busca/inicia recebe 1,3GB em vez
do trecho e trava. O conserto e o worker cortar a faixa ele mesmo quando a origem ignora — nao foi
feito ainda (exige mexer no `/p/` do worker).

## "Toca, passa uns minutos, tela branca e uns barulhos" (29/09/2026) — era FAIXA (Range)

O dono detalhou o defeito de VOD: o filme comeca, **passa uns minutos e a tela fica branca com
barulhos e para**; **pular para uma minutagem** faz o mesmo; e **copiar o link da stream** e
reproduzir tambem. Esse ultimo detalhe tira o addon da lista: se o link copiado falha, o defeito
esta no link entregue.

**Medido no link entregue:** pedindo **1KB do MEIO** de um filme de 1,3GB, a resposta era **HTTP 200
com o filme inteiro** (`content-range: bytes 0-1329098851/1329098852`). A cadeia do painel e
`kakito.xyz -> voltm.uk?token=…` e o **`voltm.uk` ignora o `Range`** (comportamento DELE, ja
documentado no projeto). O player pede o segundo 20, recebe o filme do zero, perde a sincronia do
container (tela branca) e o audio sai na taxa errada (os barulhos); depois disso ele repete o
pedido, sempre do zero, ate desistir.

**Correcao, no worker (`/p/`), em 29/09/2026:**
1. **O worker corta a faixa sozinho** quando a origem devolve 200: le o corpo, joga fora o que
   esta antes do pedido e entrega so o trecho, com **206** e `Content-Range` de verdade. O total
   vem do `content-length` **ou** do `content-range` da origem (medido: as vezes nao vem
   `content-length`, e ler so ele fazia o corte nao acontecer).
2. **O arquivo inteiro saiu do cache automatico da borda** (`cache-control: no-store` na resposta
   que sai). Medido: a borda guardava o filme inteiro e devolvia ESSA copia para quem pedia uma
   faixa — ou seja, o defeito voltava mesmo com o corte no lugar. O cache continua existindo no
   `caches.default` do proprio worker, entao quem pede o arquivo inteiro continua sendo servido
   sem tocar no painel.
3. **Nunca devolver 206 com corpo vazio**: para entregar 1KB a partir de 500MB o worker teria de
   puxar 500MB so para descartar, e dentro do limite dele nao da (medido: 206 com 0 bytes, que e
   PIOR que devolver o arquivo inteiro). Alem de 32MB do comeco, volta o 200 com o arquivo todo.

**Medido depois:** faixa no comeco devolve 206 com os bytes certos; pular para **30min, 60min e
90min** funciona (antes o de 60min falhava). O cabecalho `x-mirror-faixa` na resposta diz qual
caminho foi usado (`cortada`, `origem-fez`, `pass-through`).

**O QUE NAO DA PARA RESOLVER DA NOSSA PARTE:** pular para bem longe dentro desses arquivos continua
baixando do zero, porque a origem recusa faixa. Quem resolve isso e a origem — ou entregar a mesma
obra em HLS (que tem indice e, portanto, nao depende de faixa). **Candidato a medir:** os paineis
Xtream costuma ter a mesma obra tambem em `.m3u8`/`.ts` (o campo `container_extension` do item).

## Env

**Env do app BeamUp (addon)** — o que vale no container é o **`ENV` do `Dockerfile`** + `PORT` injetada pelo scheduler. `ssh dokku@a.baby-beamup.club config:set c12e41ddc21b-mirror KEY=VAL` aceita **1 variável por chamada**, reporta sucesso e **não reinicia nem injeta** no serviço (mudança só com novo deploy; sem confirmar leitura de config, não é canal de env). O `.env` do repo é só p/ dev local (o `Dockerfile` nem o copia — `.dockerignore` exclui):

| Var | Valor |
|---|---|
| `PUBLIC_BASE_URL` | `https://c12e41ddc21b-mirror.baby-beamup.club` ← **CRÍTICA** — fixada no `Dockerfile` |
| `VIDEO_BASE_URL` | `https://c12e41ddc21b-mirror2.baby-beamup.club` no `Dockerfile` — split round-robin do vídeo ATO entre app1/app2; vazio = sem split (decisão 29) |
| `SCRAPER_TIMEOUT_MS` | `9000` no `Dockerfile` (gateway 504 em ~12s); código default `20000` |
| `PORT` | injetada pelo Dokku (ex.: 6009) — nunca setar à mão |
| `NODE_ENV` / `DATA_DIR` / `NODE_OPTIONS` | `ENV` do `Dockerfile` (`production` / `/tmp` / `--max-old-space-size=350`) |
| `TMDB_API_KEY` / `IPTV_*` / `CDN_PROXY` | **não precisa setar** — defaults no código |
| `REDIS_URL` / `ADMIN_TOKEN` | opcionais |
| `RELAY_BASE_URL` | opcional; **ignorado no addon** (relay usa Host por padrão) |

`PUBLIC_BASE_URL` vira `runtimeBase` → todas as URLs absolutas (streams `/stream/hls`, proxy). **Vazio = auto-detecta o Host do request, com guard: só deriva se o Host parecer domínio real (rejeita `localhost`/IP — senão o healthcheck do Dokku envenenaria o `runtimeBase`); valor antigo (domínio morto) = URLs quebradas.** No container: `DATA_DIR=/tmp` (efêmero — `iptv.db`/`cache.db` recriados a cada boot) e `NODE_OPTIONS=--max-old-space-size=350` via `ENV` do `Dockerfile` (o `.env` setado pós-boot seria inefetivo).

`.env` (rastreado; dev local: `PUBLIC_BASE_URL=http://localhost:7000`, `PORT=7000`) e `ecosystem.config.js` (PM2 legado; `PUBLIC_BASE_URL: ""` = auto-detect). Use shell `grep` em auditorias de env (grep padrão pula gitignored).

## Comandos

```bash
node --test test/                                    # barreira: 259 (o CI exige ≥254)
node e2e-flow.js                                     # E2E fluxo do user (server de pé; kill→rm /tmp/cache.db→subir)
node vod-sources.js                                  # todas as fontes VOD uma a uma + probe
node load-test.js                                    # carga (LOAD_BASE/LOAD_TOTAL/LOAD_CONCURRENCY; exige0 erros)
node --check src/server.js                           # sintaxe
# --- plugin Nuvio (nuvio/) ---
cd nuvio && node build.js                            # 15 bundles + manifest.json (falha alto se registro e arquivo divergirem)
cd nuvio && node teste.js aon 30984 tv 1 1           # uma fonte; PROBE=1 prova o link com Range 2KB
cd nuvio && node teste.js etc hbo channel            # fonte de TV
python3 -m http.server 8799 --directory nuvio/public &   # índice estático local (blz/spc/ato)
cd nuvio && MIRROR_INDEX_BASE=http://127.0.0.1:8799 node tools/bateria.js      # as 15, com prova de link
cd nuvio && node tools/bateria-tv.js                 # TV: 16 canais × 4 fontes
cd nuvio && FONTES=rei,emb,etc,rcd node tools/mime.js    # MIME que o player do Nuvio vai inferir
setsid nohup env PUBLIC_BASE_URL=http://localhost:7000 PORT=7000 node src/server.js >> /tmp/mirror.log 2>&1 < /dev/null &   # subir local
kill $(ss -ltnp 'sport = :7000' | grep -oP 'pid=\K[0-9]+' | head -1)   # parar — NUNCA pkill -f "node src/server.js" (mata a shell)
git add -A && git -c user.name="Mirror" -c user.email="mirror@addon.com" commit --amend --no-edit   # alteração entra no ÚNICO commit
git push --force-with-lease novo HEAD:master     # publica no GitHub (repo mrrobots777/mirror)
git push --force-with-lease novo HEAD:gh-pages   # e na branch que o Pages workflow publica
git push beamup HEAD:master --force        # deploy BeamUp (build do Dockerfile) — = beamup deploy
curl -s https://e75602c18409-mirrorhub.baby-beamup.club/health   # saúde do addon em prod
ssh dokku@a.baby-beamup.club logs e75602c18409-mirrorhub -n 50   # logs do app (= beamup logs)
```

## Armadilhas

- Resultado de stream cacheia em `/tmp/cache.db`: **6min cheio / 60s degradado** — persiste entre restarts (apagar o arquivo força frio). **6min < vida da URL assinada do SPT (~10-15min)**: com o TTL antigo de15min o cache devolvia URL já expirada e o play dava **410 Gone** (confirmado em E2E prod). Guard extra: `hasExpiredSignedUrl()` — entrada stale/cached com `expires=` vencido **não é servida** (recompute síncrono + single-flight; antes o SWR devolvia URL morta na 1ª chamada de título frio,2× em E2E prod). E2E local exige o protocolo kill→**`rm /tmp/cache.db`**→subir (cache persiste entre restarts).
- EPG ~1,4s frio / ~30ms quente; catálogo live ~58KB cru → ~7KB gzip.
- Animes: `isLikelyAnime()` decide o pipeline (japonês + keywords); ranking via `rankAnimeStreams`. `scraperQueryList` = só **2 primeiras queries** — se `info.title` duplica em `titles`, a query romaji/extrangeira pode não ser escolhida (ex.: caminho `tt` de AoT); ids numéricos AniList trazem `titles` romaji+inglês nativamente.
- id IMDb errado → cinemeta resolve pra outro título →0 streams em ~3s (ex.: `tt2560388` NÃO é AoT, é filme tcheco; AoT real = `tmdb:1429` ou AniList `16498`). TMDB `/find` com `tv_results:[]` acontece (gap de dado) → cai cinemeta.
- Ao mudar env/domínio: atualizar **`Dockerfile` (env real em prod)** + `.env` + `.env.example` + `ecosystem.config.js` + `DEPLOY.md` + `AGENTS.md`/`CONTEXTO.md` — e novo `git push beamup HEAD:master --force` (o `config:set` do BeamUp não injeta env nem reinicia).
- **BeamUp (armadilhas confirmadas em 23/09/2026)**: scheduler executa **`node /start web`** (sem `beamup-start.js`→`/start` no `Dockerfile` = loop `Cannot find module '/start'` e 504); gateway **504 em ~12s** (request frio de catálogo/meta/stream pode 504 e cacheia em background — repetir); `git ls-remote beamup` → `unsupported command` (só push); `config:set` aceita **1 var/chamada** e não chega ao container (`config:unset` também é unsupported); chaves GitHub só são reconhecidas depois de `beamup config a.baby-beamup.club devavmirror` (`sync-github-keys`). Logs: `ssh dokku@a.baby-beamup.club logs c12e41ddc21b-mirror -n 50` (boot = `[beamup-start] ...` + `[Mirror] listening on :<PORT>`). Deploy mais recente: **`74231cc`** (24/09/2026) — fontes mortas removidas (decisão 27): `iptv-epg.org` fora do `epg.js` (EPG = só XMLTV do kakito, `source-info-name="Kakito"`) + API `popplaydb.vercel.app` `503` fora do PPD (embed `mgeb.top` puro). Anterior: **`cacc150`** — `fetchWithFallback` KGE/DRV (direto → worker `/proxy` → relay BR `/fetch`), probe de filme honesto (400/HTML = morto), `/health`+`/metrics` `no-store` (decisão 26).
- **Rede do BeamUp vs fontes**: `kakito.xyz` **responde do host** hoje (auth:1,14.914 VODs; playlist M3U e EPG XMLTV puxados via relay BR/worker — a origem deles é que flapeia521/404/400); **`iptv-epg.org` foi REMOVIDO (decisão 27)** — dava403 de TODO lugar (egress BR direto com UA Chrome+Referer, worker e relay — `Upstream 403` = fonte bloqueada, **não** geo) → EPG = **só XMLTV do kakito via worker** (200); `getEpgBounded` devolve `[]` em400ms enquanto a fonte não responde (nova tentativa em60s — meta/catálogo respondem sem EPG). **KGE/DRV FORAM REMOVIDAS (decisão 30)**; **AON responde direto do egress DE** e **TOP dá 403 no topanimes do egress DE → cadeia direto→allorigins→wayback** (hosts dos players — blogger/alibaba/googlevideo — respondem direto). SPC/SPT e fontes de anime (SHG/RON) confirmados OK no host. **ATO (`4x4u29c.autos`, decisão 28) bloqueia datacenter BR e vídeo do worker CF (`Upstream 403`) — só egress DE entrega** (playlist/API via worker ok; vídeo embrulhado no `/stream/proxy` da prod). Origin **ignora Range** em faixa fechada pequena (devolve200+arquivo inteiro) — probe/ffprobe do ATO só pela prod; `vod-sources`/`audit` (egress BR) **não servem p/ validar ATO**.
- **`/tmp/iptv.db` local pode corromper** (`database disk image is malformed` → `kkt busca rows=0`, KKT =0 no `vod-sources`; os scripts carregam `dotenv` e forçam `DATA_DIR=/tmp` — `env -u` não resolve): restaurar com server caído `fuser -k 7000/tcp` → `cp iptv.db /tmp/iptv.db` (o do cwd tem199k linhas) → subir de novo (`setsid nohup env PUBLIC_BASE_URL=http://localhost:7000 PORT=7000 node src/server.js >> /tmp/mirror.log 2>&1 &`).

- **CDN do SPC (`/vauth` em `173.208.234.226`) bloqueia por rate-limit por IP**: rajada de requests → nginx devolve **404 para TODOS os ids** (a API do painel continua 200 e o painel ainda manda o 302 — só o CDN recusa) por alguns minutos; causa falsos "links mortos" no probe e invalida validação local feita logo após teste em massa (nunca disparar probes de vários processos em paralelo; em prod é 1 processo com fila 2/host).
- **Edge-cache do Cloudflare (zona BeamUp)**: o CF faz **edge-cache de JSON** (`cf-cache-status` HIT/MISS) e reescreve `Cache-Control` do origin para `max-age=14400` (4h) — resposta de boot antigo ficou **HIT ~70min** (URLs relativas de quando `PUBLIC_BASE_URL` faltava); entrada velha só expira pelo TTL (**não há purge** — a zona não é nossa). Mitigação: `/stream/` responde **`Cache-Control: no-store`** → `cf-cache-status: BYPASS` (validado: 3 pedidos idênticos seguidos BYPASS) — streams nunca congelam na borda; catálogo/meta/manifesto segue cacheáveis (bom p/ capacidade). UA de script (`Python-urllib`) é **bloqueado pelo CF (error 1010)** — testes HTTP precisam de User-Agent de navegador. `/epg.xml` usa `getEpgBounded(1200)` → **503 em ~1,4s** (com `getEpg()` puro estourava o fetch em voo e o gateway dava **504 em 12s**).
- **Meta de id `kitsu:` FUNCIONA** (branch kitsu em `resolveMeta` + `getKitsu` enriquecido com poster/background/sinopse/ano): validado E2E — `kitsu:11` → "Naruto" +220 videos; `meta:null` só se Kitsu API cair (throw→catch→log). Streams kitsu continuam normais.
- **`kakito.xyz` é o único ponto de queda de BLZ+KKT** (mesmo backend): quando o host cai (confirmado22/09/2026 — inacessível da VPS **e** da borda do worker Cloudflare, enquanto cloudflare.com/jsdelivr respondiam), o xtream lança `panel failed: timeout` mantendo as streams SPC via `partialStreams`, e os probes de URL do KKT expiram — SPC/SPT/anime/EMB seguem normais. Se BLZ **e** KKT sumirem juntos, checar `curl -4 https://kakito.xyz/` antes de procurar bug. **Circuit breaker por painel** (`xtream.js`): **2 falhas consecutivas → painel pulado por5min** (`isPanelOpen`/`recordPanelFailure`/`recordPanelSuccess` exportados p/ teste) — sem ele, o `allSettled` de15s do BLZ morto estourava o budget de9s da prod e os `partialStreams` do SPC eram **descartados** (SPC nunca chegava em prod durante o apagão + frio custava ~15s, p95 do load-test); com o breaker aberto o xtream resolve só com SPC em ~2-4s. Painel100% saudável nunca é pulado (contador zera no sucesso).
- **Auditoria E2E de todas as fontes (23/09/2026, `audit-sources.js`,2 rodadas)**: **16/17 casos com stream, probes 23-24/30, ffprobe 8-9/9, match BAD 0**. Status: ✅ SPC/SPT/SHG/RON/KGE/DRV/EMB | ⚠️ BLZ+KKT+EPG (apagão kakito — links KKT mortos), PPD série (mgeb intermitente) + **PPD R2 do provedor deles com `NotEntitled: Please enable R2` (bucket desativado na conta CF deles — upstream, some sozinho quando religarem)**, KGE aceita spinoffs do mesmo prefixo ("Dragon Ball Super"/"Kai" p/ "Dragon Ball"), SPC devolveu503 num episódio (transitório). SPC sobrevive ao timeout do BLZ via `partialStreams`. **Anime na prod voltou a resolver** (AniList 429 passou — e2e prod `streams Naruto E3` OK).
- `/catalog/<type>/<id>` de id não registrado → **200 `{"metas":[]}`** (SDK) — inofensivo, o id não consta no manifesto.
- Fluxo completo de streams, formato do objeto stream e tabela de fontes: `AGENTS.md`.
- ids IMDb usados em testes antigos podem estar errados (ex.: It 2017 = `tt1396484`/`tmdb:346364`; `tt0795176` não existe no TMDB) — validar id antes de concluir "0 streams = bug".

---

**NGINX NA FRENTE DO PAINEL, SERVINDO DE CDN (decisao 107)** — o dono apontou que o addon **FrostView** poe um nginx na frente do painel e pediu para aplicar a mesma coisa. Montado: `deploy/nginx-kak.conf`, rodando **na propria caixa BR** (`144.33.21.1`), **na porta 8443, na frente do relay** — o relay desceu para `8444` e o nginx o repassa. Nao abriu porta nova (a 8443 ja estava liberada e nao depende da Oracle security list).

**O QUE O NGINX FAZ, E POR QUE CADA PEÇA EXISTE** (o limite do painel e medido: `1->1/1, 2->2/2, 3->2/3` com 403 em 545ms, `4->1/4`; e **de CONCORRENCIA**, nao de vazao — a origem entrega 26 Mbps):

1. **`proxy_cache_lock on` — a peca que mais importa.** Quando N pessoas pedem o mesmo segmento novo, so o **primeiro** vai ao painel; os outros esperam e leem do disco. **MEDIDO: 6 pessoas no mesmo canal, no mesmo instante -> 1 ida a origem, 5 do disco, 6/6 com video em 1 s** (2,52-4,64 MB cada, `sync 0x47`). Antes eram 6 idas a origem.
2. **`keepalive 4` no upstream** — o painel ve poucas conexoes vivas, nunca uma por pedido e nunca uma **rajada** (que e o formato que mais desperta o limitador).
3. **Cache em disco** 12 GB, `inactive 15m` — um canal novo a cada ~10s, entao o cache roda em ciclo e guarda os canais quentes, nao os 733.

**A CHAVE DE CACHE TIRA O TOKEN — O DETALHE QUE FAZ ISSO FUNCIONAR**: o endereco do segmento traz o token DENTRO do caminho (`/hlsr/<token>/MirrorPrincipal/ditj7j1h/<canal>/<md5>/<canal>_<n>.ts`) e o token gira. Se a chave fosse o endereco inteiro, cada rotacao zeraria o cache. A chave e so a parte de tras do token (`/MirrorPrincipal/...`), que tem o **md5 do conteudo** e nunca muda. **MEDIDO: o mesmo arquivo com um token FALSO na URL respondeu `HIT` em 41 ms, sem tocar no painel.**

**MEDIDO, CONFIGURACAO**:
- 1a vez: `MISS` **2134 ms**, 3,18 MB, `sync 0x47`; 2a vez: `HIT` **36 ms**.
- **SEM `slice` de proposito**: com fatia de 1 MB o nginx pedia o arquivo a origem **uma vez por fatia** (3 pedidos para 2,88 MB) e devolvia 200 inteiro para um Range. Contra um painel de 2 conexoes, 3 pedidos por arquivo e o pior formato possivel. Cacheando o arquivo inteiro: **uma** ida a origem.
- **`Range` devolve 200 inteiro, e nao 206** — porque **a ORIGEM ignora `Range`** (ja registrado antes: devolve o arquivo inteiro). Nao e defeito da configuracao.
- **`403`/`404` NAO sao guardados em cache.** Eu tinha `proxy_cache_valid 404 403 5s` e isso foi um erro: o painel recusa de forma momentanea, guardar a recusa transformava um tropeco em estado grudento — apareceu `X-Mirror-Cache: STALE` devolvendo 403, o nginx servindo um erro guardado enquanto a origem ja tinha se recuperado. Agora so `200` entra.
- **`/cdn/` e proxy restrito**: so aceita `/cdn/hlsr/<token>/MirrorPrincipal/...` (o mesmo caminho do `ALVO_KAK` do app) e qualquer outra coisa sob `/cdn/` devolve **403** — testado com `/cdn/player_api.php?action=get_live_streams` -> 403. Sem isso a caixa virava proxy aberto para o painel.

**LIGADO NO APP** (`src/routes/segmentos.js`): `buscaKak` vai na CDN primeiro (`KAKITO_CDN_URL`, default `http://144.33.21.1:8443/cdn`) e so cai no painel quando ela nao tem o arquivo. Dois detalhes: (1) o `segCache.pega` exige que a busca devolva um **Buffer**, entao a origem do pedaco (`cdn` ou `painel`) fica num contador e nao dentro do valor — mudar isso quebraria o `server.js:1671`; (2) se a CDN falhar, ela fica **fora por 1 min** (`cdnForaAte`) em vez de pagar o tempo de espera em cada pedaco. **A lista nao precisou de codigo**: o relay agora esta atras do nginx, entao `GET /pl/:id` ja passa pelo cache de 2 s de graca. `/health -> capacity.cdnKak` mostra `{cdn, cdnCache:{HIT,MISS}, painel, falhasCdn}`.

**BUG QUE EU COMMETI NESTA**: comecei `cdnBoaAte = 0` e testava `Date.now() > cdnBoaAte`, o que deixava a CDN **DESLIGADA desde o primeiro instante** — a contagem mostrava `cdn: 0, painel: 1` com a CDN de pe no ar. O sentido certo e `cdnForaAte` (ate quando ela esta fora), comecando em 0 = ligada. Vale a pena ver a contagem depois de ligar qualquer caminho novo: ela foi o que denunciou.

**O QUE ISSO NAO RESOLVE, e o dono tem de saber**: **nao aumenta quantos canais DIFERENTES o painel entrega ao mesmo tempo.** Isso e a banda da origem (26 Mbps) e o teto de 2 conexoes, e nenhum servidor web muda. MEDIDO: 8 canais diferentes em paralelo -> 3 com 403 e 4 sem lista; **em serie, 10 canais -> 0/10** (embora o teste esteja contaminado pela varredura de verificacao, que ainda competes pelo painel). O que muda e **quantas vezes a origem e chamada**: de uma por espectador para uma por canal a cada 10 s. E o minimo fisico possivel.
