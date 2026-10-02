#!/bin/bash
set -e

INSTALL_DIR="/home/suporte/mirror"
NODE_MIN_VERSION=20
REPO_URL="https://github.com/devavmirror/mirror.git"

echo "=== Mirror Relay Deploy ==="
echo ""

echo "[1/6] Verificando Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo "  OK: $(node -v)"

echo "[2/6] Verificando PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi
echo "  OK: $(pm2 -v)"

echo "[3/6] Obtendo código..."
if [ -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || echo "  git pull falhou, usando código local"
else
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

echo "[4/6] Instalando dependências..."
npm install --production

echo "[5/6] Verificando relay-server.js..."
if [ ! -f "relay-server.js" ]; then
    echo "  ERRO: relay-server.js não encontrado!"
    exit 1
fi

echo "[6/6] Iniciando relay com PM2..."
pm2 delete mirror-relay 2>/dev/null || true
pm2 start relay-ecosystem.config.js
pm2 save

echo ""
echo "Configurando auto-start no boot..."
pm2 startup 2>/dev/null || true

echo ""
echo "=== Relay Deploy concluído! ==="
echo ""
echo "Status:"
pm2 status
echo ""
echo "Health: curl http://localhost:7100/health"
echo "IP deste servidor: $(curl -s ifconfig.me 2>/dev/null || echo 'não detectado')"
echo ""
echo "Na VPS principal, defina no .env:"
echo "  RELAY_BASE_URL=http://<IP_DESTA_VPS>:7100"
