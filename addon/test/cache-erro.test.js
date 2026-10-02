// A BORDA NAO PODE GUARDAR ERRO — e o servidor nao pode cair por causa de um.
//
// O problema que este arquivo trava (decisao 140, corrigido na 154): a zona do BeamUp reescreve o
// `Cache-Control` da origem para `public, max-age=14400`, entao um 404 transitório ficava 4 horas
// na borda. A guarda que resolvia isso estava no `res.on("finish")` — e o `finish` dispara DEPOIS
// dos headers irem, entao o `setHeader` levantava ERR_HTTP_HEADERS_SENT em TODA resposta >= 400. O
// `uncaughtException` do servidor chama `process.exit(1)`: um 404 derrubava o addon inteiro.
//
// O teste sobe um servidor HTTP de verdade e pergunta, porque o defeito e' justamente de headers
// no fio — nenhum teste de texto de arquivo pegaria isso.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const express = require("express");

const { proibeCacheDeErro, CABECALHOS_DE_ERRO } = require("../src/lib/cache-erro");

function sobe(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve({ server, porta: server.address().port }));
  });
}

function pega(porta, caminho) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: porta, path: caminho }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on("error", reject);
  });
}

test("decisao 140/154: erro sai com no-store e o processo sobrevive ao 404", async () => {
  const app = express();
  app.use((req, res, next) => {
    res.set("Cache-Control", "public, max-age=120");
    next();
  });
  app.use(proibeCacheDeErro);
  app.get("/ok.json", (_req, res) => res.json({ ok: true }));
  app.get("/some.json", (_req, res) => res.status(404).json({ error: "nao achei" }));
  app.get("/quebrou.json", (_req, res) => res.status(500).json({ error: "deu ruim" }));

  const { server, porta } = await sobe(app);
  try {
    const bom = await pega(porta, "/ok.json");
    assert.equal(bom.status, 200);
    assert.equal(bom.headers["cache-control"], "public, max-age=120",
      "resposta boa continua cacheavel — a guarda e' so do erro");

    for (const [caminho, status] of [["/some.json", 404], ["/quebrou.json", 500]]) {
      const ruim = await pega(porta, caminho);
      assert.equal(ruim.status, status);
      assert.equal(ruim.headers["cache-control"], "no-store",
        `${status} nao pode ser guardado pela borda por 4 horas`);
      // O que a Cloudflare respeita para o TTL DA BORDA e' separado do TTL da origem.
      assert.equal(ruim.headers["cdn-cache-control"], "no-store");
      assert.equal(ruim.headers["cloudflare-cdn-cache-control"], "no-store");
      for (const nome of CABECALHOS_DE_ERRO) assert.equal(ruim.headers[nome.toLowerCase()], "no-store");
    }

    // O servidor continua de pe depois dos dois erros: era o `uncaughtException` que matava o
    // processo, e nao a resposta.
    assert.equal(server.listening, true, "o servidor caiu depois de um 404");
    assert.equal((await pega(porta, "/ok.json")).status, 200, "o servidor parou de responder");
  } finally {
    server.close();
  }
});

test("decisao 154: o guarda nao usa o evento finish (e' o que causava o crash)", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "cache-erro.js"), "utf8");
  assert.equal(/on\(\s*["']finish["']/.test(src), false,
    "o finish dispara depois dos headers irem — e o que produzia ERR_HTTP_HEADERS_SENT");
  assert.match(src, /writeHead/, "a guarda tem que entrar no writeHead, que roda antes de enviar");
});