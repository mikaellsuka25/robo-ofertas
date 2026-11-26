// Peças comuns do painel: layout, menu, formulários
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => (n == null || n === '' || !isFinite(n) ? '-' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const when = (ms) => (ms ? new Date(Number(ms)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-');

const MENU = [
  ['Painel', [['/', 'Início'], ['/feed', 'Feed de produtos']]],
  ['Canais', [['/instancias', 'Números (WhatsApp)'], ['/grupos', 'Grupos e categorias'], ['/modo-envio', 'Modo de envio'], ['/telegram', 'Telegram']]],
  ['Envios', [['/envio-direto', 'Envio direto'], ['/envio-manual', 'Envio manual'], ['/historico', 'Histórico']]],
  ['Automações', [['/automacoes', 'Minhas automações']]],
  ['Personalização', [['/textos', 'Textos e chamadas'], ['/cupons', 'Cupons'], ['/tags', 'Tags de preço e cupom']]],
  ['Crescimento', [['/vitrine', 'Vitrine'], ['/gerador', 'Gerador de links'], ['/rotador', 'Rotador de grupos']]],
  ['Configurações', [['/credenciais', 'Credenciais']]],
];

const CSS = `
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;color:#1d1f23}
a{color:#c2381c}
.wrap{display:flex;min-height:100vh}
aside{width:230px;flex:0 0 230px;background:#1d1f23;color:#ddd;padding:14px 10px;position:sticky;top:0;height:100vh;overflow:auto}
aside .brand{font-weight:800;color:#fff;font-size:17px;padding:4px 8px 12px}
aside h4{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a8f98;margin:14px 8px 4px}
aside a{display:block;color:#e7e8ea;text-decoration:none;padding:7px 10px;border-radius:8px;font-size:14px}
aside a.on,aside a:hover{background:#ee4d2d;color:#fff}
.top{display:none}
main{flex:1;min-width:0;padding:18px;max-width:1100px}
h1{font-size:21px;margin:0 0 14px}h2{font-size:16px;margin:0 0 10px}
.card{background:#fff;border:1px solid #e3e5e8;border-radius:12px;padding:14px;margin-bottom:14px}
label{display:block;font-weight:600;margin:10px 0 4px;font-size:13.5px}
small,.muted{color:#666;font-size:12.5px}
input,textarea,select{width:100%;padding:9px;border:1px solid #ccd0d5;border-radius:8px;font:inherit;background:#fff}
textarea{min-height:100px}
input[type=checkbox],input[type=radio]{width:18px;height:18px;vertical-align:middle;margin:0 6px 0 0}
button,.btn{display:inline-block;padding:9px 14px;border:0;border-radius:8px;background:#ee4d2d;color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}
button.sec,.btn.sec{background:#e9eaed;color:#1d1f23}button.danger,.btn.danger{background:#fbe3e0;color:#b3261e}
button.small,.btn.small{padding:5px 9px;font-size:12.5px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0 12px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.stat{background:#f7f8fa;border-radius:10px;padding:10px}.stat b{display:block;font-size:22px}
.ok{color:#137333}.warn{color:#b06000}.bad{color:#c5221f}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;background:#eef0f2}
.pill.on{background:#e6f4ea;color:#137333}.pill.off{background:#f1f1f1;color:#666}.pill.err{background:#fde7e7;color:#b3261e}
table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;padding:7px 6px;border-top:1px solid #eee;vertical-align:top}
th{font-size:12px;color:#666;font-weight:600;border-top:0}
.item{display:flex;gap:10px;border-top:1px solid #eee;padding:10px 0}.item:first-child{border-top:0}
.item img{width:64px;height:64px;object-fit:cover;border-radius:8px;background:#eee;flex:0 0 64px}
.item .t{flex:1;min-width:0}
pre{white-space:pre-wrap;background:#f7f8fa;padding:10px;border-radius:8px;font-size:13px;max-height:340px;overflow:auto;margin:0}
.chk{display:flex;gap:6px;align-items:center;padding:6px 0;border-top:1px solid #f0f0f0;font-weight:400;margin:0}
.flash{background:#e6f4ea;border:1px solid #b7dfc2;padding:10px;border-radius:8px;margin-bottom:14px}
.flash.err{background:#fde7e7;border-color:#f3b9b4}
.help{background:#fff8ec;border:1px solid #f3d9a8;border-radius:10px;padding:10px 12px;font-size:13.5px;margin-bottom:14px}
.wa{background:#e7ffdb;border-radius:8px;padding:10px;white-space:pre-wrap;font-size:14px;max-width:420px}
details summary{cursor:pointer;font-weight:600}
@media(max-width:820px){aside{display:none}.top{display:block;background:#1d1f23;padding:8px 10px;position:sticky;top:0;z-index:5}
 .top select{background:#2b2e33;color:#fff;border-color:#444}main{padding:12px}}
`;

function layout(title, active, body, { refresh } = {}) {
  const nav = MENU.map(([g, items]) => `<h4>${g}</h4>${items.map(([h, l]) =>
    `<a href="${h}" class="${h === active ? 'on' : ''}">${l}</a>`).join('')}`).join('');
  const options = MENU.map(([g, items]) => `<optgroup label="${g}">${items.map(([h, l]) =>
    `<option value="${h}" ${h === active ? 'selected' : ''}>${l}</option>`).join('')}</optgroup>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${esc(title)} · Robô de Ofertas</title><style>${CSS}</style></head><body>
<div class="top"><select onchange="location=this.value">${options}</select></div>
<div class="wrap"><aside><div class="brand">🤖 Robô de Ofertas</div>${nav}<h4>Conta</h4><a href="/sair">Sair</a></aside>
<main>${body}</main></div></body></html>`;
}

function flash(url) {
  const m = url.searchParams.get('msg'), e = url.searchParams.get('err');
  return (m ? `<div class="flash">${esc(m)}</div>` : '') + (e ? `<div class="flash err">${esc(e)}</div>` : '');
}

const field = (name, label, value, { type = 'text', hint = '', attrs = '' } = {}) =>
  `<div><label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</div>`;
const area = (name, label, value, { hint = '', rows = 5, attrs = '' } = {}) =>
  `<div><label>${label}</label><textarea name="${name}" rows="${rows}" ${attrs}>${esc(value)}</textarea>${hint ? `<small>${hint}</small>` : ''}</div>`;
const select = (name, label, value, options, { hint = '' } = {}) =>
  `<div><label>${label}</label><select name="${name}">${options.map(([v, l]) =>
    `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${hint ? `<small>${hint}</small>` : ''}</div>`;
const check = (name, label, on, { value = '1', hint = '' } = {}) =>
  `<label class="chk"><input type="checkbox" name="${name}" value="${esc(value)}" ${on ? 'checked' : ''}><span>${label}${hint ? ` <small>${hint}</small>` : ''}</span></label>`;

const pill = (on, yes = 'ativa', no = 'pausada') => `<span class="pill ${on ? 'on' : 'off'}">${on ? yes : no}</span>`;
const STATE = {
  open: ['✅ Conectado', 'ok'], connecting: ['⏳ Aguardando QR code', 'warn'], close: ['❌ Desconectado', 'bad'],
  sem_instancia: ['❌ Desconectado', 'bad'], servico_indisponivel: ['⚠️ Serviço do WhatsApp iniciando…', 'warn'],
};
const stateLabel = (s) => { const [l, c] = STATE[s] || [s, 'warn']; return `<span class="${c}">${l}</span>`; };

// Mostra a formatação do WhatsApp (*negrito* ~riscado~ _itálico_) na prévia
const waHtml = (t) => require('../telegram').toHtml(t);

module.exports = { waHtml, esc, brl, when, layout, flash, field, area, select, check, pill, stateLabel, MENU };
