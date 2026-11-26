// Conexão com o WhatsApp feita pelo próprio robô (biblioteca Baileys, a mesma usada por trás da Evolution API).
// Cada número conectado é uma "instância". A sessão fica salva em DATA_DIR/wa/<nome>.
const fs = require('node:fs');
const path = require('node:path');
const store = require('./db');

let B = null; // módulo Baileys (ESM)
async function lib() {
  if (!B) B = await import('@whiskeysockets/baileys');
  return B;
}
const logger = require('pino')({ level: process.env.WA_LOG_LEVEL || 'silent' });

const sessions = new Map(); // nome → { sock, state, qr, qrAt, retries, starting }
let messageHandler = null;
const recentSent = new Map(); // id → mensagem (para reenvio quando o WhatsApp pede)

const authDir = (name) => path.join(store.DATA_DIR, 'wa', String(name).replace(/[^\w-]/g, '_'));
const hasSession = (name) => fs.existsSync(path.join(authDir(name), 'creds.json'));

function onMessage(fn) { messageHandler = fn; }

async function start(name) {
  let s = sessions.get(name);
  if (s && (s.sock || s.starting)) return s;
  s = s || { state: 'close', qr: null, qrAt: 0, retries: 0 };
  s.starting = true;
  s.stopped = false;
  sessions.set(name, s);
  try {
    const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = await lib();
    fs.mkdirSync(authDir(name), { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir(name));
    let version;
    try { version = (await fetchLatestBaileysVersion()).version; } catch {}
    const sock = makeWASocket({
      auth: state, logger, ...(version ? { version } : {}), browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: true,
      getMessage: async (key) => recentSent.get(key.id),
    });
    s.sock = sock;
    s.state = 'connecting';
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (u) => {
      if (s.sock !== sock) return; // evento de uma conexão antiga
      if (u.qr) {
        try { s.qr = await require('qrcode').toDataURL(u.qr, { margin: 1, width: 320 }); s.qrAt = Date.now(); } catch {}
      }
      if (u.connection === 'open') {
        s.state = 'open'; s.qr = null; s.retries = 0;
        store.log('info', `WhatsApp conectado: ${name}`);
      }
      if (u.connection === 'close') {
        const err = u.lastDisconnect && u.lastDisconnect.error;
        const code = err && err.output && err.output.statusCode;
        s.sock = null;
        s.state = 'close';
        if (code === DisconnectReason.loggedOut) {
          store.log('erro', `WhatsApp ${name}: desconectado pelo celular. Conecte de novo pelo QR code.`);
          fs.rmSync(authDir(name), { recursive: true, force: true });
          s.qr = null;
          return;
        }
        if (s.stopped) return;
        // sem sessão e QR expirado: espera alguém abrir a tela de conexão
        if (!hasSession(name) && code === DisconnectReason.timedOut) { s.qr = null; return; }
        s.retries = (s.retries || 0) + 1;
        const wait = code === DisconnectReason.restartRequired ? 300 : Math.min(60000, 2000 * s.retries);
        if (code !== DisconnectReason.restartRequired) store.log('info', `WhatsApp ${name}: conexão caiu (código ${code || '?'}), reconectando em ${Math.round(wait / 1000)} s`);
        setTimeout(() => start(name).catch(() => {}), wait);
      }
    });
    sock.ev.on('messages.upsert', ({ messages }) => {
      if (!messageHandler) return;
      for (const m of messages) {
        if (!m.key || !m.message) continue;
        Promise.resolve(messageHandler({ event: 'messages.upsert', instance: name, data: m }))
          .catch((err) => store.log('erro', `Mensagem recebida: ${err.message}`));
      }
    });
  } finally {
    s.starting = false;
  }
  return s;
}

// Sobe todos os números que já têm sessão salva
async function startAll(names) {
  for (const n of names) if (hasSession(n)) await start(n).catch((err) => store.log('erro', `WhatsApp ${n}: ${err.message}`));
}

async function ensureInstance(name) { await start(name); }

async function state(name) {
  const s = sessions.get(name);
  if (!s) return hasSession(name) ? 'connecting' : 'close';
  return s.state;
}

async function waitFor(s, cond, ms) {
  for (let t = 0; t < ms && !cond(); t += 250) await new Promise((r) => setTimeout(r, 250));
}

async function qrCode(name) {
  const s = await start(name);
  await waitFor(s, () => s.qr || s.state === 'open', 6000);
  return { base64: s.qr, pairingCode: null };
}

async function pairingCode(name, phone) {
  const s = await start(name);
  await waitFor(s, () => s.qr || s.state === 'open', 10000);
  if (!s.sock) throw new Error('A conexão ainda não está pronta, tente de novo.');
  return s.sock.requestPairingCode(String(phone).replace(/\D/g, ''));
}

async function logout(name) {
  const s = sessions.get(name);
  if (s) {
    s.stopped = true;
    if (s.sock) { try { await s.sock.logout(); } catch {} try { s.sock.end(undefined); } catch {} }
  }
  sessions.delete(name);
  fs.rmSync(authDir(name), { recursive: true, force: true });
}
async function remove(name) { await logout(name); }

function sockOf(name) {
  const s = sessions.get(name);
  if (!s || !s.sock || s.state !== 'open') throw new Error(`O número ${name} não está conectado.`);
  return s.sock;
}

async function groups(name) {
  const all = await sockOf(name).groupFetchAllParticipating();
  return Object.values(all).map((g) => ({
    id: g.id, name: g.subject || g.id, size: g.size || (g.participants ? g.participants.length : 0), announce: !!g.announce,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function inviteUrl(name, groupJid) {
  const code = await sockOf(name).groupInviteCode(groupJid);
  return code ? `https://chat.whatsapp.com/${code}` : null;
}

// Baixa a imagem de uma mensagem recebida (Clone/Monitoramento/Replicador)
async function mediaBase64(name, data) {
  const { downloadMediaMessage } = await lib();
  const sock = sockOf(name);
  const buf = await downloadMediaMessage(data, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
  const mime = (data.message && data.message.imageMessage && data.message.imageMessage.mimetype) || 'image/jpeg';
  return buf ? { base64: buf.toString('base64'), mimetype: mime } : null;
}

async function imageBuffer(image) {
  if (image.base64) return Buffer.from(String(image.base64).replace(/^data:[^,]+,/, ''), 'base64');
  const res = await fetch(image.url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`imagem HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Prévia do link montada pelo robô: título + foto do produto (não depende do site da Shopee responder)
async function buildPreview(sock, text, card) {
  const { prepareWAMessageMedia } = await lib();
  const urls = String(text).match(/https?:\/\/[^\s*~_]+/g) || [];
  const matched = (card.url && urls.find((u) => u === card.url || u.startsWith(card.url))) || urls[0];
  if (!matched) return undefined;
  const preview = { 'canonical-url': matched, 'matched-text': matched, title: card.title || '', description: card.description || '' };
  if (card.image) {
    try {
      const buf = await imageBuffer({ url: card.image });
      const { imageMessage } = await prepareWAMessageMedia({ image: buf }, { upload: sock.waUploadToServer, mediaTypeOverride: 'thumbnail-link' });
      preview.jpegThumbnail = imageMessage && imageMessage.jpegThumbnail ? Buffer.from(imageMessage.jpegThumbnail) : undefined;
      preview.highQualityThumbnail = imageMessage || undefined;
    } catch (err) {
      store.log('erro', `Prévia do link: não consegui preparar a foto (${err.message})`);
    }
  }
  return preview;
}

async function mentionsFor(sock, to) {
  if (!/@g\.us$/.test(to)) return undefined;
  const meta = await sock.groupMetadata(to);
  return (meta.participants || []).map((p) => p.id);
}

// Envia uma mensagem.
// image: { url } ou { base64, mimetype } → foto com legenda
// preview: true = prévia do link; card = { url, title, description, image } monta a prévia com a foto do produto
async function send(name, to, { text, image, preview = true, card, mentionAll = false }) {
  const sock = sockOf(name);
  const mentions = mentionAll ? await mentionsFor(sock, to) : undefined;
  let content;
  if (image && (image.url || image.base64)) {
    content = { image: await imageBuffer(image), caption: text || '', mimetype: image.mimetype || 'image/jpeg' };
  } else {
    content = { text: text || '' };
    if (!preview) content.linkPreview = null;
    else if (card && (card.title || card.image)) content.linkPreview = await buildPreview(sock, text, card);
    // sem card: o próprio WhatsApp tenta montar a prévia a partir do link
  }
  if (mentions) content.mentions = mentions;
  const msg = await sock.sendMessage(to, content);
  if (msg && msg.key && msg.key.id) {
    recentSent.set(msg.key.id, msg.message);
    if (recentSent.size > 300) recentSent.delete(recentSent.keys().next().value);
  }
  return msg;
}

async function setWebhook() {} // não é mais necessário: as mensagens chegam direto

module.exports = { start, startAll, onMessage, ensureInstance, setWebhook, state, qrCode, pairingCode, logout, remove, groups, inviteUrl, mediaBase64, send, buildPreview, authDir, hasSession };
