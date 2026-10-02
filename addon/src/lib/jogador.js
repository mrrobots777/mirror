// AS PARTES DE UM PLAYER, SEPARADAS. Uma fonte so de verdade.
//
// MEDIDO 01/10/2026: o titulo do player era um texto unico montado em tres lugares diferentes
// (`vodTitle` nos scrapers, `rankAnimeStreams` no servidor, e a linha de guia da TV colada
// depois). O resultado era que o mesmo conteudo aparecia com nomes diferentes conforme a fonte
// — "Breaking Bad: A Quimica do Mal" no BLZ e "Breaking Bad" no SPT — e quem quisesse consumir
// por programa tinha que abrir o texto e adivinhar onde estava a fonte, a qualidade e o
// idioma.
//
// Aqui o player e decomposto em pecas nomeadas, e o texto da tela e montado a partir delas. O
// mesmo objeto serve para o Stremio (que so sabe mostrar texto) e para a API (que devolve as
// pecas soltas).
//
// As pecas, sempre neste formato:
//
//   nome         "Breaking Bad"        o nome do conteudo, sem ano/qualidade/fonte
//   ano          1999                  so filme; serie costuma nao ter
//   temporada    1                     null em filme e TV
//   episodio     1                     null em filme e TV
//   episodioRot  "S01E01"              "" quando nao ha temporada/episodio
//   qualidade    "720p"                "unknown" quando nao se sabe
//   fonte        "BLZ"                 a sigla curta que o dono ve
//   fonteId      "blz"                 a chave do registro unico (core/nomes.js)
//   fonteNome    "CDN VOD | BLZ"       o rotulo completo do registro
//   idioma       "portugues" | "legendado" | "desconhecido"
//   idiomaRot    "Portugues" | "Legendado" | ""
//
// O `idioma` tem tres valores e nao dois, e isso e deliberado: antes o projeto so escrevia
// "Legendado" quando SABIA que nao era dublado (`getAudioInfo` devolvia `null` para audio
// desconhecido, e o servidor caia em outro caminho). streams sem informacao de audio vao
// para "desconhecido", que e uma informacao util — e impede o erro de afirmar "Legendado"
// num stream que e dublado e so nao declarou.

const { getSourceDisplayName, getSourceCodename } = require("./source-names");
const { FONTES } = require("../core/nomes");

const EMOJI = /^[🎬🌊🌎🧩📺💧☁️⏭️\s]+/u;

function limpaNome(texto) {
  return String(texto || "").replace(EMOJI, "").replace(/\s+/g, " ").trim();
}

// O texto do titulo do player vem em tres formatos diferentes conforme a origem:
//   filme   "🌊 Matrix (1999) · 720p · BLZ"
//   serie   "🌊 Breaking Bad · S01E01 · 720p · PROXY · ATO"
//   anime   "☁️ HBO · Direto · ETC"      (TV; a guia vem em linhas depois)
// Aqui a gente separa o que E nome do conteudo do que E etiqueta, em vez de adivinhar.
const ETIQUETAS = new Set([
  "proxy", "direto", "relay", "torrent", "unknown", "original", "remasterizado", "dublado", "legendado",
]);

function pareceQualidade(pedaco) {
  return /^\d{3,4}p$/i.test(pedaco) || /^(?:4k|uhd|hd|sd|full\s*hd|fhd)$/i.test(pedaco.trim());
}

function pareceEpisodio(pedaco) {
  return /^s\d{1,2}e\d{1,3}$/i.test(pedaco.replace(/\s+/g, "")) || /^\d{1,2}x\d{1,3}$/i.test(pedaco.trim());
}

function pareceFonte(pedaco) {
  const t = pedaco.trim();
  if (!t) return false;
  if (ETIQUETAS.has(t.toLowerCase())) return false;
  // sigla do registro: 2 a 5 letras, so maiusculas (BLZ, SPC, ATO, SHG, REI, EMB...)
  return /^[A-Z][A-Z0-9]{1,4}$/.test(t);
}

// A primeira linha do texto do player, ja sem emoji e sem as etiquetas conhecidas.
//
// A sigla da fonte tambem sai daqui, e e o que faz "Matrix (1999) BLZ" virar "Matrix (1999)"
// em vez de um nome com a fonte grudada. Sem isso o nome do player trazia a fonte DENTRO do
// titulo e a API devolvia "Matrix (1999) BLZ" como `nome`.
function primeiroNome(texto, siglasConhecidas) {
  const linha = String(texto || "").split("\n")[0] || "";
  const siglas = new Set((siglasConhecidas || []).map((x) => String(x).toUpperCase()));
  const ficam = linha
    .split("·")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((parte) => !ficaVazia(parte, siglas))
    .filter((parte) => !(siglas.has(parte.toUpperCase()) && !/\s/.test(parte)));
  return limpaNome(ficam.join(" "));
}

function ficaVazia(parte, siglas) {
  const t = String(parte || "").trim();
  if (!t) return true;
  if (pareceQualidade(t)) return true;
  if (pareceEpisodio(t)) return true;
  if (ETIQUETAS.has(t.toLowerCase())) return true;
  if (siglas && siglas.has(t.toUpperCase()) && !/\s/.test(t)) return true;
  return false;
}

function tiraAno(nome) {
  const m = String(nome || "").match(/^(.*?)\s*\(((?:19|20)\d{2})\)\s*$/);
  if (!m) return { nome: String(nome || "").trim(), ano: null };
  return { nome: m[1].trim(), ano: Number(m[2]) };
}

function temporadaEpisodioDe(stream, nomeTexto) {
  // 1) o proprio stream (a fonte sempre preenche season/episode)
  let temporada = Number(stream.season) || null;
  let episodio = Number(stream.episode) || null;
  if (!temporada && !episodio) {
    const achou = String(nomeTexto || "").match(/\bs(\d{1,2})e(\d{1,3})\b/i);
    if (achou) {
      temporada = Number(achou[1]);
      episodio = Number(achou[2]);
    }
  }
  // Filme e TV ao vivo nao tem temporada/episodio de verdade. `makeHttpStream` deixa 1 como
  // padrao, entao `1/1` aqui seria mentira: so vale quando o texto do player traz o rotulo.
  if (!String(nomeTexto || "").match(/\bs\d{1,2}e\d{1,3}\b/i) && !(stream.type === "series" && temporada)) {
    if (stream.type !== "series") {
      temporada = null;
      episodio = null;
    }
  }
  const temRot = temporada && episodio;
  return {
    temporada: temRot ? temporada : null,
    episodio: temRot ? episodio : null,
    episodioRot: temRot ? `S${String(temporada).padStart(2, "0")}E${String(episodio).padStart(2, "0")}` : "",
  };
}

function fonteDe(stream, nomeTexto) {
  // 1) a chave do proprio stream (o registro e a fonte da verdade)
  const fontes = (stream.sources || []).map((s) => String(s).toLowerCase()).filter(Boolean);
  const sigla = (chave) => {
    const f = FONTES[chave];
    return f ? f.sigla : String(chave).toUpperCase();
  };
  if (fontes.length) {
    const chave = fontes[0];
    return {
      fonte: sigla(chave),
      fonteId: chave,
      fonteNome: getSourceDisplayName(chave) || sigla(chave),
    };
  }
  // 2) o texto do player, quando o stream nao veio com `sources`
  const partes = String(nomeTexto || "").split("·").map((p) => p.trim()).filter(Boolean);
  for (const parte of partes) {
    if (pareceFonte(parte)) {
      const chave = Object.keys(FONTES).find((k) => FONTES[k].sigla === parte.toUpperCase());
      if (chave) return { fonte: parte.toUpperCase(), fonteId: chave, fonteNome: getSourceDisplayName(chave) || parte.toUpperCase() };
    }
  }
  return { fonte: "", fonteId: "", fonteNome: getSourceDisplayName("cas") || "Mirror" };
}

function idiomaDe(stream) {
  // `audioUnknown` e a marca de que a fonte NAO DECLARA audio. Sem ela, `dubbed`/`portuguese`
  ///`subtitle` valem. Com ela, o honesto e "desconhecido" — e o projeto nao pode afirmar
  // "Legendado" num stream que talvez seja dublado.
  if (stream.audioUnknown) return { idioma: "desconhecido", idiomaRot: "", dublado: null, legendado: null };
  const dublado = !!(stream.dubbed || stream.portuguese);
  const legendado = !!(stream.subtitle || (Array.isArray(stream.subtitles) && stream.subtitles.length > 0) || stream.dubbed === false && stream.portuguese === false && stream.subtitle === false);
  if (dublado) return { idioma: "portugues", idiomaRot: "Português", dublado: true, legendado: !!stream.subtitle };
  if (legendado) return { idioma: "legendado", idiomaRot: "Legendado", dublado: false, legendado: true };
  return { idioma: "desconhecido", idiomaRot: "", dublado: null, legendado: null };
}

function flagDe(idioma) {
  if (idioma === "portugues") return "🌎";
  if (idioma === "legendado") return "🧩";
  return "";
}

// DECOMPOE o player. E a funcao que importa.
function partesDe(stream, contexto) {
  const ctx = contexto || {};
  const texto = String(stream.title || "");
  // A fonte primeiro: e a sigla dela que precisa sair de dentro do nome do conteudo.
  const { fonte, fonteId, fonteNome } = fonteDe(stream, texto);
  const nomeComAno = primeiroNome(texto, [fonte]);
  const { nome, ano } = tiraAno(nomeComAno);
  const { temporada, episodio, episodioRot } = temporadaEpisodioDe(stream, nomeComAno);
  const qualidade = stream.quality && stream.quality !== "unknown" ? String(stream.quality) : "unknown";
  const { idioma, idiomaRot, dublado, legendado } = idiomaDe(stream);
  const aoVivo = !!(stream.isLive || stream.behaviorHints && stream.behaviorHints.live);
  // O NOME CANONICO GANHA. MEDIDO 01/10/2026: o mesmo serie aparecia com nomes diferentes conforme
  // a fonte — "Breaking Bad: A Quimica do Mal" no BLZ, "Breaking Bad" no SPT — e o usuario via
  // tres linhas quase iguais na lista, sem saber que eram o mesmo conteudo. O nome canonico vem do
  // METADADO (TMDB/AniList), que e o mesmo para todo mundo; o do painel e so um palpite do site.
  const canonico = String(ctx.nome || "").trim();
  return {
    nome: canonico || nome || (stream.type === "tv" ? "Canal" : "Filme"),
    titulo: nomeComAno || String(stream.title || "").split("\n")[0] || "",
    ano,
    temporada,
    episodio,
    episodioRot,
    qualidade,
    fonte,
    fonteId,
    fonteNome,
    idioma,
    idiomaRot,
    dublado,
    legendado,
    aoVivo,
    tipo: stream.type || "movie",
    // A GUIA DA TV E A UNICA COISA QUE FAZ SENTIDO IR JUNTO DO TEXTO: ela muda a cada minuto e
    // nao cabe em um campo de dado estavel.
    //
    // MEDIDO (decisao 141): o filtro e' por MARCADOR, e nao "tudo que estiver depois da 1a linha".
    // O titulo do player ja vem com a linha de IDIOMA e a de qualidade, e copiar "whatever vem
    // depois da 1a linha" jogava "🌎 Portugues" de volta para baixo do texto remontado — o
    // usuario lia a mesma informacao duas vezes. So entram as linhas que sao de fato guia.
    guia: texto
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => /^[📺⏭️]/u.test(l))
      .join("\n"),
    nomeContexto: ctx.nome || "",
  };
}

// O TEXTO DA TELA, montado a partir das pecas. Uma linha por informacao, na ordem que o
// olho le: o que e, onde estamos, em que idioma, em que qualidade, de onde.
//
// MEDIDO: a linha unica com "·" (decisao antiga) escondia a temporada no meio do nome e a
// fonte grudada na qualidade. Em telas estreitas de celular o texto era cortado e o usuario
// nao via nem o idioma nem a fonte.
// O TEXTO DA TELA, montado a partir das pecas — UMA INFORMAÇÃO POR LINHA, em cascata.
//
// O dono: "eu quero que no player das fontes não fiquem as coisas escritas uma do lado da outra e
// sim em cascata".
//
// MEDIDO (decisão 142): com tudo grudado por "·", a tela do celular cortava a linha pelo meio e o
// usuário perdia justamente o FIM — que é a fonte, a informação que diz de onde vem o vídeo. E numa
// tela estreita não há como ler "🌎 Português · 720p · BLZ" sem que uma das três desapareça.
//
// A ordem é a que o olho lê: o que é, onde estamos, em que idioma, em que qualidade, de onde.
function tituloDe(peças) {
  const p = peças || {};
  const emoji = p.tipo === "tv" ? "☁️" : "🌊";
  const linhas = [];
  // 1) O QUE E: o nome do conteudo e onde estamos dentro dele.
  const cabecalho = [p.nome, p.episodioRot].filter(Boolean).join(" · ");
  linhas.push(`${emoji} ${cabecalho}${p.ano ? ` (${p.ano})` : ""}`.trim());
  // 2) EM QUE IDIOMA.
  if (p.idiomaRot) linhas.push(`${flagDe(p.idioma)} ${p.idiomaRot}`);
  // 3) EM QUE QUALIDADE.
  if (p.qualidade && p.qualidade !== "unknown") linhas.push(p.qualidade);
  // 4) DE ONDE VEM.
  if (p.fonte) linhas.push(p.fonte);
  // 5) O QUE ESTA NO AR (so a TV tem, e e o que muda a cada minuto).
  if (p.guia) linhas.push(p.guia);
  return linhas.filter(Boolean).join("\n");
}

// O NOME CURTO da lista (a coluna estreita do Stremio). Mantem o formato que o projeto ja
// usava ("Mirror 720p") porque e o que o usuario reconhece de lista para lista, e acrescenta a
// fonte — que e o que diferencia dois players iguais.
// O NOME CURTO da lista (a coluna estreita do Stremio): "Mirror" + qualidade + fonte, sem o "·",
// que nao cabe numa coluna.
function nomeDe(peças) {
  const p = peças || {};
  const partes = ["Mirror"];
  if (p.qualidade && p.qualidade !== "unknown") partes.push(p.qualidade);
  if (p.fonte) partes.push(p.fonte);
  return partes.join(" ");
}

module.exports = { partesDe, tituloDe, nomeDe, primeiroNome, tiraAno, idiomaDe, flagDe, EMOJI };
