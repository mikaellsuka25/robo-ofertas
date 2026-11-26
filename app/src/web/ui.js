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
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap');
:root{--bg:#f7f8fb;--card:#fff;--text:#182033;--muted:#667085;--muted2:#475467;--line:#e4e7ec;--wine:#7b1838;--wine-soft:#fbf3f6;--wine-line:#e4bfd0;--blue:#1f78e6;--blue-dark:#1665c7;--ok:#127a46;--warn:#a15c00;--bad:#c0262d}
*{box-sizing:border-box}
body{margin:0;font:14.5px/1.5 Poppins,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text)}
a{color:var(--wine)}
.wrap{display:flex;min-height:100vh}
aside{width:244px;flex:0 0 244px;background:#fff;border-right:1px solid var(--line);padding:18px 12px;position:sticky;top:0;height:100vh;overflow:auto}
aside .brand{font-weight:800;font-size:18px;letter-spacing:-.5px;padding:2px 10px 14px;display:flex;align-items:center;gap:8px}
aside .brand i{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--wine);color:#fff;font-style:normal;font-size:15px}
aside h4{font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;color:#98a2b3;margin:16px 10px 4px;font-weight:700}
aside a{display:block;color:var(--muted2);text-decoration:none;padding:7px 10px;border-radius:10px;font-size:13.5px;font-weight:500}
aside a:hover{background:#f2f4f7;color:var(--text)}
aside a.on{background:var(--wine-soft);color:var(--wine);font-weight:700;box-shadow:inset 0 0 0 1px var(--wine-line)}
.top{display:none}
main{flex:1;min-width:0;padding:26px 28px;max-width:1120px}
h1{font-size:28px;font-weight:900;letter-spacing:-1.2px;margin:0 0 18px;line-height:1.15}
h2{font-size:16.5px;font-weight:800;letter-spacing:-.3px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:16px;box-shadow:0 10px 30px rgba(16,24,40,.05)}
label{display:block;font-weight:600;margin:10px 0 5px;font-size:13px;color:var(--text)}
small,.muted{color:var(--muted);font-size:12.5px}
input,textarea,select{width:100%;padding:10px 12px;border:1px solid #d0d5dd;border-radius:11px;font:inherit;background:#fff;color:var(--text);transition:border-color .15s,box-shadow .15s}
input:focus,textarea:focus,select:focus{outline:0;border-color:var(--wine);box-shadow:0 0 0 3px rgba(123,24,56,.12)}
textarea{min-height:100px}
input[type=checkbox],input[type=radio]{width:18px;height:18px;vertical-align:middle;margin:0 6px 0 0;accent-color:var(--wine)}
input[type=color]{padding:3px;height:42px}
button,.btn{display:inline-block;padding:10px 16px;border:0;border-radius:11px;background:var(--blue);color:#fff;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap;box-shadow:0 8px 20px rgba(31,120,230,.22);transition:background .15s,transform .05s}
button:hover,.btn:hover{background:var(--blue-dark)}button:active,.btn:active{transform:translateY(1px)}
button.sec,.btn.sec{background:#fff;color:var(--text);box-shadow:none;border:1px solid #d0d5dd}button.sec:hover,.btn.sec:hover{background:#f9fafb}
button.danger,.btn.danger{background:#fff;color:var(--bad);border:1px solid #f4c7c9;box-shadow:none}button.danger:hover,.btn.danger:hover{background:#fef3f2}
button.small,.btn.small{padding:6px 10px;font-size:12.5px;border-radius:9px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0 14px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.stat{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 14px}.stat small{font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:10.5px}
.stat b{display:block;font-size:26px;font-weight:900;letter-spacing:-1px}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11.5px;font-weight:700;background:#f2f4f7;color:var(--muted2);text-transform:uppercase;letter-spacing:.04em}
.pill.on{background:var(--wine-soft);color:var(--wine);box-shadow:inset 0 0 0 1px var(--wine-line)}.pill.off{background:#f2f4f7;color:#7a8493}.pill.err{background:#fef3f2;color:var(--bad)}
table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;padding:9px 8px;border-top:1px solid #eef0f3;vertical-align:top}
th{font-size:11px;color:var(--muted);font-weight:700;border-top:0;text-transform:uppercase;letter-spacing:.06em}
.item{display:flex;gap:12px;border-top:1px solid #eef0f3;padding:12px 0}.item:first-child{border-top:0}
.item img{width:66px;height:66px;object-fit:cover;border-radius:12px;background:#f2f4f7;flex:0 0 66px;border:1px solid var(--line)}
.item .t{flex:1;min-width:0}
pre{white-space:pre-wrap;background:#f9fafb;border:1px solid #eef0f3;padding:12px;border-radius:12px;font-size:12.5px;max-height:340px;overflow:auto;margin:0}
.chk{display:flex;gap:6px;align-items:center;padding:7px 0;border-top:1px solid #f2f4f7;font-weight:500;margin:0}
.flash{background:#ecfdf3;border:1px solid #abefc6;color:#085d3a;padding:11px 14px;border-radius:12px;margin-bottom:16px;font-weight:500}
.flash.err{background:#fef3f2;border-color:#fecdca;color:#b42318}
.help{background:var(--wine-soft);border:1px solid var(--wine-line);border-radius:14px;padding:12px 14px;font-size:13.5px;margin-bottom:16px;color:#4a1022}
.wa{background:#e7ffdb;border-radius:12px;padding:12px;white-space:pre-wrap;font-size:14px;max-width:440px;box-shadow:0 1px 0 rgba(0,0,0,.08)}
details summary{cursor:pointer;font-weight:700}
code{background:#f2f4f7;border-radius:6px;padding:1px 5px;font-size:12.5px}
@media(max-width:820px){aside{display:none}.top{display:block;background:#fff;border-bottom:1px solid var(--line);padding:10px 12px;position:sticky;top:0;z-index:5}
 main{padding:16px 14px}h1{font-size:24px}}
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
<div class="wrap"><aside><div class="brand"><i>🤖</i>Robô de Ofertas</div>${nav}<h4>Conta</h4><a href="/sair">Sair</a></aside>
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
  open: ['✅ Conectado', 'ok'], connecting: ['⏳ Conectando…', 'warn'], close: ['❌ Desconectado', 'bad'],
  sem_instancia: ['❌ Desconectado', 'bad'], servico_indisponivel: ['⚠️ Serviço do WhatsApp iniciando…', 'warn'],
};
const stateLabel = (s) => { const [l, c] = STATE[s] || [s, 'warn']; return `<span class="${c}">${l}</span>`; };

// Mostra a formatação do WhatsApp (*negrito* ~riscado~ _itálico_) na prévia
const waHtml = (t) => require('../telegram').toHtml(t);

module.exports = { waHtml, esc, brl, when, layout, flash, field, area, select, check, pill, stateLabel, MENU };
