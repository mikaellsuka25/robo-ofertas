// Envio: escolhe o número, monta a mensagem, manda para cada grupo e registra no histórico
const fs = require('node:fs');
const path = require('node:path');
const store = require('./db');
const wa = require('./whatsapp');
const tg = require('./telegram');
const images = require('./images');
const render = require('./render');
const { applyReplacements, removeLines } = require('./text');

const { db, log, parse } = store;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- Destinos ----------
function resolveDestinations(ids = [], categories = []) {
  const set = new Set(ids);
  const rows = db.prepare('SELECT * FROM destinations WHERE active=1').all();
  return rows.filter((d) => set.has(d.id) || (d.category && categories.includes(d.category)));
}

// ---------- Números (instâncias) ----------
const listInstances = () => db.prepare('SELECT * FROM instances ORDER BY created_at, name').all();

async function openInstances() {
  const out = [];
  for (const i of listInstances()) if ((await wa.state(i.name)) === 'open') out.push(i.name);
  return out;
}

// Decide quais números enviam para quais grupos
async function planInstances(dests, preferred) {
  const wDests = dests.filter((d) => d.channel !== 'telegram');
  if (!wDests.length) return [];
  const open = await openInstances();
  if (!open.length) throw new Error('Nenhum número de WhatsApp conectado.');
  const mode = store.get('instance_mode');
  if (mode === 'dividida' && open.length > 1) {
    return open.map((inst, k) => ({ instance: inst, dests: wDests.filter((_, j) => j % open.length === k) })).filter((x) => x.dests.length);
  }
  let inst;
  if (mode === 'alternada' && open.length > 1) {
    const n = (Number(store.get('rr_counter')) || 0) + 1;
    store.set('rr_counter', n);
    inst = open[n % open.length];
  } else {
    const want = preferred || (wDests[0] && wDests[0].instance) || open[0];
    inst = open.includes(want) ? want : open[0]; // número caiu? outro assume
  }
  return [{ instance: inst, dests: wDests }];
}

// ---------- Montagem da mensagem ----------
function loadImage(payload, product) {
  if (payload.image_file) {
    const file = path.join(store.DATA_DIR, 'uploads', path.basename(payload.image_file));
    if (fs.existsSync(file)) return { base64: fs.readFileSync(file).toString('base64'), mimetype: payload.image_mime || 'image/jpeg' };
  }
  if (payload.image_url) return { url: payload.image_url };
  if (product && product.image_url) return { url: product.image_url };
  return null;
}

async function buildMessage(item, automation) {
  const payload = parse(item.payload, {});
  const cfg = automation ? automation.cfg : {};
  const product = item.product_id ? db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id) : null;
  let text = payload.text;
  if (text == null && product) {
    const r = await render.renderProduct(product, {
      templateIds: payload.templates || cfg.templates, template: payload.template,
      couponIds: payload.coupons || cfg.coupons, coupon: payload.coupon,
      price: payload.price, old_price: payload.old_price, cta: payload.cta, cta_ai: payload.cta_ai,
      extra_text: payload.extra_text, link: payload.link,
    });
    text = r.text;
  }
  text = applyReplacements(text || '', cfg.filters && cfg.filters.replace);
  text = removeLines(text, cfg.filters && cfg.filters.remove_lines);
  const media = payload.media || cfg.media || 'preview';
  const wantsImage = media === 'imagem' || payload.image_file;
  const image = wantsImage ? loadImage(payload, product) : null;
  // prévia do link montada pelo robô, com a foto e o nome do produto
  const card = product && product.link ? {
    url: payload.link || product.link,
    title: store.get('preview_title') === '0' ? '' : (product.title || ''),
    description: store.get('preview_title') === '0' || !product.price ? '' : `R$ ${require('./text').brl(payload.price || product.price)}${product.discount ? ` · ${product.discount}% OFF` : ''}`,
    image: product.image_url,
  } : null;
  return {
    text, product, image, card,
    preview: media !== 'imagem' && media !== 'texto',
    image_style: payload.image_style || cfg.image_style || 'padrao',
    mention_all: !!payload.mention_all,
    raw_image: !!payload.image_file && payload.keep_image, // imagem capturada: não recorta
  };
}

// Mensagens que o próprio robô enviou não devem voltar pelo webhook como se fossem novas
function markOwn(instance, r) {
  const id = r && r.key && r.key.id;
  if (id) db.prepare('INSERT OR IGNORE INTO seen_messages(id,at) VALUES(?,?)').run(`${instance}:${id}`, Date.now());
}

// ---------- Envio de um item da fila ----------
async function sendItem(item, { automation } = {}) {
  const lock = db.prepare(`UPDATE queue SET status='sending' WHERE id=? AND status='pending'`).run(item.id);
  if (!lock.changes) return { skipped: true };
  const payload = parse(item.payload, {});
  const cfg = automation ? automation.cfg : {};
  const dests = resolveDestinations(payload.dest || cfg.dest || [], payload.dest_categories || cfg.dest_categories || []);
  try {
    if (!dests.length) throw new Error('Nenhum grupo de destino escolhido.');
    const msg = await buildMessage(item, automation);
    if (!msg.text && !msg.image) throw new Error('Mensagem vazia.');
    let image = msg.image;
    if (image && !msg.raw_image) image = await images.prepare(image, msg.image_style);

    const results = [];
    const record = (d, instance, ok, error) => {
      results.push(ok);
      db.prepare(`INSERT INTO history(queue_id,automation_id,product_id,dest_id,dest_name,channel,instance,status,error,title,link,origin_url,at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(item.id, item.automation_id || null, item.product_id || null, d.id, d.name,
        d.channel, instance || '', ok ? 'sent' : 'failed', error || null,
        (msg.product && msg.product.title) || (msg.text || '').split('\n').find((l) => l.trim()) || '',
        (msg.product && msg.product.link) || payload.link || '', (msg.product && msg.product.origin_url) || '', Date.now());
    };

    // WhatsApp
    const plan = await planInstances(dests, cfg.instance || payload.instance).catch((err) => {
      for (const d of dests.filter((x) => x.channel !== 'telegram')) record(d, '', false, err.message);
      return [];
    });
    const gap = () => sleep(payload.fast ? rand(3000, 4000) : rand(5000, 12000));
    await Promise.all(plan.map(async ({ instance, dests: list }) => {
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        try {
          const r = await wa.send(instance, d.id, { text: msg.text, image, preview: msg.preview, card: msg.card, mentionAll: msg.mention_all });
          markOwn(instance, r);
          record(d, instance, true);
        } catch (err) {
          // tenta outro número conectado antes de desistir
          let sent = false;
          for (const other of (await openInstances()).filter((x) => x !== instance)) {
            try { markOwn(other, await wa.send(other, d.id, { text: msg.text, image, preview: msg.preview, card: msg.card, mentionAll: msg.mention_all })); record(d, other, true); sent = true; break; } catch {}
          }
          if (!sent) record(d, instance, false, err.message);
        }
        if (i < list.length - 1) await gap();
      }
    }));

    // Telegram
    for (const d of dests.filter((x) => x.channel === 'telegram')) {
      try {
        await tg.send(d.id.replace(/^tg:/, ''), { text: msg.text, image, preview: msg.preview });
        record(d, 'telegram', true);
      } catch (err) { record(d, 'telegram', false, err.message); }
    }

    const okCount = results.filter(Boolean).length;
    if (!okCount) {
      db.prepare(`UPDATE queue SET status='failed', error=? WHERE id=?`).run('Falhou em todos os grupos (veja o Histórico).', item.id);
      return { ok: false };
    }
    db.prepare(`UPDATE queue SET status='sent', sent_at=?, error=? WHERE id=?`).run(Date.now(),
      okCount < results.length ? `Falhou em ${results.length - okCount} de ${results.length} grupos` : null, item.id);
    if (item.automation_id) db.prepare('UPDATE automations SET last_send=? WHERE id=?').run(Date.now(), item.automation_id);
    log('info', `Enviado para ${okCount} grupo(s): ${((msg.product && msg.product.title) || msg.text || '').split('\n')[0].slice(0, 60)}`);
    return { ok: true, sent: okCount, total: results.length };
  } catch (err) {
    db.prepare(`UPDATE queue SET status='failed', error=? WHERE id=?`).run(err.message, item.id);
    for (const d of dests) {
      db.prepare(`INSERT INTO history(queue_id,automation_id,product_id,dest_id,dest_name,channel,status,error,title,at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(item.id, item.automation_id || null, item.product_id || null, d.id, d.name, d.channel, 'failed', err.message, '', Date.now());
    }
    if (!dests.length) {
      db.prepare(`INSERT INTO history(queue_id,automation_id,product_id,status,error,at) VALUES(?,?,?,?,?,?)`)
        .run(item.id, item.automation_id || null, item.product_id || null, 'failed', err.message, Date.now());
    }
    log('erro', `Envio: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// Coloca na fila (e devolve o item)
function enqueue({ automation_id = null, product_id = null, payload = {}, score = 0, send_after = 0, status = 'pending' }) {
  const r = db.prepare(`INSERT INTO queue(automation_id,product_id,payload,score,status,send_after,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(automation_id, product_id, JSON.stringify(payload), score, status, send_after, Date.now());
  return db.prepare('SELECT * FROM queue WHERE id=?').get(Number(r.lastInsertRowid));
}

// Guarda uma imagem (base64) em disco e devolve o nome do arquivo
function saveImage(base64, mimetype = 'image/jpeg') {
  const ext = /png/.test(mimetype) ? 'png' : /webp/.test(mimetype) ? 'webp' : /gif/.test(mimetype) ? 'gif' : 'jpg';
  const name = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(store.DATA_DIR, 'uploads', name), Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64'));
  return name;
}

module.exports = { sendItem, enqueue, buildMessage, resolveDestinations, planInstances, openInstances, listInstances, saveImage };
