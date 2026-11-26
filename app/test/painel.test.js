// Testes do painel: migração da versão 1, todas as páginas abrem e os formulários principais funcionam
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { startFakes } = require('./fakes');
const { installFakeWa } = require('./fakewa');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-painel-'));
process.env.DATA_DIR = DIR;
process.env.EVOLUTION_API_KEY = 'chave';
process.env.PANEL_PASSWORD = 'senha123';

// Banco no formato da versão 1 (o que o usuário tem hoje)
{
  const old = new DatabaseSync(path.join(DIR, 'robo.db'));
  old.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE offers (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, item_key TEXT, title TEXT, price REAL, old_price REAL, discount INTEGER,
      commission REAL, rating REAL, sales INTEGER, image_url TEXT, link TEXT, extra_text TEXT, score REAL, status TEXT, error TEXT,
      created_at INTEGER, sent_at INTEGER, keyword TEXT, title_key TEXT);`);
  const s = old.prepare('INSERT INTO settings VALUES(?,?)');
  s.run('keywords', 'toalha de mesa\ncadeira'); s.run('min_discount', '40'); s.run('shopee_app_id', '123456'); s.run('shopee_secret', 'segredo');
  s.run('groups', JSON.stringify([{ id: '111@g.us', name: 'Ofertas VIP' }])); s.run('send_every_min', '12');
  old.prepare(`INSERT INTO offers(source,item_key,title,price,discount,link,score,status,created_at) VALUES('shopee','9.10','Cadeira X',100,50,'https://s.shopee.com.br/c',50,'pending',?)`).run(Date.now());
  old.prepare(`INSERT INTO offers(source,item_key,title,price,discount,link,score,status,created_at,sent_at) VALUES('shopee','9.11','Mesa Y',80,40,'https://s.shopee.com.br/m',40,'sent',?,?)`).run(Date.now(), Date.now());
  old.close();
}

let F, P, cookie, srv;
test.before(async () => {
  F = await startFakes();
  process.env.SHOPEE_ENDPOINT = F.base + '/graphql';
  process.env.EVOLUTION_URL = F.base;
  installFakeWa(F.state);
  process.env.TELEGRAM_API = F.base;
  const server = require('../src/server');
  srv = http.createServer((q, s) => server.handle(q, s));
  await new Promise((r) => srv.listen(0, r));
  P = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv.close(); F.close(); });

const H = () => ({ cookie, 'Content-Type': 'application/x-www-form-urlencoded' });
const post = (p, body) => fetch(P + p, { method: 'POST', headers: H(), body: new URLSearchParams(body).toString(), redirect: 'manual' });
const get = (p) => fetch(P + p, { headers: { cookie }, redirect: 'manual' });

test('migração: dados da versão 1 viram a automação "Busca Shopee"', () => {
  const store = require('../src/db');
  const [a] = store.listAutomations();
  assert.strictEqual(a.name, 'Busca Shopee');
  assert.strictEqual(a.type, 'busca');
  assert.strictEqual(a.cfg.keywords, 'toalha de mesa\ncadeira');
  assert.strictEqual(a.cfg.min_discount, 40);
  assert.strictEqual(a.cfg.interval_min, 12);
  assert.deepStrictEqual(a.cfg.dest, ['111@g.us']);
  assert.ok(a.active);
  assert.strictEqual(store.db.prepare(`SELECT COUNT(*) n FROM queue WHERE status='pending'`).get().n, 1);
  assert.strictEqual(store.db.prepare(`SELECT COUNT(*) n FROM queue WHERE status='sent'`).get().n, 1);
  assert.strictEqual(store.get('shopee_app_id'), '123456');
  assert.ok(store.db.prepare('SELECT * FROM templates').get().body.includes('{cta_ia}'));
});

test('login', async () => {
  let r = await fetch(P + '/', { redirect: 'manual' });
  assert.strictEqual(r.headers.get('location'), '/entrar');
  r = await fetch(P + '/entrar', { method: 'POST', body: 'senha=errada', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  assert.ok(!r.headers.get('set-cookie'));
  r = await fetch(P + '/entrar', { method: 'POST', body: 'senha=senha123', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.ok(cookie);
});

test('todas as páginas do menu abrem', async () => {
  const { MENU } = require('../src/web/ui');
  const pages = MENU.flatMap(([, items]) => items.map(([h]) => h)).concat([
    '/automacoes/nova', '/automacoes/nova?tipo=busca', '/automacoes/nova?tipo=promo', '/automacoes/nova?tipo=monitor',
    '/automacoes/nova?tipo=clone', '/automacoes/nova?tipo=replicador', '/automacoes/1', '/automacoes/1/fila',
    '/instancias/robo/conectar', '/grupos?buscar=1&inst=robo', '/rotador?novo=1', '/feed/1', '/fila/1', '/historico?status=failed']);
  for (const p of pages) {
    const r = await get(p);
    const html = await r.text();
    assert.strictEqual(r.status, 200, `${p} → ${r.status}\n${html.slice(0, 500)}`);
    assert.ok(!/Deu erro/.test(html), `${p} mostrou erro: ${html.match(/<pre>([^<]*)/)?.[1]}`);
  }
});

test('criar automação de promoção pelo formulário', async () => {
  await post('/grupos/cadastrar', [['inst', 'robo'], ['g', '222@g.us|Achadinhos|200']]);
  const r = await post('/automacoes/nova', [['type', 'promo'], ['name', 'Meus links'], ['origin', '999@g.us'], ['dest', '222@g.us'],
    ['mode', 'imediato'], ['interval_min', '5'], ['hour_start', '07:30'], ['hour_end', '22:00'], ['media', 'preview'], ['active', '1'], ['use_tags', '1']]);
  assert.match(decodeURIComponent(r.headers.get('location')), /salva e ativa/);
  const store = require('../src/db');
  const a = store.listAutomations().find((x) => x.name === 'Meus links');
  assert.strictEqual(a.cfg.origin, '999@g.us');
  assert.strictEqual(a.cfg.mode, 'imediato');
  // origem igual a destino é recusado
  const bad = await post(`/automacoes/${a.id}`, [['name', 'Meus links'], ['origin', '222@g.us'], ['dest', '222@g.us'], ['active', '1']]);
  assert.match(decodeURIComponent(bad.headers.get('location')), /loop/);
  assert.strictEqual(store.getAutomation(a.id).active, 0);
});

test('textos, cupons, tags e credenciais', async () => {
  let r = await post('/textos', { name: 'Curto', store: 'any', body: '{nome}\nR$ {preco_atual}\n{link}' });
  assert.match(decodeURIComponent(r.headers.get('location')), /salvo/);
  r = await post('/textos', { name: 'Errado', store: 'any', body: '{{nome}}' });
  assert.match(decodeURIComponent(r.headers.get('location')), /chave simples/);
  r = await post('/cupons', { code: 'casa10', kind: 'pct', value: '10', min_price: '50' });
  const store = require('../src/db');
  assert.strictEqual(store.db.prepare('SELECT code FROM coupons').get().code, 'CASA10');
  r = await post('/tags', { msg: 'https://s.shopee.com.br/x\n#preco 39,90\n#cupom ACHADO\n#desconto 10%' });
  const html = await r.text();
  assert.match(html, /ACHADO · 10%/);
  r = await post('/credenciais', { shopee_app_id: '123456', shopee_subid: 'meu sub!', testar: 'shopee' });
  assert.match(decodeURIComponent(r.headers.get('location')), /Shopee conectada/);
  assert.strictEqual(store.get('shopee_subid'), 'meusub');
});

test('envio manual agendado com imagem (multipart)', async () => {
  const fd = new FormData();
  fd.append('text', 'Bom dia, grupo!');
  fd.append('media', 'preview');
  fd.append('dest', '222@g.us');
  fd.append('quando', 'agendar');
  const t = new Date(Date.now() + 3600000);
  const local = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  fd.append('data', local);
  fd.append('image', new Blob([Buffer.from('fakejpeg')], { type: 'image/jpeg' }), 'foto.jpg');
  const r = await fetch(P + '/envio-manual', { method: 'POST', headers: { cookie }, body: fd, redirect: 'manual' });
  assert.match(decodeURIComponent(r.headers.get('location')), /Agendado/);
  const store = require('../src/db');
  const q = store.db.prepare(`SELECT * FROM queue WHERE automation_id IS NULL ORDER BY id DESC`).get();
  const pl = JSON.parse(q.payload);
  assert.strictEqual(pl.media, 'imagem');
  assert.ok(fs.existsSync(path.join(DIR, 'uploads', pl.image_file)));
  assert.ok(q.send_after > Date.now());
});

test('rotador manda para o grupo com vaga e vitrine pública', async () => {
  let r = await post('/rotador', [['name', 'Ofertas'], ['limit', '500'], ['g', '111@g.us|robo'], ['g', '222@g.us|robo']]);
  const store = require('../src/db');
  const rot = store.db.prepare('SELECT * FROM rotators').get();
  r = await fetch(`${P}/r/${rot.slug}`, { redirect: 'manual' });
  assert.strictEqual(r.headers.get('location'), 'https://chat.whatsapp.com/INV222@g.us', 'Ofertas VIP tem 1000 pessoas (cheio), vai para Achadinhos');
  r = await fetch(`${P}/v`);
  assert.strictEqual(r.status, 404, 'vitrine desativada por padrão');
  await post('/vitrine', { vitrine_enabled: '1', vitrine_name: 'Achados da Casa', vitrine_color: '#123456' });
  r = await fetch(`${P}/v`);
  const html = await r.text();
  assert.match(html, /Achados da Casa/);
  assert.match(html, /Mesa Y/, 'produto já enviado aparece');
  r = await fetch(`${P}/ir/2`, { redirect: 'manual' });
  assert.strictEqual(r.headers.get('location'), 'https://s.shopee.com.br/m');
});

test('gerador público converte link', async () => {
  const store = require('../src/db');
  store.set('gerador_enabled', '1');
  const r = await fetch(`${P}/g`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'link=' + encodeURIComponent('https://shopee.com.br/x-i.3.4') });
  assert.match(await r.text(), /s\.shopee\.com\.br\/aff\w+\?sub=gerador/);
});

