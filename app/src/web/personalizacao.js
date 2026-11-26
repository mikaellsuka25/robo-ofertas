// Personalização: textos (modelos), cupons e tags
const store = require('../db');
const render = require('../render');
const engine = require('../automations');
const { esc, brl, when, field, area, select, check } = require('./ui');

const { db } = store;

const SAMPLE = {
  id: 0, store: 'shopee', item_key: 'exemplo', title: 'Lixeira Inox 5 Litros Cesto Com Pedal E Balde Removível',
  price: 49.99, old_price: 71.41, discount: 30, rating: 4.8, sales: 5321, commission: 12,
  link: 'https://s.shopee.com.br/1W126AXO0v', cta_ai: 'Até o lixo ganha um cantinho discreto e organizado na casa',
};

const VARS = [
  ['{nome}', 'Nome do produto'], ['{preco_original}', 'Preço "De" (use com ~riscado~)'], ['{preco_atual}', 'Preço atual (já com cupom, se houver)'],
  ['{desconto}', '% de desconto'], ['{link}', 'Seu link de afiliado'], ['{link_site}', 'Link da sua Vitrine (sem Vitrine, vira {link})'],
  ['{loja}', 'Nome da loja'], ['{cta}', 'Chamada capturada do grupo monitorado'], ['{cta_ia}', 'Chamada gerada (MAIÚSCULAS)'],
  ['{cta_ia_m}', 'Chamada gerada (normal)'], ['{cupom_codigo}', 'Código do cupom'], ['{cupom_link}', 'Link do cupom'],
  ['{cupom_texto}', 'Frase do cupom (configurável abaixo)'], ['{preco_com_cupom}', 'Preço com o cupom'], ['{economia_cupom}', 'Quanto o cupom economiza'],
  ['{nota}', 'Nota do produto'], ['{vendas}', 'Quantidade vendida'], ['{comissao}', 'Sua comissão (%)'], ['{texto}', 'Frase da tag #texto'],
];

module.exports = (r) => {
  // ---------- Textos ----------
  r.get('/textos', async (ctx) => {
    const list = db.prepare('SELECT * FROM templates ORDER BY id').all();
    const editId = Number(ctx.url.searchParams.get('editar')) || 0;
    const edit = editId ? list.find((t) => t.id === editId) : null;
    const s = store.all();
    const previews = await Promise.all(list.map((t) => render.renderProduct(SAMPLE, { template: t.body }).then((x) => x.text).catch((e) => e.message)));
    ctx.page('Textos', '/textos', `<h1>Textos personalizados</h1>
      <div class="help">Um texto só é usado se estiver marcado na automação (ou escolhido no envio). Sem nenhum marcado, sai o primeiro texto da lista.
      Se uma variável estiver vazia, a <b>linha inteira some</b>. Trechos entre colchetes, como <code>[De ~R$ {preco_original}~ |]</code>, somem sozinhos.</div>
      <div class="card"><h2>${edit ? 'Editar texto' : 'Novo texto'}</h2>
        <form method="post" action="/textos${edit ? `/${edit.id}` : ''}"><div class="grid">
          ${field('name', 'Nome', edit ? edit.name : '', { attrs: 'required' })}
          ${select('store', 'Aplicar a', edit ? edit.store : 'shopee', [['shopee', 'Shopee'], ['any', 'Qualquer loja']])}</div>
          ${area('body', 'Texto', edit ? edit.body : store.DEFAULT_TEMPLATE, { rows: 10, hint: 'Use *negrito*, _itálico_ e ~riscado~. Variáveis com chave simples: {nome}, nunca {{nome}}.' })}
          <p class="row"><button>${edit ? 'Salvar' : 'Criar texto'}</button>${edit ? '<a class="btn sec" href="/textos">Cancelar</a>' : ''}</p></form>
        <details><summary>Variáveis disponíveis</summary><table>${VARS.map(([v, d]) => `<tr><td><code>${v}</code></td><td>${d}</td></tr>`).join('')}</table></details></div>
      ${list.map((t, k) => `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(t.name)} <small class="muted">(${t.store === 'any' ? 'qualquer loja' : 'Shopee'})</small></h2>
        <div class="row"><a class="btn small sec" href="/textos?editar=${t.id}">Editar</a>
        <form method="post" action="/textos/${t.id}/excluir" onsubmit="return confirm('Excluir este texto?')"><button class="small danger">Excluir</button></form></div></div>
        <p class="muted" style="margin:8px 0 4px">Como fica:</p><div class="wa">${esc(previews[k])}</div></div>`).join('')}
      <div class="card"><h2>Chamada (CTA)</h2>
        <form method="post" action="/textos/cta">
        ${area('cta_guide', 'Como a chamada deve ser escrita', s.cta_guide, { rows: 4, hint: 'Tom, público, bordões e o que evitar. Vale quando há uma chave de IA em Credenciais; sem chave, o robô usa o banco de frases prontas por tipo de produto.' })}
        ${field('coupon_phrase', 'Frase do cupom ({cupom_texto})', s.coupon_phrase, { hint: 'Use {codigo} e {valor}. Ex.: 🎟️ Use o cupom *{codigo}* e ganhe {valor} OFF', attrs: 'maxlength="300"' })}
        <p><button>Salvar</button></p></form></div>`);
  });
  const saveTpl = (ctx, id) => {
    const f = ctx.form;
    const body = String(f.body || '').replace(/\r/g, '').trim();
    if (!body) return ctx.back('/textos', 'O texto está vazio.', true);
    if (/\{\{\w+\}\}/.test(body)) return ctx.back('/textos', 'Use chave simples nas variáveis: {nome}, não {{nome}}.', true);
    const st = f.store === 'any' ? 'any' : 'shopee';
    if (id) db.prepare('UPDATE templates SET name=?, store=?, body=? WHERE id=?').run(String(f.name).slice(0, 80), st, body, id);
    else db.prepare('INSERT INTO templates(name,store,body,created_at) VALUES(?,?,?,?)').run(String(f.name).slice(0, 80), st, body, Date.now());
    ctx.back('/textos', 'Texto salvo.');
  };
  r.post('/textos', (ctx) => saveTpl(ctx, 0));
  r.post('/textos/cta', (ctx) => {
    store.set('cta_guide', String(ctx.form.cta_guide || '').slice(0, 1500));
    store.set('coupon_phrase', String(ctx.form.coupon_phrase || '').slice(0, 300));
    ctx.back('/textos', 'Salvo.');
  });
  r.post('/textos/:id', (ctx) => saveTpl(ctx, Number(ctx.params.id)));
  r.post('/textos/:id/excluir', (ctx) => {
    db.prepare('DELETE FROM templates WHERE id=?').run(Number(ctx.params.id));
    ctx.back('/textos', 'Texto excluído.');
  });

  // ---------- Cupons ----------
  r.get('/cupons', (ctx) => {
    const list = db.prepare('SELECT * FROM coupons ORDER BY active DESC, id DESC').all();
    ctx.page('Cupons', '/cupons', `<h1>Cupons de desconto</h1>
      <div class="help">Marque os cupons dentro de cada automação. Na hora do envio, o robô escolhe o de <b>maior desconto</b> que vale para o preço do produto e calcula <code>{preco_com_cupom}</code>.</div>
      <div class="card"><h2>Novo cupom</h2><form method="post" action="/cupons"><div class="grid">
        ${field('code', 'Código', '', { hint: 'ex.: SHOPEE10' })}
        ${field('link', 'Link do cupom (opcional)', '')}
        ${select('kind', 'Tipo', 'pct', [['pct', '% de desconto'], ['brl', 'R$ de desconto']])}
        ${field('value', 'Valor', '', { type: 'number', attrs: 'step="0.01" required' })}
        ${field('min_price', 'Compra mínima (R$)', '0', { type: 'number', attrs: 'step="0.01"' })}
        ${field('max_discount', 'Desconto máximo (R$)', '0', { type: 'number', attrs: 'step="0.01"', hint: 'para cupons de %; 0 = sem teto' })}
        ${field('expires', 'Vale até', '', { type: 'date' })}
      </div><p><button>Cadastrar</button></p></form></div>
      <div class="card"><table><tr><th>Cupom</th><th>Desconto</th><th>Validade</th><th></th></tr>
      ${list.map((c) => `<tr><td><b>${esc(c.code || '-')}</b>${c.link ? `<br><small>${esc(c.link)}</small>` : ''}</td>
        <td>${render.couponValueLabel(c)}${c.min_price ? `<br><small>mín. ${brl(c.min_price)}</small>` : ''}${c.max_discount ? `<br><small>até ${brl(c.max_discount)}</small>` : ''}</td>
        <td><small>${c.expires_at ? when(c.expires_at) : 'sem validade'}${c.expires_at && c.expires_at < Date.now() ? ' <span class="bad">(vencido)</span>' : ''}</small></td>
        <td><div class="row"><form method="post" action="/cupons/${c.id}/alternar"><button class="small sec">${c.active ? 'Desativar' : 'Ativar'}</button></form>
        <form method="post" action="/cupons/${c.id}/excluir" onsubmit="return confirm('Excluir?')"><button class="small danger">Excluir</button></form></div></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum cupom.</td></tr>'}</table></div>`);
  });
  r.post('/cupons', (ctx) => {
    const f = ctx.form;
    if (!f.code && !f.link) return ctx.back('/cupons', 'Informe o código ou o link do cupom.', true);
    const exp = f.expires ? new Date(`${f.expires}T23:59:59`).getTime() : null;
    db.prepare(`INSERT INTO coupons(store,code,link,kind,value,min_price,max_discount,expires_at,active,created_at) VALUES('shopee',?,?,?,?,?,?,?,1,?)`)
      .run(String(f.code || '').trim().toUpperCase(), String(f.link || '').trim(), f.kind === 'brl' ? 'brl' : 'pct', Number(f.value) || 0,
        Number(f.min_price) || 0, Number(f.max_discount) || 0, exp, Date.now());
    ctx.back('/cupons', 'Cupom cadastrado.');
  });
  r.post('/cupons/:id/alternar', (ctx) => { db.prepare('UPDATE coupons SET active=1-active WHERE id=?').run(Number(ctx.params.id)); ctx.back('/cupons', 'Salvo.'); });
  r.post('/cupons/:id/excluir', (ctx) => { db.prepare('DELETE FROM coupons WHERE id=?').run(Number(ctx.params.id)); ctx.back('/cupons', 'Excluído.'); });

  // ---------- Tags ----------
  const tagsPage = async (ctx, input = '') => {
    let result = '';
    if (input) {
      const t = engine.parseTags(input);
      const p = { ...SAMPLE };
      const out = await render.renderProduct(p, { price: t.price, old_price: t.old_price, coupon: t.coupon, extra_text: t.extra_text });
      result = `<div class="card"><h2>Resultado</h2><table>
        <tr><td>Preço atual</td><td>${t.price ? brl(t.price) : '<span class="muted">do produto</span>'}</td></tr>
        <tr><td>Preço "De"</td><td>${t.old_price ? brl(t.old_price) : '<span class="muted">do produto</span>'}</td></tr>
        <tr><td>Cupom</td><td>${t.coupon ? `${esc(t.coupon.code || t.coupon.link)} · ${render.couponValueLabel(t.coupon)}${t.coupon.min_price ? ` (mín. ${brl(t.coupon.min_price)})` : ''}` : '<span class="muted">nenhum (precisa de #cupom ou #cupomlink junto com #desconto)</span>'}</td></tr>
        <tr><td>Frase extra</td><td>${esc(t.extra_text || '-')}</td></tr></table>
        <p class="muted" style="margin:10px 0 4px">Com um produto de exemplo, fica assim:</p><div class="wa">${esc(out.text)}</div></div>`;
    }
    ctx.page('Tags', '/tags', `<h1>Tags de preço e cupom</h1>
      <div class="card"><p>No seu <b>grupo de origem</b>, escreva as tags em linhas próprias, junto do link. Elas somem da mensagem final.</p>
      <table><tr><td><code>#preco 89,90</code></td><td>troca o preço atual</td></tr>
      <tr><td><code>#precoa 199,90</code></td><td>troca o preço "De"</td></tr>
      <tr><td><code>#cupom CODIGO</code> ou <code>#cupomlink URL</code></td><td>com <code>#desconto 15%</code> (ou <code>R$ 20</code>) e, se quiser, <code>#limite 40</code> (compra mínima): ativa um cupom só nesta promoção</td></tr>
      <tr><td><code>#texto ...</code></td><td>frase complementar (vai em {texto} ou no fim da mensagem)</td></tr></table></div>
      <div class="card"><h2>Simulador</h2><form method="post" action="/tags">
        <textarea name="msg" rows="6" placeholder="https://s.shopee.com.br/xxxx&#10;#preco 39,90&#10;#cupom ACHADO10&#10;#desconto 10%&#10;#limite 30">${esc(input)}</textarea>
        <p><button>Testar</button></p></form></div>${result}`);
  };
  r.get('/tags', (ctx) => tagsPage(ctx));
  r.post('/tags', (ctx) => tagsPage(ctx, String(ctx.form.msg || '')));
};

module.exports.SAMPLE = SAMPLE;
