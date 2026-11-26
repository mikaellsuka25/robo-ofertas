// Servidores de mentira (Shopee, Evolution/WhatsApp, Telegram, IA) para os testes
const http = require('node:http');
const crypto = require('node:crypto');

function startFakes({ secret = 'segredo' } = {}) {
  const state = {
    sent: [], tg: [], ai: 0, shopeeCalls: 0,
    instances: { robo: 'open' }, // nome → estado
    groups: [{ id: '111@g.us', subject: 'Ofertas VIP', size: 1000 }, { id: '222@g.us', subject: 'Achadinhos', size: 200 },
      { id: '999@g.us', subject: 'Minha origem', size: 3 }, { id: '888@g.us', subject: 'Concorrente', size: 5000 }],
    failFor: new Set(), // jids que dão erro ao enviar
    tgUpdates: [],
    products: {
      '1.2': { itemId: 2, shopId: 1, productName: 'Air Fryer Mondial 4L Preta', imageUrl: 'https://img/af.jpg', priceMin: '249.90', priceDiscountRate: 50, ratingStar: '4.9', sales: 9000, commissionRate: '0.1', offerLink: 'https://s.shopee.com.br/af', productLink: 'https://shopee.com.br/product/1/2', shopName: 'Loja A' },
      '3.4': { itemId: 4, shopId: 3, productName: 'Toalha de Banho Gigante 100% Algodão', imageUrl: 'https://img/toalha.jpg', priceMin: '39.90', priceDiscountRate: 40, ratingStar: '4.7', sales: 1200, commissionRate: '0.12', offerLink: 'https://s.shopee.com.br/toalha', productLink: 'https://shopee.com.br/product/3/4', shopName: 'Loja B' },
    },
    search: [
      { itemId: 10, shopId: 9, productName: 'Cadeira Gamer Profissional Reclinável', imageUrl: 'https://img/c1.jpg', priceMin: '399.90', priceDiscountRate: 60, ratingStar: '4.8', sales: 3000, commissionRate: '0.1', offerLink: 'https://s.shopee.com.br/c1' },
      { itemId: 11, shopId: 9, productName: 'Cadeira de Escritório Ergonômica Giratória', imageUrl: 'https://img/c2.jpg', priceMin: '299.90', priceDiscountRate: 55, ratingStar: '4.7', sales: 2500, commissionRate: '0.1', offerLink: 'https://s.shopee.com.br/c2' },
      { itemId: 12, shopId: 9, productName: 'Espelho Redondo Adnet Couro com Alça 60cm', imageUrl: 'https://img/e1.jpg', priceMin: '21.90', priceDiscountRate: 80, ratingStar: '4.9', sales: 8000, commissionRate: '0.13', offerLink: 'https://s.shopee.com.br/e1' },
      { itemId: 13, shopId: 9, productName: 'Espelho Redondo Decorativo Adnet Suspenso de Parede 60cm', imageUrl: 'https://img/e2.jpg', priceMin: '21.90', priceDiscountRate: 78, ratingStar: '4.8', sales: 7000, commissionRate: '0.13', offerLink: 'https://s.shopee.com.br/e2' },
      { itemId: 14, shopId: 9, productName: 'Produto Ruim Barato', imageUrl: 'https://img/r.jpg', priceMin: '9.90', priceDiscountRate: 70, ratingStar: '3.1', sales: 900, commissionRate: '0.1', offerLink: 'https://s.shopee.com.br/r' },
      { itemId: 15, shopId: 9, productName: 'Bonsai Artificial Realista', imageUrl: 'https://img/b.jpg', priceMin: '17.98', priceDiscountRate: 81, ratingStar: '4.8', sales: 600, commissionRate: '0.11', offerLink: 'https://s.shopee.com.br/b' },
    ],
  };

  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const url = new URL(req.url, 'http://x');

    // ---- Shopee ----
    if (url.pathname === '/graphql') {
      state.shopeeCalls++;
      const m = (req.headers.authorization || '').match(/Credential=(\d+), Timestamp=(\d+), Signature=(\w+)/);
      if (!m || m[3] !== crypto.createHash('sha256').update(m[1] + m[2] + body + secret).digest('hex')) {
        return json(200, { errors: [{ message: 'Invalid Signature' }] });
      }
      const q = JSON.parse(body);
      if (q.query.includes('generateShortLink')) {
        const h = crypto.createHash('md5').update(q.variables.url).digest('hex').slice(0, 6);
        return json(200, { data: { generateShortLink: { shortLink: `https://s.shopee.com.br/aff${h}?sub=${(q.variables.subIds || []).join(',')}` } } });
      }
      const byId = q.query.match(/shopId:(\d+), itemId:(\d+)/);
      if (byId) {
        const p = state.products[`${byId[1]}.${byId[2]}`];
        return json(200, { data: { productOfferV2: { nodes: p ? [p] : [] } } });
      }
      return json(200, { data: { productOfferV2: { nodes: state.search, pageInfo: { page: 1, limit: 50, hasNextPage: false } } } });
    }

    // ---- IA ----
    if (url.pathname === '/v1/messages') {
      state.ai++;
      if (req.headers['x-api-key'] !== 'chave-ia') return json(401, { error: { message: 'invalid x-api-key' } });
      return json(200, { content: [{ type: 'text', text: '"Sua cozinha nunca mais será a mesma"' }] });
    }

    // ---- Telegram ----
    const tgm = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
    if (tgm) {
      if (tgm[1] !== '123:ABC') return json(401, { ok: false, description: 'Unauthorized' });
      const method = tgm[2];
      if (method === 'getMe') return json(200, { ok: true, result: { username: 'robo_bot' } });
      if (method === 'getUpdates') { const u = state.tgUpdates; state.tgUpdates = []; return json(200, { ok: true, result: u }); }
      state.tg.push({ method, body: /json/.test(req.headers['content-type'] || '') ? JSON.parse(body) : { multipart: true } });
      return json(200, { ok: true, result: { message_id: 1 } });
    }

    // ---- Evolution (WhatsApp) ----
    if (req.headers.apikey !== 'chave') return json(401, { message: 'Unauthorized' });
    let m;
    if ((m = url.pathname.match(/^\/instance\/connectionState\/(.+)$/))) {
      const st = state.instances[decodeURIComponent(m[1])];
      return st ? json(200, { instance: { state: st } }) : json(404, { message: 'not found' });
    }
    if (url.pathname === '/instance/create') { state.instances[JSON.parse(body).instanceName] = 'close'; return json(201, {}); }
    if (url.pathname.startsWith('/instance/connect/')) return json(200, { base64: 'data:image/png;base64,AAAA', pairingCode: 'ABCD1234' });
    if (url.pathname.startsWith('/instance/logout/')) { state.instances[decodeURIComponent(url.pathname.split('/').pop())] = 'close'; return json(200, {}); }
    if (url.pathname.startsWith('/instance/delete/')) { delete state.instances[decodeURIComponent(url.pathname.split('/').pop())]; return json(200, {}); }
    if (url.pathname.startsWith('/webhook/set/')) { state.webhook = JSON.parse(body); return json(201, {}); }
    if (url.pathname.startsWith('/group/fetchAllGroups/')) return json(200, state.groups);
    if (url.pathname.startsWith('/group/inviteCode/')) return json(200, { inviteUrl: `https://chat.whatsapp.com/INV${url.searchParams.get('groupJid')}` });
    if (url.pathname.startsWith('/chat/getBase64FromMediaMessage/')) return json(200, { base64: Buffer.from('fake-image').toString('base64'), mimetype: 'image/jpeg' });
    if ((m = url.pathname.match(/^\/message\/(sendText|sendMedia)\/(.+)$/))) {
      const b = JSON.parse(body);
      const inst = decodeURIComponent(m[2]);
      if (state.instances[inst] !== 'open') return json(400, { message: 'instance not connected' });
      if (state.failFor.has(b.number)) return json(400, { response: { message: ['not a participant'] } });
      const id = 'MSG' + (state.sent.length + 1);
      state.sent.push({ type: m[1], instance: inst, body: b, id });
      return json(201, { key: { id, remoteJid: b.number, fromMe: true } });
    }
    json(404, { message: 'not found' });
  });

  return new Promise((resolve) => server.listen(0, () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ state, base, close: () => server.close() });
  }));
}

module.exports = { startFakes };
