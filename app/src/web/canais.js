// Canais: números de WhatsApp, grupos/categorias, modo de envio, Telegram
const crypto = require('node:crypto');
const store = require('../db');
const wa = require('../whatsapp');
const tg = require('../telegram');
const images = require('../images');
const dispatch = require('../dispatch');
const { esc, when, field, select, check, stateLabel } = require('./ui');

const { db } = store;

function categories() {
  return db.prepare(`SELECT DISTINCT category FROM destinations WHERE category IS NOT NULL AND category<>'' ORDER BY category`).all().map((r) => r.category);
}

module.exports = (r) => {
  // ---------- Números ----------
  r.get('/instancias', async (ctx) => {
    const list = dispatch.listInstances();
    const states = await Promise.all(list.map((i) => wa.state(i.name)));
    ctx.page('Números', '/instancias', `
      <h1>Números de WhatsApp</h1>
      <div class="help">Cada número conectado pode enviar as ofertas. Com mais de um, escolha em <a href="/modo-envio">Modo de envio</a> se eles revezam ou dividem os grupos. Se um número cair, outro conectado assume.</div>
      <div class="card"><table><tr><th>Número</th><th>Situação</th><th></th></tr>
      ${list.map((i, k) => `<tr><td><b>${esc(i.label || i.name)}</b><br><small>${esc(i.name)}</small>
          <form method="post" action="/instancias/${encodeURIComponent(i.name)}/renomear" class="row" style="margin-top:6px">
          <input name="label" value="${esc(i.label || '')}" style="max-width:220px"><button class="small sec">Renomear</button></form></td>
        <td>${stateLabel(states[k])}</td>
        <td><div class="row">
          ${states[k] !== 'open' ? `<a class="btn small" href="/instancias/${encodeURIComponent(i.name)}/conectar">Conectar (QR code)</a>` : ''}
          ${states[k] === 'open' ? `<form method="post" action="/instancias/${encodeURIComponent(i.name)}/desconectar" onsubmit="return confirm('Desconectar este número? As automações dele param até reconectar.')"><button class="small sec">Desconectar</button></form>` : ''}
          ${list.length > 1 ? `<form method="post" action="/instancias/${encodeURIComponent(i.name)}/remover" onsubmit="return confirm('Remover este número do robô?')"><button class="small danger">Remover</button></form>` : ''}
        </div></td></tr>`).join('')}
      </table></div>
      <div class="card"><h2>Adicionar número</h2>
        <form method="post" action="/instancias/novo" class="row"><input name="label" placeholder="Ex.: Número reserva" required style="max-width:280px"><button>Adicionar</button></form>
        <small>Depois de adicionar, toque em "Conectar" e escaneie o QR code com o celular desse número.</small></div>`);
  });

  r.post('/instancias/novo', async (ctx) => {
    const name = 'num-' + crypto.randomBytes(3).toString('hex');
    db.prepare('INSERT INTO instances(name,label,created_at) VALUES(?,?,?)').run(name, String(ctx.form.label || 'Número').slice(0, 60), Date.now());
    try { await wa.ensureInstance(name); } catch (err) { return ctx.back('/instancias', `Número salvo, mas a conexão respondeu: ${err.message}`, true); }
    ctx.redirect(`/instancias/${name}/conectar`);
  });
  r.post('/instancias/:name/renomear', (ctx) => {
    db.prepare('UPDATE instances SET label=? WHERE name=?').run(String(ctx.form.label || '').slice(0, 60), decodeURIComponent(ctx.params.name));
    ctx.back('/instancias', 'Nome salvo.');
  });
  r.post('/instancias/:name/desconectar', async (ctx) => {
    await wa.logout(decodeURIComponent(ctx.params.name));
    ctx.back('/instancias', 'Número desconectado.');
  });
  r.post('/instancias/:name/remover', async (ctx) => {
    const name = decodeURIComponent(ctx.params.name);
    if (db.prepare('SELECT COUNT(*) n FROM instances').get().n <= 1) return ctx.back('/instancias', 'Precisa ficar pelo menos um número.', true);
    await wa.remove(name);
    db.prepare('DELETE FROM instances WHERE name=?').run(name);
    ctx.back('/instancias', 'Número removido.');
  });

  r.get('/instancias/:name/conectar', async (ctx) => {
    const name = decodeURIComponent(ctx.params.name);
    const inst = db.prepare('SELECT * FROM instances WHERE name=?').get(name);
    if (!inst) return ctx.back('/instancias', 'Número não encontrado.', true);
    const st = await wa.state(name);
    if (st === 'open') {
      return ctx.page('Conectar', '/instancias', `<div class="card"><h2>✅ ${esc(inst.label || name)} conectado</h2>
        <p>Agora cadastre os grupos que vão receber as ofertas.</p><a class="btn" href="/grupos?inst=${encodeURIComponent(name)}&buscar=1">Buscar grupos deste número</a></div>`);
    }
    if (st === 'connecting' && wa.hasSession(name)) {
      return ctx.page('Conectar', '/instancias', `<div class="card"><h2>⏳ Reconectando ${esc(inst.label || name)}…</h2>
        <p>Este número já foi conectado antes; o robô está restabelecendo a conexão. Esta página atualiza sozinha.</p>
        <form method="post" action="/instancias/${encodeURIComponent(name)}/desconectar" onsubmit="return confirm('Apagar a conexão salva e gerar um QR code novo?')"><button class="small sec">Não conecta? Gerar QR code novo</button></form></div>`, { refresh: 10 });
    }
    let qr = null, err = '';
    try { qr = await wa.qrCode(name); } catch (e) { err = e.message; }
    ctx.page('Conectar', '/instancias', `<div class="card"><h2>Conectar: ${esc(inst.label || name)}</h2>
      <ol><li>No celular desse número, abra o WhatsApp.</li>
      <li>Toque em <b>⋮</b> (ou Configurações no iPhone) → <b>Dispositivos conectados</b> → <b>Conectar dispositivo</b>.</li>
      <li>Aponte a câmera para o código abaixo.</li></ol>
      ${qr && qr.base64 ? `<p style="text-align:center"><img src="${esc(qr.base64)}" alt="QR code" style="width:280px;max-width:100%;border:8px solid #fff"></p>` : `<p class="warn">Gerando o código… ${esc(err)}</p>`}
      <p class="muted">O código muda a cada poucos segundos; a página atualiza sozinha.</p></div>
      <div class="card"><h2>Está no mesmo celular?</h2>
      <p class="muted">Digite o número com DDI e DDD (ex.: 5511999998888) e, no WhatsApp, escolha <b>Conectar com número de telefone</b>.</p>
      <form method="post" action="/instancias/${encodeURIComponent(name)}/codigo" class="row"><input name="phone" inputmode="numeric" placeholder="5511999998888" required style="max-width:240px"><button>Gerar código</button></form></div>`, { refresh: 25 });
  });
  r.post('/instancias/:name/codigo', async (ctx) => {
    const name = decodeURIComponent(ctx.params.name);
    try {
      const code = await wa.pairingCode(name, String(ctx.form.phone || '').replace(/\D/g, ''));
      ctx.back(`/instancias/${encodeURIComponent(name)}/conectar`, code ? `Seu código: ${code} — digite no WhatsApp em "Conectar com número de telefone".` : 'Não veio código; use o QR code.');
    } catch (e) { ctx.back(`/instancias/${encodeURIComponent(name)}/conectar`, e.message, true); }
  });

  // ---------- Grupos ----------
  r.get('/grupos', async (ctx) => {
    const inst = ctx.url.searchParams.get('inst') || (dispatch.listInstances()[0] || {}).name;
    let found = null, err = '';
    if (ctx.url.searchParams.get('buscar') && inst) {
      try { found = await wa.groups(inst); } catch (e) { err = e.message; }
    }
    const dests = db.prepare('SELECT * FROM destinations ORDER BY channel, name').all();
    const registered = new Set(dests.map((d) => d.id));
    const cats = categories();
    const instOpts = dispatch.listInstances().map((i) => [i.name, i.label || i.name]);
    ctx.page('Grupos', '/grupos', `
      <h1>Grupos e categorias</h1>
      <div class="card"><h2>Buscar grupos no WhatsApp</h2>
        <form method="get" class="row"><input type="hidden" name="buscar" value="1">
          <select name="inst" style="max-width:260px">${instOpts.map(([v, l]) => `<option value="${esc(v)}" ${v === inst ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <button>Buscar grupos</button></form>
        ${err ? `<p class="bad">Não consegui listar: ${esc(err)}. Confira se o número está conectado.</p>` : ''}
        ${found ? `<form method="post" action="/grupos/cadastrar"><input type="hidden" name="inst" value="${esc(inst)}">
          <p class="muted">Marque os grupos que vão <b>receber</b> ofertas. Grupos de origem e grupos monitorados não precisam ser cadastrados aqui.</p>
          ${found.map((g) => check('g', `${esc(g.name)} <small>· ${g.size || '?'} pessoas${g.announce ? ' · só admins' : ''}</small>`, registered.has(g.id), { value: `${g.id}|${g.name}|${g.size || 0}` })).join('') || '<p class="muted">Nenhum grupo encontrado.</p>'}
          <p><button>Cadastrar selecionados</button></p></form>` : ''}
      </div>
      <div class="card"><h2>Destinos cadastrados (${dests.length})</h2>
        <form method="post" action="/grupos/atualizar" style="margin-bottom:8px"><button class="small sec">🔄 Atualizar nomes e tamanhos</button></form>
        <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <table><tr><th>Grupo</th><th>Categoria</th><th>Enviar por</th><th></th></tr>
        ${dests.map((d) => `<tr><td><b>${esc(d.name)}</b><br><small>${d.channel === 'telegram' ? '✈️ Telegram' : '💬 WhatsApp'}${d.size ? ` · ${d.size} pessoas` : ''}${d.active ? '' : ' · <span class="bad">desativado</span>'}</small></td>
          <td colspan="3"><form method="post" action="/grupos/${encodeURIComponent(d.id)}/salvar" class="row">
            <input name="category" list="cats" value="${esc(d.category || '')}" placeholder="sem categoria" style="max-width:170px">
            ${d.channel === 'telegram' ? '<span class="muted" style="min-width:150px">bot do Telegram</span>' : `<select name="instance" style="max-width:170px">${instOpts.map(([v, l]) => `<option value="${esc(v)}" ${v === d.instance ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`}
            <label class="chk" style="border:0"><input type="checkbox" name="active" value="1" ${d.active ? 'checked' : ''}>ativo</label>
            <button class="small sec">Salvar</button></form>
            <form method="post" action="/grupos/${encodeURIComponent(d.id)}/remover" onsubmit="return confirm('Remover este destino?')" style="margin-top:4px"><button class="small danger">Remover</button></form></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum destino ainda.</td></tr>'}
        </table>
        <small>Categorias juntam vários grupos (WhatsApp e Telegram). Nas automações, você pode marcar uma categoria em vez de cada grupo.</small></div>`);
  });

  r.post('/grupos/cadastrar', (ctx) => {
    const inst = ctx.form.inst;
    let n = 0;
    for (const v of ctx.form.getAll('g')) {
      const [id, name, size] = v.split('|');
      if (!/@g\.us$/.test(id)) continue;
      db.prepare(`INSERT INTO destinations(id,channel,name,instance,size,active,created_at) VALUES(?,?,?,?,?,1,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, size=excluded.size`).run(id, 'whatsapp', name, inst, Number(size) || 0, Date.now());
      n++;
    }
    ctx.back('/grupos', `${n} grupo(s) cadastrados.`);
  });
  r.post('/grupos/atualizar', async (ctx) => {
    let n = 0;
    for (const i of dispatch.listInstances()) {
      try {
        for (const g of await wa.groups(i.name)) {
          n += db.prepare('UPDATE destinations SET name=?, size=? WHERE id=?').run(g.name, g.size || 0, g.id).changes;
        }
      } catch {}
    }
    ctx.back('/grupos', `${n} destino(s) atualizados.`);
  });
  r.post('/grupos/:id/salvar', (ctx) => {
    const id = decodeURIComponent(ctx.params.id);
    const d = db.prepare('SELECT * FROM destinations WHERE id=?').get(id);
    if (!d) return ctx.back('/grupos', 'Destino não encontrado.', true);
    db.prepare('UPDATE destinations SET category=?, instance=?, active=? WHERE id=?')
      .run(String(ctx.form.category || '').trim().slice(0, 40), ctx.form.instance || d.instance, ctx.form.active ? 1 : 0, id);
    ctx.back('/grupos', 'Salvo.');
  });
  r.post('/grupos/:id/remover', (ctx) => {
    db.prepare('DELETE FROM destinations WHERE id=?').run(decodeURIComponent(ctx.params.id));
    ctx.back('/grupos', 'Removido.');
  });

  // ---------- Modo de envio + marca d'água ----------
  r.get('/modo-envio', (ctx) => {
    const s = store.all();
    const radio = (v, title, desc) => `<label class="chk" style="align-items:flex-start"><input type="radio" name="instance_mode" value="${v}" ${s.instance_mode === v ? 'checked' : ''}><span><b>${title}</b><br><small>${desc}</small></span></label>`;
    ctx.page('Modo de envio', '/modo-envio', `<h1>Modo de envio</h1><form method="post">
      <div class="card"><h2>Como os números são usados</h2>
        ${radio('automacao', 'Escolher na automação (padrão)', 'Cada automação usa o número escolhido nela. Se ele cair, outro número conectado assume.')}
        ${radio('alternada', 'Alternada', 'Cada promoção sai por um número, revezando entre eles para dividir o desgaste.')}
        ${radio('dividida', 'Dividida', 'Os grupos de cada envio são repartidos entre os números, ao mesmo tempo. Envio mais rápido.')}
        <small>Para Alternada e Dividida, todos os números precisam estar nos grupos de destino.</small></div>
      <div class="card"><h2>Prévia do link</h2>
        ${check('preview_title', 'Mostrar o nome e o preço do produto junto com a foto na prévia', s.preview_title !== '0')}
        <small>A prévia é montada pelo robô com a foto oficial do produto. Desmarcado, aparece só a foto e o endereço.</small></div>
      <div class="card"><h2>Marca d'água nas fotos</h2>
        ${images.available() ? '' : '<p class="warn">O tratamento de imagens não está disponível nesta instalação; as fotos saem originais.</p>'}
        ${check('watermark_enabled', 'Colocar marca d\'água nas fotos (envios com imagem)', s.watermark_enabled === '1')}
        <div class="grid">
          ${field('watermark_text', 'Texto (até 30 letras)', s.watermark_text, { attrs: 'maxlength="30"' })}
          ${select('watermark_size', 'Tamanho', s.watermark_size, [['pequena', 'Pequena'], ['media', 'Média'], ['grande', 'Grande']])}
          ${field('watermark_opacity', 'Transparência (10 a 100%)', s.watermark_opacity, { type: 'number', attrs: 'min="10" max="100"' })}
          ${field('watermark_color', 'Cor da etiqueta', s.watermark_color, { type: 'color' })}
        </div><small>A posição varia entre os 4 cantos a cada foto. Não vale para a prévia do link (essa foto é montada pelo WhatsApp).</small></div>
      <p><button>Salvar</button></p></form>`);
  });
  r.post('/modo-envio', (ctx) => {
    const f = ctx.form;
    if (['automacao', 'alternada', 'dividida'].includes(f.instance_mode)) store.set('instance_mode', f.instance_mode);
    store.set('preview_title', f.preview_title ? '1' : '0');
    store.set('watermark_enabled', f.watermark_enabled ? '1' : '0');
    store.set('watermark_text', String(f.watermark_text || '').slice(0, 30));
    if (['pequena', 'media', 'grande'].includes(f.watermark_size)) store.set('watermark_size', f.watermark_size);
    store.set('watermark_opacity', Math.min(100, Math.max(10, Number(f.watermark_opacity) || 70)));
    if (/^#[0-9a-f]{6}$/i.test(f.watermark_color || '')) store.set('watermark_color', f.watermark_color);
    ctx.back('/modo-envio', 'Salvo.');
  });

  // ---------- Telegram ----------
  r.get('/telegram', (ctx) => {
    const s = store.all();
    const list = db.prepare(`SELECT * FROM destinations WHERE channel='telegram' ORDER BY name`).all();
    ctx.page('Telegram', '/telegram', `<h1>Telegram</h1>
      <div class="card"><h2>1. Crie o seu bot</h2>
        <ol><li>No Telegram, abra o <b>@BotFather</b> e mande <code>/newbot</code>.</li><li>Escolha um nome. Ele devolve um <b>token</b>.</li><li>Cole o token aqui.</li></ol>
        <form method="post" action="/telegram/token" class="row"><input name="token" type="password" placeholder="${s.telegram_token ? '•••••• (já salvo)' : '123456:ABC...'}" style="max-width:380px"><button>Salvar token</button></form></div>
      <div class="card"><h2>2. Vincule grupos e canais</h2>
        <ol><li>Adicione o seu bot ao grupo ou canal como <b>administrador</b> (com permissão de enviar mensagens).</li>
        <li>Gere o código abaixo e mande <code>/link CÓDIGO</code> dentro do grupo ou canal.</li><li>Em até 15 segundos ele aparece na lista.</li></ol>
        ${s.telegram_link_code ? `<p>Código atual: <b style="font-size:18px">${esc(s.telegram_link_code)}</b> → mande <code>/link ${esc(s.telegram_link_code)}</code></p>` : ''}
        <form method="post" action="/telegram/codigo"><button class="sec">${s.telegram_link_code ? 'Gerar outro código' : 'Gerar código'}</button></form></div>
      <div class="card"><h2>Grupos/canais vinculados (${list.length})</h2>
        ${list.map((d) => `<div class="item"><div class="t"><b>${esc(d.name)}</b><br><small>${esc(d.id)} · ${d.category ? `categoria ${esc(d.category)}` : 'sem categoria'}</small></div></div>`).join('') || '<p class="muted">Nenhum ainda.</p>'}
        <small>Para colocar em categorias ou remover, use <a href="/grupos">Grupos e categorias</a>.</small></div>`);
  });
  r.post('/telegram/token', async (ctx) => {
    const t = String(ctx.form.token || '').trim();
    if (!t) return ctx.back('/telegram', 'Cole o token do bot.', true);
    store.set('telegram_token', t);
    try { const me = await tg.api('getMe', {}); ctx.back('/telegram', `✅ Bot @${me.username} conectado.`); }
    catch (e) { ctx.back('/telegram', `O Telegram recusou o token: ${e.message}`, true); }
  });
  r.post('/telegram/codigo', (ctx) => {
    store.set('telegram_link_code', crypto.randomBytes(3).toString('hex').toUpperCase());
    ctx.back('/telegram', 'Código gerado.');
  });
};

module.exports.categories = categories;
