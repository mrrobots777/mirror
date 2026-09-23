// REGISTRO ÚNICO DAS FONTES DO PLUGIN.
//
// Toda fonte se declara UMA VEZ aqui. O resto do plugin deriva:
//   * `build.js` gera o `manifest.json` do repositório a partir daqui
//     (o manifesto virou saída de build — não existe mais escrito à mão);
//   * `teste.js` acha o arquivo da fonte por `arquivo`;
//   * `tools/gerar-indice.js` lê a credencial do painel em `arquivo`;
//   * este arquivo não é bundlado em nenhum scraper: quem precisa dele é o
//     tooling (Node), nunca o runtime do Nuvio.
//
// Campos:
//   chave      identificador do scraper no repositório do Nuvio ("blz")
//   sigla      o nome curto que aparece na lista de fontes do app ("BLZ")
//   arquivo    módulo do scraper em `src/scrapers/` (kebab-case)
//   tipos      `supportedTypes` do manifesto ("channel" = TV ao vivo)
//   conteudos  o que a fonte ENTREGA (categoria de conteúdo)
//   descricao  uma linha do manifesto, que o dono lê na tela de Plugins
//   idx        namespace do shard em `public/idx/` (só painéis com índice)
//   prefixo    como a fonte de TV é sinalizada no id do canal
//
// Para mudar qualquer nome, arquivo ou tipo: muda AQUI e só aqui.

const GRUPOS = {
  vod: "CDN VOD",
  tv: "CDN TV",
};

const CONTEUDOS = ["anime", "filme", "serie", "dorama", "tv"];

function rotuloDe(grupo, sigla) {
  return `${GRUPOS[grupo]} | ${sigla}`;
}

const NOME_REPOSITORIO = "Mirror";
const VERSAO_REPOSITORIO = "1.0.0";
const VERSAO_SCRAPER = "1.0.0";
const DESCRICAO_REPOSITORIO =
  "Fontes do Mirror para o Nuvio: anime, filmes, séries, doramas e TV ao vivo";

const FONTES = {
  shg: {
    sigla: "SHG",
    arquivo: "otakulogia.js",
    tipos: ["movie", "tv"],
    conteudos: ["anime"],
    descricao: "Anime dublado PT-BR via SHG (otakulogia)"
  },
  ron: {
    sigla: "RON",
    arquivo: "animesdigital.js",
    tipos: ["movie", "tv"],
    conteudos: ["anime"],
    descricao: "Anime PT-BR/legendado via RON (animesdigital)"
  },
  aon: {
    sigla: "AON",
    arquivo: "aon.js",
    tipos: ["movie", "tv"],
    conteudos: ["anime"],
    descricao: "Anime PT-BR/legendado via AON (animesonline.io)"
  },
  atb: {
    sigla: "ATB",
    arquivo: "anitube.js",
    tipos: ["movie", "tv"],
    conteudos: ["anime"],
    descricao: "Anime PT-BR/legendado via ATB (anitube.biz)"
  },
  spt: {
    sigla: "SPT",
    arquivo: "playerflix.js",
    tipos: ["movie", "tv"],
    conteudos: ["filme", "serie"],
    descricao: "Filmes e séries via SPT (playerflix.ink)"
  },
  blz: {
    sigla: "BLZ",
    arquivo: "painel-blaze.js",
    tipos: ["movie", "tv"],
    conteudos: ["filme", "serie"],
    descricao: "Filmes e séries via BLZ (kakito)",
    idx: "blz"
  },
  spc: {
    sigla: "SPC",
    arquivo: "painel-space.js",
    tipos: ["movie", "tv"],
    conteudos: ["filme", "serie"],
    descricao: "Filmes e séries via SPC (telaplay)",
    idx: "spc"
  },
  ato: {
    sigla: "ATO",
    arquivo: "painel-autos.js",
    tipos: ["movie", "tv"],
    conteudos: ["filme", "serie"],
    descricao: "Filmes e séries via ATO (painel Xtream)",
    idx: "ato"
  },
  rtd: {
    sigla: "RTD",
    arquivo: "redetoons.js",
    tipos: ["movie", "tv"],
    conteudos: ["anime", "filme", "serie"],
    descricao: "Filmes, séries e anime via RTD (RedeToons)"
  },
  dgo: {
    sigla: "DGO",
    arquivo: "doramogo.js",
    tipos: ["movie", "tv"],
    conteudos: ["dorama"],
    descricao: "Doramas via DGO (doramogo)"
  },
  vzr: {
    sigla: "VZR",
    arquivo: "vizer.js",
    tipos: ["movie", "tv"],
    conteudos: ["filme", "serie"],
    descricao: "Filmes e séries via VZR (vizer)"
  },
  rei: {
    sigla: "REI",
    arquivo: "reidosembeds.js",
    tipos: ["channel"],
    conteudos: ["tv"],
    descricao: "TV ao vivo via REI (reidosembeds)",
    prefixo: "rei:"
  },
  emb: {
    sigla: "EMB",
    arquivo: "embedtv.js",
    tipos: ["channel"],
    conteudos: ["tv"],
    descricao: "TV ao vivo via EMB (embedtv)",
    prefixo: "emb:"
  },
  etc: {
    sigla: "ETC",
    arquivo: "embedcanais.js",
    tipos: ["channel"],
    conteudos: ["tv"],
    descricao: "TV ao vivo via ETC (sinal público)",
    prefixo: "etc:"
  },
  rcd: {
    sigla: "RCD",
    arquivo: "reidoscanais.js",
    tipos: ["channel"],
    conteudos: ["tv"],
    descricao: "TV ao vivo via RCD (reidoscanais)",
    prefixo: "rcd:"
  }
};

function fonte(chave) {
  const f = FONTES[chave];
  if (!f) throw new Error(`fonte fora do registro (src/core/fontes.js): ${chave}`);
  return f;
}

function chaves() {
  return Object.keys(FONTES);
}

function fontesDe(conteudo) {
  return chaves().filter(chave => FONTES[chave].conteudos.includes(conteudo));
}

function fontesComIndice() {
  return chaves().filter(chave => !!FONTES[chave].idx);
}

function arquivoDe(chave) {
  return fonte(chave).arquivo;
}

function bundleDe(chave) {
  return `${chave}.js`;
}

function grupo(chave) {
  return FONTES[chave].tipos.includes("channel") ? "tv" : "vod";
}

function rotulo(chave) {
  return rotuloDe(grupo(chave), sigla(chave));
}

function sigla(chave) {
  const f = FONTES[chave];
  return f ? f.sigla : String(chave || "").toUpperCase();
}

function prefixo(chave) {
  const f = FONTES[chave];
  return f && f.prefixo !== undefined ? f.prefixo : `${chave}:`;
}

function conteudo(chave) {
  return FONTES[chave].conteudos.join(", ");
}

function scrapers() {
  return chaves().map(chave => {
    const f = FONTES[chave];
    return {
      id: chave,
      name: f.sigla,
      version: VERSAO_SCRAPER,
      filename: bundleDe(chave),
      description: f.descricao,
      supportedTypes: f.tipos.slice()
    };
  });
}

function manifesto() {
  return {
    name: NOME_REPOSITORIO,
    version: VERSAO_REPOSITORIO,
    description: DESCRICAO_REPOSITORIO,
    author: NOME_REPOSITORIO,
    scrapers: scrapers()
  };
}

module.exports = {
  CONTEUDOS,
  DESCRICAO_REPOSITORIO,
  FONTES,
  GRUPOS,
  NOME_REPOSITORIO,
  VERSAO_REPOSITORIO,
  VERSAO_SCRAPER,
  arquivoDe,
  bundleDe,
  chaves,
  conteudo,
  fonte,
  fontesComIndice,
  fontesDe,
  grupo,
  manifesto,
  prefixo,
  rotulo,
  scrapers,
  sigla
};