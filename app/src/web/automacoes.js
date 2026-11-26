// Automações: lista, criar/editar, fila, planilha
const store = require('../db');
const wa = require('../whatsapp');
const dispatch = require('../dispatch');
const products = require('../products');
const engine = require('../automations');
const shopee = require('../shopee');
const { esc, brl, when, field, area, select, check, pill } = require('./ui');
const { destPicker, templateOptions } = require('./envios');

const { db, log, parse } = store;
const T = store.AUTOMATION_TYPES;

const DESCR = {
  busca: 'O robô procura ofertas na Shopee pelas suas palavras-chave e filtros e envia uma a cada intervalo.',
  promo: 'Você cola links num grupo seu (grupo de origem) e eles viram promoções prontas. Também recebe links do Feed, do Envio direto e de planilhas.',
  monitor: 'Lê grupos de outros afiliados, troca os links pelos seus e monta uma promoção nova com o seu texto.',
  clone: 'Copia a mensagem inteira de outros afiliados, só trocando os links pelos seus.',
  replicador: 'Repassa as mensagens de um grupo seu para os grupos de destino, do jeito que chegaram.',
};

// Grupos do WhatsApp (para escolher origem/monitorados), com cache curto
let groupCache = { at: 0, list: [] };
async function allGroups() {
  if (Date.now() - groupCache.at < 120000 && groupCache.list.length) return groupCache.list;
  const map = new Map();
  for (const i of dispatch.listInstances()) {
    try { for (const g of await wa.groups(i.name)) map.set(g.id, g); } catch {}
  }
  groupCache = { at: Date.now(), list: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  return groupCache.list;
}

function groupSelect(name, selected, groups, { multiple = false, max = 0, exclude = [] } = {}) {
  const sel = new Set([].concat(selected || []));
  const list = groups.filter((g) => !exclude.includes(g.id) || sel.has(g.id));
  const known = new Set(list.map((g) => g.id));
  const extra = [...sel].filter((id) => id && !known.has(id)).map((id) => ({ id, name: `${id} (não encontrado agora)` }));
  if (multiple) {
    return `${[...extra, ...list].map((g) => check(name, esc(g.name), sel.has(g.id), { value: g.id })).join('') || '<p class="muted">Nenhum grupo encontrado (o número está conectado?).</p>'}
      ${max ? `<small>Máximo de ${max} grupos.</small>` : ''}`;
  }
  return `<select name="${name}"><option value="">— escolha —</option>${[...extra, ...list].map((g) => `<option value="${esc(g.id)}" ${sel.has(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`;
}

function hours(c) {
  return `${field('hour_start', 'Começa às', c.hour_start, { type: 'time' })}${field('hour_end', 'Para às', c.hour_end, { type: 'time' })}`;
}

async function form(a) {
  const c = a.cfg;
  const type = a.type;
  const groups = ['promo', 'monitor', 'clone', 'replicador'].includes(type) ? await allGroups() : [];
  const destIds = db.prepare('SELECT id FROM destinations').all().map((d) => d.id);
  const instOpts = [['', 'Automático (o primeiro conectado)'], ...dispatch.listInstances().map((i) => [i.name, i.label || i.name])];
  const tplIds = (c.templates || []).map(Number);
  const tpls = db.prepare('SELECT id,name,store FROM templates ORDER BY id').all();
  const cps = db.prepare('SELECT * FROM coupons WHERE active=1 ORDER BY id DESC').all();
  const render = require('../render');

  const origin = type === 'promo' ? `<div class="card"><h2>Grupo de origem</h2>
      <p class="muted">O grupo onde você cola os links. Pode deixar vazio se os links vierem só do Feed, do Envio direto ou de planilha.</p>
      ${groupSelect('origin', c.origin, groups, { exclude: destIds })}
      ${check('use_tags', 'Ler as tags #preco, #precoa, #cupom, #texto das mensagens (<a href="/tags">como usar</a>)', c.use_tags !== false)}</div>`
    : type === 'replicador' ? `<div class="card"><h2>Grupo de origem</h2>${groupSelect('origin', c.origin, groups, { exclude: destIds })}
      <small>Grupos que já são destino não aparecem aqui (evita mensagens em loop).</small></div>`
      : ['monitor', 'clone'].includes(type) ? `<div class="card"><h2>Grupos monitorados (até 3)</h2>
      <p class="muted">Grupos de outros afiliados em que o seu número está. O robô lê as ofertas de lá.</p>
      ${groupSelect('monitored', c.monitored, groups, { multiple: true, max: 3, exclude: destIds })}</div>` : '';

  const busca = type === 'busca' ? `<div class="card"><h2>O que procurar</h2>
      ${area('keywords', 'Palavras-chave (uma por linha)', c.keywords, { rows: 7, hint: 'Sem palavra-chave, o robô usa uma seleção variada da Shopee.' })}
      ${area('exclude', 'Nunca enviar produtos com estas palavras', c.exclude, { rows: 2, hint: 'Separe por vírgula. Ex.: usado, réplica, infantil' })}
      <div class="grid">
        ${select('sort', 'Ordenar a busca por', c.sort, [[2, 'Mais vendidos'], [1, 'Relevância'], [5, 'Maior comissão'], [4, 'Menor preço'], [3, 'Maior preço']])}
        ${field('min_discount', 'Desconto mínimo (%)', c.min_discount, { type: 'number' })}
        ${field('min_price', 'Preço mínimo (R$)', c.min_price, { type: 'number', attrs: 'step="0.01"' })}
        ${field('max_price', 'Preço máximo (R$)', c.max_price, { type: 'number', attrs: 'step="0.01"', hint: '0 = sem limite' })}
        ${field('min_rating', 'Nota mínima', c.min_rating, { type: 'number', attrs: 'step="0.1"' })}
        ${field('min_sales', 'Vendas mínimas', c.min_sales, { type: 'number' })}
        ${field('min_commission', 'Comissão mínima (%)', c.min_commission, { type: 'number' })}
        ${field('collect_every_min', 'Buscar a cada (min)', c.collect_every_min, { type: 'number', attrs: 'min="15"' })}
        ${field('per_keyword', 'Ofertas por palavra-chave', c.per_keyword, { type: 'number', hint: 'em cada busca' })}
        ${field('variety', 'Não repetir o mesmo tipo em', c.variety, { type: 'number', hint: 'ex.: 5 = uma cadeira só 5 ofertas depois da outra' })}
        ${field('repost_days', 'Repetir produto após (dias)', c.repost_days, { type: 'number' })}
      </div></div>` : '';

  const capture = type === 'monitor' ? `<div class="card"><h2>Capturas do grupo monitorado</h2>
      ${check('capture_cta', 'Capturar a chamada (vai para {cta} no seu texto)', c.capture_cta)}
      ${check('capture_coupon', 'Capturar o código de cupom (vai para {cupom_codigo})', c.capture_coupon)}
      ${check('capture_image', 'Usar a imagem do grupo monitorado', c.capture_image)}</div>`
    : type === 'clone' ? `<div class="card"><h2>Modo cópia</h2>
      ${check('remove_cta', 'Tirar a chamada do afiliado original (primeira linha)', c.remove_cta)}
      ${select('ai_cta', 'Chamada nova', c.ai_cta, [['none', 'Não colocar'], ['upper', 'Chamada de IA em MAIÚSCULAS'], ['lower', 'Chamada de IA normal']])}
      ${check('ai_cta_bold', 'Chamada em negrito', c.ai_cta_bold)}
      ${check('capture_image', 'Usar a imagem do grupo monitorado', c.capture_image)}</div>` : '';

  const queueOpts = ['monitor', 'clone'].includes(type) ? `<div class="grid">
      ${select('order', 'Ordem da fila', c.order, [['chegada', 'Ordem de chegada'], ['cortafila', 'Corta-fila (o que chegou agora sai primeiro)']])}
      ${field('cleanup_time', 'Limpar a fila todo dia às', c.cleanup_time, { type: 'time', hint: 'vazio = nunca' })}</div>` : '';

  const textCard = ['clone', 'replicador'].includes(type) ? '' : `<div class="card"><h2>Texto e cupons</h2>
      <p class="muted">Marque até 6 textos: o robô usa o que for da Shopee e, se não houver, o de "qualquer loja". Nenhum marcado = texto padrão.</p>
      ${tpls.map((t) => check('templates', `${esc(t.name)} <small>(${t.store === 'any' ? 'qualquer loja' : 'Shopee'})</small>`, tplIds.includes(t.id), { value: t.id })).join('') || '<p class="muted">Nenhum texto ainda. <a href="/textos">Criar</a></p>'}
      <p class="muted" style="margin-top:10px">Cupons (o robô escolhe o de maior desconto que vale para o preço):</p>
      ${cps.map((cp) => check('coupons', `${esc(cp.code || cp.link)} · ${render.couponValueLabel(cp)}${cp.min_price ? ` (mín. R$ ${cp.min_price})` : ''}`, (c.coupons || []).map(Number).includes(cp.id), { value: cp.id })).join('') || '<p class="muted">Nenhum cupom. <a href="/cupons">Cadastrar</a></p>'}</div>`;

  const filters = type === 'replicador' ? '' : `<div class="card"><h2>Filtros</h2>
      <div class="grid">
        ${field('f_block', 'Bloquear se tiver', c.filters.block, { hint: 'palavras separadas por vírgula' })}
        ${field('f_only', 'Enviar só se tiver', c.filters.only, { hint: 'palavras separadas por vírgula' })}
        ${field('f_price_min', 'Preço acima de (R$)', c.filters.price_min, { type: 'number', attrs: 'step="0.01"' })}
        ${field('f_price_max', 'Preço abaixo de (R$)', c.filters.price_max, { type: 'number', attrs: 'step="0.01"' })}
        ${type === 'busca' ? '' : field('f_min_discount', 'Desconto mínimo (%)', c.filters.min_discount, { type: 'number' })}
      </div>
      ${area('f_replace', 'Substituir palavras (uma regra por linha: <code>de => para</code>)', c.filters.replace, { rows: 3, hint: 'Deixe vazio depois de => para apagar. Links e preços nunca são alterados.' })}</div>`;

  return `<form method="post" action="/automacoes/${a.id || 'nova'}">
    <input type="hidden" name="type" value="${esc(type)}">
    <div class="card"><h2>${esc(T[type])}</h2><p class="muted">${DESCR[type]}</p>
      <div class="grid">${field('name', 'Nome', a.name || T[type], { attrs: 'required' })}
      ${select('instance', 'Número que envia', c.instance, instOpts)}</div>
      ${check('active', 'Automação ativa', !!a.active)}</div>
    ${origin}${busca}${capture}
    <div class="card"><h2>Grupos de destino</h2>${destPicker(c.dest || [], c.dest_categories || [])}</div>
    <div class="card"><h2>Envio</h2><div class="grid">
      ${select('mode', 'Tipo de envio', c.mode, type === 'busca' ? [['fila', 'Fila com intervalo']] : [['imediato', 'Imediato'], ['fila', 'Fila com intervalo']])}
      ${field('interval_min', 'Intervalo (min)', c.interval_min, { type: 'number', attrs: 'min="1" max="240"', hint: 'na fila: tempo entre uma promoção e outra' })}
      ${field('jitter_min', 'Variação (± min)', c.jitter_min, { type: 'number', hint: 'deixa menos robótico' })}
      ${field('max_per_day', 'Máximo por dia', c.max_per_day, { type: 'number', hint: '0 = sem limite' })}
      ${hours(c)}
      ${type === 'replicador' ? '' : select('media', 'Formato', c.media, [['preview', 'Prévia do link'], ['imagem', 'Imagem + legenda']])}
      ${type === 'replicador' ? '' : select('image_style', 'Estilo da imagem', c.image_style, [['padrao', 'Padrão (recorte quadrado)'], ['enquadrada', 'Enquadrada (fundo branco)'], ['original', 'Original']])}
    </div>${queueOpts}</div>
    ${textCard}${filters}
    <p class="row"><button>Salvar automação</button><a class="btn sec" href="/automacoes">Cancelar</a></p></form>`;
}

function readForm(f, type, old = {}) {
  const n = (k, d = 0) => (f[k] === undefined || f[k] === '' ? d : Number(f[k]));
  const cfg = {
    instance: f.instance || '', dest: f.getAll('dest'), dest_categories: f.getAll('dest_cat'),
    hour_start: f.hour_start || '08:00', hour_end: f.hour_end || '22:00',
    mode: type === 'busca' ? 'fila' : (f.mode === 'imediato' ? 'imediato' : 'fila'),
    interval_min: Math.min(240, Math.max(1, n('interval_min', 10))), jitter_min: Math.max(0, n('jitter_min', 0)),
    max_per_day: Math.max(0, n('max_per_day', 0)),
    media: f.media === 'imagem' ? 'imagem' : 'preview',
    image_style: ['padrao', 'enquadrada', 'original'].includes(f.image_style) ? f.image_style : 'padrao',
    templates: f.getAll('templates').map(Number).slice(0, 6), coupons: f.getAll('coupons').map(Number),
    filters: {
      block: f.f_block || '', only: f.f_only || '', replace: String(f.f_replace || '').replace(/\r/g, ''),
      price_min: n('f_price_min'), price_max: n('f_price_max'), min_discount: n('f_min_discount'),
    },
  };
  if (type === 'busca') Object.assign(cfg, {
    keywords: String(f.keywords || '').replace(/\r/g, '').trim(), exclude: f.exclude || '', sort: n('sort', 2),
    min_discount: n('min_discount'), min_price: n('min_price'), max_price: n('max_price'), min_rating: n('min_rating'),
    min_sales: n('min_sales'), min_commission: n('min_commission'), collect_every_min: Math.max(15, n('collect_every_min', 60)),
    per_keyword: Math.max(1, n('per_keyword', 3)), variety: Math.max(0, n('variety', 5)), repost_days: Math.max(1, n('repost_days', 7)),
  });
  if (type === 'promo') Object.assign(cfg, { origin: f.origin || '', use_tags: !!f.use_tags });
  if (type === 'replicador') Object.assign(cfg, { origin: f.origin || '' });
  if (type === 'monitor' || type === 'clone') Object.assign(cfg, { monitored: f.getAll('monitored').slice(0, 3), order: f.order === 'cortafila' ? 'cortafila' : 'chegada', cleanup_time: f.cleanup_time || '' });
  if (type === 'monitor') Object.assign(cfg, { capture_cta: !!f.capture_cta, capture_coupon: !!f.capture_coupon, capture_image: !!f.capture_image });
  if (type === 'clone') Object.assign(cfg, { remove_cta: !!f.remove_cta, ai_cta: ['upper', 'lower'].includes(f.ai_cta) ? f.ai_cta : 'none', ai_cta_bold: !!f.ai_cta_bold, capture_image: !!f.capture_image });
  return { ...old, ...cfg };
}

function validate(a) {
  const c = a.cfg;
  const origins = [c.origin, ...(c.monitored || [])].filter(Boolean);
  const dests = new Set(dispatch.resolveDestinations(c.dest, c.dest_categories).map((d) => d.id));
  if (origins.some((o) => dests.has(o))) return 'Um grupo de origem/monitorado não pode ser também destino (as mensagens entrariam em loop).';
  if (a.active && !dests.size) return 'Escolha pelo menos um grupo de destino para ativar.';
  if (a.active && a.type === 'replicador' && !c.origin) return 'Escolha o grupo de origem.';
  if (a.active && ['monitor', 'clone'].includes(a.type) && !(c.monitored || []).length) return 'Escolha pelo menos um grupo monitorado.';
  return null;
}

module.exports = (r) => {
  r.get('/automacoes', (ctx) => {
    const list = store.listAutomations();
    const qn = (id, st) => db.prepare(`SELECT COUNT(*) n FROM queue WHERE automation_id=? AND status=?`).get(id, st).n;
    ctx.page('Automações', '/automacoes', `<h1>Automações</h1>
      <p><a class="btn" href="/automacoes/nova">+ Nova automação</a></p>
      ${list.map((a) => `<div class="card"><div class="row" style="justify-content:space-between">
          <div><h2 style="margin:0">${esc(a.name)} ${pill(a.active)}</h2><small>${esc(T[a.type])} · ${a.cfg.mode === 'imediato' ? 'imediato' : `a cada ${a.cfg.interval_min} min`} · ${esc(a.cfg.hour_start)}–${esc(a.cfg.hour_end)}</small></div>
          <small>fila: <b>${qn(a.id, 'pending')}</b> · enviadas hoje: <b>${engine.sentTodayFor(a.id)}</b> · último envio: ${when(a.last_send)}</small></div>
        <div class="row" style="margin-top:10px">
          <a class="btn small" href="/automacoes/${a.id}">Editar</a>
          <a class="btn small sec" href="/automacoes/${a.id}/fila">Ver fila</a>
          <form method="post" action="/automacoes/${a.id}/alternar"><button class="small sec">${a.active ? '⏸️ Pausar' : '▶️ Ativar'}</button></form>
          ${a.type === 'busca' ? `<form method="post" action="/automacoes/${a.id}/buscar"><button class="small sec">🔎 Buscar agora</button></form>` : ''}
          ${a.type === 'promo' ? `<a class="btn small sec" href="/automacoes/${a.id}/planilha">📄 Planilha</a>` : ''}
          <form method="post" action="/automacoes/${a.id}/excluir" onsubmit="return confirm('Excluir esta automação e a fila dela?')"><button class="small danger">Excluir</button></form>
        </div></div>`).join('') || '<div class="card"><p class="muted">Nenhuma automação ainda.</p></div>'}`);
  });

  r.get('/automacoes/nova', async (ctx) => {
    const type = ctx.url.searchParams.get('tipo');
    if (!T[type]) {
      return ctx.page('Nova automação', '/automacoes', `<h1>Nova automação</h1>
        ${Object.entries(T).map(([k, l]) => `<div class="card"><h2>${l}</h2><p class="muted">${DESCR[k]}</p><a class="btn small" href="/automacoes/nova?tipo=${k}">Criar</a></div>`).join('')}`);
    }
    const a = { name: T[type], type, active: 0, cfg: store.automationConfig({ type, config: '{}' }) };
    ctx.page('Nova automação', '/automacoes', `<h1>Nova automação</h1>${await form(a)}`);
  });

  r.get('/automacoes/:id', async (ctx) => {
    const a = store.getAutomation(Number(ctx.params.id));
    if (!a) return ctx.back('/automacoes', 'Automação não encontrada.', true);
    ctx.page(a.name, '/automacoes', `<h1>${esc(a.name)}</h1>${await form(a)}`);
  });

  r.post('/automacoes/:id', (ctx) => {
    const f = ctx.form;
    const isNew = ctx.params.id === 'nova';
    const old = isNew ? null : store.getAutomation(Number(ctx.params.id));
    if (!isNew && !old) return ctx.back('/automacoes', 'Automação não encontrada.', true);
    const type = isNew ? f.type : old.type;
    if (!T[type]) return ctx.back('/automacoes', 'Tipo inválido.', true);
    const a = { id: old && old.id, name: String(f.name || T[type]).slice(0, 80), type, active: !!f.active, cfg: readForm(f, type, old ? parse(old.config, {}) : {}) };
    const err = validate(a);
    if (err) {
      a.active = false;
      const id = store.saveAutomation(a);
      return ctx.back(`/automacoes/${id}`, `${err} A automação foi salva pausada.`, true);
    }
    const id = store.saveAutomation(a);
    if (a.active && type === 'busca' && isNew) engine.collect(store.getAutomation(id)).catch(() => {});
    ctx.back('/automacoes', `"${a.name}" salva${a.active ? ' e ativa' : ''}.`);
  });

  r.post('/automacoes/:id/alternar', (ctx) => {
    const a = store.getAutomation(Number(ctx.params.id));
    if (!a) return ctx.back('/automacoes', 'Automação não encontrada.', true);
    a.active = !a.active;
    const err = a.active && validate(a);
    if (err) return ctx.back('/automacoes', err, true);
    store.saveAutomation(a);
    ctx.back('/automacoes', a.active ? `"${a.name}" ativada.` : `"${a.name}" pausada.`);
  });
  r.post('/automacoes/:id/excluir', (ctx) => {
    const id = Number(ctx.params.id);
    db.prepare(`UPDATE queue SET status='skipped' WHERE automation_id=? AND status='pending'`).run(id);
    db.prepare('DELETE FROM automations WHERE id=?').run(id);
    ctx.back('/automacoes', 'Automação excluída.');
  });
  r.post('/automacoes/:id/buscar', (ctx) => {
    const a = store.getAutomation(Number(ctx.params.id));
    if (!a) return ctx.back('/automacoes', 'Automação não encontrada.', true);
    engine.collect(a).catch((e) => log('erro', e.message));
    ctx.back(`/automacoes/${a.id}/fila`, 'Buscando ofertas… em 1 ou 2 minutos elas aparecem aqui.');
  });

  // ---------- Fila ----------
  r.get('/automacoes/:id/fila', (ctx) => {
    const a = store.getAutomation(Number(ctx.params.id));
    if (!a) return ctx.back('/automacoes', 'Automação não encontrada.', true);
    const next = engine.plan(a, 40);
    const total = db.prepare(`SELECT COUNT(*) n FROM queue WHERE automation_id=? AND status='pending'`).get(a.id).n;
    const recent = db.prepare(`SELECT q.*, p.title, p.image_url, p.price FROM queue q LEFT JOIN products p ON p.id=q.product_id
      WHERE q.automation_id=? AND q.status IN ('sent','failed') ORDER BY COALESCE(q.sent_at,q.created_at) DESC LIMIT 20`).all(a.id);
    const row = (q, actions) => { const pl = parse(q.payload, {}); return `<div class="item"><img src="${esc(q.image_url || '')}" loading="lazy">
      <div class="t"><b>${esc(q.title || (pl.text || '').split('\n').find((l) => l.trim()) || '(mensagem)')}</b><br>
      <small>${q.price ? brl(pl.price || q.price) : ''} ${q.sent_at ? `· enviado ${when(q.sent_at)}` : `· entrou ${when(q.created_at)}`}${q.error ? ` · <span class="bad">${esc(q.error)}</span>` : ''}</small>
      ${actions ? `<div class="row" style="margin-top:6px">${actions}</div>` : ''}</div></div>`; };
    ctx.page(`Fila · ${a.name}`, '/automacoes', `<h1>Fila: ${esc(a.name)}</h1>
      <div class="card"><h2>Próximas (${total})</h2><p class="muted">Na ordem em que vão sair.</p>
        <div class="row" style="margin-bottom:8px">${a.type === 'busca' ? `<form method="post" action="/automacoes/${a.id}/buscar"><button class="small sec">🔎 Buscar agora</button></form>` : ''}
        ${total ? `<form method="post" action="/automacoes/${a.id}/limpar" onsubmit="return confirm('Tirar tudo da fila?')"><button class="small sec">🧹 Limpar fila</button></form>` : ''}</div>
        ${next.map((q) => row(q, `<form method="post" action="/fila/${q.id}/enviar"><button class="small">Enviar agora</button></form>
          <form method="post" action="/fila/${q.id}/pular"><button class="small sec">Pular</button></form>
          <a class="btn small sec" href="/fila/${q.id}">Ver mensagem</a>`)).join('') || '<p class="muted">Fila vazia.</p>'}</div>
      <div class="card"><h2>Enviadas recentemente</h2>${recent.map((q) => row(q)).join('') || '<p class="muted">Nada ainda.</p>'}</div>`);
  });
  r.post('/automacoes/:id/limpar', (ctx) => {
    const n = db.prepare(`UPDATE queue SET status='skipped', error='fila limpa' WHERE automation_id=? AND status='pending'`).run(Number(ctx.params.id)).changes;
    ctx.back(`/automacoes/${ctx.params.id}/fila`, `${n} item(ns) tirados da fila.`);
  });

  r.get('/fila/:id', async (ctx) => {
    const q = db.prepare('SELECT * FROM queue WHERE id=?').get(Number(ctx.params.id));
    if (!q) return ctx.back('/automacoes', 'Item não encontrado.', true);
    const a = q.automation_id ? store.getAutomation(q.automation_id) : null;
    let msg;
    try { msg = await dispatch.buildMessage(q, a); } catch (err) { msg = { text: `(erro: ${err.message})` }; }
    const img = msg.image && (msg.image.url || (msg.image.base64 && `data:${msg.image.mimetype};base64,${msg.image.base64}`));
    const back = a ? `/automacoes/${a.id}/fila` : '/historico';
    ctx.page('Mensagem', '/automacoes', `<h1>Como vai ficar</h1><div class="card">
      ${img ? `<img src="${esc(img)}" style="max-width:300px;border-radius:8px;display:block;margin-bottom:6px">` : ''}
      ${!img && msg.preview && msg.product && msg.product.image_url ? `<div style="display:flex;gap:8px;align-items:center;background:#f0f2f5;border-radius:8px;padding:8px;max-width:420px;margin-bottom:6px"><img src="${esc(msg.product.image_url)}" style="width:64px;height:64px;object-fit:cover;border-radius:6px"><small>Prévia do link (aproximada)</small></div>` : ''}
      <div class="wa">${esc(msg.text)}</div>
      <p class="row" style="margin-top:12px">${q.status === 'pending' ? `<form method="post" action="/fila/${q.id}/enviar"><button>Enviar agora</button></form>` : ''}<a class="btn sec" href="${back}">Voltar</a></p></div>`);
  });
  r.post('/fila/:id/:acao', (ctx) => {
    const q = db.prepare(`SELECT * FROM queue WHERE id=? AND status='pending'`).get(Number(ctx.params.id));
    const back = q && q.automation_id ? `/automacoes/${q.automation_id}/fila` : '/envio-manual';
    if (!q) return ctx.back(back, 'Esse item não está mais na fila.', true);
    if (ctx.params.acao === 'pular') {
      db.prepare(`UPDATE queue SET status='skipped' WHERE id=?`).run(q.id);
      return ctx.back(back, 'Tirado da fila.');
    }
    if (ctx.params.acao === 'enviar') {
      const a = q.automation_id ? store.getAutomation(q.automation_id) : null;
      dispatch.sendItem(q, { automation: a }).catch((e) => log('erro', e.message));
      return ctx.back(back, 'Enviando…');
    }
    ctx.back(back, 'Ação desconhecida.', true);
  });

  // ---------- Planilha ----------
  r.get('/automacoes/:id/planilha', (ctx) => {
    const a = store.getAutomation(Number(ctx.params.id));
    if (!a) return ctx.back('/automacoes', 'Automação não encontrada.', true);
    ctx.page('Planilha', '/automacoes', `<h1>Planilha → ${esc(a.name)}</h1>
      <div class="help">Envie um arquivo CSV ou Excel (XLSX) com a coluna <b>Offer Link</b> (a exportação da Shopee) ou <b>Links</b>. Uma coluna <b>CTA</b> é opcional. Máximo de 100 links por arquivo.</div>
      <form method="post" enctype="multipart/form-data" class="card"><input type="file" name="file" accept=".csv,.xlsx,.xlsm,.txt" required><p><button>Enviar planilha</button></p></form>`);
  });
  r.post('/automacoes/:id/planilha', async (ctx) => {
    const a = store.getAutomation(Number(ctx.params.id));
    if (!a) return ctx.back('/automacoes', 'Automação não encontrada.', true);
    const file = (ctx.files || [])[0];
    if (!file) return ctx.back(`/automacoes/${a.id}/planilha`, 'Escolha um arquivo.', true);
    let rows;
    try { rows = await readSheet(file); } catch (err) { return ctx.back(`/automacoes/${a.id}/planilha`, `Não consegui ler o arquivo: ${err.message}`, true); }
    if (!rows.length) return ctx.back(`/automacoes/${a.id}/planilha`, 'Não achei a coluna "Offer Link" ou "Links" com links.', true);
    if (rows.length > 100) return ctx.back(`/automacoes/${a.id}/planilha`, `O arquivo tem ${rows.length} links; o máximo é 100.`, true);
    (async () => {
      for (const row of rows) {
        try {
          const p = await products.fromLink(row.link, { source: 'planilha', subId: 'planilha' });
          dispatch.enqueue({ automation_id: a.id, product_id: p.id, payload: row.cta ? { cta: row.cta, cta_ai: row.cta } : {} });
        } catch (err) { log('erro', `Planilha: ${err.message}`); }
      }
      log('info', `Planilha: ${rows.length} links processados para "${a.name}".`);
    })();
    ctx.back(`/automacoes/${a.id}/fila`, `${rows.length} links sendo processados. Eles aparecem na fila em instantes.`);
  });
};

// Lê CSV ou XLSX → [{ link, cta }]
async function readSheet(file) {
  let table = [];
  if (/\.xlsx|\.xlsm$/i.test(file.filename) || /spreadsheetml/.test(file.mime)) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const ws = wb.worksheets[0];
    ws.eachRow((row) => {
      table.push(row.values.slice(1).map((v) => (v && typeof v === 'object' ? (v.hyperlink || v.text || (v.richText || []).map((t) => t.text).join('')) : v) ?? '').map(String));
    });
  } else {
    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    table = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => parseCsvLine(l, sep));
  }
  if (!table.length) return [];
  const header = table[0].map((h) => h.trim().toLowerCase());
  let li = header.findIndex((h) => h === 'offer link' || h === 'links' || h === 'link');
  const ci = header.findIndex((h) => h === 'cta');
  let body = table.slice(1);
  if (li < 0) { // sem cabeçalho: procura links em qualquer coluna
    body = table;
    return body.map((r) => ({ link: r.find((c) => shopee.findLinks(c).length) })).filter((x) => x.link).map((x) => ({ link: shopee.findLinks(x.link)[0], cta: '' }));
  }
  return body.map((r) => ({ link: shopee.findLinks(r[li] || '')[0], cta: ci >= 0 ? String(r[ci] || '').trim() : '' })).filter((x) => x.link);
}

function parseCsvLine(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

module.exports.readSheet = readSheet;
