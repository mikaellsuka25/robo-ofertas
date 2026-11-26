// Banco de dados local (SQLite embutido no Node, sem instalar nada)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'robo.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, level TEXT, msg TEXT);

  -- Números de WhatsApp conectados (cada um é uma "instância" na Evolution API)
  CREATE TABLE IF NOT EXISTS instances (
    name TEXT PRIMARY KEY, label TEXT, created_at INTEGER
  );

  -- Grupos/canais de destino (WhatsApp ou Telegram)
  CREATE TABLE IF NOT EXISTS destinations (
    id TEXT PRIMARY KEY,               -- jid do WhatsApp (…@g.us) ou tg:<chat_id>
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    name TEXT, instance TEXT, category TEXT, size INTEGER DEFAULT 0,
    invite_url TEXT, active INTEGER DEFAULT 1, created_at INTEGER
  );

  -- Todo produto que passou pelo robô (o "Feed")
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store TEXT DEFAULT 'shopee',
    item_key TEXT,                     -- shopId.itemId
    title TEXT, price REAL, old_price REAL, discount INTEGER,
    commission REAL, rating REAL, sales INTEGER,
    image_url TEXT, link TEXT, origin_url TEXT, shop_name TEXT,
    source TEXT,                       -- busca | promo | monitor | clone | direto | manual | planilha
    cta TEXT, cta_ai TEXT,
    favorite INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0,
    created_at INTEGER, updated_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_products_item ON products(item_key);
  CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at);

  -- Automações (busca, promo, monitor, clone, replicador)
  CREATE TABLE IF NOT EXISTS automations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, type TEXT, active INTEGER DEFAULT 0,
    config TEXT DEFAULT '{}',
    last_run INTEGER, last_send INTEGER,
    created_at INTEGER
  );

  -- Fila de envio
  CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_id INTEGER,
    product_id INTEGER,
    payload TEXT DEFAULT '{}',         -- texto pronto, imagem, cupom, preço manual, grupos…
    score REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',     -- pending | sending | sent | failed | skipped
    error TEXT,
    send_after INTEGER DEFAULT 0,      -- envio agendado
    created_at INTEGER, sent_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status, automation_id, score);

  -- Histórico: uma linha por grupo de destino
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id INTEGER, automation_id INTEGER, product_id INTEGER,
    dest_id TEXT, dest_name TEXT, channel TEXT, instance TEXT,
    status TEXT, error TEXT, title TEXT, link TEXT, origin_url TEXT, at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_history_at ON history(at);

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, store TEXT DEFAULT 'any', body TEXT, created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store TEXT DEFAULT 'shopee', code TEXT, link TEXT,
    kind TEXT DEFAULT 'pct',           -- pct | brl
    value REAL, min_price REAL DEFAULT 0, max_discount REAL DEFAULT 0,
    expires_at INTEGER, active INTEGER DEFAULT 1, created_at INTEGER
  );

  -- Rotador de grupos
  CREATE TABLE IF NOT EXISTS rotators (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE,
    groups TEXT DEFAULT '[]',          -- [{id, name, invite_url, limit}]
    active INTEGER DEFAULT 1, created_at INTEGER
  );

  -- Cliques (vitrine, links rastreados, rotador)
  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, ref TEXT, at INTEGER, ua TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_clicks ON clicks(kind, at);

  -- Mensagens já processadas (evita processar a mesma mensagem duas vezes)
  CREATE TABLE IF NOT EXISTS seen_messages (id TEXT PRIMARY KEY, at INTEGER);
`);

// Se o robô reiniciou no meio de um envio, a mensagem volta para a fila
db.exec(`UPDATE queue SET status='pending' WHERE status='sending'`);

const DEFAULT_TEMPLATE =
  '*{cta_ia}*\n\n' +
  '🛍️ {nome}\n\n' +
  'De ~R$ {preco_original}~\n' +
  '*Por R$ {preco_atual}* 🔥\n' +
  '{cupom_texto}\n\n' +
  '🛒 *Compre aqui:*\n' +
  '{link}';

const DEFAULTS = {
  shopee_app_id: '',
  shopee_secret: '',
  shopee_subid: 'robo',
  paused: '0',
  instance_mode: 'automacao',
  preview_title: '1',              // prévia do link com nome e preço do produto (0 = só a foto)      // automacao | alternada | dividida
  default_template: DEFAULT_TEMPLATE,
  coupon_phrase: '🎟️ Use o cupom *{codigo}* e ganhe {valor} OFF',
  // marca d'água
  watermark_enabled: '0',
  watermark_text: '',
  watermark_size: 'media',         // pequena | media | grande
  watermark_opacity: '70',
  watermark_color: '#ee4d2d',
  // IA para a chamada (CTA)
  ai_key: '',
  ai_model: 'claude-haiku-5-5',
  cta_guide: 'Público: famílias brasileiras que amam achadinhos para a casa. Tom: animado, próximo, sem exageros. Frases curtas (até 12 palavras). Sem emojis. Nunca invente preço ou característica que não esteja no nome do produto.',
  // páginas públicas
  public_url: '',
  vitrine_enabled: '0',
  vitrine_name: 'Achadinhos',
  vitrine_description: 'As melhores ofertas da Shopee, escolhidas a dedo.',
  vitrine_color: '#ee4d2d',
  vitrine_group_link: '',
  vitrine_direct: '0',              // 1 = clicar no produto vai direto à loja
  gerador_enabled: '0',
  gerador_name: 'Gerador de descontos',
  // telegram
  telegram_token: '',
  telegram_link_code: '',
};

function get(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULTS[key];
}
function set(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value ?? ''));
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
  try {
    db.prepare('INSERT INTO logs(at, level, msg) VALUES(?, ?, ?)').run(Date.now(), level, String(msg).slice(0, 1000));
    db.prepare('DELETE FROM logs WHERE id < (SELECT MAX(id) - 1000 FROM logs)').run();
  } catch {}
}

const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ---------- Automações ----------
const AUTOMATION_DEFAULTS = {
  common: {
    instance: '', dest: [], dest_categories: [], hour_start: '08:00', hour_end: '22:00',
    mode: 'fila', interval_min: 10, jitter_min: 2, media: 'preview', image_style: 'padrao',
    templates: [], coupons: [], max_per_day: 0,
    filters: { block: '', only: '', replace: '', price_min: 0, price_max: 0, min_discount: 0 },
  },
  busca: {
    keywords: '', exclude: '', sort: 2, min_discount: 30, min_rating: 4.5, min_sales: 50, min_price: 0,
    max_price: 500, min_commission: 0, per_keyword: 3, variety: 5, repost_days: 7, collect_every_min: 60,
  },
  promo: { origin: '', use_tags: true },
  monitor: { monitored: [], capture_cta: false, capture_coupon: true, capture_image: false, order: 'chegada', cleanup_time: '' },
  clone: { monitored: [], remove_cta: true, ai_cta: 'none', ai_cta_bold: true, capture_image: true, order: 'chegada', cleanup_time: '' },
  replicador: { origin: '' },
};
const AUTOMATION_TYPES = {
  busca: 'Busca de produtos',
  promo: 'Automatizador / Fila de promoções',
  monitor: 'Monitoramento',
  clone: 'Monitoramento Clone',
  replicador: 'Replicador de mensagens',
};

function automationConfig(a) {
  const base = { ...AUTOMATION_DEFAULTS.common, ...(AUTOMATION_DEFAULTS[a.type] || {}) };
  const cfg = { ...base, ...parse(a.config, {}) };
  cfg.filters = { ...AUTOMATION_DEFAULTS.common.filters, ...(cfg.filters || {}) };
  return cfg;
}
function getAutomation(id) {
  const a = db.prepare('SELECT * FROM automations WHERE id=?').get(id);
  return a ? { ...a, cfg: automationConfig(a) } : null;
}
function listAutomations() {
  return db.prepare('SELECT * FROM automations ORDER BY id').all().map((a) => ({ ...a, cfg: automationConfig(a) }));
}
function saveAutomation(a) {
  const config = JSON.stringify(a.cfg || {});
  if (a.id) {
    db.prepare('UPDATE automations SET name=?, type=?, active=?, config=? WHERE id=?')
      .run(a.name, a.type, a.active ? 1 : 0, config, a.id);
    return a.id;
  }
  const r = db.prepare('INSERT INTO automations(name,type,active,config,created_at) VALUES(?,?,?,?,?)')
    .run(a.name, a.type, a.active ? 1 : 0, config, Date.now());
  return Number(r.lastInsertRowid);
}

// ---------- Migração da versão 1 (tabela offers) ----------
function migrateV1() {
  const hasOffers = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='offers'`).get();
  if (get('schema_version') === '2') return;
  if (!db.prepare('SELECT COUNT(*) n FROM instances').get().n) {
    db.prepare('INSERT OR IGNORE INTO instances(name,label,created_at) VALUES(?,?,?)')
      .run(process.env.EVOLUTION_INSTANCE || 'robo', 'Número principal', Date.now());
  }
  if (!db.prepare('SELECT COUNT(*) n FROM templates').get().n) {
    const old = db.prepare(`SELECT value FROM settings WHERE key='template'`).get();
    let body = DEFAULT_TEMPLATE;
    if (old && old.value && !/\{chamada\}/.test(old.value) && /\{link\}/.test(old.value)) {
      body = old.value.replace(/\{titulo\}/g, '{nome}').replace(/\{preco\}/g, '{preco_atual}')
        .replace(/\{preco_antigo\}/g, '{preco_original}').replace(/\{chamada\}/g, '{cta_ia}');
    }
    db.prepare('INSERT INTO templates(name,store,body,created_at) VALUES(?,?,?,?)').run('Padrão Shopee', 'shopee', body, Date.now());
  }
  if (!db.prepare('SELECT COUNT(*) n FROM automations').get().n) {
    const old = (k, d) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : d; };
    const groups = parse(old('groups', '[]'), []);
    for (const g of groups) {
      db.prepare(`INSERT OR IGNORE INTO destinations(id,channel,name,instance,active,created_at) VALUES(?,?,?,?,1,?)`)
        .run(g.id, 'whatsapp', g.name, process.env.EVOLUTION_INSTANCE || 'robo', Date.now());
    }
    const tpl = db.prepare('SELECT id FROM templates ORDER BY id LIMIT 1').get();
    const cfg = {
      dest: groups.map((g) => g.id),
      hour_start: String(old('hour_start', '8')).padStart(2, '0') + ':00',
      hour_end: String(old('hour_end', '23')).padStart(2, '0') + ':00',
      mode: 'fila', interval_min: Number(old('send_every_min', 10)), jitter_min: Number(old('send_jitter_min', 2)),
      media: old('send_mode', 'preview') === 'imagem' ? 'imagem' : 'preview',
      templates: tpl ? [tpl.id] : [], max_per_day: Number(old('max_per_day', 90)),
      keywords: old('keywords', ''), min_discount: Number(old('min_discount', 30)), min_rating: Number(old('min_rating', 4.5)),
      min_sales: Number(old('min_sales', 50)), max_price: Number(old('max_price', 500)), min_commission: Number(old('min_commission', 0)),
      per_keyword: Number(old('max_per_keyword', 3)), variety: Number(old('variety', 5)),
      repost_days: Number(old('repost_after_days', 7)), collect_every_min: Number(old('collect_every_min', 60)),
    };
    const active = old('paused', '0') !== '1' && groups.length > 0;
    const id = saveAutomation({ name: 'Busca Shopee', type: 'busca', active, cfg });
    if (hasOffers) {
      const rows = db.prepare(`SELECT * FROM offers`).all();
      const insP = db.prepare(`INSERT INTO products(store,item_key,title,price,old_price,discount,commission,rating,sales,
        image_url,link,source,created_at,updated_at) VALUES('shopee',?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insQ = db.prepare(`INSERT INTO queue(automation_id,product_id,payload,score,status,error,created_at,sent_at)
        VALUES(?,?,?,?,?,?,?,?)`);
      for (const o of rows) {
        const p = insP.run(o.item_key, o.title, o.price, o.old_price, o.discount, o.commission, o.rating, o.sales,
          o.image_url, o.link, o.source === 'manual' ? 'manual' : 'busca', o.created_at, o.created_at);
        const payload = o.source === 'manual' ? JSON.stringify({ text: o.extra_text, image_url: o.image_url, link: o.link }) : '{}';
        const status = o.status === 'error' ? 'failed' : o.status;
        insQ.run(id, Number(p.lastInsertRowid), payload, o.score || 0, status, o.error, o.created_at, o.sent_at);
      }
    }
  }
  set('schema_version', '2');
}
migrateV1();

module.exports = {
  db, get, set, all, num, log, parse, DEFAULTS, DATA_DIR, DEFAULT_TEMPLATE,
  AUTOMATION_DEFAULTS, AUTOMATION_TYPES, automationConfig, getAutomation, listAutomations, saveAutomation,
};
