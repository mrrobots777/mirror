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
ENV PUBLIC_BASE_URL=https://e75602c18409-mirrorhub.baby-beamup.club
ENV TV_BASE_URL=https://e75602c18409-mirrorhub2.baby-beamup.club
# A ponte app1 -> cluster de TV. O default do codigo e 8000 e era MUITO BAIXO: o cluster leva
# ~9,7s para resolver os canais mais pesados, entao o app1 abortava aos 8s, caia no fallback
# local e refazia o trabalho inteiro — 8s + 9,7s passa dos ~12,3s que o gateway aguenta, e o
# cliente levava 504 e via "sem fontes" no canal (medido: 10 dos 157 canais em 28/09/2026).
# Com 11000 o app1 espera o cluster responder (~10,2s no total) e ainda sobra folga antes dos 12,3s.
ENV TV_PROXY_TIMEOUT_MS=11000
EXPOSE 3000
USER node
CMD ["node", "mirrorstream/src/server.js"]