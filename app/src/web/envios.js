// Envios: envio direto, envio manual, histórico e feed de produtos
const store = require('../db');
const products = require('../products');
const dispatch = require('../dispatch');
const render = require('../render');
const shopee = require('../shopee');
const { waHtml, esc, brl, when, field, area, select, check } = require('./ui');

const { db, log, parse } = store;

// Escolha de grupos/categorias (reaproveitado nas automações)
function destPicker(selected = [], selectedCats = [], { name = 'dest', catName = 'dest_cat' } = {}) {
  const dests = db.prepare('SELECT * FROM destinations WHERE active=1 ORDER BY channel, name').all();
  const cats = [...new Set(dests.map((d) => d.category).filter(Boolean))].sort();
  if (!dests.length) return '<p class="warn">Nenhum grupo cadastrado. <a href="/grupos">Cadastre os grupos de destino</a>.</p>';
  return `${cats.length ? `<p class="muted" style="margin:4px 0">Categorias:</p>${cats.map((c) => check(catName, `📁 ${esc(c)} <small>(${dests.filter((d) => d.category === c).length} grupos)</small>`, selectedCats.includes(c), { value: c })).join('')}
    <p class="muted" style="margin:10px 0 4px">Ou grupos avulsos:</p>` : ''}
    <label class="chk" style="font-weight:600"><input type="checkbox" onclick="for(const c of this.closest('div').querySelectorAll('input[name=${name}]'))c.checked=this.checked"> Selecionar todos</label>
    ${dests.map((d) => check(name, `${d.channel === 'telegram' ? '✈️' : '💬'} ${esc(d.name)} <small>${d.category ? `· ${esc(d.category)}` : ''}${d.size ? ` · ${d.size} pessoas` : ''}</small>`, selected.includes(d.id), { value: d.id })).join('')}`;
}

function templateOptions() {
  return [['', 'Padrão (o primeiro modelo)'], ...db.prepare('SELECT id,name FROM templates ORDER BY id').all().map((t) => [t.id, t.name])];
}
function couponOptions() {
  return [['', 'Sem cupom'], ...db.prepare('SELECT * FROM coupons WHERE active=1 ORDER BY id DESC').all()
    .map((c) => [c.id, `${c.code || c.link} · ${render.couponValueLabel(c)}${c.min_price ? ` (mín. R$ ${c.min_price})` : ''}`])];
}
function automationOptions(types) {
  return store.listAutomations().filter((a) => !types || types.includes(a.type)).map((a) => [a.id, `${a.name} (${store.AUTOMATION_TYPES[a.type]})`]);
}

const SOURCES = { busca: 'Busca', promo: 'Automatizador', monitor: 'Monitoramento', clone: 'Clone', direto: 'Envio direto', manual: 'Manual', planilha: 'Planilha', feed: 'Feed' };

module.exports = (r) => {
  // ---------- Envio direto ----------
  r.get('/envio-direto', (ctx) => {
    const ids = (ctx.url.searchParams.get('produtos') || '').split(',').map(Number).filter(Boolean);
    const pre = ids.map((id) => products.getProduct(id)).filter(Boolean);
    ctx.page('Envio direto', '/envio-direto', `<h1>Envio direto</h1>
      <div class="help">Cole até 20 links da Shopee (um por linha). Cada link vira uma promoção com o seu link de afiliado e o seu modelo de texto.</div>
      <form method="post"><div class="card">
        ${pre.length ? `<input type="hidden" name="produtos" value="${pre.map((p) => p.id).join(',')}"><p><b>Produtos do Feed:</b></p>${pre.map((p) => `<div class="item"><img src="${esc(p.image_url || '')}"><div class="t"><b>${esc(p.title || p.link)}</b><br><small>${brl(p.price)}</small></div></div>`).join('')}` : ''}
        ${area('links', pre.length ? 'Mais links (opcional)' : 'Links (um por linha)', '', { rows: 6, attrs: 'placeholder="https://s.shopee.com.br/..."' })}
      </div>
      <div class="card"><h2>Para onde</h2>${destPicker()}</div>
      <div class="card"><h2>Como</h2><div class="grid">
        ${select('modo', 'Quando', 'agora', [['agora', 'Enviar agora'], ...automationOptions().map(([v, l]) => [`fila:${v}`, `Adicionar à fila de: ${l}`])])}
        ${select('media', 'Formato', 'preview', [['preview', 'Prévia do link'], ['imagem', 'Imagem + legenda']])}
        ${select('template', 'Texto', '', templateOptions())}
        ${select('coupon', 'Cupom cadastrado', '', couponOptions())}
      </div>
      <details style="margin-top:10px"><summary>Cupom só para este envio</summary><div class="grid">
        ${field('tmp_code', 'Código', '')}${field('tmp_value', 'Desconto', '', { hint: 'ex.: 10% ou R$ 15' })}${field('tmp_min', 'Preço mínimo (R$)', '', { type: 'number', attrs: 'step="0.01"' })}
      </div></details>
      <small>Ao escolher uma fila, os grupos e o formato da automação são usados.</small></div>
      <p><button>Processar</button></p></form>`);
  });

  r.post('/envio-direto', (ctx) => {
    const f = ctx.form;
    const links = String(f.links || '').split(/\s+/).filter((l) => /^https?:\/\//.test(l));
    const ids = String(f.produtos || '').split(',').map(Number).filter(Boolean);
    if (links.length + ids.length === 0) return ctx.back('/envio-direto', 'Cole pelo menos um link.', true);
    if (links.length + ids.length > 20) return ctx.back('/envio-direto', 'No máximo 20 links por vez.', true);
    const dest = f.getAll('dest'), cats = f.getAll('dest_cat');
    const toQueue = String(f.modo || '').startsWith('fila:') ? Number(f.modo.slice(5)) : null;
    if (!toQueue && !dest.length && !cats.length) return ctx.back('/envio-direto', 'Escolha pelo menos um grupo.', true);
    const payload = { media: f.media };
    if (!toQueue) { payload.dest = dest; payload.dest_categories = cats; }
    if (f.template) payload.templates = [Number(f.template)];
    if (f.coupon) payload.coupons = [Number(f.coupon)];
    if (f.tmp_code && f.tmp_value) {
      const brlKind = /r\$/i.test(f.tmp_value);
      payload.coupon = { code: f.tmp_code.trim(), kind: brlKind ? 'brl' : 'pct', value: require('../text').parsePrice(f.tmp_value) || 0, min_price: Number(f.tmp_min) || 0 };
    }
    (async () => {
      const all = [...ids.map((id) => ({ id })), ...links.map((l) => ({ link: l }))];
      for (const x of all) {
        try {
          const p = x.id ? products.getProduct(x.id) : await products.fromLink(x.link, { source: 'direto', subId: 'direto' });
          if (!p) continue;
          const item = dispatch.enqueue({ automation_id: toQueue, product_id: p.id, payload, score: toQueue ? 9999 : 0 });
          if (!toQueue) await dispatch.sendItem(item);
        } catch (err) {
          log('erro', `Envio direto: ${err.message}`);
          db.prepare(`INSERT INTO history(status,error,title,at) VALUES('failed',?,?,?)`).run(err.message, x.link || '', Date.now());
        }
      }
    })();
    ctx.back(toQueue ? `/automacoes/${toQueue}/fila` : '/historico',
      toQueue ? `${links.length + ids.length} link(s) indo para a fila (próximos a sair).` : `Processando ${links.length + ids.length} link(s). Acompanhe aqui no Histórico.`);
  });

  // ---------- Envio manual ----------
  r.get('/envio-manual', (ctx) => {
    const scheduled = db.prepare(`SELECT * FROM queue WHERE automation_id IS NULL AND status='pending' AND send_after>? ORDER BY send_after`).all(Date.now());
    ctx.page('Envio manual', '/envio-manual', `<h1>Envio manual</h1>
      <form method="post" enctype="multipart/form-data"><div class="card">
        ${area('text', 'Mensagem', '', { rows: 7, hint: 'Use *negrito*, _itálico_ e ~riscado~. Para prévia do link, o link precisa estar no texto.' })}
        <div class="grid">
          ${select('media', 'Formato', 'preview', [['preview', 'Texto com prévia do link'], ['texto', 'Só texto (sem prévia)'], ['imagem', 'Imagem + legenda']])}
          <div><label>Imagem (até 5 MB)</label><input type="file" name="image" accept="image/jpeg,image/png,image/gif,image/webp"></div>
        </div>
        ${check('mention_all', 'Mencionar todos (só grupos de WhatsApp — use com moderação)', false)}
      </div>
      <div class="card"><h2>Para onde</h2>${destPicker()}</div>
      <div class="card"><h2>Quando</h2><div class="grid">
        ${select('quando', 'Enviar', 'agora', [['agora', 'Agora'], ['agendar', 'Agendar']])}
        ${field('data', 'Data e hora (horário de Brasília)', '', { type: 'datetime-local' })}
      </div><small>Agendamento de 5 minutos a 90 dias à frente. Sai mesmo com o painel fechado (o robô precisa estar ligado).</small></div>
      <p><button>Enviar</button></p></form>
      <div class="card"><h2>Agendados (${scheduled.length})</h2>
        ${scheduled.map((q) => { const pl = parse(q.payload, {}); return `<div class="item"><div class="t"><b>${when(q.send_after)}</b><pre>${esc((pl.text || '').slice(0, 300))}</pre></div>
          <form method="post" action="/fila/${q.id}/pular" onsubmit="return confirm('Cancelar este agendamento?')"><button class="small danger">Cancelar</button></form></div>`; }).join('') || '<p class="muted">Nada agendado.</p>'}</div>`);
  });

  r.post('/envio-manual', async (ctx) => {
    const f = ctx.form;
    const text = String(f.text || '').replace(/\r/g, '').trim();
    const dest = f.getAll('dest'), cats = f.getAll('dest_cat');
    if (!dest.length && !cats.length) return ctx.back('/envio-manual', 'Escolha pelo menos um grupo.', true);
    const img = (ctx.files || []).find((x) => x.field === 'image' && x.buffer.length);
    if (img && (img.truncated || img.buffer.length > 5 * 1024 * 1024)) return ctx.back('/envio-manual', 'A imagem passa de 5 MB.', true);
    if (img && !/^image\/(jpeg|png|gif|webp)$/.test(img.mime)) return ctx.back('/envio-manual', 'Formato de imagem não aceito (use JPG, PNG, GIF ou WebP).', true);
    if (!text && !img) return ctx.back('/envio-manual', 'Escreva a mensagem ou escolha uma imagem.', true);
    const payload = { text, dest, dest_categories: cats, media: img ? 'imagem' : f.media === 'imagem' ? 'preview' : f.media, mention_all: !!f.mention_all, keep_image: true };
    if (f.media === 'texto') payload.media = 'texto';
    if (img) { payload.image_file = dispatch.saveImage(img.buffer.toString('base64'), img.mime); payload.image_mime = img.mime; payload.media = 'imagem'; }
    let sendAfter = 0;
    if (f.quando === 'agendar') {
      const t = new Date(f.data).getTime();
      if (!t || t < Date.now() + 4 * 60000 || t > Date.now() + 90 * 86400000) return ctx.back('/envio-manual', 'Escolha uma data entre 5 minutos e 90 dias à frente.', true);
      sendAfter = t;
    }
    const item = dispatch.enqueue({ payload, send_after: sendAfter });
    if (!sendAfter) {
      dispatch.sendItem(item).catch((e) => log('erro', e.message));
      return ctx.back('/historico', 'Enviando…');
    }
    ctx.back('/envio-manual', `Agendado para ${when(sendAfter)}.`);
  });

  // ---------- Histórico ----------
  r.get('/historico', (ctx) => {
    const sp = ctx.url.searchParams;
    const status = sp.get('status') || '', q = sp.get('q') || '', auto = sp.get('auto') || '';
    const page = Math.max(0, Number(sp.get('p')) || 0);
    const where = [], args = [];
    if (status) { where.push('h.status=?'); args.push(status); }
    if (q) { where.push('(h.title LIKE ? OR h.dest_name LIKE ? OR h.link LIKE ? OR h.error LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (auto) { where.push('h.automation_id=?'); args.push(Number(auto)); }
    const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT h.*, a.name AS auto_name FROM history h LEFT JOIN automations a ON a.id=h.automation_id ${W} ORDER BY h.id DESC LIMIT 60 OFFSET ?`).all(...args, page * 60);
    const tot = db.prepare(`SELECT SUM(status='sent') s, SUM(status='failed') f FROM history`).get();
    const pend = db.prepare(`SELECT COUNT(*) n FROM queue WHERE status='pending'`).get().n;
    const qs = (o) => '?' + new URLSearchParams({ status, q, auto, ...o }).toString();
    ctx.page('Histórico', '/historico', `<h1>Histórico de envios</h1>
      <div class="card"><div class="stats">
        <div class="stat"><small>Enviados</small><b class="ok">${tot.s || 0}</b></div>
        <div class="stat"><small>Falhas</small><b class="bad">${tot.f || 0}</b></div>
        <div class="stat"><small>Pendentes na fila</small><b>${pend}</b></div></div></div>
      <div class="card"><form class="row">
        <select name="status" style="max-width:150px"><option value="">Todos</option><option value="sent" ${status === 'sent' ? 'selected' : ''}>Enviados</option><option value="failed" ${status === 'failed' ? 'selected' : ''}>Falhas</option></select>
        <select name="auto" style="max-width:220px"><option value="">Todas as origens</option>${automationOptions().map(([v, l]) => `<option value="${v}" ${String(v) === auto ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <input name="q" value="${esc(q)}" placeholder="Buscar produto, grupo ou erro" style="max-width:260px"><button class="sec">Filtrar</button></form></div>
      <div class="card"><table><tr><th>Quando</th><th>Produto / mensagem</th><th>Grupo</th><th>Situação</th></tr>
      ${rows.map((h) => `<tr><td><small>${when(h.at)}</small></td>
        <td><b>${esc((h.title || '').slice(0, 90))}</b><br><small>${esc(h.auto_name || 'envio avulso')}${h.link ? ` · <a href="${esc(h.link)}" target="_blank" rel="noopener">link afiliado</a>` : ''}${h.origin_url ? ` · <a href="${esc(h.origin_url)}" target="_blank" rel="noopener">original</a>` : ''}</small></td>
        <td><small>${esc(h.dest_name || '-')}${h.instance && h.instance !== 'telegram' ? `<br>via ${esc(h.instance)}` : ''}</small></td>
        <td>${h.status === 'sent' ? '<span class="pill on">enviado</span>' : `<span class="pill err">falha</span><br><small class="bad">${esc((h.error || '').slice(0, 200))}</small>`}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nada aqui.</td></tr>'}
      </table>
      <div class="row" style="margin-top:10px">${page > 0 ? `<a class="btn small sec" href="${qs({ p: page - 1 })}">← Mais novos</a>` : ''}${rows.length === 60 ? `<a class="btn small sec" href="${qs({ p: page + 1 })}">Mais antigos →</a>` : ''}</div></div>`);
  });

  // ---------- Feed de produtos ----------
  r.get('/feed', (ctx) => {
    const sp = ctx.url.searchParams;
    const src = sp.get('fonte') || '', q = sp.get('q') || '', fav = sp.get('fav') || '';
    const page = Math.max(0, Number(sp.get('p')) || 0);
    const where = [], args = [];
    if (src) { where.push('source=?'); args.push(src); }
    if (q) { where.push('title LIKE ?'); args.push(`%${q}%`); }
    if (fav) where.push('favorite=1');
    const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM products ${W} ORDER BY pinned DESC, id DESC LIMIT 40 OFFSET ?`).all(...args, page * 40);
    const total = db.prepare(`SELECT COUNT(*) n FROM products ${W}`).get(...args).n;
    const autos = automationOptions();
    const qs = (o) => '?' + new URLSearchParams({ fonte: src, q, fav, ...o }).toString();
    ctx.page('Feed de produtos', '/feed', `<h1>Feed de produtos <small class="muted">(${total})</small></h1>
      <div class="card"><form method="post" action="/feed/link" class="row"><input name="link" placeholder="Cole um link da Shopee para gerar a promoção" required style="flex:1;min-width:220px"><button>Gerar</button></form></div>
      <div class="card"><form class="row">
        <select name="fonte" style="max-width:180px"><option value="">Todas as fontes</option>${Object.entries(SOURCES).map(([v, l]) => `<option value="${v}" ${v === src ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="chk" style="border:0"><input type="checkbox" name="fav" value="1" ${fav ? 'checked' : ''}>Só favoritos</label>
        <input name="q" value="${esc(q)}" placeholder="Buscar pelo nome" style="max-width:240px"><button class="sec">Filtrar</button></form></div>
      <div class="card">${rows.map((p) => `<div class="item"><img src="${esc(p.image_url || '')}" loading="lazy">
        <div class="t"><b>${p.favorite ? '★ ' : ''}${esc(p.title || p.link)}</b><br>
          <small>${brl(p.price)}${p.old_price ? ` <s>${brl(p.old_price)}</s>` : ''}${p.discount ? ` · ${p.discount}% OFF` : ''}${p.commission ? ` · comissão ${Number(p.commission).toFixed(0)}%` : ''} · ${SOURCES[p.source] || p.source} · ${when(p.created_at)}</small>
          <div class="row" style="margin-top:6px">
            <a class="btn small" href="/envio-direto?produtos=${p.id}">Enviar</a>
            ${autos.length ? `<form method="post" action="/feed/${p.id}/fila" class="row"><select name="auto" style="max-width:200px;padding:5px">${autos.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select><button class="small sec">Pôr na fila</button></form>` : ''}
            <a class="btn small sec" href="/feed/${p.id}">Editar</a>
            <form method="post" action="/feed/${p.id}/favorito"><button class="small sec">${p.favorite ? '☆ Desfavoritar' : '★ Favoritar'}</button></form>
            ${p.link ? `<a class="btn small sec" href="${esc(p.link)}" target="_blank" rel="noopener">Abrir</a>` : ''}
          </div></div></div>`).join('') || '<p class="muted">Nenhum produto ainda.</p>'}
        <div class="row" style="margin-top:10px">${page > 0 ? `<a class="btn small sec" href="${qs({ p: page - 1 })}">← Anteriores</a>` : ''}${rows.length === 40 ? `<a class="btn small sec" href="${qs({ p: page + 1 })}">Próximos →</a>` : ''}</div></div>`);
  });

  r.post('/feed/link', async (ctx) => {
    const link = String(ctx.form.link || '').trim();
    if (!shopee.findLinks(link).length) return ctx.back('/feed', 'Cole um link da Shopee.', true);
    try {
      const p = await products.fromLink(link, { source: 'feed', subId: 'feed' });
      ctx.back(`/feed/${p.id}`, 'Promoção gerada. Confira e envie.');
    } catch (err) { ctx.back('/feed', err.message, true); }
  });

  r.get('/feed/:id', async (ctx) => {
    const p = products.getProduct(Number(ctx.params.id));
    if (!p) return ctx.back('/feed', 'Produto não encontrado.', true);
    let preview = '';
    try { preview = (await render.renderProduct(p, { templateIds: [] })).text; } catch (err) { preview = `(${err.message})`; }
    ctx.page('Editar produto', '/feed', `<h1>Editar produto</h1>
      <div class="card"><div class="item"><img src="${esc(p.image_url || '')}"><div class="t"><b>${esc(p.title || '')}</b><br><small>${esc(p.link || '')}</small></div></div></div>
      <form method="post"><div class="card"><div class="grid">
        ${field('title', 'Nome', p.title || '')}
        ${field('price', 'Preço atual (R$)', p.price || '', { type: 'number', attrs: 'step="0.01"' })}
        ${field('old_price', 'Preço "De" (R$)', p.old_price || '', { type: 'number', attrs: 'step="0.01"' })}
        ${field('cta_ai', 'Chamada (CTA)', p.cta_ai || '', { hint: 'Vazio = gerar de novo' })}
        ${field('image_url', 'Link da imagem', p.image_url || '')}
      </div><p><button>Salvar</button> <a class="btn sec" href="/envio-direto?produtos=${p.id}">Enviar</a></p></div></form>
      <div class="card"><h2>Como fica com o modelo padrão</h2><div class="wa">${waHtml(preview)}</div></div>`);
  });
  r.post('/feed/:id', (ctx) => {
    const f = ctx.form, id = Number(ctx.params.id);
    const price = Number(f.price) || null, old = Number(f.old_price) || null;
    const discount = price && old && old > price ? Math.round((1 - price / old) * 100) : 0;
    db.prepare('UPDATE products SET title=?, price=?, old_price=?, discount=?, cta_ai=?, image_url=?, updated_at=? WHERE id=?')
      .run(String(f.title || '').slice(0, 300), price, old, discount, String(f.cta_ai || '').trim() || null, String(f.image_url || '').trim() || null, Date.now(), id);
    ctx.back(`/feed/${id}`, 'Salvo.');
  });
  r.post('/feed/:id/favorito', (ctx) => {
    db.prepare('UPDATE products SET favorite=1-favorite WHERE id=?').run(Number(ctx.params.id));
    ctx.redirect(ctx.req.headers.referer && /\/feed/.test(ctx.req.headers.referer) ? new URL(ctx.req.headers.referer).pathname + new URL(ctx.req.headers.referer).search : '/feed');
  });
  r.post('/feed/:id/fila', (ctx) => {
    const a = store.getAutomation(Number(ctx.form.auto));
    if (!a) return ctx.back('/feed', 'Automação não encontrada.', true);
    dispatch.enqueue({ automation_id: a.id, product_id: Number(ctx.params.id), score: 9999 });
    ctx.back('/feed', `Colocado como próximo na fila de "${a.name}".`);
  });
};

module.exports.destPicker = destPicker;
module.exports.templateOptions = templateOptions;
module.exports.couponOptions = couponOptions;
