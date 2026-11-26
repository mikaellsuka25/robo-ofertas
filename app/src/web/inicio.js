// Início: resumo do dia, status dos números e atalhos
const store = require('../db');
const wa = require('../whatsapp');
const dispatch = require('../dispatch');
const { esc, when, stateLabel, pill } = require('./ui');

const { db } = store;

module.exports = (r) => {
  r.get('/', async (ctx) => {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const sentToday = db.prepare(`SELECT COUNT(*) n FROM queue WHERE status='sent' AND sent_at>=?`).get(day.getTime()).n;
    const failToday = db.prepare(`SELECT COUNT(*) n FROM history WHERE status='failed' AND at>=?`).get(day.getTime()).n;
    const pending = db.prepare(`SELECT COUNT(*) n FROM queue WHERE status='pending'`).get().n;
    const autos = store.listAutomations();
    const instances = dispatch.listInstances();
    const states = await Promise.all(instances.map((i) => wa.state(i.name)));
    const dests = db.prepare('SELECT COUNT(*) n FROM destinations WHERE active=1').get().n;
    const paused = store.get('paused') === '1';
    const hasShopee = !!(store.get('shopee_app_id') || process.env.SHOPEE_APP_ID);
    const steps = [
      [hasShopee, '<a href="/credenciais">Colocar as chaves da Shopee</a>'],
      [states.includes('open'), '<a href="/instancias">Conectar um número de WhatsApp</a>'],
      [dests > 0, '<a href="/grupos">Cadastrar os grupos de destino</a>'],
      [autos.some((a) => a.active), '<a href="/automacoes">Criar e ativar uma automação</a>'],
    ];
    const logs = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 30').all();
    const qCount = (id) => db.prepare(`SELECT COUNT(*) n FROM queue WHERE automation_id=? AND status='pending'`).get(id).n;
    ctx.page('Início', '/', `
      <h1>Início</h1>
      ${steps.every((s) => s[0]) ? '' : `<div class="help"><b>Configuração inicial (${steps.filter((s) => s[0]).length} de ${steps.length})</b>
        <ol style="margin:6px 0 0">${steps.map(([ok, l]) => `<li>${ok ? '✅ ' : ''}${l}</li>`).join('')}</ol></div>`}
      <div class="card"><div class="stats">
        <div class="stat"><small>Enviadas hoje</small><b>${sentToday}</b></div>
        <div class="stat"><small>Na fila</small><b>${pending}</b></div>
        <div class="stat"><small>Automações ativas</small><b>${autos.filter((a) => a.active).length} / ${autos.length}</b></div>
        <div class="stat"><small>Falhas hoje</small><b class="${failToday ? 'bad' : ''}">${failToday}</b></div>
        <div class="stat"><small>Grupos de destino</small><b>${dests}</b></div>
      </div>
      <p class="row" style="margin-top:12px">
        <form method="post" action="/acao/pausar-tudo"><button class="${paused ? '' : 'sec'}">${paused ? '▶️ Retomar todos os envios' : '⏸️ Pausar todos os envios'}</button></form>
        <a class="btn sec" href="/envio-direto">Envio direto</a><a class="btn sec" href="/envio-manual">Envio manual</a>
        <a class="btn sec" href="/automacoes/nova">Nova automação</a>
      </p>${paused ? '<p class="warn"><b>Todos os envios estão pausados.</b> As automações continuam guardando ofertas na fila.</p>' : ''}</div>
      <div class="card"><h2>WhatsApp</h2>
        ${instances.map((i, k) => `<div class="row" style="justify-content:space-between;border-top:1px solid #eee;padding:8px 0">
          <span><b>${esc(i.label || i.name)}</b> <small>(${esc(i.name)})</small></span><span>${stateLabel(states[k])}</span></div>`).join('') || '<p class="muted">Nenhum número cadastrado.</p>'}
        <a class="btn small sec" href="/instancias">Gerenciar números</a></div>
      <div class="card"><h2>Automações</h2>
        ${autos.map((a) => `<div class="row" style="justify-content:space-between;border-top:1px solid #eee;padding:8px 0">
          <span><a href="/automacoes/${a.id}"><b>${esc(a.name)}</b></a> <small>${esc(store.AUTOMATION_TYPES[a.type] || a.type)}</small></span>
          <span>${pill(a.active)} <small>fila: ${qCount(a.id)} · último envio: ${when(a.last_send)}</small></span></div>`).join('') || '<p class="muted">Nenhuma automação ainda.</p>'}
      </div>
      <div class="card"><h2>Últimos acontecimentos</h2>
        <pre>${logs.map((l) => `${when(l.at)}  ${l.level === 'erro' ? '❗' : '•'} ${esc(l.msg)}`).join('\n') || 'Nada ainda.'}</pre></div>`, { refresh: 60 });
  });

  r.post('/acao/pausar-tudo', (ctx) => {
    const paused = store.get('paused') === '1';
    store.set('paused', paused ? '0' : '1');
    ctx.back('/', paused ? 'Envios retomados.' : 'Todos os envios pausados.');
  });
};
