// Automações: busca de produtos, promoções a partir de grupo, monitoramento, clone e replicador
const store = require('./db');
const shopee = require('./shopee');
const products = require('./products');
const dispatch = require('./dispatch');
const wa = require('./whatsapp');
const ai = require('./ai');
const { family, isDuplicate, checkFilters, list, fold, parsePrice } = require('./text');

const { db, log, parse } = store;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Horários ----------
function minutesOf(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2})(?::(\d{2}))?$/);
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
}
function withinHours(cfg, now = new Date()) {
  const s = minutesOf(cfg.hour_start), e = minutesOf(cfg.hour_end);
  if (s == null || e == null || s === e) return true;
  const t = now.getHours() * 60 + now.getMinutes();
  return s < e ? t >= s && t < e : t >= s || t < e; // ex.: 22:00–02:00
}
function startOfDay() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function sentTodayFor(automationId) {
  return db.prepare(`SELECT COUNT(*) n FROM queue WHERE automation_id=? AND status='sent' AND sent_at>=?`).get(automationId, startOfDay()).n;
}

// ---------- Busca de produtos ----------
function score(o) {
  return o.discount * 0.6 + Math.min(o.commission, 20) * 1.5 + Math.log10(1 + o.sales) * 5 + o.rating * 2;
}

function passesBusca(o, c) {
  if (!o.link || !(o.price > 0)) return false;
  if (o.discount < Number(c.min_discount || 0)) return false;
  if (o.rating < Number(c.min_rating || 0)) return false;
  if (o.sales < Number(c.min_sales || 0)) return false;
  if (Number(c.max_price) > 0 && o.price > Number(c.max_price)) return false;
  if (Number(c.min_price) > 0 && o.price < Number(c.min_price)) return false;
  if (o.commission < Number(c.min_commission || 0)) return false;
  const ex = list(c.exclude);
  if (ex.length && ex.some((w) => fold(o.title).includes(w))) return false;
  return !checkFilters(c.filters, { text: o.title, price: o.price, discount: o.discount });
}

const collecting = new Set();
async function collect(a) {
  if (collecting.has(a.id)) return { busy: true, added: 0, seen: 0 };
  collecting.add(a.id);
  let added = 0, seen = 0;
  try {
    const c = a.cfg;
    db.prepare('UPDATE automations SET last_run=? WHERE id=?').run(Date.now(), a.id);
    // ofertas antigas na fila podem ter mudado de preço
    db.prepare(`UPDATE queue SET status='skipped', error='expirou na fila' WHERE automation_id=? AND status='pending' AND created_at<?`)
      .run(a.id, Date.now() - 2 * 86400000);
    const days = Number(c.repost_days) || 7;
    const existing = db.prepare(`SELECT p.item_key, p.title, p.price, p.image_url FROM queue q JOIN products p ON p.id=q.product_id
      WHERE q.automation_id=? AND q.created_at>? AND q.status IN ('pending','sending','sent')`).all(a.id, Date.now() - days * 86400000);
    let keywords = String(c.keywords || '').split('\n').map((k) => k.trim()).filter(Boolean);
    if (!keywords.length) keywords = ['']; // sem palavra-chave: seleção variada
    for (const kw of keywords) {
      try {
        const nodes = await shopee.searchOffers({ keyword: kw, sortType: Number(c.sort) || 2, limit: 50 });
        const cands = nodes.map((n) => { seen++; return { ...shopee.normalize(n), keyword: kw }; })
          .filter((o) => passesBusca(o, c)).sort((x, y) => score(y) - score(x));
        let kwAdded = 0;
        for (const o of cands) {
          if (kwAdded >= Math.max(1, Number(c.per_keyword) || 3)) break;
          if (isDuplicate(o, existing)) continue;
          const p = products.upsert(o, 'busca');
          dispatch.enqueue({ automation_id: a.id, product_id: p.id, score: score(o), payload: { keyword: kw } });
          existing.push(o);
          kwAdded++; added++;
        }
      } catch (err) {
        log('erro', `${a.name} — busca "${kw}": ${err.message}`);
        if (err.fatal) break;
      }
      await sleep(1200);
    }
    log('info', `${a.name}: ${seen} produtos vistos, ${added} novos na fila.`);
  } finally {
    collecting.delete(a.id);
  }
  return { added, seen };
}

// Próximos da fila de uma automação, na ordem de envio
function plan(a, limit = 1) {
  const now = Date.now();
  const pending = db.prepare(`SELECT q.*, p.title, p.image_url, p.price FROM queue q LEFT JOIN products p ON p.id=q.product_id
    WHERE q.automation_id=? AND q.status='pending' AND q.send_after<=? ORDER BY q.score DESC, q.id ASC LIMIT 400`).all(a.id, now);
  if (a.type !== 'busca') {
    if (a.cfg.order === 'cortafila') {
      // o que chegou nos últimos 50 s passa na frente
      pending.sort((x, y) => {
        const fx = now - x.created_at < 50000, fy = now - y.created_at < 50000;
        if (fx !== fy) return fx ? -1 : 1;
        return fx ? y.created_at - x.created_at : x.id - y.id;
      });
    } else pending.sort((x, y) => (y.score >= 9999) - (x.score >= 9999) || x.id - y.id);
    return pending.slice(0, limit);
  }
  // busca: não repete o mesmo tipo de produto em sequência
  const n = Math.max(0, Number(a.cfg.variety) || 0);
  const recent = n ? db.prepare(`SELECT p.title FROM queue q JOIN products p ON p.id=q.product_id
    WHERE q.automation_id=? AND q.status='sent' ORDER BY q.sent_at DESC LIMIT ?`).all(a.id, n).map((r) => family(r)).filter(Boolean) : [];
  const order = [];
  while (pending.length && order.length < limit) {
    let i = pending.findIndex((o) => o.score >= 9999);
    if (i < 0) i = pending.findIndex((o) => !recent.includes(family(o)));
    if (i < 0) i = 0;
    const [o] = pending.splice(i, 1);
    order.push(o);
    recent.unshift(family(o)); if (recent.length > n) recent.length = n;
  }
  return order;
}

// ---------- Mensagens recebidas (webhook da Evolution) ----------
function messageText(m) {
  if (!m) return '';
  return m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text)
    || (m.imageMessage && m.imageMessage.caption) || (m.videoMessage && m.videoMessage.caption) || '';
}

// Tags no grupo de origem: #preco, #precoa, #cupom, #cupomlink, #desconto, #limite, #texto
function parseTags(text) {
  const tags = {};
  const rest = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^#(precoa|preco|cupomlink|cupom|desconto|limite|texto)\b\s*(.*)$/i);
    if (m) tags[m[1].toLowerCase()] = m[2].trim();
    else rest.push(line);
  }
  const out = { text: rest.join('\n').trim() };
  if (tags.preco) out.price = parsePrice(tags.preco);
  if (tags.precoa) out.old_price = parsePrice(tags.precoa);
  if (tags.texto) out.extra_text = tags.texto;
  if ((tags.cupom || tags.cupomlink) && tags.desconto) {
    const brl = /r\$/i.test(tags.desconto);
    out.coupon = {
      code: tags.cupom || '', link: tags.cupomlink || '', kind: brl ? 'brl' : 'pct',
      value: parsePrice(tags.desconto) || 0, min_price: parsePrice(tags.limite) || 0, store: 'shopee', active: 1,
    };
  }
  return out;
}

// Chamada do afiliado original = primeira linha sem link e sem preço
function captureCta(text) {
  const first = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  if (!first || /https?:\/\//.test(first) || /r\$\s*\d/i.test(first)) return '';
  return first.replace(/[*_~]/g, '').trim();
}
function captureCoupon(text) {
  const m = String(text || '').match(/cupo[mn]\s*:?\s*\*?([A-Z0-9]{4,20})\*?/i);
  return m ? m[1].toUpperCase() : '';
}
function removeCta(text) {
  const lines = String(text || '').split('\n');
  const idx = lines.findIndex((l) => l.trim());
  if (idx >= 0 && captureCta(lines[idx])) lines.splice(idx, 1);
  return lines.join('\n').trim();
}

function failHistory(a, reason, title = '') {
  db.prepare(`INSERT INTO history(automation_id,status,error,title,at) VALUES(?,?,?,?,?)`).run(a.id, 'failed', reason, title, Date.now());
}

async function captureImage(instance, data) {
  if (!data.message || !data.message.imageMessage) return null;
  try {
    const img = await wa.mediaBase64(instance, data);
    if (img) return { image_file: dispatch.saveImage(img.base64, img.mimetype), image_mime: img.mimetype };
  } catch (err) { log('erro', `Capturar imagem: ${err.message}`); }
  return null;
}

async function afterEnqueue(a, item) {
  if (a.cfg.mode === 'imediato' && withinHours(a.cfg)) await dispatch.sendItem(item, { automation: a });
}

async function handleForAutomation(a, instance, data, text) {
  const c = a.cfg;
  if (a.type === 'replicador') {
    if (!withinHours(c)) return; // fora do horário: não guarda
    const img = await captureImage(instance, data);
    if (!text && !img) return;
    const item = dispatch.enqueue({ automation_id: a.id, payload: { text, ...(img || {}), keep_image: true, media: img ? 'imagem' : 'preview', fast: true } });
    if (c.mode === 'imediato') await dispatch.sendItem(item, { automation: a });
    return;
  }
  const links = shopee.findLinks(text);
  if (!links.length) return;

  if (a.type === 'clone') {
    let converted;
    try { converted = await products.convertLinksInText(text, { source: 'clone', subId: 'clone' }); }
    catch (err) { failHistory(a, err.message, text.split('\n')[0]); return; }
    let out = converted.text;
    const reason = checkFilters(c.filters, { text: out, price: converted.products[0] && converted.products[0].price, discount: converted.products[0] && converted.products[0].discount });
    if (reason) { failHistory(a, `Filtro: ${reason}`, out.split('\n')[0]); return; }
    if (c.remove_cta || c.ai_cta !== 'none') out = removeCta(out);
    if (c.ai_cta && c.ai_cta !== 'none' && converted.products[0]) {
      const phrase = await ai.cta(converted.products[0]);
      let line = c.ai_cta === 'upper' ? ai.upper(phrase) : ai.sentence(phrase);
      if (c.ai_cta_bold) line = `*${line}*`;
      out = `${line}\n\n${out}`;
    }
    const img = c.capture_image ? await captureImage(instance, data) : null;
    const item = dispatch.enqueue({
      automation_id: a.id, product_id: converted.products[0] ? converted.products[0].id : null,
      payload: { text: out, ...(img || {}), keep_image: true, media: img ? 'imagem' : 'preview' },
    });
    await afterEnqueue(a, item);
    return;
  }

  // promo e monitor: geram promoção nova com o seu modelo de texto
  const tags = a.type === 'promo' && c.use_tags !== false ? parseTags(text) : {};
  const img = a.type === 'monitor' && c.capture_image ? await captureImage(instance, data) : null;
  for (const link of links) {
    let p;
    try { p = await products.fromLink(link, { source: a.type, subId: a.type }); }
    catch (err) { failHistory(a, err.message, link); continue; }
    const price = tags.price || p.price;
    const reason = checkFilters(c.filters, { text: `${p.title || ''}\n${text}`, price, discount: p.discount });
    if (reason) { failHistory(a, `Filtro: ${reason}`, p.title || link); continue; }
    const payload = {};
    if (tags.price) payload.price = tags.price;
    if (tags.old_price) payload.old_price = tags.old_price;
    if (tags.extra_text) payload.extra_text = tags.extra_text;
    if (tags.coupon) payload.coupon = tags.coupon;
    if (a.type === 'monitor') {
      if (c.capture_cta) payload.cta = captureCta(text);
      if (c.capture_coupon) { const code = captureCoupon(text); if (code) payload.coupon = { code, kind: 'pct', value: 0 }; }
      if (img) Object.assign(payload, img, { keep_image: true, media: 'imagem' });
    }
    const item = dispatch.enqueue({ automation_id: a.id, product_id: p.id, payload });
    await afterEnqueue(a, item);
  }
}

// Ponto de entrada do webhook
async function onWebhook(body) {
  const event = String(body.event || '').toLowerCase().replace(/_/g, '.');
  if (event !== 'messages.upsert') return;
  const instance = body.instance || body.instanceName || '';
  const items = Array.isArray(body.data) ? body.data : [body.data];
  for (const data of items) {
    if (!data || !data.key) continue;
    const jid = data.key.remoteJid;
    const id = `${instance}:${data.key.id}`;
    const seen = db.prepare('INSERT OR IGNORE INTO seen_messages(id,at) VALUES(?,?)').run(id, Date.now());
    if (!seen.changes) continue; // já processada (ou foi o próprio robô que enviou)
    const text = messageText(data.message);
    for (const a of store.listAutomations().filter((x) => x.active)) {
      const origins = a.type === 'monitor' || a.type === 'clone' ? (a.cfg.monitored || []) : [a.cfg.origin].filter(Boolean);
      if (!origins.includes(jid)) continue;
      try { await handleForAutomation(a, instance, data, text); }
      catch (err) { log('erro', `${a.name}: ${err.message}`); }
    }
  }
  db.prepare('DELETE FROM seen_messages WHERE at < ?').run(Date.now() - 3 * 86400000);
}

// ---------- Ciclo principal ----------
const nextSendAt = new Map();
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    const paused = store.get('paused') === '1';
    // envios avulsos agendados (Envio Manual/Direto)
    if (!paused) {
      const due = db.prepare(`SELECT * FROM queue WHERE automation_id IS NULL AND status='pending' AND send_after<=? ORDER BY send_after, id LIMIT 5`).all(now);
      for (const item of due) await dispatch.sendItem(item);
    }
    for (const a of store.listAutomations()) {
      const c = a.cfg;
      // limpeza diária da fila
      if (c.cleanup_time) {
        const key = `cleanup_${a.id}`, today = new Date().toDateString();
        const t = minutesOf(c.cleanup_time), cur = new Date().getHours() * 60 + new Date().getMinutes();
        if (t != null && cur >= t && store.get(key) !== today) {
          db.prepare(`UPDATE queue SET status='skipped', error='limpeza diária' WHERE automation_id=? AND status='pending'`).run(a.id);
          store.set(key, today);
        }
      }
      if (!a.active || paused) continue;
      if (a.type === 'busca' && now - (a.last_run || 0) >= Math.max(15, Number(c.collect_every_min) || 60) * 60000) {
        collect(a).catch((err) => log('erro', `${a.name}: ${err.message}`));
      }
      if (!withinHours(c)) continue;
      if (Number(c.max_per_day) > 0 && sentTodayFor(a.id) >= Number(c.max_per_day)) continue;
      const next = nextSendAt.get(a.id) || 0;
      if (c.mode === 'fila' && now < next) continue;
      const [item] = plan(a, 1);
      if (!item) continue;
      await dispatch.sendItem(item, { automation: a });
      const interval = Math.max(1, Number(c.interval_min) || 10) + (Math.random() * 2 - 1) * (Number(c.jitter_min) || 0);
      nextSendAt.set(a.id, Date.now() + Math.max(60000, interval * 60000));
    }
  } catch (err) {
    log('erro', `Ciclo: ${err.message}`);
  } finally {
    ticking = false;
  }
}

function start() {
  setInterval(() => tick(), 30000);
  setTimeout(() => tick(), 15000);
}

module.exports = { start, tick, collect, plan, onWebhook, parseTags, captureCta, captureCoupon, removeCta, withinHours, score, sentTodayFor, nextSendAt };
