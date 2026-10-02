# Dockerfile do MIRRORVIEW — TV ao vivo: as 4 fontes, o guia (EPG) e o catalogo de canal.
#
# Contexto de build: a RAIZ do repo.
#     docker build -f mirrorview/Dockerfile -t mirrorview .
#
# O `Dockerfile` da raiz constroi o `mirrorstream/` (filmes e series). Os dois coexistem de
# proposito: sao dois produtos com dois `package.json`, duas dependencias e dois deploys.
#
# ETAPA 1: este produto tem o CATALOGO de TV completo e medido (327 canais em
# `/catalog/tv/mirror-tv-live.json` e nas rotas `/nuvio/*`, que e' de onde o Nuvio tira a
# lista). A CAMADA DE PLAYER entra na etapa 2 — ver `mirrorview/README.md`.
FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY mirrorview/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
COPY mirrorview/beamup-start.js /start
RUN chmod +x /start
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/tmp
# MEDIDO em 29/09/2026, no servidor de catalogo: sem `MALLOC_ARENA_MAX` o processo sobe em
# 157MB de RSS com o catalogo e o EPG prontos. Nao e' vazamento — e arena do glibc:
# `global.gc()` nao baixa nada (medido 157 -> 156). Com 2 arenas cai para 139MB, -18MB.
ENV MALLOC_ARENA_MAX=2
ENV NODE_OPTIONS=--max-old-space-size=224

# MEDIDO 02/10/2026: este Dockerfile NAO tinha `PUBLIC_BASE_URL`, e o `mirrorstream/` tem.
# Sem ela o gateway do BeamUp reescreve o `Host` para o nome do app, o guard de auto-detect
# rejeita e as URLs saem RELATIVAS — que e' a quebra de TV ao vivo registrada nas decisoes
# 138/139 (logo, poster e `/tv` sao montados a partir daqui). `config:set` do BeamUp nao
# injeta env no servico, entao o valor tem de ficar AQUI, como no `Dockerfile` da raiz.
#
# O nome do app no BeamUp E' a URL: quando o dono renomeou `mirrorhub2` para `mirrorview`,
# o endereco mudou e este valor precisou mudar junto. Trocar o nome do app sem trocar esta
# linha nao quebra o build — so as URLs.
ENV PUBLIC_BASE_URL=https://e75602c18409-mirrorview.baby-beamup.club

EXPOSE 3000
USER node
CMD ["node", "mirrorview/src/server.js"]