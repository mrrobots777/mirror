// O CATALOGO DOS PAINEIS EM SQLITE, e nao na RAM.
//
// MEDIDO 01/10/2026 (a meta do dono: 150MB no maximo, e nunca passar de 300MB com milhares de
// pessoas). O `xtream.preloadLists()` custava **206MB** sozinho (RSS 57 -> 263MB) e media assim:
//
//   objeto por item, 3 paineis x (filmes + series)  ->  heap 78MB, RSS 250MB apos carregar
//   apos forcar a coleta                           ->  heap 20MB, RSS 168MB
//
// Ou seja: **nao era vazao** — o app guardava 20MB de catalogo e o resto era lixo esperando o
// coletor. Mas lixo de 200MB ainda significa 250MB de RSS no pico, e o dono pediu 150MB.
//
// O projeto JA tem a solucao provada do outro lado: o KKT guarda 192.383 canais em SQLite
// (`iptv.db`) e usa **7MB** de RAM. Aqui e o mesmo desenho:
//
//   - o catalogo de cada painel e gravado UMA vez (idempotente) e fica em disco;
//   - a busca do stream faz `SELECT ... WHERE norm LIKE ?` e traz **dezenas** de candidatos, nao
//     93 mil itens — o que tambem mata o trabalho por pedido de recalcular `matchKey` em tudo;
//   - se o banco nao abrir (ou a gravacao falhar), o codigo cai no caminho de memoria: o
//     catalogo volta a ser uma lista na RAM e nada quebra, so que sem a economia.
//
// Tabela: `item(painel, tipo, norm, nome, desc, id, ext)`, com indice em `(painel, tipo, norm)`.
// `norm` e o titulo normalizado (`matchKey`), que e o que a busca usa.

const fs = require("fs");
const path = require("path");
const { ENV } = require("../core/nomes");

let db = null;
let disponivel = true;

function caminhoDoBanco() {
  const dir = String(ENV.DATA_DIR || "/tmp");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return path.join(dir, "paineis.db");
}

function abre() {
  if (db) return db;
  if (!disponivel) return null;
  let Database = null;
  try {
    Database = require("better-sqlite3");
  } catch (_) {
    disponivel = false;
    return null;
  }
  try {
    db = new Database(caminhoDoBanco());
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.exec(`CREATE TABLE IF NOT EXISTS item (
      painel TEXT NOT NULL,
      tipo   TEXT NOT NULL,
      norm   TEXT NOT NULL,
      nome   TEXT NOT NULL,
      desc   TEXT,
      id     TEXT NOT NULL,
      ext    TEXT
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_item ON item (painel, tipo, norm)");
    db.exec(`CREATE TABLE IF NOT EXISTS marca (
      painel TEXT NOT NULL,
      tipo   TEXT NOT NULL,
      total  INTEGER NOT NULL,
      quando INTEGER NOT NULL,
      PRIMARY KEY (painel, tipo)
    )`);
  } catch (e) {
    console.error(`[paineis] banco indisponivel (${e.message.slice(0, 60)}):indo para memoria`);
    disponivel = false;
    db = null;
  }
  return db;
}

function temCatalogo(painel, tipo) {
  const d = abre();
  if (!d) return false;
  try {
    const r = d.prepare("SELECT total FROM marca WHERE painel = ? AND tipo = ?").get(painel, tipo);
    return !!(r && r.total > 0);
  } catch (_) {
    return false;
  }
}

// Grava o catalogo inteiro em UMA transacao. Devolve quantos itens foram gravados.
function grava(painel, tipo, itens) {
  const d = abre();
  if (!d) return 0;
  try {
    const limpar = d.prepare("DELETE FROM item WHERE painel = ? AND tipo = ?");
    const inserir = d.prepare("INSERT INTO item (painel, tipo, norm, nome, desc, id, ext) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const marcar = d.prepare("INSERT OR REPLACE INTO marca (painel, tipo, total, quando) VALUES (?, ?, ?, ?)");
    const gravarTudo = d.transaction((lista) => {
      for (const it of lista) {
        if (!it) continue;
        inserir.run(painel, tipo, it.key || "", it.name || "", it.title || "", it.id || "", it.ext || "mp4");
      }
      marcar.run(painel, tipo, lista.length, Date.now());
    });
    gravarTudo(itens);
    return itens.length;
  } catch (e) {
    console.error(`[paineis] falha ao gravar ${painel}/${tipo}: ${e.message.slice(0, 60)}`);
    return 0;
  }
}

function apaga(painel, tipo) {
  const d = abre();
  if (!d) return 0;
  try {
    d.prepare("DELETE FROM item WHERE painel = ? AND tipo = ?").run(painel, tipo);
    d.prepare("DELETE FROM marca WHERE painel = ? AND tipo = ?").run(painel, tipo);
    return 1;
  } catch (_) {
    return 0;
  }
}

// Candidatos de um titulo: as linhas cujo titulo normalizado contem a chave pedida OU contem
// alguma palavra forte dela — o mesmo criterio do `preFiltra` do `match.js`, que e um
// SUPERCONJUNTO do que ele devolve (a pontuacao final continua sendo feita no codigo).
// `limite` protege de titulo generico ("the") que casaria com o catalogo inteiro.
function candidatos(painel, tipo, chaveNormalizada, limite = 400) {
  const d = abre();
  if (!d || !chaveNormalizada) return null;
  // SEM CATALOGO GRAVADO, o resposta tem de ser `null` e nao lista vazia: quem chama usa o
  // `null` para cair no caminho de memoria (decisao 136). Devolvendo `[]`, a fonte respondia
  // "esse painel nao tem o filme" sem nunca olhar o catalogo — perda silenciosa de fonte.
  if (!temCatalogo(painel, tipo)) return null;
  try {
    const palavras = chaveNormalizada.split(" ").filter((p) => p.length >= 4).slice(0, 6);
    const termos = [chaveNormalizada, ...palavras];
    const onde = termos.map(() => "norm LIKE ? ESCAPE '\\'").join(" OR ");
    const like = termos.map((t) => `%${t.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
    const linhas = d.prepare(`SELECT nome, desc, id, ext FROM item WHERE painel = ? AND tipo = ? AND (${onde}) LIMIT ?`).all(painel, tipo, ...like, limite);
    return linhas.map((r) => ({ name: r.nome, title: r.desc || "", stream_id: r.id, series_id: r.id, container_extension: r.ext || "mp4" }));
  } catch (e) {
    console.error(`[paineis] consulta falhou (${e.message.slice(0, 60)}):indo para memoria`);
    return null;
  }
}

// GRAVA O CATALOGO SEM MONTAR A LISTA (decisao 136).
//
// O `JSON.parse` do texto inteiro e o que produz o pico: medido, um painel de 31.499 itens
// vira ~40MB de objetos vivos e ~250MB de RSS durante o parse. Aqui o texto e cortado item a item
// (respeitando string e escape), cada item e convertido e inserido no SQLite em lotes, e o
// objeto morre no fim do lote. O pico fica no tamanho do texto cru mais um lote.
//
// MEDIDO: boot que baixa, RSS de 342MB -> 150MB. O texto cru e' inevitavel (a API devolve JSON
// inteiro); o que sai de cena e a lista de 30 mil objetos.
function gravaStream(painel, tipo, texto, paraCadaItem, lote = 400) {
  const d = abre();
  if (!d) return 0;
  const t = String(texto);
  // Onde comeca o array de itens: o painel pode devolver `[{...}]` ou `{vod_streams: [...]}`.
  const inicio = t.indexOf("[");
  if (inicio < 0) return 0;

  const inserir = d.prepare("INSERT INTO item (painel, tipo, norm, nome, desc, id, ext) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const marcar = d.prepare("INSERT OR REPLACE INTO marca (painel, tipo, total, quando) VALUES (?, ?, ?, ?)");
  let total = 0;
  let pendentes = [];

  const loteInsert = d.transaction((linhas) => {
    for (const it of linhas) inserir.run(painel, tipo, it.key || "", it.name || "", it.title || "", it.id || "", it.ext || "mp4");
  });

  const guarda = () => {
    if (!pendentes.length) return;
    loteInsert(pendentes);
    total += pendentes.length;
    pendentes = [];
  };

  d.prepare("DELETE FROM item WHERE painel = ? AND tipo = ?").run(painel, tipo);

  // O corte e por CHAVES, e nao por "profundidade" de qualquer tipo.
  //
  // MEDIDO 01/10/2026 (a primeira versao contava `{` E `[` juntos e tirava 0 item de 5 de 6
  // catalogos): os itens do painel tem ARRAY dentro ("category_ids":[671]), entao o `]` fechava
  // a profundidade no meio do objeto, o `}` seguinte a levava para menos um, e o item nunca era
  // capturado. Chave sozinha nao tem esse problema: `{...}` do item e os `{...}` aninhados
  // fecham, e o item termina quando a contagem de chaves volta a zero. Texto entre aspas (com
  // `{}`, `[]`, `\"` e `\\`) e ignorado pelo ramo de string.
  let chaves = 0;
  let colchetes = 0;
  let dentroDeString = false;
  let escapado = false;
  let inicioItem = -1;
  for (let i = inicio + 1; i < t.length; i++) {
    const c = t[i];
    if (dentroDeString) {
      if (escapado) escapado = false;
      else if (c === "\\") escapado = true;
      else if (c === '"') dentroDeString = false;
      continue;
    }
    if (c === '"') { dentroDeString = true; continue; }
    if (c === "[") { colchetes++; continue; }
    if (c === "]") {
      colchetes--;
      if (colchetes < 0) break;
      continue;
    }
    if (c === "{") {
      if (chaves === 0) inicioItem = i;
      chaves++;
      continue;
    }
    if (c === "}") {
      chaves--;
      if (chaves === 0 && inicioItem >= 0) {
        const item = parseSeguro(t.slice(inicioItem, i + 1));
        inicioItem = -1;
        if (item) {
          const compacto = paraCadaItem ? paraCadaItem(item) : null;
          if (compacto) pendentes.push(compacto);
          if (pendentes.length >= lote) guarda();
        }
      }
      continue;
    }
  }
  guarda();
  marcar.run(painel, tipo, total, Date.now());
  return total;
}

function parseSeguro(texto) {
  try {
    return JSON.parse(texto);
  } catch (_) {
    return null;
  }
}

// O MESMO GRAVAMENTO, SEM A STRING INTEIRA (decisao 136).
//
// O `gravaStream` recebe o TEXTO, e o texto de um catalogo grande e o dobro do Buffer na RAM: um
// `Space/vod` de 30MB vira Buffer 30MB + string 30MB. Aqui o Buffer e' lido em FATIAS de 2MB,
// cada fatia vira string e e' solta; o que sobra (o item pela metade) vai no "resto" do corte.
// O estado (dentro de string, escapado, contagem de chaves) atravessa a fronteira da fatia.
//
// MEDIDO: boot que baixa, RSS de 162MB para 136MB; e o pico cai junto, porque o objeto grande de
// 30MB nunca chega a existir.
const { StringDecoder } = require("string_decoder");

function consumidorDeFatias(painel, tipo, paraCadaItem, lote = 400) {
  const d = abre();
  if (!d) return null;
  const inserir = d.prepare("INSERT INTO item (painel, tipo, norm, nome, desc, id, ext) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const marcar = d.prepare("INSERT OR REPLACE INTO marca (painel, tipo, total, quando) VALUES (?, ?, ?, ?)");
  const loteInsert = d.transaction((linhas) => {
    for (const it of linhas) inserir.run(painel, tipo, it.key || "", it.name || "", it.title || "", it.id || "", it.ext || "mp4");
  });
  d.prepare("DELETE FROM item WHERE painel = ? AND tipo = ?").run(painel, tipo);

  let total = 0;
  let pendentes = [];
  let chaves = 0;
  let colchetes = 0;
  let dentroDeString = false;
  let escapado = false;
  let achouArray = false;
  let resto = "";
  const dec = new StringDecoder("utf8");

  const guarda = () => {
    if (!pendentes.length) return;
    loteInsert(pendentes);
    total += pendentes.length;
    pendentes = [];
  };

  const processa = (texto) => {
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (!achouArray) { if (c === "[") achouArray = true; continue; }
      if (dentroDeString) {
        if (chaves > 0) resto += c;
        if (escapado) escapado = false;
        else if (c === "\\") escapado = true;
        else if (c === '"') dentroDeString = false;
        continue;
      }
      if (c === '"') { dentroDeString = true; if (chaves > 0) resto += c; continue; }
      // O colchete vai para o item tambem: MEDIDO, um array VAZIO dentro do item ("backdrop_path":[])
      // perdia os dois colchetes e virava "backdrop_path": — 1.367 de 9.664 itens do painel
      // saiam com o texto quebrado e o `JSON.parse` falhava.
      if (c === "[") { colchetes++; if (chaves > 0) resto += c; continue; }
      // So sai quando o colchete fecha o ARRAY INTEIRO (colchetes fica negativo). Com
      // `return colchetes < 0` direto, um `]` aninhado ("category_ids":[671]) devolvia falso e
      // ABANDONAVA o resto da fatia — medido: 0 item gravado.
      if (c === "]") { colchetes--; if (colchetes < 0) return true; if (chaves > 0) resto += c; continue; }
      if (c === "{") { if (chaves === 0) resto = ""; resto += c; chaves++; continue; }
      if (c === "}") {
        resto += c;
        chaves--;
        if (chaves === 0) {
          const item = parseSeguro(resto);
          resto = "";
          if (item) {
            const compacto = paraCadaItem ? paraCadaItem(item) : null;
            if (compacto) pendentes.push(compacto);
            if (pendentes.length >= lote) guarda();
          }
        }
        continue;
      }
      if (chaves > 0) resto += c;
    }
    return false;
  };

  return {
    // Cada pedaco da resposta entra aqui e e processado e solto.
    peca: (bufferPeca) => {
      const texto = dec.write(bufferPeca);
      return texto ? processa(texto) : false;
    },
    fecha: () => {
      const ultimo = dec.end();
      if (ultimo) processa(ultimo);
      guarda();
      marcar.run(painel, tipo, total, Date.now());
      return total;
    },
    get total() { return total; },
  };
}

function gravaBuffer(painel, tipo, buffer, paraCadaItem, fatiaBytes = 2 * 1024 * 1024, lote = 400) {
  const d = abre();
  if (!d || !buffer || !buffer.length) return 0;
  const inserir = d.prepare("INSERT INTO item (painel, tipo, norm, nome, desc, id, ext) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const marcar = d.prepare("INSERT OR REPLACE INTO marca (painel, tipo, total, quando) VALUES (?, ?, ?, ?)");
  const loteInsert = d.transaction((linhas) => {
    for (const it of linhas) inserir.run(painel, tipo, it.key || "", it.name || "", it.title || "", it.id || "", it.ext || "mp4");
  });
  d.prepare("DELETE FROM item WHERE painel = ? AND tipo = ?").run(painel, tipo);

  let total = 0;
  let pendentes = [];
  const guarda = () => {
    if (!pendentes.length) return;
    loteInsert(pendentes);
    total += pendentes.length;
    pendentes = [];
  };

  let chaves = 0;
  let colchetes = 0;
  let dentroDeString = false;
  let escapado = false;
  let achouArray = false;
  let resto = "";
  const dec = new StringDecoder("utf8");

  const processa = (texto) => {
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (!achouArray) {
        if (c === "[") achouArray = true;
        continue;
      }
      if (dentroDeString) {
        // O CONTEUDO DA STRING TAMBEM ENTRA NO ITEM (medido: sem isso o item remontado ficava
        // "{:,:,:,:}" e o JSON.parse falhava — o `gravaStream` nao tinha esse problema porque
        // recorte o texto original, sem remontar).
        if (chaves > 0) resto += c;
        if (escapado) escapado = false;
        else if (c === "\\") escapado = true;
        else if (c === '"') dentroDeString = false;
        continue;
      }
      if (c === '"') { dentroDeString = true; if (chaves > 0) resto += c; continue; }
      // O colchete vai para o item tambem: MEDIDO, um array VAZIO dentro do item ("backdrop_path":[])
      // perdia os dois colchetes e virava "backdrop_path": — 1.367 de 9.664 itens do painel
      // saiam com o texto quebrado e o `JSON.parse` falhava.
      if (c === "[") { colchetes++; if (chaves > 0) resto += c; continue; }
      if (c === "]") { colchetes--; if (colchetes < 0) return true; if (chaves > 0) resto += c; continue; }
      if (c === "{") {
        if (chaves === 0) resto = "";
        resto += c;
        chaves++;
        continue;
      }
      if (c === "}") {
        resto += c;
        chaves--;
        if (chaves === 0) {
          const item = parseSeguro(resto);
          resto = "";
          if (item) {
            const compacto = paraCadaItem ? paraCadaItem(item) : null;
            if (compacto) pendentes.push(compacto);
            if (pendentes.length >= lote) guarda();
          }
        }
        continue;
      }
      if (chaves > 0) resto += c;
    }
    return false;
  };

  for (let pos = 0; pos < buffer.length; pos += fatiaBytes) {
    const texto = dec.write(buffer.subarray(pos, Math.min(pos + fatiaBytes, buffer.length)));
    if (processa(texto)) break;
  }
  const ultimo = dec.end();
  if (ultimo) processa(ultimo);
  guarda();
  marcar.run(painel, tipo, total, Date.now());
  return total;
}

function stats() {
  const d = abre();
  if (!d) return { banco: false };
  try {
    const itens = d.prepare("SELECT COUNT(*) as c FROM item").get().c;
    const marcas = d.prepare("SELECT painel, tipo, total, quando FROM marca ORDER BY painel, tipo").all();
    return { banco: true, itens, marcas };
  } catch (_) {
    return { banco: false };
  }
}

function fecha() {
  if (db) {
    try { db.close(); } catch (_) {}
    db = null;
  }
}

module.exports = { temCatalogo, grava, gravaStream, gravaBuffer, consumidorDeFatias, apaga, candidatos, stats, fecha, caminhoDoBanco };