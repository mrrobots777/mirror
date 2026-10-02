// O CAMINHO DO BYTE: onde um defeito significa "a pessoa clicou e nao tocou".
//
// MEDIDO na auditoria de 30/09/2026: a cobertura do projeto era 57,96% no geral, mas a parte
// que realmente entrega video estava quase sem teste — `stream-relay` 12,15%, `prova-viva`
// 24,18% e `url-resolver` 25,38%. Sao exatamente os tres modulos que, se quebrarem, nao dao erro
// nenhum: o stream simplesmente para de tocar na TV da pessoa.
//
// Estes testes NAO dependem de nenhuma fonte externa: sob um servidor HTTP local que responde
// exatamente os casos que o codigo precisa distinguir (morto, lento, pagina de erro, playlist
// sem segmento, faixa 206, cadeia de redirect, redirect infinito). E o servidor e local porque a
// prova e sobre a DECISAO do codigo, nao sobre aorta que respondeu.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { provaDe, descartaMortos, stats } = require("../src/lib/prova-viva");
const { detectHost, ehMidia, resolveUrl, HOSTERS } = require("../src/lib/url-resolver");

const MP4 = Buffer.concat([Buffer.from("\0\0\0\x18ftypmp42"), Buffer.alloc(256 * 1024, 0x22)]);
// O RELAY tem que responder 206 COM OS BYTES PEDIDOS, e o "cortar sozinho" e o que faz o link
// funcionar com a origem que ignora `Range`. Cada byte tem valor proprio aqui para dar para
// conferir byte a byte o que saiu.
const MP4_CARIMBADO = Buffer.from(Array.from({ length: 64 * 1024 }, (_v, i) => i % 251));
const TS = Buffer.concat([Buffer.from([0x47, 0x40, 0x11]), Buffer.alloc(9000, 0x47)]);

// 3 e 4 sao o video de verdade; os outros sao as armadilhas que o codigo tem que distinguir.
const ROTA_M3U8_MESTRE = [
  "#EXTM3U",
  "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360",
  "baixa.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080",
  "alta.m3u8",
].join("\n");

const ROTA_M3U8_MIDIA = ["#EXTM3U", "#EXTINF:4.0,", "seg1.ts", "#EXTINF:4.0,", "seg2.ts", "#EXT-X-ENDLIST"].join("\n");

let server;
let base;
// Quantas vezes o servidor de teste foi chamado, por caminho. E a prova de que o relay
// COMPARTILHA: duas pessoas no mesmo canal tem que custar 1 ida a origem, nao 2.
const pedidosNaOrigem = new Map();
const conta = (rota) => pedidosNaOrigem.set(rota, (pedidosNaOrigem.get(rota) || 0) + 1);

test.before(async () => {
  server = http.createServer((req, res) => {
    const rota = req.url.split("?")[0];
    conta(rota);
    const mandar = (status, tipo, corpo, extra = {}) => {
      res.writeHead(status, { "Content-Type": tipo, "Content-Length": Buffer.byteLength(corpo), ...extra });
      res.end(corpo);
    };
    switch (rota) {
      case "/mestre.m3u8": return mandar(200, "application/vnd.apple.mpegurl", ROTA_M3U8_MESTRE);
      case "/midia.m3u8": return mandar(200, "application/vnd.apple.mpegurl", ROTA_M3U8_MIDIA);
      case "/vazia.m3u8": return mandar(200, "application/vnd.apple.mpegurl", "#EXTM3U\n#EXT-X-ENDLIST");
      case "/naoplaylist.m3u8": return mandar(200, "application/vnd.apple.mpegurl", "acesso negado, tente de novo amanha");
      case "/erro.html": return mandar(200, "text/html; charset=utf-8", "<html><body>404 na origem</body></html>");
      case "/morto.m3u8": return mandar(404, "text/plain", "nao existe");
      case "/proibido.m3u8": return mandar(403, "text/plain", "proibido");
      case "/sumiu.m3u8": return mandar(410, "text/plain", "gone");
      case "/juridico.m3u8": return mandar(451, "text/plain", "unavailable for legal reasons");
      case "/quebrado.m3u8": return mandar(500, "text/plain", "erro interno");
      // A armadilha mais importante: a origem LENTA nao pode ser condenada.
      case "/lento.m3u8": return;
      case "/video.mp4":
        if (req.headers.range) {
          const faixa = req.headers.range.match(/bytes=(\d+)-(\d+)/);
          const ini = Number(faixa[1]);
          const fim = Number(faixa[2]);
          const pedaco = MP4.subarray(ini, fim + 1);
          return mandar(206, "video/mp4", pedaco, {
            "Content-Range": `bytes ${ini}-${fim}/${MP4.length}`,
            "Accept-Ranges": "bytes",
          });
        }
        return mandar(200, "video/mp4", MP4, { "Accept-Ranges": "bytes" });
      case "/morto.mp4": return mandar(404, "text/plain", "nao existe");
      // Arquivo que o player pede em faixa, com os bytes marcados.
      case "/marcado.mp4":
        if (req.headers.range) {
          const f = req.headers.range.match(/bytes=(\d+)-(\d*)/);
          const ini = Number(f[1]);
          const fim = f[2] === "" ? MP4_CARIMBADO.length - 1 : Math.min(Number(f[2]), MP4_CARIMBADO.length - 1);
          return mandar(206, "video/mp4", MP4_CARIMBADO.subarray(ini, fim + 1), {
            "Content-Range": `bytes ${ini}-${fim}/${MP4_CARIMBADO.length}`,
            "Accept-Ranges": "bytes",
          });
        }
        return mandar(200, "video/mp4", MP4_CARIMBADO, { "Accept-Ranges": "bytes" });
      // A ARMADILHA DO DONO (29/09): a origem IGNORA `Range` e devolve 200 com o arquivo
      // inteiro. Foi o que produziu "toca, passa uns minutos, tela branca, e para" e tambem
      // "o link copiado buga". O relay tem que cortar a faixa sozinho mesmo assim.
      case "/ignora-range.mp4":
        return mandar(200, "video/mp4", MP4_CARIMBADO, { "Content-Length": String(MP4_CARIMBADO.length) });
      // Segmento de TV ao vivo: o relay monta um stream compartilhado entre as pessoas.
      case "/seg.ts": return mandar(200, "video/mp2t", TS);
      case "/seg-morto.ts": return mandar(404, "text/plain", "nao existe");
      // Segmento que fica ABRITO, como um canal de verdade: e o que permite duas pessoas
      // entrarem no mesmo stream compartilhado. Um corpo de 9KB acaba antes da segunda pessoa
      // chegar, e o teste mediria o tempo da maquina em vez do relay.
      case "/seg-lento.ts": {
        res.writeHead(200, { "Content-Type": "video/mp2t" });
        let enviados = 0;
        const timer = setInterval(() => {
          enviados++;
          res.write(Buffer.alloc(4000, enviados % 251));
          if (enviados >= 6) { clearInterval(timer); res.end(); }
        }, 60);
        res.on("close", () => clearInterval(timer));
        return;
      }
      case "/video.html": return mandar(200, "text/html", "<html>login</html>");
      // Cadeia de redirect: o codigo tem que seguir e dizer ONDE parou.
      case "/pulo1": return mandar(302, "text/plain", "", { Location: "/pulo2" });
      case "/pulo2": return mandar(301, "text/plain", "", { Location: "/final.m3u8" });
      case "/final.m3u8": return mandar(200, "application/vnd.apple.mpegurl", ROTA_M3U8_MIDIA);
      case "/laco": return mandar(302, "text/plain", "", { Location: "/laco" });
      // Arquivo que nunca responde: mesma armadilha da playlist lenta, no caminho do MP4.
      case "/lento.mp4": return;
      default: return mandar(404, "text/plain", "rota desconhecida");
    }
  });
  // Sem `host`: escuta nos dois. O `localtest.me` (e o `nip.io`) resolvem para 127.0.0.1 E
  // para ::1, e o Node tenta o IPv6 primeiro — com o servidor preso so no IPv4 o relay takes
  // ECONNREFUSED em ::1 e o teste falha por um motivo que nao tem nada a ver com o relay.
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  const conexoes = server && server.closeAllConnections ? server.closeAllConnections() : null;
  if (conexoes && typeof conexoes.then === "function") conexoes.then(() => {});
});

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// O relay recebe a RESPOSTA DO CLIENTE (um response de Express) e escreve nela: `.set`,
// `.status`, `.send` e, no caminho de midia, um `stream.pipe` de verdade. Por isso o double
// precisa ser um Writable de verdade e nao um objeto com metodos.
const { Writable } = require("node:stream");

// Espera a resposta chegar em vez de cravar um tempo. O relay tem RATE LIMIT POR HOST
// (`HOST_RATE_LIMIT_MS`), entao um pedido feito logo depois do anterior pode nao ter ido a origem
// ainda — medir em tempo fixo media a fila, e nao o relay.
async function esperaResposta(cliente, limiteMs = 4000) {
  const passo = 40;
  for (let gasto = 0; gasto < limiteMs; gasto += passo) {
    if (cliente.corpo !== null || cliente.statusCode !== 200 || cliente.finalizado || cliente.headersSent) {
      if (cliente.corpo !== null || cliente.finalizado) return cliente;
    }
    await espera(passo);
  }
  return cliente;
}

function novoCliente() {
  const partes = [];
  const c = new Writable({
    // O Express marca `headersSent` no PRIMEIRO write (e nao no `set`), e o relay depende disso:
    // sem marcar, `failConsumers` acha que ainda pode mandar 502 para quem ja esta recebendo
    // bytes. O double precisa ser fiel nesse ponto.
    write(chunk, _enc, cb) { c.headersSent = true; partes.push(Buffer.from(chunk)); cb(); },
    final(cb) { c.finalizado = true; cb(); },
  });
  c.statusCode = 200;
  c.headersSent = false;
  c.destroyed = false;
  c.headers = {};
  c.corpo = null;
  c.set = function (h, v) {
    if (h && typeof h === "object") Object.assign(c.headers, h);
    else c.headers[h] = v;
    return c;
  };
  c.status = function (cod) { c.statusCode = cod; return c; };
  c.send = function (b) {
    c.corpo = b === undefined ? "" : b;
    partes.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b)));
    c.headersSent = true;
    c.writableEnded = true;
    c.end();
    return c;
  };
  c.texto = () => partes.map((p) => p.toString("utf8")).join("");
  c.bytes = () => Buffer.concat(partes);
  return c;
}

// Hostname que o DNS leva para 127.0.0.1 sem o filtro de IP privado pegar (o filtro ve so o
// nome, e `127.0.0.1.nip.io` comeca com `127.` e cai nele).
const NOME = "localtest.me";
let porNome = "";

/* ---------------------------------------------------------------- prova de vida */

test("prova de vida: playlist de verdade responde viva e com a qualidade da variante maior", async () => {
  const mestre = await provaDe(`${base}/mestre.m3u8`);
  assert.equal(mestre.vivo, true);
  // A variante de 1920x1080 e a que o player escolhe, entao e a que tem que aparecer.
  assert.equal(mestre.qualidade, "1080p");

  const midia = await provaDe(`${base}/midia.m3u8`);
  assert.equal(midia.vivo, true);
  // Midia sem EXT-X-STREAM-INF nao tem variante: qualidade e nulo, e o link continua de pe.
  assert.equal(midia.qualidade, null);
});

test("prova de vida: as quatro mortes confirmadas saem da lista, cada uma com o seu motivo", async () => {
  // Playlist VAZIA com 200: foi o que fez o Stremio trocar de player em laco no REI.
  const vazia = await provaDe(`${base}/vazia.m3u8`);
  assert.equal(vazia.vivo, false);
  assert.match(vazia.motivo, /sem segmento/, "playlist sem segmento precisa ter motivo proprio");

  const naoPlaylist = await provaDe(`${base}/naoplaylist.m3u8`);
  assert.equal(naoPlaylist.vivo, false);
  assert.match(naoPlaylist.motivo, /nao e playlist/, "texto que nao e playlist tem que ser dito");

  // 200 com text/html e a PAGINA DE ERRO da origem (kakito -> voltm.uk), nao um video.
  const html = await provaDe(`${base}/erro.html`);
  assert.equal(html.vivo, false);
  assert.match(html.motivo, /pagina de erro/);

  for (const [rota, motivo] of [["/morto.m3u8", "404"], ["/proibido.m3u8", "403"], ["/sumiu.m3u8", "410"], ["/juridico.m3u8", "451"], ["/quebrado.m3u8", "500"]]) {
    const r = await provaDe(base + rota);
    assert.equal(r.vivo, false, `${rota} tem que ser condemnada`);
    assert.match(r.motivo, new RegExp(motivo), `${rota}: o motivo tem que citar ${motivo}`);
  }
});

test("prova de vida: LENTIDÃO nunca condena o link (a assimetria que impede o modulo de piorar as coisas)", async () => {
  // A origem nao responde. A sonda estoura o tempo e devolve `vivo: null` — que significa
  // "nao deu para provar", e o link e MANTIDO. Descartar aqui custaria cobertura de graca.
  const lento = await provaDe(`${base}/lento.m3u8`, { timeoutMs: 250 });
  assert.equal(lento.vivo, null, "timeout tem que ser null, nunca false");
  assert.ok(lento.motivo, "mesmo sem veredicto o motivo e registrado");

  const mp4Lento = await provaDe(`${base}/lento.mp4`, { timeoutMs: 250 });
  assert.equal(mp4Lento.vivo, null, "lento tambem em arquivo continua nao prova de morte");
});

test("prova de vida: arquivo responde por faixa, e o que devolve 404 sai", async () => {
  const faixa = await provaDe(`${base}/video.mp4`);
  assert.equal(faixa.vivo, true);

  const morto = await provaDe(`${base}/morto.mp4`);
  assert.equal(morto.vivo, false);
  assert.match(morto.motivo, /404/);

  const pagina = await provaDe(`${base}/video.html`);
  assert.equal(pagina.vivo, false);
  assert.match(pagina.motivo, /pagina de erro/, "html para arquivo tambem e pagina de erro");
});

test("prova de vida: descartaMortos tira o que MORREU e mantem o que nao deu para provar", async () => {
  const antes = stats();
  const lista = [
    { id: "vivo:mestre", name: "vivo", url: `${base}/mestre.m3u8` },
    { id: "morto:404", name: "morto", url: `${base}/morto.m3u8` },
    { id: "lento:x", name: "lento", url: `${base}/lento.m3u8` },
    { id: "vazio:x", name: "vazio", url: `${base}/vazia.m3u8` },
  ];
  const saida = await descartaMortos(lista, { timeoutMs: 250 });
  // O modulo tira do ARRAY RECEBIDO (o servidor devolve esse mesmo array na resposta) e devolve
  // o relatorio do que tirou — e nao uma copia filtrada.
  const urls = lista.map((s) => s.url);
  assert.ok(urls.includes(`${base}/mestre.m3u8`), "o que responde fica");
  assert.ok(urls.includes(`${base}/lento.m3u8`), "o que nao deu para provar fica");
  assert.ok(!urls.includes(`${base}/morto.m3u8`), "o 404 sai");
  assert.ok(!urls.includes(`${base}/vazia.m3u8`), "a playlist sem segmento sai");
  assert.equal(saida.removidos, 2, "dois fora: o 404 e a playlist sem segmento");
  assert.ok(Array.isArray(saida.mortos) && saida.mortos.length === 2);
  assert.ok(saida.mortos.every((m) => m.motivo && m.url), "todo morto vem com motivo e endereco");

  const depois = stats();
  assert.ok(depois.proved >= antes.proved, "a contagem de sondas anda para frente");
  assert.ok(depois.mortos >= antes.mortos, "e a de mortos tambem");
});

test("prova de vida: com TODOS os candidatos mortos, a lista fica vazia — e isso e a regra", async () => {
  // AREGRA DO DONO: "fonte que nao toca no 1o play nao entra". Morto confirmado sai, mesmo que
  // isso esvazie a lista. A excecao existe em outro modulo (o pipeline do xtream mantem o
  // conjunto quando TODOS morrem, porque ali o criterio e ano/runtime e nao vida) — aqui o
  // criterio e vida, e link morto na tela da pessoa e pior do que lista curta.
  //
  // Importante: isso so acontece com MORTE CONFIRMADA. O que nao deu para provar continua
  // entrando (o teste acima prova isso), e e por isso que a lista so esvazia quando nenhuma
  // fonte tem nada vivo.
  const todosMortos = [
    { id: "a", name: "a", url: `${base}/morto.m3u8` },
    { id: "b", name: "b", url: `${base}/proibido.m3u8` },
  ];
  const saida = await descartaMortos(todosMortos, { timeoutMs: 400 });
  assert.equal(todosMortos.length, 0, "todos mortos saem todos");
  assert.equal(saida.removidos, 2);
  assert.ok(saida.mortos.every((m) => /HTTP (404|403)/.test(m.motivo)), "cada saida diz o status que a condenou");

  // E o filtro ignora o que ja e relay nosso (sondar a si mesmo nao diz nada da origem).
  const jaRelay = [{ id: "r", name: "r", url: "https://mirror-x.workers.dev/stream/proxy?u=abc" }];
  const semCandidato = await descartaMortos(jaRelay, { timeoutMs: 400 });
  assert.equal(semCandidato.removidos, 0);
  assert.equal(jaRelay.length, 1, "relay nosso nunca entra na lista de mortos");

  // E link sem http(s) (ou seja, sem onde sondar) nunca e julgado.
  const semUrl = [{ id: "z", name: "z", url: "magnet:?xt=1" }];
  await descartaMortos(semUrl, { timeoutMs: 400 });
  assert.equal(semUrl.length, 1, "sem http nao ha prova de morte possivel");
});

/* ------------------------------------------------------------------ relay */

// OS TESTES DE RELAY SAIRAM DAQUI NA DECISAO 155.
//
// Eram 12, e cobriam exatamente o `lib/stream-relay.js`: a reescrita de playlist para o proxy,
// a chave de stream compartilhado, o `resolveRedirects` (recusa de IP privado, protocolo
// estranho e laco infinito), as metricas, a midia ao vivo entrando no mesmo stream, e os dois
// casos de FAIXA (206 byte a byte, e o relay cortando sozinho quando a origem ignora `Range`,
// que era o defeito de 29/09/2026).
//
// Esse arquivo foi apagado junto com a rota `/stream/hls/*`, a mascara e o proxy: o video nao
// passa mais pelo servidor. Os dois modulos que FICARAM neste arquivo — `prova-viva` e
// `url-resolver` — continuam com os seus testes, porque continuam no codigo.
//
// A cobertura que a 130 mediu para o relay (12% -> 82%) nao se aplica mais: nao ha relay.
// O que substitui essa garantia e' o `test/caminho-do-byte` do plugin (`nuvio/`), que e'
// onde o byte trafega agora.

test("resolvedor: reconhece os hosters que ele sabe desfazer e recusa o resto", () => {
  // A lista e o contrato: se um hoster novo entrar no codigo sem entrar aqui, o teste avisa.
  for (const [url, hoster] of [
    ["https://www.mediafire.com/file/abc/video.mp4", "mediafire"],
    ["https://streamtape.com/e/abc123", "streamtape"],
    ["https://fembed.com/v/abc", "fembed"],
    ["https://vidcloud.pro/e/abc", "vidcloud"],
    ["https://sendvid.com/abc", "sendvid"],
    ["https://mixdrop.co/abc", "mixdrop"],
    ["https://doodstream.com/abc", "doodstream"],
    ["https://streamlare.com/e/abc", "streamlare"],
    ["https://streamsb.com/e/abc", "streamsb"],
    ["https://vidplay.site/e/abc", "vidplay"],
    ["https://filemoon.sx/e/abc", "filemoon"],
    ["https://mp4upload.com/e/abc", "mp4upload"],
    ["https://streamwish.com/e/abc", "streamwish"],
    ["https://www.veoh.com/watch/abc", "veoh"],
    ["https://ok.ru/video/abc", "okru"],
  ]) {
    assert.equal(detectHost(url), hoster, `${url} tem que ser reconhecido como ${hoster}`);
    assert.ok(HOSTERS[hoster] && typeof HOSTERS[hoster].resolve === "function",
      `${hoster} sem resolve() e uma promessa que o codigo nao cumpre`);
  }
  // Endereco direto e o caso comum: nao ha o que desfazer, devolve ele mesmo.
  assert.equal(detectHost("https://cdn.exemplo/video.mp4"), "direct");
  assert.equal(detectHost("nao-e-url"), null);
});

test("resolvedor: midoria sao as extensoes que o player reconhece (e o resto volta como ta)", () => {
  for (const u of ["https://x/a.m3u8", "https://x/a.mp4", "https://x/a.ts", "https://x/a.mkv", "https://x/a.webm"]) {
    assert.equal(ehMidia(u), true, `${u} e midia`);
  }
  assert.equal(ehMidia("https://x/pagina.html"), false);
  assert.equal(ehMidia(""), false);
});

test("resolvedor: devolve null para o que nao sabe desfazer, em vez de inventar URL", async () => {
  assert.equal(await resolveUrl(""), null);
  assert.equal(await resolveUrl(null), null);
  assert.equal(await resolveUrl("nao-e-url"), null, "lixo nao pode virar URL de midia");
  // Endereco direto passa por ele mesmo — e o que mantem o playback quando o hoster sumiu.
  const direto = `https://cdn.exemplo/video.m3u8?token=abc`;
  assert.equal(await resolveUrl(direto), direto);
});

/* ------------------------------------------------------------------ higiene geral */

test("sanidade do byte: o servidor de teste respondeu o que os testes assumem", async () => {
  const r = await fetch(`${base}/midia.m3u8`);
  const texto = await r.text();
  assert.match(texto, /#EXTM3U/);
  assert.match(texto, /seg1\.ts/);
  const mp4 = await fetch(`${base}/video.mp4`, { headers: { Range: "bytes=0-15" } });
  assert.equal(mp4.status, 206, "o servidor precisa responder 206 de verdade, senao o teste nao mede faixa");
  assert.match(mp4.headers.get("content-range") || "", /^bytes 0-15\//);
  await espera(10);
});