# Changelog

Todas as mudancas estao no **commit unico** deste repositorio (a regra do dono e reescrever o
ultimo commit em vez de criar um novo, entao nao ha um historico por release aqui). O que muda e
que **este arquivo e a memoria**: o que entrou, por que, e o que foi medido.

## 1.0.1 — 30/09/2026

### TV ao vivo
- **REI é o dono da TV** (catálogo, EPG e stream principal); EMB e ETC entram **dentro** do canal
  do REI como players adicionais. Medido: `cnnbrasil`, `bandnews`, `hbo` com REI + EMB + ETC.
- **Catálogo = o do REI** (327 canais). Saíram os 60 que só a EMB/ETC tinham — eventos
  esportivos de uma ocorrência só, que faziam a lista parecer duplicada.
- **Gêneros em 7 baldes**, com o menu do Stremio saindo da mesma lista. Antes: 19 gêneros crus e
  **6 das 10 opções do menu quebradas**.
- **Nada segura mais a resposta do catálogo**: a triagem e a prévia viraram trabalho de fundo
  (**131s → 84ms**; 429 do REI de 57 para 3). Coesão invertida: a lista é o que a fonte declara
  menos quem tem **prova** de não entregar (24h); prova de vida nunca tira ninguém.
- EPG: XMLTV do REI (`/api/guia`), 143 canais / 3.972 programas, sem custo de heap.

### VOD
- **Um worker por fonte** (16): o plano grátis da Cloudflare dá cota **por worker**, então uma
  fonte que estoura derrubaria as outras. Lista no registro único + `deploy-workers.sh`.
- Cache em duas camadas (memória + SQLite) com single-flight, stale-while-revalidate e
  revalidação em fundo: medido 5,97s → 0,27s no mesmo pedido.
- Prova de vida antes de entregar link; codec fechado nunca sai sozinho (medido 0 de 31
  H.265/VP9/AV1 depois da correção, era 3 de 23).
- Qualidade lida do bitstream (H.264 em TS, MP4), sem hardcode.

### Operação e segurança
- Headers de segurança em tudo (antes: **zero**), CSP nas três páginas.
- `/stream/proxy-check` deixou de ser um proxy aberto: agora exige token.
- `.env` saiu do índice do git (ainda precisa **rotacionar** as credenciais, que seguem no
  histórico).
- Deploy dos dois apps + 16 workers por comando, com verificação depois.

### Conhecido / pendente
- **RTD** sem saída brasileira: a API fica na Polônia e o RTD só responde do Brasil.
- **P2P** só na página `/tv`, desligado, e 2 de 3 trackers públicos mortos. O player do Stremio
  não faz WebRTC, então P2P de vídeo é só no navegador.
- **Cache de segmento de TV na borda** não existe: N pessoas no mesmo canal = N idas à origem.
- **Sem alerta** de fonte caída.
- **Cobertura 57,96%**, e a parte fraca é o caminho do byte (`stream-relay` 12%).
- **Histórico**: um commit só (sem `bisect` nem autoria).
- **DGO** com site instável (lastro do fornecedor).
