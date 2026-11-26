// Crescimento: vitrine pública, gerador de links e rotador de grupos
const crypto = require('node:crypto');
const store = require('../db');
const shopee = require('../shopee');
const wa = require('../whatsapp');
const dispatch = require('../dispatch');
const { esc, brl, when, field, area, select, check } = require('./ui');

const { db, log, parse } = store;

function baseUrl(ctx) {
  const set = (store.get('public_url') || '').replace(/\/$/, '');
  if (set) return set;
  return `http://${ctx.req.headers.host || 'localhost'}`;
}
function click(kind, ref, ctx) {
  db.prepare('INSERT INTO clicks(kind,ref,at,ua) VALUES(?,?,?,?)').run(kind, String(ref), Date.now(), String(ctx.req.headers['user-agent'] || '').slice(0, 200));
}
function publicPage(title, color, body) {
  const c = /^#[0-9a-f]{6}$/i.test(color) ? color : '#7b1838';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title><style>
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;800;900&display=swap');
  *{box-sizing:border-box}body{margin:0;font:15px/1.5 Poppins,system-ui,sans-serif;background:#f7f8fb;color:#182033}
  header{background:radial-gradient(900px 300px at 50% 0,${c}14,#fff);border-bottom:1px solid #e4e7ec;padding:34px 16px 26px;text-align:center}
  header h1{margin:0;font-size:34px;font-weight:900;letter-spacing:-1.5px;color:${c}}header p{margin:8px auto 0;color:#667085;max-width:560px}
  main{max-width:1100px;margin:0 auto;padding:14px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px}
  .card{background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e7ec;box-shadow:0 10px 30px rgba(16,24,40,.06);display:flex;flex-direction:column;text-decoration:none;color:inherit}
  .card img{width:100%;aspect-ratio:1;object-fit:cover;background:#eee}.card .b{padding:9px;display:flex;flex-direction:column;gap:4px;flex:1}
  .t{font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .p{font-weight:800;color:${c};font-size:17px}.o{color:#888;text-decoration:line-through;font-size:12px}.d{background:${c};color:#fff;border-radius:6px;padding:1px 6px;font-size:12px;font-weight:700;align-self:flex-start}
  .btn{display:block;text-align:center;background:#1f78e6;color:#fff;padding:12px;border-radius:11px;font-weight:700;text-decoration:none;margin-top:10px;box-shadow:0 8px 20px rgba(31,120,230,.22)}
  .btn.sec{background:#25d366}input{width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;font:inherit}button{width:100%;padding:12px;border:0;border-radius:11px;background:#1f78e6;color:#fff;font:inherit;font-weight:700;margin-top:8px}
  form.s{display:flex;gap:8px;margin-bottom:12px}form.s input{flex:1}form.s button{width:auto;margin:0}
  .box{background:#fff;border:1px solid #e4e7ec;border-radius:18px;padding:20px;max-width:520px;margin:0 auto;box-shadow:0 26px 70px rgba(16,24,40,.08)}
  </style></head><body>${body}</body></html>`;
}

// ---------- Rotador: escolhe o grupo ----------
let sizeCache = { at: 0, map: new Map() };
async function groupSizes() {
  if (Date.now() - sizeCache.at < 300000) return sizeCache.map;
  const map = new Map();
  for (const i of dispatch.listInstances()) {
    try { for (const g of await wa.groups(i.name)) map.set(g.id, g.size || 0); } catch {}
  }
  sizeCache = { at: Date.now(), map };
  return map;
}

module.exports = (r) => {
  // ---------- Vitrine (configuração) ----------
  r.get('/vitrine', (ctx) => {
    const s = store.all();
    const url = `${baseUrl(ctx)}/v`;
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const n = db.prepare(`SELECT COUNT(*) n FROM clicks WHERE kind IN ('vitrine','produto') AND at>=? AND at<?`).get(d.getTime(), d.getTime() + 86400000).n;
      days.push([d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), n]);
    }
    const max = Math.max(1, ...days.map((d) => d[1]));
    const top = db.prepare(`SELECT c.ref, COUNT(*) n, p.title FROM clicks c LEFT JOIN products p ON p.id=CAST(c.ref AS INTEGER)
      WHERE c.kind='produto' AND c.at>? GROUP BY c.ref ORDER BY n DESC LIMIT 10`).all(Date.now() - 30 * 86400000);
    ctx.page('Vitrine', '/vitrine', `<h1>Minha vitrine</h1>
      <div class="help">Uma página pública com as ofertas que o robô enviou, com contagem de cliques. Para funcionar fora da sua casa, o robô precisa estar num servidor (VPS) e o <b>endereço público</b> precisa estar preenchido em <a href="/credenciais">Credenciais</a>.</div>
      <form method="post"><div class="card">
        ${check('vitrine_enabled', 'Vitrine ativa', s.vitrine_enabled === '1')}
        <p>Endereço: <a href="${esc(url)}" target="_blank">${esc(url)}</a></p>
        <div class="grid">${field('vitrine_name', 'Nome', s.vitrine_name)}${field('vitrine_color', 'Cor', s.vitrine_color, { type: 'color' })}
        ${field('vitrine_group_link', 'Botão "Entrar no grupo" (link)', s.vitrine_group_link, { hint: 'pode ser o link do seu Rotador' })}</div>
        ${area('vitrine_description', 'Descrição', s.vitrine_description, { rows: 2 })}
        ${check('vitrine_direct', 'Clicar no produto vai direto para a Shopee (sem página do produto)', s.vitrine_direct === '1')}
        <small>Com a vitrine ativa, a variável <code>{link_site}</code> leva para a página do produto na vitrine (com clique contado).</small>
        <p><button>Salvar</button></p></div></form>
      <div class="card"><h2>Cliques nos últimos 14 dias</h2>
        <div style="display:flex;align-items:flex-end;gap:4px;height:120px">${days.map(([d, n]) => `<div style="flex:1;text-align:center"><div title="${n}" style="background:#7b1838;border-radius:4px 4px 0 0;height:${Math.round((n / max) * 100)}px;min-height:${n ? 2 : 0}px"></div><small style="font-size:10px">${d}</small></div>`).join('')}</div>
        <p class="muted">Total: ${days.reduce((a, d) => a + d[1], 0)} cliques</p></div>
      <div class="card"><h2>Produtos mais clicados (30 dias)</h2><table>${top.map((t) => `<tr><td>${esc(t.title || `#${t.ref}`)}</td><td><b>${t.n}</b></td></tr>`).join('') || '<tr><td class="muted">Nenhum clique ainda.</td></tr>'}</table></div>`);
  });
  r.post('/vitrine', (ctx) => {
    const f = ctx.form;
    store.set('vitrine_enabled', f.vitrine_enabled ? '1' : '0');
    store.set('vitrine_direct', f.vitrine_direct ? '1' : '0');
    for (const k of ['vitrine_name', 'vitrine_description', 'vitrine_group_link']) store.set(k, String(f[k] || '').slice(0, 300));
    if (/^#[0-9a-f]{6}$/i.test(f.vitrine_color || '')) store.set('vitrine_color', f.vitrine_color);
    ctx.back('/vitrine', 'Vitrine salva.');
  });

  // ---------- Vitrine (pública) ----------
  r.get('/v', (ctx) => {
    if (store.get('vitrine_enabled') !== '1') return ctx.send(publicPage('Vitrine', '#999', '<main><p>Vitrine desativada.</p></main>'), 404);
    click('vitrine', 'home', ctx);
    const q = ctx.url.searchParams.get('q') || '';
    const rows = db.prepare(`SELECT p.* FROM products p WHERE p.id IN (SELECT DISTINCT product_id FROM queue WHERE status='sent' AND product_id IS NOT NULL)
      ${q ? 'AND p.title LIKE ?' : ''} ORDER BY p.updated_at DESC LIMIT 120`).all(...(q ? [`%${q}%`] : []));
    const s = store.all();
    ctx.send(publicPage(s.vitrine_name, s.vitrine_color, `<header><h1>${esc(s.vitrine_name)}</h1><p>${esc(s.vitrine_description)}</p>
      ${s.vitrine_group_link ? `<a class="btn sec" style="display:inline-block;padding:9px 16px" href="${esc(s.vitrine_group_link)}">💬 Entrar no grupo</a>` : ''}</header>
      <main><form class="s"><input name="q" value="${esc(q)}" placeholder="Buscar ofertas"><button>Buscar</button></form>
      <div class="grid">${rows.map((p) => `<a class="card" href="/p/${p.id}"><img src="${esc(p.image_url || '')}" loading="lazy" alt="">
        <div class="b"><div class="t">${esc(p.title || '')}</div>${p.old_price ? `<div class="o">${brl(p.old_price)}</div>` : ''}<div class="p">${brl(p.price)}</div>${p.discount ? `<span class="d">-${p.discount}%</span>` : ''}</div></a>`).join('') || '<p>Nenhuma oferta ainda.</p>'}</div></main>`));
  }, { public: true });

  r.get('/p/:id', (ctx) => {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(Number(ctx.params.id));
    if (!p || !p.link) return ctx.send(publicPage('Oferta', '#999', '<main><p>Oferta não encontrada.</p></main>'), 404);
    const s = store.all();
    if (s.vitrine_direct === '1' || s.vitrine_enabled !== '1') { click('produto', p.id, ctx); return ctx.redirect(p.link); }
    ctx.send(publicPage(p.title || 'Oferta', s.vitrine_color, `<header><h1>${esc(s.vitrine_name)}</h1></header><main><div class="box">
      <img src="${esc(p.image_url || '')}" style="width:100%;border-radius:10px" alt=""><h2 style="font-size:17px">${esc(p.title || '')}</h2>
      ${p.old_price ? `<div class="o">${brl(p.old_price)}</div>` : ''}<div class="p" style="font-size:24px">${brl(p.price)}</div>
      <a class="btn" href="/ir/${p.id}">🛒 Ver na Shopee</a>${s.vitrine_group_link ? `<a class="btn sec" href="${esc(s.vitrine_group_link)}">💬 Entrar no grupo de ofertas</a>` : ''}
      <p style="text-align:center"><a href="/v">Ver mais ofertas</a></p></div></main>`));
  }, { public: true });
  r.get('/ir/:id', (ctx) => {
    const p = db.prepare('SELECT id, link FROM products WHERE id=?').get(Number(ctx.params.id));
    if (!p || !p.link) return ctx.redirect('/v');
    click('produto', p.id, ctx);
    ctx.redirect(p.link);
  }, { public: true });

  // ---------- Gerador de links ----------
  r.get('/gerador', (ctx) => {
    const s = store.all();
    const n = db.prepare(`SELECT COUNT(*) n FROM clicks WHERE kind='gerador' AND at>?`).get(Date.now() - 30 * 86400000).n;
    ctx.page('Gerador', '/gerador', `<h1>Gerador de links</h1>
      <div class="help">Uma página pública onde seus seguidores colam um link da Shopee e recebem o mesmo produto com o <b>seu</b> link de afiliado.</div>
      <form method="post"><div class="card">${check('gerador_enabled', 'Gerador ativo', s.gerador_enabled === '1')}
        <p>Endereço: <a href="${esc(baseUrl(ctx))}/g" target="_blank">${esc(baseUrl(ctx))}/g</a></p>
        ${field('gerador_name', 'Título da página', s.gerador_name)}<p><button>Salvar</button></p>
        <p class="muted">Links gerados nos últimos 30 dias: <b>${n}</b></p></div></form>`);
  });
  r.post('/gerador', (ctx) => {
    store.set('gerador_enabled', ctx.form.gerador_enabled ? '1' : '0');
    store.set('gerador_name', String(ctx.form.gerador_name || '').slice(0, 80));
    ctx.back('/gerador', 'Salvo.');
  });
  const hits = new Map();
  const geradorPage = (ctx, { link = '', result = '', error = '' } = {}) => {
    const s = store.all();
    ctx.send(publicPage(s.gerador_name, s.vitrine_color, `<header><h1>${esc(s.gerador_name)}</h1><p>Cole o link de um produto da Shopee</p></header>
      <main><div class="box"><form method="post"><input name="link" value="${esc(link)}" placeholder="https://shopee.com.br/..." required><button>Gerar meu link com desconto</button></form>
      ${error ? `<p style="color:#b3261e">${esc(error)}</p>` : ''}
      ${result ? `<p>Pronto! Seu link:</p><input value="${esc(result)}" readonly onclick="this.select()"><a class="btn" href="${esc(result)}">Abrir na Shopee</a>` : ''}
      ${s.vitrine_group_link ? `<a class="btn sec" href="${esc(s.vitrine_group_link)}">💬 Entrar no grupo de ofertas</a>` : ''}</div></main>`));
  };
  r.get('/g', (ctx) => (store.get('gerador_enabled') === '1' ? geradorPage(ctx) : ctx.send(publicPage('Gerador', '#999', '<main><p>Indisponível.</p></main>'), 404)), { public: true });
  r.post('/g', async (ctx) => {
    if (store.get('gerador_enabled') !== '1') return ctx.send('indisponível', 404);
    const ip = String(ctx.req.headers['x-forwarded-for'] || ctx.req.socket.remoteAddress || '').split(',')[0].trim();
    const h = (hits.get(ip) || []).filter((t) => Date.now() - t < 3600000);
    if (h.length >= 20) return geradorPage(ctx, { error: 'Muitos links em pouco tempo. Tente de novo mais tarde.' });
    hits.set(ip, [...h, Date.now()]);
    const link = String(ctx.form.link || '').trim();
    const found = shopee.findLinks(link)[0];
    if (!found) return geradorPage(ctx, { link, error: 'Isso não parece um link da Shopee.' });
    try {
      const resolved = await shopee.resolveLink(found);
      const canonical = resolved.shopId ? `https://shopee.com.br/product/${resolved.shopId}/${resolved.itemId}` : resolved.url;
      const result = await shopee.shortLink(canonical, ['gerador']);
      click('gerador', canonical, ctx);
      geradorPage(ctx, { link, result });
    } catch (err) {
      log('erro', `Gerador: ${err.message}`);
      geradorPage(ctx, { link, error: 'Não consegui gerar agora. Tente de novo em instantes.' });
    }
  }, { public: true });

  // ---------- Rotador de grupos ----------
  r.get('/rotador', async (ctx) => {
    const list = db.prepare('SELECT * FROM rotators ORDER BY id').all();
    const sizes = list.length ? await groupSizes() : new Map();
    const editId = Number(ctx.url.searchParams.get('editar')) || 0;
    const edit = list.find((x) => x.id === editId);
    let groups = [];
    if (edit || ctx.url.searchParams.get('novo')) {
      const map = new Map();
      for (const i of dispatch.listInstances()) { try { for (const g of await wa.groups(i.name)) map.set(g.id, { ...g, instance: i.name }); } catch {} }
      groups = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    const chosen = edit ? parse(edit.groups, []) : [];
    const formHtml = (edit || ctx.url.searchParams.get('novo')) ? `<div class="card"><h2>${edit ? 'Editar rotador' : 'Novo rotador'}</h2>
      <form method="post" action="/rotador${edit ? `/${edit.id}` : ''}"><div class="grid">${field('name', 'Nome', edit ? edit.name : 'Grupo de Ofertas', { attrs: 'required' })}
        ${field('limit', 'Trocar de grupo quando chegar a (pessoas)', chosen[0] ? chosen[0].limit : 1000, { type: 'number' })}</div>
        <p class="muted">Marque os grupos, na ordem em que devem encher (o número precisa ser admin para o robô pegar o link de convite):</p>
        ${groups.map((g) => check('g', `${esc(g.name)} <small>· ${g.size} pessoas</small>`, chosen.some((c) => c.id === g.id), { value: `${g.id}|${g.instance}` })).join('') || '<p class="muted">Nenhum grupo encontrado. O número está conectado?</p>'}
        <p class="row"><button>Salvar</button><a class="btn sec" href="/rotador">Cancelar</a></p></form></div>` : '';
    ctx.page('Rotador', '/rotador', `<h1>Rotador de grupos</h1>
      <div class="help">Um único link de convite que manda as pessoas para o grupo que ainda tem vaga, enchendo um de cada vez.</div>
      ${formHtml}${edit || ctx.url.searchParams.get('novo') ? '' : '<p><a class="btn" href="/rotador?novo=1">+ Novo rotador</a></p>'}
      ${list.map((x) => {
        const gs = parse(x.groups, []);
        const visits = db.prepare(`SELECT COUNT(*) n FROM clicks WHERE kind='rotador' AND ref=? AND at>?`).get(String(x.id), Date.now() - 7 * 86400000).n;
        return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(x.name)} ${x.active ? '<span class="pill on">ativo</span>' : '<span class="pill off">pausado</span>'}</h2>
          <div class="row"><a class="btn small sec" href="/rotador?editar=${x.id}">Editar</a>
          <form method="post" action="/rotador/${x.id}/alternar"><button class="small sec">${x.active ? 'Pausar' : 'Ativar'}</button></form>
          <form method="post" action="/rotador/${x.id}/excluir" onsubmit="return confirm('Excluir? O link para de funcionar.')"><button class="small danger">Excluir</button></form></div></div>
          <p>Link: <a href="${esc(baseUrl(ctx))}/r/${esc(x.slug)}" target="_blank">${esc(baseUrl(ctx))}/r/${esc(x.slug)}</a> · ${visits} visitas em 7 dias</p>
          <table>${gs.map((g) => `<tr><td>${esc(g.name)}</td><td>${sizes.has(g.id) ? `${sizes.get(g.id)} / ${g.limit}` : '?'}</td><td>${g.invite_url ? '✅ convite ok' : '<span class="bad">sem link de convite</span>'}</td></tr>`).join('')}</table></div>`;
      }).join('')}`);
  });
  const saveRot = async (ctx, id) => {
    const limit = Math.min(1024, Math.max(1, Number(ctx.form.limit) || 1000));
    const groups = [];
    const old = id ? parse((db.prepare('SELECT groups FROM rotators WHERE id=?').get(id) || {}).groups, []) : [];
    const all = new Map();
    for (const i of dispatch.listInstances()) { try { for (const g of await wa.groups(i.name)) all.set(g.id, g.name); } catch {} }
    for (const v of ctx.form.getAll('g')) {
      const [gid, inst] = v.split('|');
      let invite = (old.find((o) => o.id === gid) || {}).invite_url || null;
      if (!invite) { try { invite = await wa.inviteUrl(inst, gid); } catch (err) { log('erro', `Convite ${gid}: ${err.message}`); } }
      groups.push({ id: gid, name: all.get(gid) || gid, instance: inst, invite_url: invite, limit });
    }
    if (id) db.prepare('UPDATE rotators SET name=?, groups=? WHERE id=?').run(String(ctx.form.name).slice(0, 80), JSON.stringify(groups), id);
    else db.prepare('INSERT INTO rotators(name,slug,groups,active,created_at) VALUES(?,?,?,1,?)').run(String(ctx.form.name).slice(0, 80), crypto.randomBytes(4).toString('hex'), JSON.stringify(groups), Date.now());
    const missing = groups.filter((g) => !g.invite_url).length;
    ctx.back('/rotador', missing ? `Salvo, mas ${missing} grupo(s) ficaram sem link de convite (o número precisa ser admin).` : 'Rotador salvo.', !!missing);
  };
  r.post('/rotador', (ctx) => saveRot(ctx, 0));
  r.post('/rotador/:id', (ctx) => saveRot(ctx, Number(ctx.params.id)));
  r.post('/rotador/:id/alternar', (ctx) => { db.prepare('UPDATE rotators SET active=1-active WHERE id=?').run(Number(ctx.params.id)); ctx.back('/rotador', 'Salvo.'); });
  r.post('/rotador/:id/excluir', (ctx) => { db.prepare('DELETE FROM rotators WHERE id=?').run(Number(ctx.params.id)); ctx.back('/rotador', 'Excluído.'); });

  r.get('/r/:slug', async (ctx) => {
    const x = db.prepare('SELECT * FROM rotators WHERE slug=?').get(ctx.params.slug);
    if (!x || !x.active) return ctx.send(publicPage('Grupo', '#999', '<main><p>Este link não está ativo.</p></main>'), 404);
    click('rotador', x.id, ctx);
    const sizes = await groupSizes();
    const gs = parse(x.groups, []).filter((g) => g.invite_url);
    const target = gs.find((g) => (sizes.get(g.id) || 0) < g.limit) || gs[gs.length - 1];
    if (!target) return ctx.send(publicPage('Grupo', '#999', '<main><p>Nenhum grupo disponível agora.</p></main>'), 404);
    ctx.redirect(target.invite_url);
  }, { public: true });
};
