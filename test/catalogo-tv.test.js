// O CONTRATO DO `mirrorhub` — o adapter que publica a TV do Mirror no formato do Nuvio.
//
// O que trava aqui e' o `id` NUMERICO do canal. E' o que quebra em silencio: se o `id` do catalogo
// deixar de existir no `porNumero` do plugin, o canal continua abrindo, o Nuvio continua chamando o
// plugin, e o plugin devolve `null` — o sintoma e' "fonte sem player" em UM canal, sem erro
// nenhum no log. Nenhum teste de HTTP pegaria isso; o cruzamento dos dois lados pega.
//
// Os dois lados tem que ler o MESMO mapa (`plugin/src/lib/canais.js`, gerado por
// `mirrorview/tools/gerar-canais.js`). O addon nao tem copia — se tivesse, mudar o gerador quebraria um
// lado so, que e' exatamente o defeito que este arquivo existe para impedir.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { ROTAS, PREFIXOS } = require("../src/core/nomes");
// MEDIDO 02/10/2026: o catalogo de TV e' do MirrorView. O mapa (numero -> canal) e'
// gerado pelo proprio MirrorView e o plugin nao tem mais copia nenhuma — TV saiu do
// plugin na decisao do dono (ele precisa de catalogo, e o catalogo vem do addon).
const ncanais = require("../src/lib/nuvio-canais");
const nuvio = require("../src/routes/nuvio");
const tvSources = require("../src/core/tv-sources");

const mapa = require("../src/lib/canais");

// O MAPA QUE O PLUGIN USA. O addon nao pode ter o seu: se o require falhar, as 4 rotas
// respondem 503 e o resto do addon continua de pe.
test("o addon le o mapa do plugin e nao tem copia do", () => {
  assert.ok(ncanais.temMapa(), "lib/nuvio-canais.js tem de ler o mapa que o proprio MirrorView gerou");
  assert.strictEqual(ncanais.todos().length, Object.keys(mapa.porNumero).length);
});

test("todo id do mapa do plugin e um numero, unico e acima de 1000", () => {
  const numeros = [];
  const problemas = [];
  for (const [chave, item] of Object.entries(mapa.porNumero)) {
    if (!/^\d+$/.test(chave)) problemas.push(`chave "${chave}" nao e numerica`);
    if (!item || !item.slug) problemas.push(`${chave}: sem slug`);
    if (!item || !item.nome) problemas.push(`${chave}: sem nome`);
    if (item && item.slug && !mapa.porSlug[item.slug]) problemas.push(`${chave}: slug ${item.slug} fora do porSlug`);
    if (item) numeros.push(Number(chave));
  }
  assert.deepEqual(problemas, [], problemas.join(" | "));
  assert.strictEqual(new Set(numeros).size, numeros.length, "numero repetido no mapa");
  assert.strictEqual(Math.min(...numeros), 1001);
  const slugs = Object.values(mapa.porNumero).map((i) => i.slug);
  assert.strictEqual(new Set(slugs).size, slugs.length, "slug repetido no mapa");
});

test("ida e volta: numero -> slug -> chave do catalogo -> numero", () => {
  const problemas = [];
  for (const reg of ncanais.todos()) {
    const volta = ncanais.registroDeNumero(String(reg.numero));
    if (!volta) {
      problemas.push(`${reg.numero}: registro nao volta`);
      continue;
    }
    if (volta.slug !== reg.slug) problemas.push(`${reg.numero}: slug ${reg.slug} != ${volta.slug}`);
    if (volta.nome !== reg.nome) problemas.push(`${reg.numero}: nome ${volta.nome} != ${reg.nome}`);
    if (volta.chave !== reg.chave) problemas.push(`${reg.numero}: chave ${reg.chave} != ${reg.chave}`);
  }
  assert.deepEqual(problemas, [], problemas.join(" | "));
});

test("0 canais orfaos: todo canal do REI ganha numero, e todo numero volta pro canal", () => {
  // SIMULA o que o catalogo de TV entrega: o `id` e' `tv:live:<normKey(nome)>` (decisao 138) e
  // o nome e' o do REI. E' esse par que a rota do Nuvio traduz em numero.
  const problemas = [];
  const doRei = Object.entries(mapa.porSlug).filter(([, v]) => v.rei);
  assert.ok(doRei.length >= 300, `o mapa do REI ficou pequeno demais: ${doRei.length}`);
  const usados = new Set();
  for (const [slug, item] of doRei) {
    const chave = tvSources.normKey(item.nome) || tvSources.normKey(slug);
    const canal = nuvio.canalDoCatalogo({ id: `tv:live:${chave}`, name: item.nome });
    if (!canal) {
      problemas.push(`${slug} (${item.nome}): sem numero no mapa`);
      continue;
    }
    if (!/^\d+$/.test(canal.id)) problemas.push(`${slug}: id "${canal.id}" nao e numerico`);
    if (mapa.porNumero[canal.id].slug !== slug) problemas.push(`${slug}: recebeu o numero de ${mapa.porNumero[canal.id].slug}`);
    if (usados.has(canal.id)) problemas.push(`${canal.id}: repetido`);
    usados.add(canal.id);
  }
  assert.deepEqual(problemas, [], problemas.join(" | "));
  assert.strictEqual(usados.size, doRei.length, "um numero perdido na traducao");
  // O sentido contrario: nenhum numero do REI publicado no catalogo deixa de ser traduzivel.
  for (const reg of ncanais.todos()) {
    if (!reg.rei) continue;
    const canal = nuvio.canalDoCatalogo({ id: `tv:live:${reg.chave}`, name: reg.nome });
    if (!canal || canal.id !== String(reg.numero)) {
      problemas.push(`${reg.numero} (${reg.slug}): publicado e o plugin nao traduz de volta`);
    }
  }
  assert.deepEqual(problemas, [], problemas.join(" | "));
});

test("a traducao passa pelo NOME normalizado, e nao pelo slug (decisao 138)", () => {
  // O slug do REI e' a chave de normalizacao de OUTRO canal em casos reais: `tv:live:premiere` e'
  // `normKey("Premiere")`, que e' o canal 1392 (RCD), e nao o 1206 ("Premiere 1"). Se a traducao
  // olhasse o id primeiro, o Premiere 1 abriria com o player do Premiere.
  const problemas = [];
  const doRei = ncanais.todos().filter((r) => r.rei);
  for (const reg of doRei) {
    const canal = nuvio.canalDoCatalogo({ id: `tv:live:${reg.chave}`, name: reg.nome });
    if (!canal || canal.id !== String(reg.numero)) {
      problemas.push(`${reg.slug} (${reg.nome}): pelo nome saiu ${canal ? canal.id : "nada"} em vez de ${reg.numero}`);
    }
  }
  assert.deepEqual(problemas.slice(0, 10), [], problemas.slice(0, 10).join(" | "));

  // Os numeros que NAO sao do REI (os canais que so a EMB/ETC/RCD tem) ficam fora do catalogo —
  // a lista e' a do REI (decisao 138), e por isso existem numeros no mapa que nenhuma rota do Nuvio
  // publica. Entre eles a grafia se repete ("SportyNet+ 1" e' 1360 e 1395, com a mesma chave
  // normalizada), entao o que se exige e' mais fraco e mais honesto: a traducao NUNCA atravessa
  // de uma chave para outra — ela pode escolher entre canais que ja eram o mesmo nome.
  const chaves = new Set(doRei.map((r) => r.chave));
  for (const reg of ncanais.todos()) {
    const canal = nuvio.canalDoCatalogo({ id: `tv:live:${reg.chave}`, name: reg.nome });
    const dono = canal && ncanais.registroDeNumero(canal.id);
    if (!dono) {
      problemas.push(`${reg.slug}: a traducao nao devolveu canal`);
      continue;
    }
    if (dono.chave !== reg.chave) {
      problemas.push(`${reg.slug} (${reg.chave}): traduziu para ${dono.slug} (${dono.chave})`);
    }
    if (reg.rei && dono.numero !== reg.numero) {
      problemas.push(`${reg.slug}: o REI tem de ganhar a propria chave (foi para ${dono.numero})`);
    }
    if (dono.rei && !chaves.has(dono.chave)) problemas.push(`${reg.slug}: dono sem chave`);
  }
  assert.deepEqual(problemas.slice(0, 10), [], problemas.slice(0, 10).join(" | "));

  // A contra-prova, com o par trocado de proposito: o nome manda, e ele volta para o Premiere 1.
  const trocado = nuvio.canalDoCatalogo({ id: "tv:live:premiere", name: "Premiere 1" });
  const reg = ncanais.registroDeNumero(trocado.id);
  assert.ok(reg, "o par trocado tem de resolver para algum canal");
  assert.strictEqual(reg.nome, "Premiere 1", "o nome precisa ganhar do id, nao o contrario");
  assert.strictEqual(reg.slug, "premiere");
});

test("o catalogo do Nuvio publica id numerico com logo e previa", () => {
  const canal = nuvio.canalDoCatalogo({
    id: "tv:live:ae",
    name: "A&E",
    description: "desc",
    poster: "https://exemplo/logo.png",
    background: "https://exemplo/prev.png",
    genres: ["Variedades"],
  });
  assert.ok(canal, "o canal do catalogo tem de virar registro");
  assert.match(canal.id, /^\d+$/, "o id do canal no Nuvio e' numerico");
  assert.strictEqual(mapa.porNumero[canal.id].slug, "ae");
  assert.strictEqual(canal.type, "channel");
  assert.strictEqual(canal.name, "A&E");
  assert.strictEqual(canal.poster, "https://exemplo/logo.png");
  assert.strictEqual(canal.background, "https://exemplo/prev.png");
});

test("a grade do dia usa o numero no id do video, e o stream sabe ler esse id", () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const comGuia = nuvio.canalDoCatalogo({
    id: "tv:live:ae",
    name: "A&E",
    videos: [{ id: `tv:live:ae:epg:${hoje}T12:00:00.000Z`, title: "No ar", startTime: `${hoje}T12:00:00.000Z` }],
  }, hoje);
  assert.ok(comGuia.videos.length, "com data a meta carrega a grade");
  assert.strictEqual(comGuia.videos[0].id, `1001:epg:${hoje}T12:00:00.000Z`);
  assert.strictEqual(comGuia.behaviorHints.hasScheduledVideos, true);
  // E o round-trip do lado do pedido: o id que o cliente manda volta para o MESMO canal.
  const reg = ncanais.registroDeNumero(comGuia.videos[0].id);
  assert.ok(reg, "o id do video tem de resolver para um numero do mapa");
  assert.strictEqual(reg.slug, "ae");
  assert.strictEqual(reg.chave, "ae");
});

test("numero que nao existe no mapa nao vira canal, nem stream", () => {
  assert.strictEqual(ncanais.registroDeNumero("999999"), null);
  assert.strictEqual(ncanais.registroDeNumero("ae"), null);
  assert.strictEqual(ncanais.registroDeNumero(""), null);
  assert.strictEqual(ncanais.registroDeNumero("tmdb:603"), null);
  assert.strictEqual(nuvio.canalDoCatalogo({ id: "tv:live:canal-que-nao-existe", name: "Canal Que Nao Existe" }), null);
});

// DECISAO 155: o recurso `stream` SAIU do manifesto. E' a parte do servidor que o cliente le
// primeiro, e um addon que se anuncia como recurso `stream` promete um player — que nao existe
// mais aqui. O resto (tipo `channel`, id numerico, grade do dia, menu de genero) fica igual,
// porque e' o que o dono vai instalar.
test("o manifesto do Nuvio e' um addon `channel` de catalogo e meta (sem stream, decisao 155)", () => {
  const m = nuvio.manifesto({}, "https://exemplo");
  assert.strictEqual(m.name, "MirrorHub");
  assert.strictEqual(m.id, nuvio.ID_ADDON);
  assert.ok(m.version, "versao declarada");
  assert.ok(m.description && m.description.length > 20, "descricao declarada");
  assert.deepEqual(m.types, ["channel"], "o Nuvio so entende canal vivo como `channel`");
  // SO catalogo e meta. A rota de stream continua existindo (teste de baixo), mas nao e'
  // declarada: quem instala o addon nao pode esperar player do servidor.
  assert.deepEqual(m.resources, ["catalog", "meta"]);
  assert.equal(m.resources.includes("stream"), false, "o servidor nao tem player para prometer");
  // E a descricao diz isso, em vez de o manifesto esconder.
  assert.ok(/plugin/i.test(m.description), "a descricao diz de onde vem o player");
  assert.strictEqual(m.logo, "https://exemplo/logo.svg");
  assert.deepEqual(m.behaviorHints, { configurable: false, epgProvider: true });
  assert.strictEqual(m.catalogs.length, 1);
  const cat = m.catalogs[0];
  assert.strictEqual(cat.type, "channel");
  assert.strictEqual(cat.id, "tv");
  const extras = cat.extra.map((e) => e.name);
  assert.ok(extras.includes("date"), "sem `date` o cliente nao pede a grade do dia");
  assert.ok(extras.includes("genre"), "o filtro de genero e' o mesmo balde do catalogo de TV");
  // O menu de genero NAO pode ser escrito a mao: e' a mesma lista que o filtro usa (decisao 126).
  const doGenero = cat.extra.find((e) => e.name === "genre");
  assert.deepEqual(doGenero.options, ["Todos", ...tvSources.BUCKETS]);
  // E o id do catalogo do manifesto tem de ser o que a rota atende.
  assert.ok(ROTAS.nuvio.catalogo.endsWith(`/${cat.id}.json`), "a rota do catalogo nao atende o id do manifesto");
});
// As 4 rotas CONTINUAM todas no registro, e a de stream continua REGISTRADA de proposito
// (decisao 155): o manifesto nao declara o recurso, mas um cliente com o manifesto antigo em
// cache vai pedir a rota, e `{streams: []}` e' melhor do que 404. O que saiu foram as rotas de
// VIDEO do servidor — e nenhuma delas pode voltar pela porta dos tras.
test("as 4 rotas do adapter seguem no registro, e as de video sairam de vez (decisao 155)", () => {
  assert.strictEqual(ROTAS.nuvio.manifesto, "/nuvio/manifest.json");
  assert.strictEqual(ROTAS.nuvio.catalogo, "/nuvio/catalog/channel/tv.json");
  assert.strictEqual(ROTAS.nuvio.meta, "/nuvio/meta/channel/:id.json");
  // A ROTA de stream fica, mesmo fora do `resources`: e' a rede de seguranca do cliente antigo.
  assert.strictEqual(ROTAS.nuvio.stream, "/nuvio/stream/channel/:id.json");
  assert.strictEqual(PREFIXOS.nuvio, "/nuvio");
  for (const p of Object.values(ROTAS.nuvio)) assert.ok(p.startsWith(`${PREFIXOS.nuvio}/`), `rota fora do prefixo: ${p}`);

  // O adapter nao mudou de lugar nem de nome nas rotas que ele nao toca.
  assert.strictEqual(ROTAS.manifesto, "/:config/manifest.json");
  assert.strictEqual(ROTAS.catalogoStremio, "/:config/catalog/:type/:id.json");
  assert.strictEqual(ROTAS.catalogoRaiz, "/catalog/:type/:id.json");
  assert.strictEqual(ROTAS.metaStremio, "/:config/meta/:type/:id.json");
  assert.strictEqual(ROTAS.streamsStremio, "/:config/stream/:type/:id.json");
  assert.strictEqual(ROTAS.api.canais, "/api/channels");
  assert.strictEqual(ROTAS.api.streams, "/api/streams/:type/:id");

  // E as de VIDEO sumiram do registro — relay, proxy, proxy-check e o segmento da ETC.
  for (const saiu of ["hls", "proxy", "proxyCheck", "segmentoEtc"]) {
    assert.strictEqual(ROTAS[saiu], undefined, `a rota ${saiu} nao pode voltar`);
  }
  for (const saiu of ["proxy", "hls", "segmentoEtc"]) {
    assert.strictEqual(PREFIXOS[saiu], undefined, `o prefixo ${saiu} nao pode voltar`);
  }
});
// DECISAO 155: a rota de stream do adapter NAO chama mais o `handleStreams`. Ela responde
// `{streams: []}` direto, sem metadado, sem AniList e sem sonda — que e' a MESMA resposta (e o
// mesmo formato) que as outras duas rotas de stream ja devolvem, e por isso nenhum cliente
// quebra. O player vem do plugin, que tem as 4 fontes.
test("decisao 155: a rota de stream do Nuvio responde lista vazia, sem chamar o servidor de stream", () => {
  const arquivo = path.join(__dirname, "..", "src", "routes", "nuvio.js");
  const src = fs.readFileSync(arquivo, "utf8");
  // Nao ha mais cadeia de stream no adapter: nem o id montado, nem a chamada.
  // o NOME pode aparecer no comentario que explica a saida; o que nao pode e' CHAMADA.
  assert.equal(/handleStreams\(/.test(src), false, "o adapter nao chama mais o handleStreams");
  assert.equal(/await handleStreams/.test(src), false, "nem awaits");
  assert.equal(/tv:live:\${reg\.chave}/.test(src), false, "o id de stream nao e' mais montado");
  // A resposta e' a lista vazia, e o cabecalho impede que uma borda a guarde por horas (a
  // decisao 140: 404 transitório na borda foi o "todos os players pararam").
  assert.ok(src.includes("streams: []"), "a resposta e' {streams: []}");
  assert.ok(src.includes('"Cache-Control", "no-store"'), "e nao pode ser guardada na borda");
  assert.ok(src.includes("Cloudflare-CDN-Cache-Control"), "nem pelo TTL da borda da Cloudflare");
  // As garantias de hygiene do adapter continuam.
  assert.ok(!src.includes('"http://'), "nenhuma URL montada a mao no adapter (use basePublica)");
  assert.ok(!/process\.env\./.test(src), "nenhum process.env fora do registro");
});
test("o Cache-Control do adapter: catalogo e meta em 120s, stream em no-store", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  const marca = 'caminho.startsWith(PREFIXOS.nuvio + "/stream/")';
  assert.ok(server.includes(marca), "o no-store do stream do Nuvio sumiu — a borda do BeamUp guardaria o link por 4h");
  const ramo = server.slice(server.indexOf(marca), server.indexOf(marca) + 1200);
  assert.ok(ramo.includes('res.set("Cache-Control", "no-store")'), "o ramo do stream do Nuvio tem de mandar no-store");
  // O resto do adapter e' JSON normal: cai no max-age=120 do fim, e nao no no-store.
  assert.ok(server.includes('res.set("Cache-Control", "public, max-age=120")'), "o max-age=120 do JSON normal sumiu");
  assert.ok(server.includes("max-age=120") && server.includes("\\.json$"), "a regra do JSON normal sumiu");
});
