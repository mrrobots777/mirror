const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// RAIZ = a raiz do produto que este teste cobre (o addon). REPO = a raiz do monorepo,
// de onde vem o worker e o deploy — que servem aos tres produtos, nao so ao addon.
const RAIZ = path.join(__dirname, "..");
const REPO = path.join(__dirname, "..", "..");

function arquivos(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      arquivos(p, acc);
    } else if (e.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

test("nenhum timer se registra dentro da propria funcao que o timer chama", () => {
  // Este padrao multiplica os timers a cada disparo (2, 4, 8...) e foi o que matou o
  // cluster de TV: 99 buscas de token no mesmo segundo e `FATAL ERROR: Reached heap limit`.
  const alvos = arquivos(path.join(RAIZ, "src")).concat(["relay-server.js", "br-relay.js"].map((f) => path.join(RAIZ, f)));
  const achados = [];

  for (const arquivo of alvos) {
    if (!fs.existsSync(arquivo)) continue;
    const linhas = fs.readFileSync(arquivo, "utf8").split("\n");
    // Um `setInterval` na COLUNA 1 esta no nivel do modulo: roda uma vez e nunca se
    // re-registra, mesmo que a funcao que ele chama esteja logo acima. So e defeito quando
    // o registro esta RECUADO, dentro do corpo da funcao.
    linhas.forEach((l, i) => {
      const m = l.match(/^(\s+)set(Interval|Immediate)\(\s*([A-Za-z_$][\w$]*)/);
      if (!m) return;
      // procura a propria funcao: a linha de declaracao acima cujo corpo contem este registro
      let dono = null;
      for (let k = i - 1; k >= 0 && k > i - 40; k--) {
        const decl = linhas[k].match(/^(?:async\s+)?function\s+(\w+)|^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
        if (!decl) continue;
        // a declaracao e da propria funcao alvo?
        if ((decl[1] || decl[2]) !== m[3]) { dono = null; break; }
        dono = m[3];
        break;
      }
      if (dono === m[3]) achados.push(`${arquivo}:${i + 1} set${m[2]} DENTRO de ${dono}() (recuo ${m[1].length}) — se re-registra a cada disparo`);
    });
  }

  assert.deepEqual(achados, [], `timer que se re-registra: ${achados.join("; ")}`);
});

test("RTD: worker fixado em Sao Paulo para a API do RTD (decisao 123)", () => {
  // O RTD so atende quem chama DO BRASIL (medido 30/09/2026): direto 403 de fora e 200 do
  // Brasil, e via worker o mesmo — porque o worker roda no data center de quem chamou, entao
  // chamando da prod ele continuava fora e a fonte morria inteira (play-link, catalog-index e
  // video). Sem esta colocacao fixa a prod nao volta a servir RTD.
  const toml = fs.readFileSync(path.join(REPO, "wrangler.toml"), "utf8");
  assert.ok(/^\s*region\s*=\s*"aws:sa-east-1"\s*$/m.test(toml), "worker sem colocacao fixa em aws:sa-east-1");
  assert.ok(!/^\s*region\s*=\s*"aws:(?!sa-east-1)/m.test(toml), "colocacao em outra regiao que nao e Sao Paulo");
});

test("um worker por fonte: o deploy sai do registro, e o aquecimento do RTD esta no worker (decisao 124)", () => {
  // O pedido do dono foi "crie um worker para cada fonte" para ISOLAR COTA (o plano gratis da
  // Cloudflare da cota por worker). Duas coisas podem quebrar isso em silencio:
  //  (a) o `deploy-workers.sh` publicando uma lista escrita a mao — ai nasce worker que o
  //      addon nao usa e fonte que usa worker que ninguem publicaria;
  //  (b) o `mirror-rtd` deixar de fazer 2 subrequests para o MESMO destino, que e o sinal que
  //      a Cloudflare exige para mover o worker para perto da origem (e o RTD so responde
  //      do Brasil).
  const sh = fs.readFileSync(path.join(REPO, "deploy-workers.sh"), "utf8");
  assert.ok(/require\("\.\/src\/core\/nomes"\)/.test(sh), "deploy-workers.sh nao le a lista do registro unico");
  assert.ok(/WORKERS/.test(sh), "deploy-workers.sh nao usa WORKERS do registro");
  assert.ok(!/mirror-(blz|spc|ato|rtd|emb)\b/.test(sh), "deploy-workers.sh tem nome de worker escrito a mao");
  assert.ok(/echo "\[placement\]"/.test(sh) && /echo "mode = \\"smart\\""/.test(sh),
    "o worker do RTD sem Smart Placement (o RTD e o unico que so responde do Brasil)");

  const worker = fs.readFileSync(path.join(REPO, "worker-simple.js"), "utf8");
  assert.ok(/function aqueceParaRtd/.test(worker), "o worker perdeu o aquecimento para o Smart Placement");
  assert.ok(/aqueceParaRtd\(targetUrl\)/.test(worker) && /aqueceParaRtd\(decoded\)/.test(worker),
    "o aquecimento precisa entrar nas DUAS rotas que chamam o RTD (/rde/seg e /proxy)");
  assert.ok(/redetoonstv\.win\/favicon\.ico/.test(worker), "o aquecimento tem que ser uma chamada barata de verdade");
});

test("a VPS do dono nao volta: nenhum arquivo referencia a Oracle nem ao relay BR", () => {
  // O dono pediu (29/09/2026): ficar so com BeamUp + Cloudflare + Cloudflare Worker. A VPS
  // (144.33.21.1) servia apenas o token do KAK, que saiu da TV ao vivo na decisao 108 — o
  // proprio modulo confirmava, em producao, `listasNoCache:0` e `verificados:{ok:0,total:0}`.
  // Este teste falha se alguem reintroduzir o endereco, o nome do relay ou a pasta dele.
  const alvos = [
    path.join(RAIZ, "src"),
    path.join(REPO, "worker-simple.js"),
    path.join(REPO, "Dockerfile"),
    path.join(RAIZ, "package.json"),
    path.join(RAIZ, "src", "server.js")
  ];
  const proibidos = [/144\.33\.21\.1/, /BR_RELAY_URL/, /BR_TOKEN_URL/, /BR_PLAYLIST_URL/, /br-relay/i];
  const achados = [];
  const anda = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) return fs.readdirSync(p).forEach((n) => anda(path.join(p, n)));
    if (!/\.(js|json)$/.test(p) && p !== "Dockerfile") return;
    const txt = fs.readFileSync(p, "utf8");
    proibidos.forEach((re) => { if (re.test(txt)) achados.push(p + " casa com " + re); });
  };
  alvos.forEach(anda);
  assert.deepEqual(achados, [], `relay BR de volta: ${achados.join("; ")}`);
});
