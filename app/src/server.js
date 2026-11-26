// Painel web (abre no celular ou computador)
const http = require('node:http');
const crypto = require('node:crypto');
const store = require('./db');
const robot = require('./robot');
const wa = require('./whatsapp');
const shopee = require('./shopee');

const { db, log } = store;
const PASSWORD = process.env.PANEL_PASSWORD || '';
const TOKEN = crypto.createHmac('sha256', PASSWORD || 'x').update('sessao-painel').digest('hex');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => (n == null ? '-' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const when = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-');

const STATE_LABEL = {
  open: ['✅ Conectado', 'ok'], connecting: ['⏳ Aguardando leitura do QR code', 'warn'],
  close: ['❌ Desconectado', 'bad'], sem_instancia: ['❌ Desconectado', 'bad'],
  servico_indisponivel: ['⚠️ Serviço do WhatsApp iniciando…', 'warn'],
};

function page(title, body, { refresh } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${esc(title)} · Robô de Ofertas</title>
<style>
*{box-sizing:border-box}body{margin:0;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;color:#1d1f23}
header{background:#ee4d2d;color:#fff;padding:14px 16px}header b{font-size:18px}
nav{display:flex;gap:6px;overflow-x:auto;padding:10px 12px;background:#fff;border-bottom:1px solid #e3e5e8}
nav a{white-space:nowrap;padding:7px 12px;border-radius:999px;background:#f0f1f3;color:#1d1f23;text-decoration:none;font-size:14px}
nav a.on{background:#1d1f23;color:#fff}
main{max-width:760px;margin:0 auto;padding:14px}
.card{background:#fff;border:1px solid #e3e5e8;border-radius:12px;padding:14px;margin-bottom:14px}
h2{font-size:17px;margin:0 0 10px}label{display:block;font-weight:600;margin:12px 0 4px;font-size:14px}
small,.muted{color:#666;font-size:13px}
input,textarea,select{width:100%;padding:10px;border:1px solid #ccd0d5;border-radius:8px;font:inherit;background:#fff}
textarea{min-height:110px}
button,.btn{display:inline-block;padding:10px 16px;border:0;border-radius:8px;background:#ee4d2d;color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.sec,.btn.sec{background:#e9eaed;color:#1d1f23}button.small{padding:6px 10px;font-size:13px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
.stat{flex:1;min-width:120px;background:#f7f8fa;border-radius:10px;padding:10px}.stat b{display:block;font-size:22px}
.ok{color:#137333}.warn{color:#b06000}.bad{color:#c5221f}
.offer{display:flex;gap:10px;border-top:1px solid #eee;padding:10px 0}.offer img{width:64px;height:64px;object-fit:cover;border-radius:8px;background:#eee}
.offer .t{flex:1;min-width:0}.offer .t div{overflow:hidden;text-overflow:ellipsis}
pre{white-space:pre-wrap;background:#f7f8fa;padding:10px;border-radius:8px;font-size:13px;max-height:320px;overflow:auto}
.chk{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid #eee;font-weight:400}.chk input{width:22px;height:22px}
.flash{background:#e6f4ea;border:1px solid #b7dfc2;padding:10px;border-radius:8px;margin-bottom:14px}
</style></head><body>
<header><b>🤖 Robô de Ofertas</b></header>
<nav>${[['/', 'Início'], ['/whatsapp', 'WhatsApp'], ['/grupos', 'Grupos'], ['/fila', 'Fila'], ['/manual', 'Postar link'], ['/config', 'Configurações']]
    .map(([h, l]) => `<a href="${h}" class="${h === title.href ? 'on' : ''}">${l}</a>`).join('')}</nav>
<main>${body}</main></body></html>`;
}
const P = (href, name) => ({ href, toString: () => name });

function send(res, status, html, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}
const redirect = (res, to) => { res.writeHead(303, { Location: to }); res.end(); };

async function readForm(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 1e6) break; }
  const params = new URLSearchParams(body);
  const obj = Object.fromEntries(params);
  Object.defineProperty(obj, 'getAll', { value: (k) => params.getAll(k) });
  return obj;
}
function flash(url) {
  const m = url.searchParams.get('msg');
  return m ? `<div class="flash">${esc(m)}</div>` : '';
}
function authed(req) {
  const c = req.headers.cookie || '';
  return PASSWORD && c.split(';').some((p) => p.trim() === `sessao=${TOKEN}`);
}

// ---------- Páginas ----------
async function home(url) {
  const st = await wa.state();
  const [label, cls] = STATE_LABEL[st] || [st, 'warn'];
  const pending = db.prepare(`SELECT COUNT(*) n FROM offers WHERE status='pending'`).get().n;
  const groups = JSON.parse(store.get('groups') || '[]');
  const paused = store.get('paused') === '1';
  const logs = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 25').all();
  const missing = [];
  if (!(store.get('shopee_app_id') || process.env.SHOPEE_APP_ID)) missing.push('<a href="/config">colocar as chaves da Shopee</a>');
  if (st !== 'open') missing.push('<a href="/whatsapp">conectar o WhatsApp</a>');
  if (!groups.length) missing.push('<a href="/grupos">escolher os grupos</a>');
  return page(P('/', 'Início'), `${flash(url)}
  ${missing.length ? `<div class="card" style="border-color:#f3c27a;background:#fff8ec"><h2>Falta pouco para começar</h2>
    <ol>${missing.map((m) => `<li>${m}</li>`).join('')}</ol></div>` : ''}
  <div class="card"><h2>Situação</h2>
    <div class="row">
      <div class="stat"><small>WhatsApp</small><b class="${cls}" style="font-size:16px">${label}</b></div>
      <div class="stat"><small>Enviadas hoje</small><b>${robot.sentToday()} / ${esc(store.get('max_per_day'))}</b></div>
      <div class="stat"><small>Na fila</small><b>${pending}</b></div>
      <div class="stat"><small>Grupos</small><b>${groups.length}</b></div>
    </div>
    <p class="muted">Robô: <b>${paused ? '⏸️ pausado' : esc(robot.status().lastStatus)}</b></p>
    <div class="row">
      <form method="post" action="/acao/buscar"><button>🔎 Buscar ofertas agora</button></form>
      <form method="post" action="/acao/pausar"><button class="sec">${paused ? '▶️ Retomar envios' : '⏸️ Pausar envios'}</button></form>
    </div>
  </div>
  <div class="card"><h2>Últimos acontecimentos</h2>
    <pre>${logs.map((l) => `${when(l.at)}  ${l.level === 'erro' ? '❗' : '•'} ${esc(l.msg)}`).join('\n') || 'Nada ainda.'}</pre>
  </div>`, { refresh: 60 });
}

async function whatsappPage(url) {
  const st = await wa.state();
  if (st === 'open') {
    return page(P('/whatsapp', 'WhatsApp'), `${flash(url)}<div class="card"><h2>✅ WhatsApp conectado</h2>
      <p>Tudo certo. O robô já pode postar nos grupos.</p>
      <a class="btn" href="/grupos">Escolher grupos</a>
      <form method="post" action="/acao/desconectar" style="margin-top:16px" onsubmit="return confirm('Desconectar o WhatsApp do robô?')">
      <button class="sec">Desconectar este número</button></form></div>`);
  }
  if (st === 'servico_indisponivel') {
    return page(P('/whatsapp', 'WhatsApp'), `<div class="card"><h2>⏳ O serviço do WhatsApp ainda está ligando</h2>
      <p>Isso leva 1 ou 2 minutos depois de instalar ou reiniciar. Esta página atualiza sozinha.</p></div>`, { refresh: 15 });
  }
  let qr = null, err = '';
  try { qr = await wa.qrCode(); } catch (e) { err = e.message; }
  return page(P('/whatsapp', 'WhatsApp'), `${flash(url)}<div class="card"><h2>Conectar o número do robô</h2>
    <ol><li>No celular do número do robô, abra o WhatsApp.</li>
    <li>Toque em <b>⋮</b> (ou Configurações no iPhone) → <b>Dispositivos conectados</b> → <b>Conectar dispositivo</b>.</li>
    <li>Aponte a câmera para o código abaixo.</li></ol>
    ${qr && qr.base64 ? `<p style="text-align:center"><img src="${esc(qr.base64)}" alt="QR code" style="width:280px;max-width:100%;border:8px solid #fff"></p>`
      : `<p class="warn">Gerando o código… ${esc(err)}</p>`}
    <p class="muted">O código muda a cada poucos segundos; a página atualiza sozinha.</p></div>
  <div class="card"><h2>Está abrindo o painel no mesmo celular?</h2>
    <p class="muted">Aí não dá para escanear. Use o código de 8 letras: digite o número do robô com DDI e DDD (ex.: 5511999998888), toque em gerar e, no WhatsApp, escolha <b>Conectar com número de telefone</b>.</p>
    <form method="post" action="/acao/codigo"><input name="phone" inputmode="numeric" placeholder="5511999998888" required>
    <p><button>Gerar código</button></p></form></div>`, { refresh: 25 });
}

async function gruposPage(url) {
  let list = [], err = '';
  try { list = await wa.groups(); } catch (e) { err = e.message; }
  const chosen = new Set(JSON.parse(store.get('groups') || '[]').map((g) => g.id));
  return page(P('/grupos', 'Grupos'), `${flash(url)}<div class="card"><h2>Em quais grupos o robô posta?</h2>
    ${err ? `<p class="bad">Não consegui listar os grupos. Confira se o WhatsApp está conectado.<br><small>${esc(err)}</small></p>` : ''}
    <form method="post" action="/grupos">
    ${list.map((g) => `<label class="chk"><input type="checkbox" name="g" value="${esc(g.id)}|${esc(g.name)}" ${chosen.has(g.id) ? 'checked' : ''}>
      <span>${esc(g.name)} <small>${g.size ? `· ${g.size} pessoas` : ''}</small></span></label>`).join('') || '<p class="muted">Nenhum grupo encontrado.</p>'}
    <p><button>Salvar grupos</button></p></form>
    <p class="muted">Dica: o número do robô precisa ser administrador se o grupo estiver configurado para "só admins enviam".</p></div>`);
}

function offerRow(o, actions) {
  return `<div class="offer">${o.image_url ? `<img src="${esc(o.image_url)}" loading="lazy">` : '<img>'}
    <div class="t"><div><b>${esc(o.title || (o.extra_text || '').slice(0, 80) || o.link)}</b></div>
    <div class="muted">${o.price ? brl(o.price) : ''} ${o.discount ? `· ${o.discount}% OFF` : ''} ${o.commission ? `· comissão ${o.commission.toFixed(0)}%` : ''}
    ${o.sent_at ? `· enviado ${when(o.sent_at)}` : ''} ${o.error ? `<br><span class="bad">${esc(o.error.slice(0, 160))}</span>` : ''}</div>
    ${actions ? `<div class="row" style="margin-top:6px">${actions}</div>` : ''}</div></div>`;
}

function filaPage(url) {
  const pending = robot.plan(40); // na ordem em que vão sair
  const sent = db.prepare(`SELECT * FROM offers WHERE status IN ('sent','error') ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 25`).all();
  const act = (o) => `<form method="post" action="/fila/${o.id}/enviar"><button class="small">Enviar agora</button></form>
    <form method="post" action="/fila/${o.id}/pular"><button class="small sec">Pular</button></form>
    <a class="btn small sec" style="padding:6px 10px;font-size:13px" href="/fila/${o.id}/ver">Ver mensagem</a>`;
  return page(P('/fila', 'Fila'), `${flash(url)}
  <div class="card"><h2>Próximas ofertas (${db.prepare(`SELECT COUNT(*) n FROM offers WHERE status='pending'`).get().n})</h2><p class="muted">Na ordem em que vão sair: as melhores primeiro, sem repetir o mesmo tipo de produto em seguida.</p>
    ${pending.length ? `<form method="post" action="/fila/limpar" onsubmit="return confirm('Tirar todas as ofertas da fila?')"><button class="small sec">🧹 Limpar fila</button></form>` : ''}
    ${pending.map((o) => offerRow(o, act(o))).join('') || '<p class="muted">Fila vazia. Toque em "Buscar ofertas agora" no Início.</p>'}</div>
  <div class="card"><h2>Enviadas recentemente</h2>${sent.map((o) => offerRow(o)).join('') || '<p class="muted">Nada ainda.</p>'}</div>`);
}

function verPage(id) {
  const o = db.prepare('SELECT * FROM offers WHERE id=?').get(id);
  if (!o) return page(P('/fila', 'Fila'), '<p>Não encontrada.</p>');
  return page(P('/fila', 'Fila'), `<div class="card"><h2>Como vai ficar no WhatsApp</h2>
    ${store.get('send_mode') === 'imagem' && o.image_url ? `<img src="${esc(o.image_url)}" style="max-width:260px;border-radius:8px">` : ''}
    <pre>${esc(robot.formatMessage(o))}</pre>
    ${store.get('send_mode') !== 'imagem' ? `<div style="display:flex;gap:10px;align-items:center;background:#f0f2f5;border-radius:8px;padding:8px;max-width:340px">
      ${o.image_url ? `<img src="${esc(o.image_url)}" style="width:64px;height:64px;object-fit:cover;border-radius:6px">` : ''}
      <small>Prévia do link (aproximada): o WhatsApp mostra a foto e o nome do produto dentro da mensagem.</small></div>` : ''}<a class="btn sec" href="/fila">Voltar</a></div>`);
}

function manualPage(url) {
  return page(P('/manual', 'Postar link'), `${flash(url)}<div class="card"><h2>Postar uma oferta sua</h2>
    <p class="muted">Serve para Mercado Livre, Amazon ou qualquer loja. Link da Shopee vira link de afiliado sozinho; nos outros, cole o seu link de afiliado já pronto.</p>
    <form method="post" action="/manual">
      <label>Link</label><input name="link" type="url" placeholder="https://..." required>
      <label>Texto da mensagem</label><textarea name="text" placeholder="🔥 Air Fryer Mondial 4L&#10;De R$ 399 por R$ 249"></textarea>
      <label>Link da imagem (opcional)</label><input name="image" type="url" placeholder="https://...jpg">
      <label>Quando</label><select name="when"><option value="now">Enviar agora</option><option value="next">Colocar como próxima da fila</option></select>
      <p><button>Postar</button></p></form></div>`);
}

function configPage(url) {
  const s = store.all();
  const f = (k, label, hint = '', type = 'number', extra = '') => `<div><label>${label}</label><input name="${k}" type="${type}" value="${esc(s[k])}" ${extra}>${hint ? `<small>${hint}</small>` : ''}</div>`;
  const hasSecret = !!(s.shopee_secret || process.env.SHOPEE_SECRET);
  return page(P('/config', 'Configurações'), `${flash(url)}<form method="post" action="/config">
  <div class="card"><h2>Chaves da Shopee</h2>
    <p class="muted">No site <b>affiliate.shopee.com.br</b> → menu <b>Open API</b>. Copie o App ID e a Secret.</p>
    <div class="grid">
      <div><label>App ID</label><input name="shopee_app_id" inputmode="numeric" value="${esc(s.shopee_app_id || process.env.SHOPEE_APP_ID || '')}"></div>
      <div><label>Secret</label><input name="shopee_secret" type="password" placeholder="${hasSecret ? '•••••• (já salva)' : 'cole aqui'}"></div>
    </div>
    <p><button type="submit" name="testar" value="1" class="sec">Salvar e testar conexão</button></p></div>
  <div class="card"><h2>O que procurar na Shopee</h2>
    <label>Palavras-chave (uma por linha)</label><textarea name="keywords">${esc(s.keywords)}</textarea>
    <div class="grid">
      ${f('min_discount', 'Desconto mínimo (%)')}${f('max_price', 'Preço máximo (R$)', '0 = sem limite')}
      ${f('min_rating', 'Nota mínima', '', 'number', 'step="0.1"')}${f('min_sales', 'Vendas mínimas')}
      ${f('min_commission', 'Comissão mínima (%)', '0 = qualquer')}${f('collect_every_min', 'Buscar a cada (min)')}
    </div></div>
  <div class="card"><h2>Ritmo de envio</h2><div class="grid">
    ${f('send_every_min', 'Uma oferta a cada (min)')}${f('send_jitter_min', 'Variação (± min)', 'deixa menos robótico')}
    ${f('hour_start', 'Começa às (hora)')}${f('hour_end', 'Para às (hora)')}
    ${f('max_per_day', 'Máximo por dia')}${f('repost_after_days', 'Repetir produto após (dias)')}
    ${f('max_per_keyword', 'Ofertas por palavra-chave', 'em cada busca (evita 20 smartwatches)')}${f('variety', 'Não repetir o mesmo tipo em', 'ex.: 5 = depois de uma cadeira, só outra cadeira 5 ofertas depois')}
  </div></div>
  <div class="card"><h2>Formato da mensagem</h2>
    <label>Como a oferta aparece no grupo</label>
    <select name="send_mode">
      <option value="preview" ${s.send_mode !== 'imagem' ? 'selected' : ''}>Prévia do link (foto pequena dentro da mensagem, não precisa baixar)</option>
      <option value="imagem" ${s.send_mode === 'imagem' ? 'selected' : ''}>Foto grande com legenda</option>
    </select>
    <small>Na prévia do link, quem monta a foto é o próprio WhatsApp a partir do link.</small>
  </div>
  <div class="card"><h2>Modelo da mensagem</h2>
    <textarea name="template" style="min-height:170px">${esc(s.template)}</textarea>
    <small>Campos: {chamada} (frase em maiúsculas) {titulo} {preco} {preco_antigo} {desconto} {nota} {vendas} {comissao} {link}. *negrito*, _itálico_, ~riscado~. Linhas com campo vazio somem sozinhas.</small>
  </div>
  <p><button>Salvar configurações</button></p></form>
  <form method="post" action="/config/modelo-padrao" onsubmit="return confirm('Voltar ao modelo padrão da mensagem?')">
  <button class="sec small">Restaurar modelo padrão da mensagem</button></form>`);
}

// ---------- Roteador ----------
const NUM_KEYS = ['min_discount', 'max_price', 'min_rating', 'min_sales', 'min_commission', 'collect_every_min',
  'send_every_min', 'send_jitter_min', 'hour_start', 'hour_end', 'max_per_day', 'repost_after_days', 'max_per_keyword', 'variety'];

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/saude') return send(res, 200, 'ok');
  if (p === '/entrar') {
    if (req.method === 'POST') {
      const form = await readForm(req);
      if (PASSWORD && form.senha === PASSWORD) {
        return send(res, 303, '', { Location: '/', 'Set-Cookie': `sessao=${TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
      }
      await new Promise((r) => setTimeout(r, 1500));
      return redirect(res, '/entrar?msg=' + encodeURIComponent('Senha errada.'));
    }
    return send(res, 200, page(P('/entrar', 'Entrar'), `${flash(url)}<div class="card"><h2>Entrar no painel</h2>
      ${PASSWORD ? '' : '<p class="bad">Defina PANEL_PASSWORD no arquivo .env.</p>'}
      <form method="post"><label>Senha</label><input name="senha" type="password" required autofocus><p><button>Entrar</button></p></form></div>`));
  }
  if (!authed(req)) return redirect(res, '/entrar');

  const back = (to, msg) => redirect(res, `${to}?msg=${encodeURIComponent(msg)}`);
  let m;

  if (req.method === 'GET') {
    if (p === '/') return send(res, 200, await home(url));
    if (p === '/whatsapp') return send(res, 200, await whatsappPage(url));
    if (p === '/grupos') return send(res, 200, await gruposPage(url));
    if (p === '/fila') return send(res, 200, filaPage(url));
    if (p === '/manual') return send(res, 200, manualPage(url));
    if (p === '/config') return send(res, 200, configPage(url));
    if ((m = p.match(/^\/fila\/(\d+)\/ver$/))) return send(res, 200, verPage(Number(m[1])));
    return send(res, 404, page(P('', 'Não encontrado'), '<p>Página não encontrada.</p>'));
  }

  const form = await readForm(req);
  if (p === '/acao/buscar') {
    robot.collect().catch((e) => log('erro', e.message));
    return back('/', 'Buscando ofertas… em 1 ou 2 minutos elas aparecem na Fila.');
  }
  if (p === '/acao/pausar') {
    const paused = store.get('paused') === '1';
    store.set('paused', paused ? '0' : '1');
    return back('/', paused ? 'Envios retomados.' : 'Envios pausados.');
  }
  if (p === '/acao/desconectar') { await wa.logout(); return back('/whatsapp', 'Desconectado.'); }
  if (p === '/acao/codigo') {
    try {
      const code = await wa.pairingCode(String(form.phone || '').replace(/\D/g, ''));
      return back('/whatsapp', code ? `Seu código: ${code} — digite no WhatsApp em "Conectar com número de telefone".` : 'Não veio código; tente o QR code.');
    } catch (e) { return back('/whatsapp', 'Erro: ' + e.message); }
  }
  if (p === '/grupos') {
    const chosen = form.getAll('g').map((v) => {
      const i = v.indexOf('|');
      return { id: v.slice(0, i), name: v.slice(i + 1) };
    }).filter((g) => g.id.endsWith('@g.us'));
    store.set('groups', JSON.stringify(chosen));
    return back('/grupos', chosen.length ? `${chosen.length} grupo(s) salvos.` : 'Nenhum grupo escolhido: o robô não vai postar.');
  }
  if (p === '/config') {
    for (const k of NUM_KEYS) if (form[k] !== undefined && form[k] !== '' && isFinite(Number(form[k]))) store.set(k, form[k]);
    if (typeof form.keywords === 'string') store.set('keywords', form.keywords.trim());
    if (typeof form.template === 'string' && form.template.includes('{link}')) store.set('template', form.template.replace(/\r/g, ''));
    if (form.send_mode === 'preview' || form.send_mode === 'imagem') store.set('send_mode', form.send_mode);
    if (form.shopee_app_id !== undefined) store.set('shopee_app_id', String(form.shopee_app_id).trim());
    if (form.shopee_secret) store.set('shopee_secret', String(form.shopee_secret).trim());
    if (form.testar) {
      try {
        const kw = (store.get('keywords').split('\n')[0] || 'fone').trim();
        const nodes = await shopee.searchOffers({ keyword: kw, limit: 5 });
        return back('/config', `✅ Shopee conectada! Teste com "${kw}" trouxe ${nodes.length} produtos.`);
      } catch (e) { return back('/config', `❌ A Shopee recusou: ${e.message}. Confira o App ID e a Secret.`); }
    }
    return back('/config', form.template && !form.template.includes('{link}') ? 'Salvo, mas o modelo precisa ter {link} — mantive o anterior.' : 'Configurações salvas.');
  }
  if (p === '/manual') {
    let link = String(form.link || '').trim();
    try {
      if (/shopee\.com\.br|shp\.ee|s\.shopee/i.test(link) && !/s\.shopee\.com\.br\/\w+$/.test(link)) link = await shopee.shortLink(link);
    } catch (e) { log('erro', `Converter link Shopee: ${e.message}`); }
    const offer = { source: 'manual', item_key: 'manual-' + Date.now(), link, extra_text: String(form.text || '').replace(/\r/g, ''),
      image_url: String(form.image || '').trim() || null, score: form.when === 'next' ? 9999 : 0 };
    robot.addOffer(offer);
    const row = db.prepare('SELECT * FROM offers ORDER BY id DESC LIMIT 1').get();
    if (form.when === 'now') {
      robot.sendOne(row).catch((e) => log('erro', `Envio manual: ${e.message}`));
      return back('/manual', 'Enviando para os grupos…');
    }
    return back('/manual', 'Colocado como próxima oferta da fila.');
  }
  if (p === '/config/modelo-padrao') {
    db.prepare(`DELETE FROM settings WHERE key='template'`).run();
    return back('/config', 'Modelo da mensagem restaurado.');
  }
  if (p === '/fila/limpar') {
    const r = db.prepare(`UPDATE offers SET status='skipped', error='fila limpa' WHERE status='pending'`).run();
    return back('/fila', `${r.changes} ofertas tiradas da fila. Toque em "Buscar ofertas agora" para buscar de novo.`);
  }
  if ((m = p.match(/^\/fila\/(\d+)\/(enviar|pular)$/))) {
    const o = db.prepare(`SELECT * FROM offers WHERE id=? AND status='pending'`).get(Number(m[1]));
    if (!o) return back('/fila', 'Essa oferta não está mais na fila.');
    if (m[2] === 'pular') { db.prepare(`UPDATE offers SET status='skipped' WHERE id=?`).run(o.id); return back('/fila', 'Pulada.'); }
    robot.sendOne(o).catch((e) => log('erro', `Envio: ${e.message}`));
    return back('/fila', 'Enviando…');
  }
  return send(res, 404, 'não encontrado');
}

function start(port = Number(process.env.PORT) || 3000) {
  http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log('erro', `Painel: ${err.stack || err.message}`);
      if (!res.headersSent) send(res, 500, page(P('', 'Erro'), `<div class="card"><h2>Deu erro</h2><pre>${esc(err.message)}</pre></div>`));
    });
  }).listen(port, () => log('info', `Painel no ar na porta ${port}`));
}

module.exports = { start, handle };
