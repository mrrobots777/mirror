# Dockerfile do ADDON DE CATALOGO (`mirrorstream/`) — o produto que serve o catalogo para o Nuvio.
#
# Este Dockerfile mora na RAIZ do repo de proposito: e' o ponto de entrada que o BeamUp
# usa (o build roda `docker build .` na raiz), e um Dockerfile dentro de `mirrorstream/` exigiria
# saber se a plataforma aceita um caminho custom — e nao aceitou ser descubrindo em producao.
# O repo tem TRES produtos (`nuvio/`, `mirrorstream/`, `stremio/`) e este e' o do `mirrorstream/`.
FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# MEDIDO 02/10/2026: o `package.json` do addon passou a morar em `mirrorstream/`. O `COPY` aponta
# para la e o `npm ci` roda na raiz do WORKDIR, para o `node_modules` ficar onde a
# resolucao de `require` acha sem depender de onde o processo foi iniciado.
COPY mirrorstream/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
COPY mirrorstream/beamup-start.js /start
RUN chmod +x /start
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/tmp
# MEDIDO em 29/09/2026: sem isto o processo sobe em 157MB de RSS com o catalogo e o EPG prontos,
# e o cluster de TV em 285MB. Nao e vazamento: `global.gc()` NAO baixa nada (medido 157 -> 156),
# porque o Node multi-aloca e o glibc guarda a memoria por arena. Com 2 arenas o mesmo cenario
# cai para 139MB — -18MB, ou 11% do teto do dono, sem trocar uma linha de codigo. O limite
# padrao do glibc e 8 arenas por nucleo, e o container tem varios.
ENV MALLOC_ARENA_MAX=2
ENV NODE_OPTIONS=--max-old-space-size=224
ENV SCRAPER_TIMEOUT_MS=9000
ENV PUBLIC_BASE_URL=https://e75602c18409-mirrorstream.baby-beamup.club

# MEDIDO 02/10/2026: `TV_BASE_URL` e `TV_PROXY_TIMEOUT_MS` saíram daqui. Os dois existiam para a
# PONTE app1 -> cluster de TV (`lib/tv-split.js`), que repassava `/catalog/tv` e `/meta/tv` para o
# outro app. Com a divisao em tres produtos essa ponte **não existe mais**: o MirrorStream nao
# tem TV nenhuma (`TV_BASE_URL` so aparecia nele dentro de um comentario), e o MirrorView e' o
# proprio servidor de TV. A linha apontava ainda para `mirrorhub2`, o app antigo.
#
# O que as configurava agora esta em `mirrorview/Dockerfile`, que e' o produto que tem TV.

EXPOSE 3000
USER node
CMD ["node", "mirrorstream/src/server.js"]