// ERRO NAO SE GUARDA, EM ROTA NENHUMA (decisao 140).
//
// O problema que a decisao resolveu: a zona do BeamUp REESCREVE o `Cache-Control` da origem para
// `public, max-age=14400` (4 horas) e ainda assim guarda o erro. Um 404 transitório — uma fonte de
// TV que caiu por 30 segundos — ficava na borda por 4 horas e continuava sendo servido para todo
// mundo depois de a origem voltar. Para o usuário é indistinguível de "o addon está quebrado": o
// player recebe um link que não resolve.
//
// A IMPLEMENTAÇÃO QUE ESTAVA AQUI NÃO FUNCIONAVA (medido 02/10/2026, decisão 154). O header era
// posto no evento `finish` da resposta, que dispara DEPOIS dos headers irem: todo `setHeader` ali
// era tarde. Resultado: `ERR_HTTP_HEADERS_SENT` em TODA resposta >= 400. E como o
// `uncaughtException` do servidor chama `process.exit(1)`, um 404 qualquer derrubava o addon
// inteiro — que é "o addon caiu", sem nenhum aviso antes.
//
// O conserto é mexer no `writeHead`, que é o último ponto em que o cabeçalho ainda é nosso. É a
// hora de trocar o `public, max-age=120` do middleware geral por `no-store` quando o status for de
// erro. Nada mais muda: resposta boa continua cacheável, erro não.
const CABECALHOS_DE_ERRO = ["Cache-Control", "CDN-Cache-Control", "Cloudflare-CDN-Cache-Control"];

function proibeCacheDeErro(req, res, next) {
  const writeHeadOriginal = res.writeHead;
  res.writeHead = function (...args) {
    if (this.statusCode >= 400) {
      for (const nome of CABECALHOS_DE_ERRO) this.setHeader(nome, "no-store");
    }
    return writeHeadOriginal.apply(this, args);
  };
  return next();
}

module.exports = { proibeCacheDeErro, CABECALHOS_DE_ERRO };