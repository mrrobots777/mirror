# Plano de publicação — plugin Mirror/Nuvio

Este `public/` é a **raiz que vai para o GitHub Pages**. Ela contém o que o Nuvio lê:

```
public/
├── manifest.json      # o repositório de plugins (15 scrapers, GERADO pelo build)
├── <fonte>.js         # o bundle de cada scraper (saída de `npm run build`)
├── idx/               # o ÍNDICE ESTÁTICO das fontes de painel
│   ├── indice.json    # metadados: quando foi gerado, itens por fonte, tamanho por letra
│   ├── blz/<letra>.json
│   ├── spc/<letra>.json
│   └── ato/<letra>.json
└── PLANO-PUBLICACAO.md # este arquivo
```

`node build.js` gera os 15 bundles **e o `manifest.json`** (a partir do registro
`src/core/fontes.js`) e já copia tudo para `public/`. Não há manifesto escrito à mão, e
`public/` já é a raiz pronta para publicar. A raiz do Pages tem que servir `manifest.json`,
`<fonte>.js` **e** `idx/` no mesmo endereço, porque o provider monta a URL do índice a partir
da mesma base.

## 1. Onde o índice mora e por quê

As três fontes de painel Xtream (`blz`, `spc`, `ato`) **não têm busca**:

| fonte | catálogo inteiro | `action=search` | `Range` | paginação |
|---|---|---|---|---|
| **blz** (kakito.xyz) | **4,77 MB** | devolve só `user_info`, 0 itens | **ignorado** | não |
| **spc** (telaplay93.top) | **29,2 MB** (gzip 7,6 MB) | idem | ignorado | `page=1` e `page=2` são **iguais** |
| **ato** (4x4u29c.autos) | **11,9 MB** (via worker) | idem | worker ignora | não |
| **kkt** (M3U do kakito) | **48,8 MB** | idem | ignorado | não |

O runtime do plugin Nuvio **corta o corpo de qualquer resposta em 1 MB** (512 KB na quota
`limited`). Não há como baixar nenhum desses catálogos no aparelho. Sem um índice, as três
fontes ficam fora do plugin por construção — não por defeito de parser.

O índice é **título normalizado → `stream_id`**, quebrado por letra:

```
idx/blz/m.json  ->  {"v":1,"f":"blz","g":<unix>,"k":"m","n":1829,"it":[
                     [stream_id, "nome normalizado", "nome original", 0|1, ano, ext], ...]}
```

O campo `s` (posição 4) é `1` para série e `0` para filme; o `ext` é o
`container_extension` do item. Cada shard é **< 400 KB**, com folga para o teto de 1 MB.

## 2. Apontar o Nuvio para o repositório

1. Crie o repositório do plugin (`<usuario>/<repo>`, ex. `devavmirror/mirror-nuvio`).
2. Settings → Pages → branch `main`, pasta `/ (root)`. A raiz tem que ser **`public/`** —
   no GitHub Pages isso significa publicar **o conteúdo de `public/` na raiz do branch**, ou
   ajustar a pasta em Settings → Pages para `/public`.
3. Settings → Pages → **Custom domain**, se quiser um nome próprio.
4. No Nuvio: **Settings → Plugins → Add repository URL** =
   `https://<usuario>.github.io/<repo>/manifest.json`.
   O app anexa o `/manifest.json` sozinho se faltar.

**Aponte a base do índice.** O default está em `src/lib/indice.js`
(`BASE_PADRAO = "https://devavmirror.github.io/mirror-nuvio"`) — troque pelo seu domínio.
Para testar sem build, use a variável de ambiente do runtime:

```js
globalThis.MIRROR_INDEX_BASE = "https://<usuario>.github.io/<repo>"
```

Sem índice publicado, o provider devolve **`[]`** e escreve no log do Nuvio exatamente o
que falta. Ele **nunca** inventa stream.

## 3. Rodar o gerador

```bash
node tools/gerar-indice.js                 # blz + spc + ato, saida em public/idx/
node tools/gerar-indice.js spc             # so uma fonte
node tools/gerar-indice.js blz --direto    # sem passar pelo worker (o ATO nao responde direto)
node tools/gerar-indice.js --alvo=200000   # alvo menor por shard, forca 2 niveis
IDICE_SALVA=1 node tools/gerar-indice.js    # mede e loga, nao escreve nada
```

O gerador lê as **credenciais de `src/scrapers/xtream.js`** (repo do addon) e **compara com
os literais de `src/<fonte>/index.js`**. Se divergirem, ele **para com erro** — não publica
índice com credencial errada.

Para rodar contra um clone do addon: `node tools/gerar-indice.js --addon=../mirrorstream`.

## 4. Automatizar

O workflow real é **`.github/workflows/publicar-pages.yml`** (raiz do monorepo): roda o
gerador, confere que nenhum shard passou de 1 MB, roda o build e publica no GitHub Pages.
A única Actions Variable que ele usa é `MIRROR_ADDON_REPO`, e só para o caso do plugin viver
**fora** do monorepo — dentro daqui o addon de VOD é `mirrorstream/` e não há o que clonar.

> MEDIDO 02/10/2026: existiam duas cópias deste workflow em `plugin/tools/*.yml` (138 e 118
> linhas) que o GitHub **nunca executou** — Actions só lê `.github/workflows/`. Elas só
> divergiam do real e mandavam o gerador procurar credenciais em `../addon`, que já não
> existe. É por isso que a publicação caiu com `ENOENT .../addon/src/scrapers/xtream.js`
> logo depois de o addon virar `mirrorstream/`. Estavam apagadas quando o gerador passou a
> ler `../mirrorstream`.

## 5. Se o índice ficar velho

| sintoma | causa | o que fazer |
|---|---|---|
| `[SPC] nenhum item em /idx/spc/ para "…"` e o filme existe no painel | índice não foi publicado, ou a base está errada | veja §2; o caminho da URL aparece no log |
| `[indice] shard spc/m respondeu 404` | `public/idx/` não está na raiz do Pages | copie `idx/` para a raiz servida |
| filme novo não aparece | índice com mais de 6 h | rode `node tools/gerar-indice.js` na mão, ou dispare o workflow |
| catálogo mudou de host/credencial | painel girou | o gerador falha alto na divergência; atualize `src/scrapers/xtream.js` **e** `src/<fonte>/index.js` juntos |
| `JSON invalido … o runtime cortou` | shard passou de 1 MB | rode com `--alvo=` menor; o workflow também falha neste caso |

O índice envelhece **sem quebrar**: um `stream_id` que sumiu do painel só faz a origem
devolver erro, e o item morre no clique em vez de aparecer na lista. O modo oposto
(passar um item errado) é o que a barreira `matchVodTitle` + `tmdb_id` do detalhe
impede — e ela não depende da idade do índice.

## 6. `kkt` não está indexado — e por quê

`kkt` é o M3U (`get.php`) do **mesmo painel do `blz`**: mesmo host (`kakito.xyz`), mesmas
credenciais (`MirrorPrincipal`/`ditj7j1h`), mesmos arquivos. No addon o dedup por
host+path já colapsa os dois, então `kkt` é **failover do `blz`**, não conteúdo novo.
Indexá-lo seria puxar **48,8 MB** de M3U para gerar um índice com os mesmos itens — e como
o `kkt` não tem busca nem `Range`, não há gain nenhum. **Não indexe o `kkt`.** Se um dia
eles apontarem para painéis diferentes, o gerador passa a aceitar uma quarta fonte
(adicionando a chave em `FONTES` e o painel correspondente).