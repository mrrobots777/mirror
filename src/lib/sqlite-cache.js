const { ENV } = require("../core/nomes");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("node:path");

function getDbPath() {
  const candidates = [
    ENV.DATA_DIR,
    process.cwd(),
    "/tmp",
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const test = path.join(dir, ".write-test");
      fs.writeFileSync(test, "ok");
      fs.unlinkSync(test);
      return path.join(dir, "cache.db");
    } catch (_) {}
  }
  return path.join("/tmp", "cache.db");
}

const DB_PATH = getDbPath();

let db;
try {
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("wal_autocheckpoint = 1000");
  db.pragma("cache_size = -500");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expires ON kv(expires_at);
  `);
  console.log("[sqlite-cache] opened", DB_PATH);
} catch (e) {
  console.error("[sqlite-cache] init error:", e.message);
}

const stmts = {};
function getStmt(sql) {
  if (!stmts[sql]) stmts[sql] = db.prepare(sql);
  return stmts[sql];
}

// Apagar uma chave. Usado pela revalidacao de streams (medido em 29/09/2026): um link que morreu
// ficava sendo reentregue do cache ate o TTL de 15min acabar.
function del(key) {
  if (!db) return false;
  try {
    const info = getStmt("DELETE FROM kv WHERE key = ?").run(key);
    return info.changes > 0;
  } catch (_) { return false; }
}

function get(key) {
  if (!db) return null;
  try {
    const row = getStmt("SELECT value, expires_at FROM kv WHERE key = ?").get(key);
    if (!row) return null;
    if (Date.now() > row.expires_at) return null;
    return JSON.parse(row.value);
  } catch (_) { return null; }
}

function set(key, value, ttlMs) {
  if (!db) return;
  try {
    const expiresAt = Date.now() + ttlMs;
    getStmt("INSERT OR REPLACE INTO kv (key, value, expires_at) VALUES (?, ?, ?)").run(key, JSON.stringify(value), expiresAt);
  } catch (_) {}
}

const STALE_GRACE_MS = 60 * 60 * 1000;

function getStale(key) {
  if (!db) return null;
  try {
    const row = getStmt("SELECT value FROM kv WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : null;
  } catch (_) { return null; }
}

function cleanup() {
  if (!db) return 0;
  try {
    let totalDeleted = 0;
    const now = Date.now() - STALE_GRACE_MS;
    const stmt = getStmt("DELETE FROM kv WHERE expires_at < ? LIMIT 1000");
    for (let i = 0; i < 5; i++) {
      const result = stmt.run(now);
      totalDeleted += result.changes || 0;
      if (result.changes < 1000) break;
    }
    return totalDeleted;
  } catch (_) { return 0; }
}

function stats() {
  if (!db) return { total: 0, expired: 0 };
  try {
    const total = getStmt("SELECT COUNT(*) as c FROM kv").get().c;
    const expired = getStmt("SELECT COUNT(*) as c FROM kv WHERE expires_at < ?").get(Date.now()).c;
    return { total, expired };
  } catch (_) { return { total: 0, expired: 0 }; }
}

// APAGA TUDO (decisao 134). O dono pediu "resete o cache de todas as fontes": ate aqui nao
// havia NENHUM caminho para isso — o cache vivia dentro do container, sem rota, e a unica
// maneira de limpa-lo era reiniciar o app (que derruba todo mundo junto).
//
// Apagar inclui as chaves de triagem de TV (`mirror-tv:triagem*`), que e o que faz um canal
// marcado como morto voltar a lista. E o resto e o normal: playlist de canal, EPG resolvido,
// lista de canais, link de stream.
function limpaTudo() {
  if (!db) return 0;
  try {
    const antes = getStmt("SELECT COUNT(*) as c FROM kv").get().c;
    getStmt("DELETE FROM kv").run();
    return antes;
  } catch (_) {
    return 0;
  }
}

function close() {
  if (db) {
    try { db.close(); } catch (_) {}
    db = null;
  }
}

module.exports = { get, getStale, set, del, cleanup, stats, close, limpaTudo };
