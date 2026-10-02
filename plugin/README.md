# MirrorStream — o plugin do Nuvio

Plugin do app Nuvio: resolve **stream** de **filmes, séries e anime**, direto do aparelho, do
IP residencial de quem assiste. **Só VOD** — TV ao vivo não é da conta dele (o porque está no
fim, e é medido).

É este endereço que o Nuvio instala (Settings → Plugins → **Add repository URL**):

```
https://mrrobots777.github.io/mirrorstream/
```

> **Renomeado em 02/10/2026.** O repositório era `mrrobots777/mirror` e o endereço antigo
> (`…/github.io/mirror/`) agora responde **404**. Quem já tinha o plugin instalado precisa
> remover e instalar de novo pelo endereço acima — o Nuvio não sabe que a URL mudou.

## As 11 fontes

| conteúdo | fontes |
|---|---|
| anime | **SHG** (otakulogia) · **RON** (animesdigital) · **AON** (animesonline) · **ATB** (anitube) · **RTD** (RedeToons) |
| séries | **SPT** (playerflix) · **BLZ** (kakito) · **SPC** (telaplay) · **ATO** (painel Xtream) · **RTD** · **VZR** (vizer) |
| filmes | as mesmas de séries — nenhum painel tem catálogo só de série ou só de filme |
| doramas | **DGO** (doramogo) |

O que o app mostra na tela está travado em `src/lib/apresentacao.js`:

```
linha 1   Matrix (1999) - 1080p
linha 2   Legendado · S01E03 · BLZ
badge     BLZ
```

## Por que TV não está aqui

O plugin precisa de um **catálogo** de TV para saber que canais existem, e esse catálogo passa
a vir do addon **MirrorView**, que o Nuvio instala como addon (as rotas `/nuvio/*`). Deixar as
4 fontes de TV aqui seria duplicá-las em dois lugares — e o preço não é só de manutenção:

| | plugin (no aparelho) | addon (no servidor) |
|---|---|---|
| IP de origem | residencial | datacenter |
| origens que respondem | todas | **várias recusam** (403/429 medido) |
| quem vê | o dono, na sua TV | qualquer visitante |

Duas versões do mesmo player, medindo diferente, é pior que uma. O caminho de TV já existe: é o
MirrorView, que tem as 4 fontes, o guia e o catálogo de canal.

## Rodar e medir

```bash
cd plugin && npm ci && node build.js            # 11 bundles + manifest.json
MIRROR_INDEX_BASE=http://127.0.0.1:8799 node tools/bateria-completa.js
```

A barreira do plugin vive em `../test/` e `../mirrorstream/test/` (os arquivos `plugin-*.test.js`).
Ver `../CONTEXTO.md` para a medição mais recente.
