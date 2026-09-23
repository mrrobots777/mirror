# Mirror — Contexto de sessão

## Projeto
Addon Stremio para animes, filmes, séries e TV ao vivo. Node.js, CommonJS, Express 5.

## Scrapers ativos

### Anime
- **Otakulogia** — GraphQL, dublado PT-BR (api.otakulogia.com)
- **AnimesDigital** — HTML scraping (animesdigital.org)
- **AnimesOnline** — HTML scraping (animes online)

### Filmes, Séries e TV ao Vivo
- **Xtream (BLZ/SPC/NTV)** — painéis Xtream (kakito.xyz, telaplay93.top, p2vipserver.top)
- **PlayerFlix** — API REST (playerflix.ink)
- **IPTV (KKT)** — M3U playlist + SQLite (kakito.xyz)
- **FrostView (BRZ)** — TV ao vivo (paldi.pro)

### Metadados
- **AniList** — Metadados de anime
- **TMDB** — Metadados de filmes e séries
- **Cinemeta** — Fallback de resolução IMDb/TMDB

## Nomes das fontes (exibição)
| Fonte | Label | Tipo |
|-------|-------|------|
| shg | CDN VOD \| SHG | vod |
| ron | CDN VOD \| RON | vod |
| kge | CDN VOD \| KGE | vod |
| spt | CDN VOD \| SPT | vod |
| blz | CDN VOD \| BLZ | vod |
| spc | CDN VOD \| SPC | vod |
| ntv | CDN VOD \| NTV | vod |
| kkt | CDN TV \| KKT | tv |
| brz | CDN TV \| BRZ | tv |
| cas | CDN RSL \| CAS | http |

## Testar
```bash
node -c src/server.js
node -e "const s = require('./src/scrapers/otakulogia'); s.streamsFor('Naruto', 1).then(r => console.log(r.length))"
node -e "const s = require('./src/scrapers/kakito'); s.streamsFor('Matrix', 1, 'movie').then(r => console.log(r.length))"
PUBLIC_BASE_URL=http://localhost:7000 node src/server.js
```
