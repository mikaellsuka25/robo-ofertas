// O robô: busca ofertas (coletor) e posta nos grupos (enviador)
const store = require('./db');
const shopee = require('./shopee');
const wa = require('./whatsapp');

const { db, log } = store;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- Formatação da mensagem ----------
const brl = (n) => (n == null || !isFinite(n) ? '' :
  Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function formatMessage(offer, template = store.get('template')) {
  if (offer.source === 'manual') {
    const t = (offer.extra_text || '').trim();
    return t.includes(offer.link) || !offer.link ? t : `${t}\n\n🛒 ${offer.link}`.trim();
  }
  const title = (offer.title || '').length > 90 ? offer.title.slice(0, 87) + '...' : offer.title || '';
  const values = {
    titulo: title,
    preco: brl(offer.price),
    preco_antigo: offer.old_price && offer.old_price > offer.price ? brl(offer.old_price) : '',
    desconto: offer.discount > 0 ? String(offer.discount) : '',
    nota: offer.rating ? offer.rating.toFixed(1) : '',
    vendas: offer.sales ? Number(offer.sales).toLocaleString('pt-BR') : '',
    comissao: offer.commission ? offer.commission.toFixed(0) : '',
    link: offer.link || '',
  };
  // Linhas com um campo vazio somem (ex.: produto sem desconto não mostra "De R$")
  return template.split('\n').filter((line) => {
    const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    return keys.every((k) => values[k] !== '' && values[k] != null);
  }).map((line) => line.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? ''))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Coletor ----------
function score(o) {
  return o.discount * 0.6 + Math.min(o.commission, 20) * 1.5 + Math.log10(1 + o.sales) * 5 + o.rating * 2;
}

function passesFilters(o, s) {
  return o.link && o.price > 0 &&
    o.discount >= Number(s.min_discount) &&
    o.rating >= Number(s.min_rating) &&
    o.sales >= Number(s.min_sales) &&
    (Number(s.max_price) <= 0 || o.price <= Number(s.max_price)) &&
    o.commission >= Number(s.min_commission);
}

// "Smartwatch D20 Pro Bluetooth..." e "Smartwatch D20 Pro Original..." viram a mesma chave
function titleKey(title) {
  return String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 3).join(' ');
}

// ---------- Semelhança entre produtos ----------
const STOP = new Set(('de da do das dos e com para por em no na nos nas a o as os um uma kit jogo conjunto par ' +
  'pecas pcs pc unidades un und cm mm m ml l kg g x novo nova original promocao oferta frete gratis envio ' +
  'imediato pronta entrega lancamento premium luxo top super mega estilo tipo cor cores varias modelo mini grande pequeno').split(' '));

function words(title) {
  return String(title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => w.replace(/(oes|aes)$/, 'ao').replace(/s$/, '')); // plural simples: cadeiras -> cadeira
}

// "Família" do produto = primeira palavra importante do título (cadeira, espelho, toalha...)
function family(o) {
  const w = words(o.title);
  return w[0] || (o.keyword ? words(o.keyword)[0] : null) || null;
}

// Quanto dois títulos se parecem (0 a 1), olhando as primeiras palavras importantes
function similarity(a, b) {
  const A = new Set(words(a).slice(0, 8)), B = new Set(words(b).slice(0, 8));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

function titleKey(title) { return words(title).slice(0, 3).join(' '); }

function isDuplicate(o, existing) {
  return existing.some((e) =>
    (e.image_url && o.image_url && e.image_url === o.image_url) ||
    (similarity(o.title, e.title) >= 0.6 &&
      (!e.price || !o.price || Math.abs(e.price - o.price) / Math.max(e.price, o.price) <= 0.35)));
}

function isRecent(source, itemKey, days) {
  const since = Date.now() - days * 86400000;
  return !!db.prepare(`SELECT 1 FROM offers WHERE source = ? AND item_key = ? AND created_at > ?
    AND status IN ('pending','sent') LIMIT 1`).get(source, itemKey, since);
}

function addOffer(o) {
  db.prepare(`INSERT INTO offers(source,item_key,title,price,old_price,discount,commission,rating,sales,
      image_url,link,extra_text,score,status,created_at,keyword,title_key)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`).run(
    o.source, o.item_key, o.title || null, o.price || null, o.old_price || null, o.discount || 0,
    o.commission || 0, o.rating || 0, o.sales || 0, o.image_url || null, o.link || null,
    o.extra_text || null, o.score ?? score(o), Date.now(), o.keyword || null, o.title ? titleKey(o.title) : null);
}

let collecting = false;
async function collect() {
  if (collecting) return { added: 0, busy: true };
  collecting = true;
  let added = 0, seen = 0;
  try {
    const s = store.all();
    const keywords = s.keywords.split('\n').map((k) => k.trim()).filter(Boolean);
    // Ofertas antigas na fila podem ter mudado de preço: descarta
    db.prepare(`UPDATE offers SET status='skipped', error='expirou na fila'
      WHERE status='pending' AND source='shopee' AND created_at < ?`).run(Date.now() - 2 * 86400000);
    for (const kw of keywords) {
      try {
        const nodes = await shopee.searchOffers({ keyword: kw, sortType: 2, limit: 50 });
        const days = Number(s.repost_after_days) || 7;
        const perKw = Math.max(1, Number(s.max_per_keyword) || 3);
        // as melhores primeiro; só entram as X melhores desta palavra
        const cands = nodes.map((n) => { seen++; return { ...shopee.normalize(n), keyword: kw }; })
          .filter((o) => passesFilters(o, s)).sort((a, b) => score(b) - score(a));
        const existing = db.prepare(`SELECT title, price, image_url FROM offers
          WHERE created_at > ? AND status IN ('pending','sent','sending') AND title IS NOT NULL`)
          .all(Date.now() - days * 86400000);
        let kwAdded = 0;
        for (const o of cands) {
          if (kwAdded >= perKw) break;
          if (isRecent(o.source, o.item_key, days)) continue;
          if (isDuplicate(o, existing)) continue; // mesmo produto (ou quase) de outra loja
          addOffer(o);
          existing.push(o);
          kwAdded++; added++;
        }
      } catch (err) {
        log('erro', `Busca "${kw}": ${err.message}`);
        if (/SHOPEE_APP_ID|signature|assinatura|credential/i.test(err.message)) break;
      }
      await sleep(1500); // não sobrecarregar a API
    }
    log('info', `Busca concluída: ${seen} produtos vistos, ${added} ofertas novas na fila.`);
  } finally {
    collecting = false;
  }
  return { added, seen };
}

// ---------- Enviador ----------
function sentToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return db.prepare(`SELECT COUNT(*) AS n FROM offers WHERE status='sent' AND sent_at >= ?`).get(d.getTime()).n;
}

function selectedGroups() {
  try { return JSON.parse(store.get('groups')) || []; } catch { return []; }
}

async function sendOne(offer) {
  const groups = selectedGroups();
  if (!groups.length) throw new Error('Nenhum grupo escolhido no painel.');
  // "trava" a oferta para não sair duas vezes
  const lock = db.prepare(`UPDATE offers SET status='sending' WHERE id=? AND status='pending'`).run(offer.id);
  if (!lock.changes) return;
  const text = formatMessage(offer);
  const errors = [];
  for (let i = 0; i < groups.length; i++) {
    try {
      await wa.sendOffer(groups[i].id, { text, imageUrl: offer.image_url, mode: store.get('send_mode') });
    } catch (err) {
      errors.push(`${groups[i].name}: ${err.message}`);
    }
    if (i < groups.length - 1) await sleep(rand(15000, 45000)); // pausa entre um grupo e outro
  }
  if (errors.length === groups.length) {
    db.prepare(`UPDATE offers SET status='error', error=? WHERE id=?`).run(errors.join(' | '), offer.id);
    throw new Error(errors.join(' | '));
  }
  db.prepare(`UPDATE offers SET status='sent', sent_at=?, error=? WHERE id=?`)
    .run(Date.now(), errors.length ? errors.join(' | ') : null, offer.id);
  log('info', `Enviado: ${(offer.title || offer.extra_text || '').slice(0, 60)}`);
}

// Planeja a ordem de envio: melhores primeiro, sem repetir a mesma família
// (cadeira, espelho...) nas últimas X ofertas enviadas
function plan(limit = 1) {
  const n = Math.max(0, Number(store.get('variety')) || 0);
  const recent = db.prepare(`SELECT title, keyword FROM offers WHERE status='sent' AND source != 'manual'
    ORDER BY sent_at DESC LIMIT ?`).all(n).map((o) => family(o)).filter(Boolean);
  const pending = db.prepare(`SELECT * FROM offers WHERE status='pending' ORDER BY score DESC, id ASC LIMIT 300`).all();
  const order = [];
  while (pending.length && order.length < limit) {
    let i = pending.findIndex((o) => o.score >= 9999);              // manual "próxima da fila"
    if (i < 0) i = pending.findIndex((o) => o.source === 'manual' || !recent.includes(family(o)));
    if (i < 0) i = 0;                                                // só sobrou a mesma família
    const [o] = pending.splice(i, 1);
    order.push(o);
    if (o.source !== 'manual') { recent.unshift(family(o)); if (recent.length > n) recent.length = n; }
  }
  return order;
}
function nextOffer() { return plan(1)[0]; }

let sending = false;
async function senderTick() {
  const s = store.all();
  const hour = new Date().getHours();
  if (s.paused === '1') return 'pausado';
  if (hour < Number(s.hour_start) || hour >= Number(s.hour_end)) return 'fora do horário';
  if (sentToday() >= Number(s.max_per_day)) return 'limite do dia atingido';
  if (!selectedGroups().length) return 'sem grupos escolhidos';
  if ((await wa.state()) !== 'open') return 'WhatsApp desconectado';
  const offer = nextOffer();
  if (!offer) return 'fila vazia';
  sending = true;
  try { await sendOne(offer); return 'enviado'; }
  catch (err) { log('erro', `Envio: ${err.message}`); return 'erro'; }
  finally { sending = false; }
}

let lastStatus = 'iniciando';
async function senderLoop() {
  for (;;) {
    let result;
    try { result = await senderTick(); } catch (err) { result = 'erro'; log('erro', err.message); }
    lastStatus = result;
    const s = store.all();
    const wait = result === 'enviado'
      ? (Number(s.send_every_min) + rand(-1, 1) * Number(s.send_jitter_min)) * 60000
      : 60000; // sem nada para fazer: confere de novo em 1 minuto
    await sleep(Math.max(60000, wait));
  }
}

async function collectorLoop() {
  await sleep(10000);
  for (;;) {
    try { await collect(); } catch (err) { log('erro', `Coletor: ${err.message}`); }
    await sleep(Math.max(15, store.num('collect_every_min')) * 60000);
  }
}

function start() {
  collectorLoop();
  senderLoop();
}

module.exports = {
  start, collect, sendOne, nextOffer, plan, family, similarity, titleKey, formatMessage, addOffer, passesFilters, score, sentToday,
  status: () => ({ lastStatus, sending, collecting }),
};
