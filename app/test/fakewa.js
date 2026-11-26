// WhatsApp simulado: substitui as funções do módulo whatsapp nos testes
function installFakeWa(state) {
  const wa = require('../src/whatsapp');
  wa.state = async (name) => state.instances[name] || 'close';
  wa.ensureInstance = async (name) => { if (!state.instances[name]) state.instances[name] = 'close'; };
  wa.qrCode = async () => ({ base64: 'data:image/png;base64,AAAA' });
  wa.pairingCode = async () => 'ABCD1234';
  wa.logout = async (name) => { state.instances[name] = 'close'; };
  wa.remove = async (name) => { delete state.instances[name]; };
  wa.hasSession = () => false;
  wa.groups = async (name) => {
    if (state.instances[name] !== 'open') throw new Error('não conectado');
    return state.groups.map((g) => ({ id: g.id, name: g.subject, size: g.size, announce: false }));
  };
  wa.inviteUrl = async (name, jid) => `https://chat.whatsapp.com/INV${jid}`;
  wa.mediaBase64 = async () => ({ base64: Buffer.from('fake-image').toString('base64'), mimetype: 'image/jpeg' });
  wa.send = async (instance, to, opts) => {
    if (state.instances[instance] !== 'open') throw new Error('instance not connected');
    if (state.failFor.has(to)) throw new Error('not a participant');
    const id = 'MSG' + (state.sent.length + 1);
    // espelha o formato antigo para os testes: type + body
    const body = opts.image ? { number: to, caption: opts.text, media: opts.image } : { number: to, text: opts.text, linkPreview: !!opts.preview };
    state.sent.push({ type: opts.image ? 'sendMedia' : 'sendText', instance, to, opts, body, id });
    return { key: { id, remoteJid: to, fromMe: true } };
  };
  return wa;
}
module.exports = { installFakeWa };
