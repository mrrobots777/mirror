#!/bin/bash
# deploy-workers.sh — publica UM WORKER POR FONTE (decisao 124).
#
# A lista NAO esta escrita aqui: sai do registro unico (`src/core/nomes.js`, `WORKERS`), que
# e a mesma fonte que o servidor usa para escolher o worker de cada fonte. Assim nao existe
# worker publicado que o addon nao use, nem worker usado que nao foi publicado.
#
#   ./deploy-workers.sh            # publica todos
#   ./deploy-workers.sh rtd        # so o worker de uma fonte
#
# Credencial: `CLOUDFLARE_API_TOKEN` no ambiente, ou o arquivo `~/.cloudflare-token`.
# O token tem que ser de CONTA (o `/user/tokens/verify` diz "Invalid API Token" para token
# de conta, mesmo com o token bom — quem vale e `GET /client/v4/accounts`).
set -uo pipefail

cd "$(dirname "$0")" || exit 1

NODE=${WORKER_NODE:-/tmp/node-v22.14.0-linux-arm64/bin/node}
WR=$(ls -d "$HOME"/.npm/_npx/*/node_modules/wrangler/bin/wrangler.js 2>/dev/null | head -1)
MAIN=worker-simple.js
DATA=2024-01-01

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  [ -f "$HOME/.cloudflare-token" ] || {
    echo "sem credencial: export CLOUDFLARE_API_TOKEN=... ou grave em ~/.cloudflare-token"
    exit 1
  }
  CLOUDFLARE_API_TOKEN=$(cat "$HOME/.cloudflare-token")
  export CLOUDFLARE_API_TOKEN
fi
[ -x "$NODE" ] || NODE=$(command -v node)
[ -f "$WR" ] || { echo "wrangler nao encontrado (npx wrangler, uma vez, cria o cache)"; exit 1; }

soUm="${1:-}"
falhas=0
publicados=0

lista=$("$NODE" -e '
const { WORKERS } = require("./src/core/nomes");
for (const [chave, nome] of Object.entries(WORKERS)) console.log(chave + " " + nome);
')

while read -r chave nome; do
  [ -n "$chave" ] || continue
  if [ -n "$soUm" ] && [ "$soUm" != "$chave" ]; then continue; fi
  # O `main` do wrangler e resolvido a partir do diretorio do config, entao o config
  # temporario tem que ficar AO LADO do codigo (em /tmp ele nao acha worker-simple.js).
  cfg="$PWD/.wrangler-$chave.toml"
  {
    echo "name = \"$nome\""
    echo "main = \"$MAIN\""
    echo "compatibility_date = \"$DATA\""
    # So o RTD recebe Smart Placement: ele e o unico que so responde do Brasil, e o
    # aquecimento em `aqueceParaRtd` (worker-simple.js) e o que da o sinal de 2 subrequests
    # para o MESMO destino que a Cloudflare exige para reposicionar o worker.
    if [ "$chave" = "rtd" ]; then
      # REGIAO FIXA, e nao `mode = "smart"` (decisao 152). O AGENTS ja dizia que o smart placement
      # "e aceito e gravado, mas nao se aplica nesta conta" — e isso importava, porque sem saber de
      # onde o worker sai nenhuma medicao de 403 valia. MEDIDO 01/10/2026 com a regiao forcada em
      # `aws:sa-east-1`: as origens que barram IP de datacenter continuam barrando. Ou seja, o 403
      # nao e de geografia — o proxy em Worker nao resolve. Ver AGENTS, decisao 152.
      echo ""
      echo "[placement]"
      echo "mode = \"smart\""
      echo "region = \"aws:sa-east-1\""
    fi
  } > "$cfg"
  echo "=== publicando $nome (fonte $chave) ==="
  "$NODE" "$WR" deploy -c "$cfg" > "/tmp/deploy-$chave.log" 2>&1
  if grep -q "Current Version ID" "/tmp/deploy-$chave.log"; then
    grep -E "^\s+https://" "/tmp/deploy-$chave.log" | head -1
    publicados=$((publicados + 1))
  else
    falhas=$((falhas + 1))
    echo "    FALHOU: $nome"
    tail -4 "/tmp/deploy-$chave.log"
  fi
  rm -f "$cfg"
done <<< "$lista"

echo
echo "publicados: $publicados | falhas: $falhas"
[ "$falhas" -eq 0 ] || exit 1
