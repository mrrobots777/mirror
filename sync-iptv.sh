#!/bin/bash
# sync-iptv.sh — Sincroniza iptv.db entre VPSs
# Uso: ./sync-iptv.sh <ip-do-servidor-fonte>
# Executar em TODOS os VPSs periodicamente (cron)

set -e

SOURCE_IP="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DB="$SCRIPT_DIR/iptv.db"
BACKUP_DB="$SCRIPT_DIR/iptv.db.bak"
LOCK_FILE="/tmp/mirror-iptv-sync.lock"

if [ -z "$SOURCE_IP" ]; then
    echo "Uso: $0 <ip-do-servidor-fonte>"
    echo "Exemplo: $0 192.168.1.100"
    echo ""
    echo "O IP deve ser o de um VPS que já tenha o iptv.db atualizado."
    exit 1
fi

# Lock para evitar syncs simultâneos
exec 200>"$LOCK_FILE"
flock -n 200 || { echo "Sync já em andamento. Saindo."; exit 0; }

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando sync IPTV de $SOURCE_IP..."

# Backup antes de sobrescrever
if [ -f "$TARGET_DB" ]; then
    cp "$TARGET_DB" "$BACKUP_DB"
fi

# Copiar via SCP
if scp -o ConnectTimeout=10 -o StrictHostKeyChecking=no \
    "suporte@${SOURCE_IP}:Downloads/mirror/iptv.db" "$TARGET_DB.tmp" 2>/dev/null; then
    mv "$TARGET_DB.tmp" "$TARGET_DB"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Sync concluído: $(sqlite3 "$TARGET_DB" 'SELECT COUNT(*) FROM channels') canais"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERRO: Falha ao copiar de $SOURCE_IP"
    [ -f "$BACKUP_DB" ] && mv "$BACKUP_DB" "$TARGET_DB"
    exit 1
fi

# Reiniciar addon para recarregar banco
pm2 reload mirror --silent 2>/dev/null || true

# Limpar backup antigo
rm -f "$BACKUP_DB"
