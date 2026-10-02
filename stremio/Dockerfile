# Dockerfile do ADDON STREMIO (`stremio/`) — o produto que serve catalogo E players
# para quem usa Stremio, sem depender do plugin do Nuvio.
#
# O contexto de build continua sendo a RAIZ do repo:
#     docker build -f stremio/Dockerfile -t mirror-stremio .
#
# (O `Dockerfile` da raiz constroi o `addon/`. Os dois coexistem de proposito: sao dois
# produtos com dois `package.json` e duas dependencias.)
#
# ETAPA 1: este produto hoje e' o catalogo do `addon/`, com identidade propria
# (`com.mirror.stremio`). A CAMADA DE PLAYER entra na etapa 2 — ver `stremio/README.md`
# para o que ainda falta e por que o codigo nao esta no historico deste repositorio.
FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY stremio/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
COPY stremio/beamup-start.js /start
RUN chmod +x /start
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/tmp
# Mesmo teto de memoria do `addon/`: MEDIDO em 29/09/2026, sem `MALLOC_ARENA_MAX` o
# processo sobe em 157MB de RSS com o catalogo e o EPG prontos. Nao e vazamento — e arena
# do glibc: `global.gc()` nao baixa nada (medido 157 -> 156). Com 2 arenas cai para 139MB.
ENV MALLOC_ARENA_MAX=2
ENV NODE_OPTIONS=--max-old-space-size=224
EXPOSE 3000
USER node
CMD ["node", "stremio/src/server.js"]