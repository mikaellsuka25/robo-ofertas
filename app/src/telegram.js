// Bot do Telegram: envia ofertas para grupos/canais e vincula destinos com /link CODIGO
const store = require('./db');

const API = () => (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, '');
const token = () => (store.get('telegram_token') || '').trim();

async function api(method, body, isForm = false) {
  const t = token();
  if (!t) throw new Error('Telegram sem token do bot (Canais → Telegram).');
  const res = await fetch(`${API()}/bot${t}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram: ${json.description || res.status}`);
  return json.result;
}

// Formatação do WhatsApp (*negrito* ~riscado~ _itálico_) → HTML do Telegram
function toHtml(text) {
  const esc = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:]|$)/gm, '$1<b>$2</b>')
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:]|$)/gm, '$1<s>$2</s>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:]|$)/gm, '$1<i>$2</i>');
}

async function send(chatId, { text, image, preview = true }) {
  const html = toHtml(text);
  if (image && image.url && !image.base64) {
    if (html.length <= 1024) return api('sendPhoto', { chat_id: chatId, photo: image.url, caption: html, parse_mode: 'HTML' });
  }
  if (image && image.base64) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([Buffer.from(image.base64.replace(/^data:[^,]+,/, ''), 'base64')], { type: image.mimetype || 'image/jpeg' }), 'oferta.jpg');
    if (html.length <= 1024) { form.append('caption', html); form.append('parse_mode', 'HTML'); return api('sendPhoto', form, true); }
    await api('sendPhoto', form, true);
  }
  return api('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: !preview } });
}

// Lê as mensagens enviadas ao bot procurando "/link CODIGO"
let offset = 0, running = false;
async function pollOnce() {
  if (!token()) return 0;
  const updates = await api('getUpdates', { offset, timeout: 0, allowed_updates: ['message', 'channel_post', 'my_chat_member'] });
  let linked = 0;
  for (const u of updates) {
    offset = u.update_id + 1;
    const m = u.message || u.channel_post;
    if (!m || !m.text) continue;
    const match = m.text.trim().match(/^\/link(?:@\w+)?\s+(\S+)/i);
    const code = (store.get('telegram_link_code') || '').trim();
    if (!match || !code || match[1] !== code) continue;
    const id = `tg:${m.chat.id}`;
    store.db.prepare(`INSERT INTO destinations(id,channel,name,instance,active,created_at) VALUES(?,?,?,?,1,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name`).run(id, 'telegram', m.chat.title || m.chat.username || String(m.chat.id), '', Date.now());
    store.log('info', `Telegram vinculado: ${m.chat.title || m.chat.id}`);
    linked++;
    try { await api('sendMessage', { chat_id: m.chat.id, text: '✅ Grupo vinculado ao Robô de Ofertas.' }); } catch {}
  }
  return linked;
}

function start() {
  if (running) return;
  running = true;
  (async function loop() {
    for (;;) {
      try { if (token()) await pollOnce(); } catch (err) { if (!/token/.test(err.message)) store.log('erro', err.message); }
      await new Promise((r) => setTimeout(r, 15000));
    }
  })();
}

module.exports = { send, toHtml, pollOnce, start, api };
