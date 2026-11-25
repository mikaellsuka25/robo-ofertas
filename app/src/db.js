// Banco de dados local (SQLite embutido no Node, sem instalar nada)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'robo.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,            -- shopee | manual
    item_key TEXT NOT NULL,          -- id do produto na loja (evita repetição)
    title TEXT, price REAL, old_price REAL, discount INTEGER,
    commission REAL, rating REAL, sales INTEGER,
    image_url TEXT, link TEXT, extra_text TEXT,
    score REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',   -- pending | sent | skipped | error
    error TEXT,
    created_at INTEGER, sent_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_offers_item ON offers(source, item_key);
  CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status, score);
  CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, level TEXT, msg TEXT);
`);

// Se o robô reiniciou no meio de um envio, a oferta volta para a fila
db.exec(`UPDATE offers SET status='pending' WHERE status='sending'`);

const DEFAULTS = {
  keywords: 'fone bluetooth\nair fryer\nsmartwatch\ncarregador turbo\nkit skincare',
  min_discount: '30',          // % mínimo de desconto
  min_rating: '4.5',
  min_sales: '50',
  max_price: '500',
  min_commission: '0',         // % mínimo de comissão (0 = qualquer)
  collect_every_min: '60',     // de quanto em quanto tempo busca ofertas
  send_every_min: '10',        // intervalo entre ofertas enviadas
  send_jitter_min: '3',        // variação aleatória no intervalo (parece mais humano)
  hour_start: '8',
  hour_end: '23',
  max_per_day: '90',           // limite de ofertas por dia (por grupo)
  repost_after_days: '7',      // pode repetir o mesmo produto depois de X dias
  groups: '[]',                // grupos escolhidos (JSON)
  paused: '0',
  shopee_app_id: '',
  shopee_secret: '',
  template:
    '🔥 *{titulo}*\n\n' +
    '~De R$ {preco_antigo}~\n' +
    '💰 *Por R$ {preco}*  ({desconto}% OFF)\n' +
    '⭐ {nota} · {vendas} vendidos\n\n' +
    '🛒 {link}',
};

function get(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULTS[key];
}
function set(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}
function all() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function num(key) { return Number(get(key)) || 0; }

function log(level, msg) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  console.log(line);
  db.prepare('INSERT INTO logs(at, level, msg) VALUES(?, ?, ?)').run(Date.now(), level, String(msg).slice(0, 1000));
  db.prepare('DELETE FROM logs WHERE id < (SELECT MAX(id) - 500 FROM logs)').run();
}

module.exports = { db, get, set, all, num, log, DEFAULTS };
