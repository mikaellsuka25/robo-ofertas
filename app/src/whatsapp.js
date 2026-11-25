// Conversa com a Evolution API (o "WhatsApp Web" que roda no servidor)
const BASE = (process.env.EVOLUTION_URL || 'http://evolution:8080').replace(/\/$/, '');
const KEY = process.env.EVOLUTION_API_KEY || '';
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'robo';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
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

async function ensureInstance() {
  try {
    await call('GET', `/instance/connectionState/${INSTANCE}`);
  } catch (err) {
    if (err.status !== 404) throw err;
    await call('POST', '/instance/create', { instanceName: INSTANCE, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
  }
}

async function state() {
  try {
    const r = await call('GET', `/instance/connectionState/${INSTANCE}`);
    return (r.instance && r.instance.state) || r.state || 'desconhecido'; // open = conectado
  } catch (err) {
    if (err.status === 404) return 'sem_instancia';
    return 'servico_indisponivel';
  }
}

async function qrCode() {
  await ensureInstance();
  const r = await call('GET', `/instance/connect/${INSTANCE}`);
  return { base64: r.base64 || null, pairingCode: r.pairingCode || null };
}

async function pairingCode(phone) {
  await ensureInstance();
  const r = await call('GET', `/instance/connect/${INSTANCE}?number=${encodeURIComponent(phone)}`);
  return r.pairingCode || r.code || null;
}

async function logout() {
  try { await call('DELETE', `/instance/logout/${INSTANCE}`); } catch {}
}

async function groups() {
  const r = await call('GET', `/group/fetchAllGroups/${INSTANCE}?getParticipants=false`);
  const list = Array.isArray(r) ? r : r.groups || [];
  return list.map((g) => ({ id: g.id, name: g.subject || g.id, size: g.size || 0, announce: !!g.announce }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function sendOffer(groupId, { text, imageUrl }) {
  if (imageUrl) {
    try {
      return await call('POST', `/message/sendMedia/${INSTANCE}`, {
        number: groupId, mediatype: 'image', mimetype: 'image/jpeg',
        caption: text, media: imageUrl, fileName: 'oferta.jpg', delay: 1200,
      });
    } catch (err) {
      if (err.status && err.status < 500 && err.status !== 400) throw err;
      // se a imagem falhar, manda só o texto
    }
  }
  return call('POST', `/message/sendText/${INSTANCE}`, { number: groupId, text, delay: 1200, linkPreview: true });
}

module.exports = { ensureInstance, state, qrCode, pairingCode, logout, groups, sendOffer };
