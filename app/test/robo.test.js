// Testes com uma Shopee e um WhatsApp de mentira (não envia nada de verdade)
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-'));
process.env.SHOPEE_APP_ID = '123456';
process.env.SHOPEE_SECRET = 'segredo';
process.env.EVOLUTION_API_KEY = 'chave';
process.env.PANEL_PASSWORD = 'senha123';

const sent = [];
let shopeeCalls = 0;
const fake = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/graphql') {
    shopeeCalls++;
    const m = req.headers.authorization.match(/Credential=(\d+), Timestamp=(\d+), Signature=(\w+)/);
    const expected = crypto.createHash('sha256').update(m[1] + m[2] + body + 'segredo').digest('hex');
    if (m[3] !== expected) return json(200, { errors: [{ message: 'Invalid Signature' }] });
    const q = JSON.parse(body);
    if (q.query.includes('generateShortLink')) return json(200, { data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/AbC123' } } });
    return json(200, { data: { productOfferV2: { nodes: [
      { itemId: 1, productName: 'Fone Bluetooth TWS Pro', imageUrl: 'https://img/1.jpg', priceMin: '59.90', priceDiscountRate: 50,
        ratingStar: '4.8', sales: 5000, commissionRate: '0.12', offerLink: 'https://s.shopee.com.br/fone' },
      { itemId: 2, productName: 'Produto ruim', priceMin: '10', priceDiscountRate: 60, ratingStar: '3.1', sales: 900, commissionRate: '0.1', offerLink: 'x' },
      { itemId: 3, productName: 'Sem desconto', priceMin: '10', priceDiscountRate: 5, ratingStar: '4.9', sales: 900, commissionRate: '0.1', offerLink: 'x' },
    ], pageInfo: { page: 1, limit: 50, hasNextPage: false } } } });
  }
  if (req.headers.apikey !== 'chave') return json(401, { message: 'Unauthorized' });
  if (req.url.startsWith('/instance/connectionState/')) return json(200, { instance: { instanceName: 'robo', state: 'open' } });
  if (req.url.startsWith('/group/fetchAllGroups/')) return json(200, [{ id: '111@g.us', subject: 'Ofertas VIP', size: 1000 }, { id: '222@g.us', subject: 'Achadinhos', size: 200 }]);
  if (req.url.startsWith('/message/')) { sent.push({ url: req.url, body: JSON.parse(body) }); return json(201, { key: { id: 'x' } }); }
  json(404, { message: 'not found' });
});

let base, panel;
test.before(async () => {
  await new Promise((r) => fake.listen(0, r));
  base = `http://127.0.0.1:${fake.address().port}`;
  process.env.SHOPEE_ENDPOINT = base + '/graphql';
  process.env.EVOLUTION_URL = base;
});
test.after(() => { fake.close(); if (panel) panel.close(); });

test('formata a mensagem e esconde linhas vazias', () => {
  const robot = require('../src/robot');
  const msg = robot.formatMessage({ source: 'shopee', item_key: '9', title: 'Lixeira Inox 5 Litros Cesto Com Pedal', price: 49.99, old_price: 71.41, discount: 30, link: 'https://s.shopee.com.br/1W1' });
  assert.strictEqual(msg, '*ATÉ O LIXO GANHA UM CANTINHO DISCRETO E ORGANIZADO NA CASA*\n\n🛍️ Lixeira Inox 5 Litros Cesto Com Pedal\n\nDe ~R$ 71,41~\n*Por R$ 49,99* 🔥\n\n🛒 *Compre aqui:*\nhttps://s.shopee.com.br/1W1');
  const semDesconto = robot.formatMessage({ source: 'shopee', title: 'X', price: 10, discount: 0, link: 'https://l' });
  assert.doesNotMatch(semDesconto, /De R\$/);
  assert.match(semDesconto, /\*Por R\$ 10,00\* 🔥/);
});

test('busca na Shopee com assinatura certa, filtra e não duplica', async () => {
  const robot = require('../src/robot');
  const store = require('../src/db');
  store.set('keywords', 'fone');
  const r1 = await robot.collect();
  assert.strictEqual(r1.added, 1, 'só o fone passa nos filtros');
  const r2 = await robot.collect();
  assert.strictEqual(r2.added, 0, 'não coloca o mesmo produto duas vezes');
  const o = store.db.prepare(`SELECT * FROM offers WHERE item_key='1'`).get();
  assert.strictEqual(o.commission, 12);
  assert.ok(Math.abs(o.old_price - 119.8) < 0.01);
});

test('envia para todos os grupos escolhidos e marca como enviado', async () => {
  const robot = require('../src/robot');
  const store = require('../src/db');
  store.set('groups', JSON.stringify([{ id: '111@g.us', name: 'Ofertas VIP' }]));
  const o = store.db.prepare(`SELECT * FROM offers WHERE status='pending' LIMIT 1`).get();
  await robot.sendOne(o);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].body.number, '111@g.us');
  assert.match(sent[0].url, /sendText/, 'padrão é prévia do link');
  assert.strictEqual(sent[0].body.linkPreview, true);
  assert.match(sent[0].body.text, /s\.shopee\.com\.br\/fone/);
  assert.strictEqual(store.db.prepare('SELECT status FROM offers WHERE id=?').get(o.id).status, 'sent');
  await robot.sendOne(o); // segunda vez não pode reenviar
  assert.strictEqual(sent.length, 1);
});

test('painel: senha, grupos e link manual da Shopee', async () => {
  const server = require('../src/server');
  const store = require('../src/db');
  panel = http.createServer((q, s) => server.handle(q, s));
  await new Promise((r) => panel.listen(0, r));
  const P = `http://127.0.0.1:${panel.address().port}`;

  let r = await fetch(P + '/', { redirect: 'manual' });
  assert.strictEqual(r.headers.get('location'), '/entrar');
  r = await fetch(P + '/entrar', { method: 'POST', body: 'senha=errada', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  assert.ok(!r.headers.get('set-cookie'));
  r = await fetch(P + '/entrar', { method: 'POST', body: 'senha=senha123', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'Content-Type': 'application/x-www-form-urlencoded' };

  for (const pg of ['/', '/whatsapp', '/grupos', '/fila', '/manual', '/config']) {
    r = await fetch(P + pg, { headers: H });
    assert.strictEqual(r.status, 200, pg);
  }
  assert.match(await (await fetch(P + '/grupos', { headers: H })).text(), /Ofertas VIP/);

  const body = new URLSearchParams(); body.append('g', '111@g.us|Ofertas VIP'); body.append('g', '222@g.us|Achadinhos');
  await fetch(P + '/grupos', { method: 'POST', headers: H, body: body.toString(), redirect: 'manual' });
  assert.strictEqual(JSON.parse(store.get('groups')).length, 2);

  const before = sent.length;
  const m = new URLSearchParams({ link: 'https://shopee.com.br/produto-i.1.2', text: '🔥 Teste manual', image: '', when: 'next' });
  await fetch(P + '/manual', { method: 'POST', headers: H, body: m.toString(), redirect: 'manual' });
  const top = store.db.prepare(`SELECT * FROM offers WHERE status='pending' ORDER BY score DESC LIMIT 1`).get();
  assert.strictEqual(top.link, 'https://s.shopee.com.br/AbC123', 'link da Shopee convertido para afiliado');
  assert.strictEqual(sent.length, before);

  const cfg = new URLSearchParams({ min_discount: '40', template: 'sem link' });
  await fetch(P + '/config', { method: 'POST', headers: H, body: cfg.toString(), redirect: 'manual' });
  assert.strictEqual(store.get('min_discount'), '40');
  assert.match(store.get('template'), /\{link\}/, 'não aceita modelo sem link');
});

test('variedade: produtos parecidos e mesmo tipo em sequência', () => {
  const robot = require('../src/robot');
  const store = require('../src/db');
  // os exemplos reais que apareceram na fila
  const e1 = 'Espelho Redondo Adnet Couro com Alça 60cm 50cm 40cm 30cm 20cm Decorativo + Pino Pendurador';
  const e2 = 'Espelho Redondo Decorativo Adnet Supenso de Parede 60cm 50cm 40cm 30cm 20cm Com Alça + Pino';
  assert.ok(robot.similarity(e1, e2) >= 0.6, 'espelhos iguais detectados');
  assert.ok(robot.similarity(e1, 'Kit 6 vasos decorativos com plantas artificiais') < 0.6);
  for (const t of ['Cadeira de Escritório Ergonômica Giratória', 'Cadeira Gamer Profissional Reclinável',
    'kIT 2 Cadeira Lua Decorativa Poltrona', 'kit 2 Cadeiras de Jantar Lua'])
    assert.strictEqual(robot.family({ title: t }), 'cadeira', t);

  store.db.exec(`UPDATE offers SET status='skipped' WHERE status IN ('pending','sent')`);
  let k = 0;
  const mk = (title, sc) => robot.addOffer({ source: 'shopee', item_key: 'v' + k++, title, price: 10, discount: 50, link: 'x', score: sc });
  mk('Cadeira Gamer Profissional', 100); mk('Cadeira de Escritório Ergonômica', 99); mk('kit 2 Cadeira Lua', 98);
  mk('Espelho Redondo Adnet', 97); mk('Bonsai Artificial', 50); mk('Manta Cobertor Microfibra', 40);
  const fams = robot.plan(6).map((o) => robot.family(o));
  for (let i = 1; i < fams.length - 2; i++) assert.notStrictEqual(fams[i], fams[i - 1], fams.join(','));
  assert.deepStrictEqual(fams.slice(0, 4), ['cadeira', 'espelho', 'bonsai', 'manta']);
});
