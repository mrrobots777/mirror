# Mirror — Deploy BeamUp (Dokku)

## Fluxo

```
GitHub (devavmirror/mirror, main) → beamup CLI/dashboard → build (Dockerfile) → Dokku (PORT injetada) → https://<app>.<domínio>
```

## Passo a passo

### 1. Chave SSH (uma vez, na VPS)

```bash
ssh-keygen -t rsa -b 4096 -C "dev.avmirror@protonmail.com"
cat ~/.ssh/id_rsa.pub
# cadastrar no GitHub (conta devavmirror) via CLI:
gh auth login                    # precisa do scope admin:public_key
gh ssh-key add ~/.ssh/id_rsa.pub -t mirror-workstation
```

### 2. CLI + sincronização das chaves

```bash
npm install -g beamup-cli
beamup config a.baby-beamup.club devavmirror   # registra host/usuário e roda sync-github-keys no dokku
```

Sem este passo o push falha com `dokku@... Permission denied (publickey)` — o servidor só aceita chaves que constam no GitHub do usuário e **não sincroniza sozinho** ao adicionar uma chave nova.

### 3. Criar o app

O app nasce no **1º push** (`INFO: Validating app name...`). Repo remoto `c12e41ddc21b/mirror`, app `c12e41ddc21b-mirror`. `git ls-remote beamup` devolve `unsupported command` (o dokku bloqueia fetch; só `git push`/receive-pack).

### 4. Env (fixada no Dockerfile)

`ssh dokku@a.baby-beamup.club config:set c12e41ddc21b-mirror KEY=VALUE` aceita **uma variável por chamada**, reporta sucesso e **não reinicia nem injeta** no serviço — na prática a env que vale é a do `Dockerfile` (+ `PORT` injetada pelo scheduler, ex.: 6009). Por isso `PUBLIC_BASE_URL` e `SCRAPER_TIMEOUT_MS` são `ENV` do `Dockerfile`; mudanças de env exigem **novo deploy**.

### 5. Deploy + verificação

```bash
git push beamup HEAD:master --force        # build a partir do Dockerfile (= beamup deploy)
git push --force-with-lease origin main    # só publica no GitHub
curl https://c12e41ddc21b-mirror.baby-beamup.club/health
ssh dokku@a.baby-beamup.club logs c12e41ddc21b-mirror -n 50   # = beamup logs
```

O push mostra o build (`-----> Building c12e41ddc21b-mirror from Dockerfile`), os healthchecks do Dokku (port listening + uptime 10s), o `beamup-lint` (valida o manifesto Stremio) e `=====> Application deployed`. Logs de boot esperados: `[beamup-start] argv=["/start","web"] ...` e `[Mirror] listening on :<PORT>`.

## O que já está resolvido no código

| Item | Estado |
|------|--------|
| Porta | `process.env.PORT \|\| 3000`, bind `0.0.0.0` (Dokku injeta a porta — ex.: 6009) |
| Start | **Scheduler BeamUp executa `node /start web`** → `beamup-start.js` copiado para `/start` pelo `Dockerfile` (`COPY`+`chmod`); sem ele: loop `Cannot find module '/start'`. `package.json` → `npm start` (fallback herokuish, `Procfile`) |
| SIGTERM | shutdown com drain: para de aceitar conexões, drena as em voo (cap 60s) e fecha o SQLite antes de sair |
| Memória | `ENV NODE_OPTIONS=--max-old-space-size=350` + cleanup periódico (evict de cache/heap a cada 60s) |
| Dados | `DATA_DIR=/tmp` (efêmero; `USER node` só escreve em `/tmp`) |
| Credenciais | IPTV/TMDB/worker têm default no código — **nenhum segredo no repo/ imagem** |
| Health | `/health` — usado como check do BeamUp/Dokku |
| Auto-base | `ENV PUBLIC_BASE_URL` no `Dockerfile` ← **obrigatório no BeamUp**: o gateway reescreve `Host` (localhost), o guard do auto-detect rejeita e sem base as URLs saem relativas (`/stream/hls/...`) quebrando TV ao vivo. Em outros hosts o auto-detect (guard rejeita `localhost`/IP) continua válido |
| Timeout | Gateway/Cloudflare **504 em ~12s** → `ENV SCRAPER_TIMEOUT_MS=9000` (default do código 20s). Request frio de catálogo/meta/stream pode 504 e cacheia em background |
| Headless flags | **N/A** — o projeto não usa browser (scrapers HTTP). Se adicionar Playwright/Puppeteer: `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu` |

## Env vars — addon

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `PUBLIC_BASE_URL` | **Sim** | URL pública HTTPS do app BeamUp |
| `PORT` | Automática | Injetada pelo Dokku — não setar à mão |
| `TMDB_API_KEY` | Não | Default no código |
| `IPTV_USERNAME` / `IPTV_PASSWORD` / `IPTV_SERVER` / `IPTV_PORT` | Não | Defaults no código (Kakito) |
| `CDN_PROXY` | Não | Worker Cloudflare (default no código) |
| `REDIS_URL` / `ADMIN_TOKEN` | Não | Cache compartilhado / admin |
| `RELAY_BASE_URL` | Não | Relay opcional (ignorado no addon: o relay usa Host por padrão) |
| `DATA_DIR` | Não | Já fixado em `/tmp` no `Dockerfile` |

## Relay (opcional — 2º app)

`Dockerfile.relay` + `relay-server.js`, mesmo padrão (PORT injetada, `USER node`, SIGTERM com drain, `/health`). No addon: `RELAY_BASE_URL=https://<relay>.<dominio-beamup>`. Sem relay o addon funciona — o fallback de M3U8 é o worker Cloudflare (`CDN_PROXY`).

## Legado (não usar em prod)

- `render.yaml` / `render-addon.yaml` — config antiga (Render/belmo); setam `PORT=7000/7100` explicitamente, compatíveis com o código.
- `deploy.sh` / `relay-deploy.sh` + `ecosystem*.config.js` — PM2 em VPS (`PUBLIC_BASE_URL: ""` = auto-detect do domínio).
- Execução manual do relay: `PORT=7100 node relay-server.js` (sem env, o fallback é `3000`).
