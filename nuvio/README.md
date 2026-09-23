# Mirror no Nuvio

Plugin do [Nuvio](https://nuvio.tv) com as 15 fontes de streams do Mirror: anime, filme,
série, dorama e TV ao vivo.

A diferença em relação ao addon do Mirror é **onde o vídeo passa**. O addon tem um servidor
no meio; o plugin **não tem servidor nenhum** — cada scraper roda dentro do app, no aparelho
de quem assiste. O pedido sai do celular ou da TV direto para a origem, do IP residencial de
quem assiste, e volta pelo mesmo caminho. Nenhum vídeo é armazenado ou repassado por
terceiros.

O que é necessário: o plugin (este repositório) e o **catálogo** (addon `mirrorhub`, as 4
rotas `/nuvio` do Mirror), que é de onde sai a lista de canais de TV ao vivo.

---

## 1. Instalação do plugin

No Nuvio:

1. **Settings → Plugins → Add repository URL**
2. Endereço:
   ```
   https://<user>.github.io/<repo>/manifest.json
   ```
   (o app aceita o endereço do repositório sem o `/manifest.json` e acrescenta sozinho)
3. **Escolha e ative os scrapers** na tela de Plugins.

O app atualiza o repositório sozinho a cada 6 h.

## 2. Instalação do catálogo (`mirrorhub`)

O Nuvio **não** tem lista de canal nativo: a lista de TV ao vivo sempre vem de um addon. O
Mirror publica as mesmas 4 rotas em `/nuvio`, no formato que o Nuvio entende (tipo `channel`,
id numérico, e a grade do dia):

| Rota | O que entrega |
|---|---|
| `GET /nuvio/manifest.json` | o addon `MirrorHub` |
| `GET /nuvio/catalog/channel/tv.json` | a lista de canais, com a grade de cada um |
| `GET /nuvio/meta/channel/:id.json` | um canal e os programas do dia |
| `GET /nuvio/stream/channel/:id.json` | o link do canal |

Use a URL base do seu addon Mirror + `/nuvio`. É o mesmo catálogo e o mesmo cache do addon —
a rota nova é acréscimo, nada mudou para quem usa o addon no Stremio.

**Sem o catálogo os canais não aparecem.** O plugin entrega o *player* (o link do vídeo); quem
diz **quais canais existem e o que passa neles agora** é o addon.

## 3. Índice estático

Os painéis Xtream (as fontes `blz`, `spc`, `ato`) têm catálogo de **4,77 MB, 29,2 MB e
11,9 MB**, e ignoram `Range` e não paginam — não têm busca. O runtime do plugin corta o corpo
de qualquer resposta em **1 MB** (512 KB na quota `limited`). Sem ajuda, essas três fontes não
conseguem ler o catálogo.

Por isso existe o **índice estático**: o catálogo de cada painel é baixado periodamente,
dividido em *shards* de ~400 KB e publicado junto com o plugin. O scraper lê o shard, e cada
shard cabe no teto. O maior shard hoje tem 285 KB.

O índice é **renovado a cada 6 h** pelo workflow `tools/atualizar-indice.yml` (minuto 17 de
cada bloco de 6 h). Conteúdo novo no painel aparece em até 6 h.

## 4. Variáveis

As duas são opcionais e são lidas de `globalThis`, então só dá para ajustá-las se você
hospedar uma cópia sua do plugin.

| Variável | Padrão | O que faz |
|---|---|---|
| `MIRROR_INDEX_BASE` | o endereço publicado | Base do índice estático. Só precisa mudar se você publicar o índice em outro endereço. |
| `MIRROR_BLZ_CATALOGO` | `auto` | Como o BLZ lê o catálogo: `auto`, `nunca` ou `sempre`. |

Sobre `MIRROR_BLZ_CATALOGO`:

- **`auto`** (padrão) — o shard do índice entrega, e o catálogo completo é buscado em paralelo
  sem esperar: se vier inteiro, vence (é mais fresco); se vier cortado, o shard assume e o
  catálogo é descartado sem erro.
  **Atenção ao custo:** o catálogo do BLZ tem **4,77 MB** decodificados, e no modo `auto` eles
  são baixados **em toda consulta que não acabar usando o catálogo** — em 4G isso pesa, em
  WiFi são ~2,5 s. É o preço da dúvida descrita nos limites abaixo.
- **`nunca`** — só o shard. Nenhum byte de catálogo.
- **`sempre`** — só o catálogo. Só funciona se o limite do runtime contar bytes comprimidos.

O padrão é `auto` porque **não dá para medir daqui** se o teto de 1 MB conta bytes comprimidos
ou corpo decodificado. Se no seu aparelho as fontes de painel faltarem, ponha `nunca`.

## 5. Limites conhecidos

Tudo o que vem abaixo só se prova no aparelho — o servidor de onde o plugin foi escrito é IP
de datacenter, e é a origem que decide por IP. Nada aqui bloqueia a instalação; são as três
coisas a olhar no primeiro uso real.

1. **O teto de 1 MB conta bytes comprimidos ou corpo decodificado?** O plugin foi construído
   para nunca depender de uma resposta grande (é por isso que existe o índice), mas o shard do
   `spc` (285 KB) é o mais próximo da linha.
2. **403 de CDN para IP de datacenter.** O **ATO** é o caso visível: a origem devolve uma
   página de erro em vez do catálogo. Não é defeito do parser. O que não dá para provar daqui é
   o contrário — que o IP residencial passa. Precisa de um canal aberto no aparelho.
3. **`content-type` da playlist do REI.** O REI entrega vídeo por um relay com token que vale
   ~300 s, e a resposta muda de forma conforme o salto. Só o aparelho diz se o player segura a
   sessão e se aceita o `content-type` na prática.

## 6. O que ainda não é provado

- **Link copiado vence.** Os links são assinados e têm prazo. Um link copiado para outro
  aparelho, mais tarde, pode ter expirado.
- **Link gerado no aparelho é de IP residencial.** É o que faz o ATO e o RCD funcionarem, mas
  a leitura vem do desenho da arquitetura, não de uma medição feita aqui.

---

Repositório do addon (para o catálogo): o dono do plugin. Publicação: `node build.js` e
`tools/publicar-pages.yml`, que entrega `public/` no GitHub Pages.
