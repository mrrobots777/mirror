#!/bin/bash
set -e

REPO_URL="https://github.com/devavmirror/mirror.git"
INSTALL_DIR="/home/suporte/mirror"
NODE_MIN_VERSION=20

echo "=== Mirror Deploy ==="
echo ""

# 1. Verificar Node.js
echo "[1/7] Verificando Node.js..."
if ! command -v node &> /dev/null; then
    echo "  Node.js não encontrado. Instalando..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt "$NODE_MIN_VERSION" ]; then
    echo "  ERRO: Node.js >= $NODE_MIN_VERSION necessário. Versão atual: $(node -v)"
    exit 1
fi
echo "  OK: $(node -v)"

# 2. Verificar PM2
echo "[2/7] Verificando PM2..."
if ! command -v pm2 &> /dev/null; then
    echo "  PM2 não encontrado. Instalando..."
    sudo npm install -g pm2
fi
echo "  OK: $(pm2 -v)"

# 3. Clonar ou atualizar repo
echo "[3/7] Obtendo código..."
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "  Repo existente. Atualizando..."
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || echo "  Aviso: git pull falhou, usando código local"
else
    echo "  Clonando repo..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 4. Instalar dependências
echo "[4/7] Instalando dependências..."
npm ci

# 5. Verificar .env
echo "[5/7] Verificando configuração..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "  Arquivo .env criado a partir do .env.example"
        echo "  >>> EDITE O .env COM AS CONFIGURAÇÕES DO SEU SERVIDOR <<<"
    else
        echo "  Criando .env padrão..."
        cat > .env << 'ENVEOF'
PORT=7000
# PUBLIC_BASE_URL=https://mirror.seudominio.com
# TMDB_API_KEY=sua_chave_aqui
# IPTV_SERVER=seu_servidor_iptv
# IPTV_USERNAME=seu_usuario
# IPTV_PASSWORD=sua_senha
ENVEOF
        echo "  Arquivo .env criado. EDITE COM AS CONFIGURAÇÕES."
    fi
fi

# 6. Verificar iptv.db
echo "[6/7] Verificando banco IPTV..."
if [ ! -f "iptv.db" ]; then
    echo "  AVISO: iptv.db não encontrado!"
    echo "  O addon vai funcionar sem IPTV até o banco ser criado."
    echo "  Execute: node src/scrapers/kakito.js --init"
fi

# 7. Iniciar com PM2
echo "[7/7] Iniciando servidor..."
pm2 delete mirror 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

# Configurar auto-start
echo ""
echo "Configurando auto-start no boot..."
pm2 startup 2>/dev/null || true

echo ""
echo "=== Deploy concluído! ==="
echo ""
echo "Status:"
pm2 status
echo ""
echo "Logs: pm2 logs mirror"
echo "Health: curl http://localhost:7000/health"
echo ""
echo "Para configurar DNS round-robin, aponte seu dominio para este IP."
echo "IP deste servidor: $(curl -s ifconfig.me 2>/dev/null || echo 'não detectado')"
