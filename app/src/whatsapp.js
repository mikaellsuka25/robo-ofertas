// Conversa com a Evolution API (o "WhatsApp Web" que roda no servidor). Suporta vários números.
const BASE = () => (process.env.EVOLUTION_URL || 'http://evolution:8080').replace(/\/$/, '');
const KEY = () => process.env.EVOLUTION_API_KEY || '';
const crypto = require('node:crypto');
const WEBHOOK_TOKEN = () => crypto.createHmac('sha256', process.env.EVOLUTION_API_KEY || 'x').update('webhook').digest('hex').slice(0, 24);
const SELF_URL = () => (process.env.SELF_URL || 'http://robo:3000').replace(/\/$/, '');

async function call(method, path, body, timeout = 60000) {
  const res = await fetch(BASE() + path, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: KEY() },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = (json.response && JSON.stringify(json.response.message)) || json.message || text;
    const err = new Error(`WhatsApp (${res.status}): ${String(msg).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const enc = encodeURIComponent;

async function setWebhook(instance) {
  try {
    await call('POST', `/webhook/set/${enc(instance)}`, {
      webhook: {
        enabled: true, url: `${SELF_URL()}/webhook/evolution?t=${WEBHOOK_TOKEN()}`, byEvents: false, base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      },
    });
  } catch {}
}

async function ensureInstance(instance) {
  try {
    await call('GET', `/instance/connectionState/${enc(instance)}`);
  } catch (err) {
    if (err.status !== 404) throw err;
    await call('POST', '/instance/create', { instanceName: instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
  }
  await setWebhook(instance);
}

async function state(instance) {
  try {
    const r = await call('GET', `/instance/connectionState/${enc(instance)}`, null, 10000);
    return (r.instance && r.instance.state) || r.state || 'desconhecido'; // open = conectado
  } catch (err) {
    if (err.status === 404) return 'sem_instancia';
    return 'servico_indisponivel';
  }
}

async function qrCode(instance) {
  await ensureInstance(instance);
  const r = await call('GET', `/instance/connect/${enc(instance)}`);
  return { base64: r.base64 || null, pairingCode: r.pairingCode || null };
}

async function pairingCode(instance, phone) {
  await ensureInstance(instance);
  const r = await call('GET', `/instance/connect/${enc(instance)}?number=${enc(phone)}`);
  return r.pairingCode || r.code || null;
}

async function logout(instance) {
  try { await call('DELETE', `/instance/logout/${enc(instance)}`); } catch {}
}
async function remove(instance) {
  await logout(instance);
  try { await call('DELETE', `/instance/delete/${enc(instance)}`); } catch {}
}

async function groups(instance) {
  const r = await call('GET', `/group/fetchAllGroups/${enc(instance)}?getParticipants=false`, null, 90000);
  const list = Array.isArray(r) ? r : r.groups || [];
  return list.map((g) => ({ id: g.id, name: g.subject || g.id, size: g.size || 0, announce: !!g.announce }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function inviteUrl(instance, groupJid) {
  const r = await call('GET', `/group/inviteCode/${enc(instance)}?groupJid=${enc(groupJid)}`);
  return r.inviteUrl || (r.inviteCode ? `https://chat.whatsapp.com/${r.inviteCode}` : null);
}

// Baixa a imagem de uma mensagem recebida (para Clone/Monitoramento/Replicador)
// data = o objeto da mensagem recebido pelo webhook (key + message)
async function mediaBase64(instance, data) {
  const r = await call('POST', `/chat/getBase64FromMediaMessage/${enc(instance)}`,
    { message: { key: data.key, message: data.message }, convertToMp4: false }, 60000);
  return r.base64 ? { base64: r.base64, mimetype: r.mimetype || 'image/jpeg' } : null;
}

// Envia uma mensagem: texto (com ou sem prévia do link) ou imagem com legenda.
// image: { url } ou { base64, mimetype }
async function send(instance, to, { text, image, preview = true, mentionAll = false }) {
  if (image && (image.url || image.base64)) {
    return call('POST', `/message/sendMedia/${enc(instance)}`, {
      number: to, mediatype: 'image', mimetype: image.mimetype || 'image/jpeg',
      caption: text || '', media: image.base64 || image.url, fileName: 'oferta.jpg', delay: 1200,
      mentionsEveryOne: !!mentionAll,
    });
  }
  return call('POST', `/message/sendText/${enc(instance)}`, {
    number: to, text, delay: 1200, linkPreview: !!preview, mentionsEveryOne: !!mentionAll,
  });
}

module.exports = { call, ensureInstance, setWebhook, state, qrCode, pairingCode, logout, remove, groups, inviteUrl, mediaBase64, send };
