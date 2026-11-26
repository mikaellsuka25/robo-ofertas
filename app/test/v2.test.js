// Testes da versão 2 (tudo simulado: não envia nada de verdade)
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { startFakes } = require('./fakes');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'robo2-'));
process.env.EVOLUTION_API_KEY = 'chave';
process.env.PANEL_PASSWORD = 'senha123';

let F, store, dispatch, engine, render, products, text;
test.before(async () => {
  F = await startFakes();
  process.env.SHOPEE_ENDPOINT = F.base + '/graphql';
  process.env.EVOLUTION_URL = F.base;
  process.env.TELEGRAM_API = F.base;
  process.env.ANTHROPIC_API = F.base;
  store = require('../src/db');
  store.set('shopee_app_id', '123456');
  store.set('shopee_secret', 'segredo');
  dispatch = require('../src/dispatch');
  engine = require('../src/automations');
  render = require('../src/render');
  products = require('../src/products');
  text = require('../src/text');
  store.db.prepare(`INSERT INTO destinations(id,channel,name,instance,category,active,created_at) VALUES
    ('111@g.us','whatsapp','Ofertas VIP','robo','casa',1,0),('222@g.us','whatsapp','Achadinhos','robo','casa',1,0)`).run();
});
test.after(() => F.close());

const sentSince = (n) => F.state.sent.slice(n);

test('modelo: variáveis, linhas vazias somem e colchetes opcionais', () => {
  const out = render.fill('*{cta_ia}*\n🛍️ {nome}\n[De ~R$ {preco_original}~ | ]Por R$ {preco_atual}\n{cupom_texto}\n{link}',
    { cta_ia: 'OLHA ISSO', nome: 'Fone', preco_original: '', preco_atual: '59,90', cupom_texto: '', link: 'https://l' });
  assert.strictEqual(out, '*OLHA ISSO*\n🛍️ Fone\nPor R$ 59,90\nhttps://l');
});

test('cupom: escolhe o de maior desconto que vale para o preço', () => {
  const ins = store.db.prepare(`INSERT INTO coupons(store,code,kind,value,min_price,active,created_at) VALUES('shopee',?,?,?,?,1,0)`);
  const a = Number(ins.run('DEZ', 'pct', 10, 0).lastInsertRowid);
  const b = Number(ins.run('VINTE', 'brl', 20, 100).lastInsertRowid);
  assert.strictEqual(render.bestCoupon([a, b], 150).code, 'VINTE'); // R$20 > 10% de 150
  assert.strictEqual(render.bestCoupon([a, b], 50).code, 'DEZ');      // VINTE exige mínimo de R$100
});

test('produto a partir de link: dados da Shopee + link de afiliado com sub id', async () => {
  const p = await products.fromLink('https://shopee.com.br/Air-Fryer-i.1.2', { source: 'direto', subId: 'direto' });
  assert.strictEqual(p.title, 'Air Fryer Mondial 4L Preta');
  assert.strictEqual(p.price, 249.9);
  assert.match(p.link, /^https:\/\/s\.shopee\.com\.br\/aff\w+\?sub=direto$/);
  const r = await render.renderProduct(p, {});
  assert.match(r.text, /AIR FRYER|COZINHA|CASA|PREÇO|ACHAD|CORRE|ÚTIL|PROMO|PRATICIDADE|DETALHE|SUA/); // chamada do banco de frases
  assert.match(r.text, /De ~R\$ 499,80~/);
  assert.match(r.text, /\*Por R\$ 249,90\* 🔥/);
});

test('busca: filtra, junta espelhos iguais, não repete o mesmo tipo em seguida', async () => {
  const id = store.saveAutomation({ name: 'Busca', type: 'busca', active: true, cfg: {
    keywords: 'casa', dest: ['111@g.us'], per_keyword: 10, min_discount: 30, min_rating: 4.5, min_sales: 50, max_price: 500, variety: 5,
    hour_start: '00:00', hour_end: '00:00' } });
  const a = store.getAutomation(id);
  const r = await engine.collect(a);
  assert.strictEqual(r.added, 4, 'cadeira x2, 1 espelho (o outro é igual), bonsai; o ruim fica de fora');
  const fams = engine.plan(a, 4).map((q) => text.family(q));
  assert.notStrictEqual(fams[0], fams[1], fams.join(','));
  assert.strictEqual(fams.filter((f) => f === 'cadeira').length, 2);
  const again = await engine.collect(a);
  assert.strictEqual(again.added, 0, 'não repete na próxima busca');
});

test('envio: manda para os grupos, registra histórico e marca a própria mensagem', async () => {
  const a = store.getAutomation(1) && store.listAutomations().find((x) => x.name === 'Busca');
  const before = F.state.sent.length;
  const [item] = engine.plan(a, 1);
  const res = await dispatch.sendItem(item, { automation: a });
  assert.ok(res.ok, JSON.stringify(res));
  const s = sentSince(before);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].type, 'sendText');
  assert.strictEqual(s[0].body.linkPreview, true);
  assert.strictEqual(store.db.prepare(`SELECT COUNT(*) n FROM history WHERE queue_id=? AND status='sent'`).get(item.id).n, 1);
  assert.ok(store.db.prepare('SELECT 1 FROM seen_messages WHERE id=?').get(`robo:${s[0].id}`));
});

test('números: se o escolhido cair, outro assume; alternada reveza; dividida reparte', async () => {
  store.db.prepare(`INSERT INTO instances(name,label,created_at) VALUES('reserva','Reserva',1)`).run();
  F.state.instances.reserva = 'open';
  F.state.instances.robo = 'close';
  let plan = await dispatch.planInstances(dispatch.resolveDestinations(['111@g.us']), 'robo');
  assert.strictEqual(plan[0].instance, 'reserva', 'número caído → reserva assume');
  F.state.instances.robo = 'open';
  store.set('instance_mode', 'alternada');
  const used = new Set();
  for (let i = 0; i < 4; i++) used.add((await dispatch.planInstances(dispatch.resolveDestinations(['111@g.us']), ''))[0].instance);
  assert.strictEqual(used.size, 2);
  store.set('instance_mode', 'dividida');
  plan = await dispatch.planInstances(dispatch.resolveDestinations([], ['casa']), '');
  assert.strictEqual(plan.length, 2);
  assert.strictEqual(plan[0].dests.length + plan[1].dests.length, 2);
  store.set('instance_mode', 'automacao');
});

test('falha em um grupo tenta pelo outro número antes de desistir', async () => {
  F.state.failFor.add('222@g.us');
  const item = dispatch.enqueue({ payload: { text: 'Teste https://s.shopee.com.br/x', dest: ['111@g.us', '222@g.us'], fast: true } });
  const res = await dispatch.sendItem(item);
  assert.strictEqual(res.sent, 1);
  assert.strictEqual(res.total, 2);
  const fail = store.db.prepare(`SELECT * FROM history WHERE queue_id=? AND status='failed'`).get(item.id);
  assert.match(fail.error, /not a participant/);
  F.state.failFor.clear();
});

test('webhook: link no grupo de origem com tags vira promoção imediata', async () => {
  const id = store.saveAutomation({ name: 'Promo', type: 'promo', active: true, cfg: {
    origin: '999@g.us', dest: ['111@g.us'], mode: 'imediato', hour_start: '00:00', hour_end: '00:00' } });
  const before = F.state.sent.length;
  await engine.onWebhook({ event: 'messages.upsert', instance: 'robo', data: {
    key: { id: 'IN1', remoteJid: '999@g.us', fromMe: true },
    message: { conversation: 'olha esse\nhttps://shopee.com.br/toalha-i.3.4\n#preco 29,90\n#cupom TOALHA5\n#desconto R$ 5\n#texto Só hoje!' } } });
  const s = sentSince(before);
  assert.strictEqual(s.length, 1);
  const t = s[0].body.text;
  assert.match(t, /Toalha de Banho Gigante/);
  assert.match(t, /\*Por R\$ 24,90\* 🔥/, 'preço da tag menos o cupom de R$ 5');
  assert.match(t, /TOALHA5/);
  assert.match(t, /Só hoje!/);
  assert.match(t, /sub=promo/);
  // a mesma mensagem de novo não é processada
  await engine.onWebhook({ event: 'messages.upsert', instance: 'robo', data: { key: { id: 'IN1', remoteJid: '999@g.us' }, message: { conversation: 'https://shopee.com.br/toalha-i.3.4' } } });
  assert.strictEqual(sentSince(before).length, 1);
  store.saveAutomation({ ...store.getAutomation(id), active: false });
});

test('monitoramento: captura cupom e imagem; filtro bloqueia', async () => {
  const id = store.saveAutomation({ name: 'Monitor', type: 'monitor', active: true, cfg: {
    monitored: ['888@g.us'], dest: ['111@g.us'], mode: 'imediato', capture_coupon: true, capture_image: true, capture_cta: true,
    templates: [], hour_start: '00:00', hour_end: '00:00', filters: { block: 'air fryer' } } });
  const before = F.state.sent.length;
  await engine.onWebhook({ event: 'MESSAGES_UPSERT', instance: 'robo', data: {
    key: { id: 'M1', remoteJid: '888@g.us' },
    message: { imageMessage: { caption: 'CORRE QUE ACABA\nToalha linda\nCupom: ACHEI10\nhttps://shopee.com.br/x-i.3.4' } } } });
  const s = sentSince(before);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].type, 'sendMedia', 'imagem capturada do grupo');
  assert.match(s[0].body.caption, /ACHEI10/);
  await engine.onWebhook({ event: 'messages.upsert', instance: 'robo', data: {
    key: { id: 'M2', remoteJid: '888@g.us' }, message: { conversation: 'https://shopee.com.br/af-i.1.2' } } });
  assert.strictEqual(sentSince(before).length, 1, 'air fryer bloqueada pelo filtro');
  const h = store.db.prepare(`SELECT error FROM history WHERE automation_id=? AND status='failed' ORDER BY id DESC`).get(id);
  assert.match(h.error, /Filtro/);
  store.saveAutomation({ ...store.getAutomation(id), active: false });
});

test('clone: troca os links, tira a chamada antiga e põe chamada de IA', async () => {
  store.set('ai_key', 'chave-ia');
  store.saveAutomation({ name: 'Clone', type: 'clone', active: true, cfg: {
    monitored: ['888@g.us'], dest: ['222@g.us'], mode: 'imediato', remove_cta: true, ai_cta: 'upper', ai_cta_bold: true,
    capture_image: false, hour_start: '00:00', hour_end: '00:00' } });
  const before = F.state.sent.length;
  await engine.onWebhook({ event: 'messages.upsert', instance: 'robo', data: {
    key: { id: 'C1', remoteJid: '888@g.us' },
    message: { extendedTextMessage: { text: 'APROVEITA GENTE\n🔥 Air fryer top\nPor R$ 249\nhttps://shopee.com.br/af-i.1.2' } } } });
  const s = sentSince(before);
  assert.strictEqual(s.length, 1);
  const t = s[0].body.text;
  assert.ok(!/APROVEITA GENTE/.test(t), 'chamada antiga removida');
  assert.match(t, /^\*SUA COZINHA NUNCA MAIS SERÁ A MESMA\*/);
  assert.match(t, /sub=clone/);
  assert.ok(!/shopee\.com\.br\/af-i/.test(t), 'link original trocado');
  store.set('ai_key', '');
});

test('replicador: repassa a mensagem como chegou', async () => {
  store.saveAutomation({ name: 'Rep', type: 'replicador', active: true, cfg: { origin: '999@g.us', dest: ['111@g.us', '222@g.us'], mode: 'imediato', hour_start: '00:00', hour_end: '00:00' } });
  const before = F.state.sent.length;
  await engine.onWebhook({ event: 'messages.upsert', instance: 'robo', data: { key: { id: 'R1', remoteJid: '999@g.us' }, message: { conversation: 'Aviso: amanhã tem live!' } } });
  const s = sentSince(before).filter((x) => x.body.text === 'Aviso: amanhã tem live!');
  assert.strictEqual(s.length, 2);
});

test('telegram: vincula por /link e envia com HTML', async () => {
  store.set('telegram_token', '123:ABC');
  store.set('telegram_link_code', 'XYZ123');
  F.state.tgUpdates = [{ update_id: 5, message: { text: '/link XYZ123', chat: { id: -100, title: 'Canal TG' } } }];
  const tg = require('../src/telegram');
  assert.strictEqual(await tg.pollOnce(), 1);
  assert.ok(store.db.prepare(`SELECT 1 FROM destinations WHERE id='tg:-100'`).get());
  assert.strictEqual(tg.toHtml('*Por R$ 10* ~R$ 20~ <b>'), '<b>Por R$ 10</b> <s>R$ 20</s> &lt;b&gt;');
  const item = dispatch.enqueue({ payload: { text: '*Oi* https://x.com', dest: ['tg:-100'] } });
  const r = await dispatch.sendItem(item);
  assert.ok(r.ok);
  assert.strictEqual(F.state.tg.at(-1).method, 'sendMessage');
  assert.strictEqual(F.state.tg.at(-1).body.chat_id, '-100');
});

test('filtros e substituições não mexem em links', () => {
  assert.match(text.checkFilters({ block: 'usado, réplica' }, { text: 'Tênis RÉPLICA top' }), /replica/);
  assert.strictEqual(text.checkFilters({ only: 'casa' }, { text: 'Toalha para casa' }), null);
  assert.strictEqual(text.applyReplacements('Corre no link https://s.shopee.com.br/corre corre!', 'corre => voa'), 'voa no link https://s.shopee.com.br/corre voa!');
  assert.strictEqual(text.parsePrice('R$ 1.234,56'), 1234.56);
  assert.strictEqual(text.parsePrice('89.90'), 89.9);
});

test('envio agendado sai na hora certa', async () => {
  const item = dispatch.enqueue({ payload: { text: 'Agendado!', dest: ['111@g.us'], fast: true }, send_after: Date.now() + 3600000 });
  const before = F.state.sent.length;
  await engine.tick();
  assert.strictEqual(sentSince(before).filter((x) => x.body.text === 'Agendado!').length, 0);
  store.db.prepare('UPDATE queue SET send_after=? WHERE id=?').run(Date.now() - 1000, item.id);
  await engine.tick();
  assert.strictEqual(sentSince(before).filter((x) => x.body.text === 'Agendado!').length, 1);
});

test('planilha CSV da Shopee', async () => {
  const { readSheet } = require('../src/web/automacoes');
  const rows = await readSheet({ filename: 'x.csv', mime: 'text/csv', buffer: Buffer.from('Item Id,Offer Link,CTA\n1,https://s.shopee.com.br/abc,Olha isso\n2,"https://shopee.com.br/x-i.1.2",\n') });
  assert.deepStrictEqual(rows, [{ link: 'https://s.shopee.com.br/abc', cta: 'Olha isso' }, { link: 'https://shopee.com.br/x-i.1.2', cta: '' }]);
});
