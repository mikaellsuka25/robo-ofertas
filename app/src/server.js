// Servidor web do painel (e das páginas públicas: vitrine, gerador, rotador)
const http = require('node:http');
const crypto = require('node:crypto');
const store = require('./db');
const ui = require('./web/ui');

const { log } = store;
const PASSWORD = () => process.env.PANEL_PASSWORD || '';
const TOKEN = () => crypto.createHmac('sha256', PASSWORD() || 'x').update('sessao-painel').digest('hex');
const WEBHOOK_TOKEN = () => crypto.createHmac('sha256', process.env.EVOLUTION_API_KEY || 'x').update('webhook').digest('hex').slice(0, 24);

let Busboy = null;
try { Busboy = require('busboy'); } catch {}

// ---------- Roteador ----------
const routes = [];
function add(method, pattern, handler, opts = {}) {
  const re = pattern instanceof RegExp ? pattern : new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ method, re, handler, public: !!opts.public });
}
const router = { get: (p, h, o) => add('GET', p, h, o), post: (p, h, o) => add('POST', p, h, o) };

// ---------- Corpo da requisição ----------
async function readBody(req) {
  const type = req.headers['content-type'] || '';
  if (/multipart\/form-data/.test(type) && Busboy) {
    return new Promise((resolve, reject) => {
      const fields = new URLSearchParams();
      const files = [];
      const bb = Busboy({ headers: req.headers, limits: { fileSize: 6 * 1024 * 1024, files: 3 } });
      bb.on('field', (name, val) => fields.append(name, val));
      bb.on('file', (name, stream, info) => {
        const chunks = []; let truncated = false;
        stream.on('data', (c) => chunks.push(c));
        stream.on('limit', () => { truncated = true; });
        stream.on('end', () => { if (info.filename) files.push({ field: name, filename: info.filename, mime: info.mimeType, buffer: Buffer.concat(chunks), truncated }); });
      });
      bb.on('close', () => resolve({ params: fields, files }));
      bb.on('error', reject);
      req.pipe(bb);
    });
  }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 5e6) break; }
  if (/json/.test(type)) { try { return { json: JSON.parse(body || '{}'), params: new URLSearchParams(), files: [] }; } catch { return { json: {}, params: new URLSearchParams(), files: [] }; } }
  return { params: new URLSearchParams(body), files: [] };
}

function formObject(params) {
  const obj = Object.fromEntries(params);
  Object.defineProperty(obj, 'getAll', { value: (k) => params.getAll(k) });
  return obj;
}

function authed(req) {
  const c = req.headers.cookie || '';
  return !!PASSWORD() && c.split(';').some((p) => p.trim() === `sessao=${TOKEN()}`);
}

function makeCtx(req, res, url) {
  return {
    req, res, url,
    send(html, status = 200, headers = {}) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers }); res.end(html); },
    json(obj, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); },
    redirect(to) { res.writeHead(303, { Location: to }); res.end(); },
    back(to, msg, isErr = false) {
      const sep = to.includes('?') ? '&' : '?';
      res.writeHead(303, { Location: `${to}${sep}${isErr ? 'err' : 'msg'}=${encodeURIComponent(msg)}` }); res.end();
    },
    page(title, active, body, opts) { this.send(ui.layout(title, active, ui.flash(url) + body, opts)); },
  };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const ctx = makeCtx(req, res, url);
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (p === '/saude') return ctx.send('ok');
  if (p === '/webhook/evolution' && req.method === 'POST') {
    if (url.searchParams.get('t') !== WEBHOOK_TOKEN()) return ctx.json({ ok: false }, 403);
    const body = await readBody(req);
    ctx.json({ ok: true });
    require('./automations').onWebhook(body.json || {}).catch((err) => log('erro', `Webhook: ${err.message}`));
    return;
  }
  if (p === '/entrar') {
    if (req.method === 'POST') {
      const { params } = await readBody(req);
      if (PASSWORD() && params.get('senha') === PASSWORD()) {
        return ctx.send('', 303, { Location: '/', 'Set-Cookie': `sessao=${TOKEN()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
      }
      await new Promise((r) => setTimeout(r, 1500));
      return ctx.back('/entrar', 'Senha errada.', true);
    }
    return ctx.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Entrar · Robô de Ofertas</title><style>body{font:16px system-ui;background:#f4f5f7;display:grid;place-items:center;min-height:100vh;margin:0}
      form{background:#fff;padding:24px;border-radius:14px;border:1px solid #e3e5e8;width:min(340px,92vw)}input,button{width:100%;padding:11px;border-radius:8px;font:inherit;margin-top:8px}
      input{border:1px solid #ccd0d5}button{background:#ee4d2d;color:#fff;border:0;font-weight:700}.e{color:#b3261e}</style></head><body>
      <form method="post"><h2 style="margin-top:0">🤖 Robô de Ofertas</h2>
      ${url.searchParams.get('err') ? `<p class="e">${ui.esc(url.searchParams.get('err'))}</p>` : ''}
      ${PASSWORD() ? '' : '<p class="e">Defina PANEL_PASSWORD no arquivo .env.</p>'}
      <label>Senha</label><input name="senha" type="password" required autofocus><button>Entrar</button></form></body></html>`);
  }
  if (p === '/sair') return ctx.send('', 303, { Location: '/entrar', 'Set-Cookie': 'sessao=; Path=/; Max-Age=0' });

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = p.match(r.re);
    if (!m) continue;
    if (!r.public && !authed(req)) return ctx.redirect('/entrar');
    ctx.params = m.groups || {};
    if (req.method === 'POST') {
      const body = await readBody(req);
      ctx.form = formObject(body.params);
      ctx.files = body.files || [];
      ctx.jsonBody = body.json;
    }
    return r.handler(ctx);
  }
  if (!authed(req)) return ctx.redirect('/entrar');
  return ctx.page('Não encontrado', '', '<div class="card"><h2>Página não encontrada</h2><a href="/">Voltar ao início</a></div>');
}

// Carrega as páginas
for (const mod of ['inicio', 'canais', 'envios', 'automacoes', 'personalizacao', 'crescimento', 'credenciais']) {
  require(`./web/${mod}`)(router);
}

function start(port = Number(process.env.PORT) || 3000) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log('erro', `Painel: ${err.stack || err.message}`);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ui.layout('Erro', '', `<div class="card"><h2>Deu erro</h2><pre>${ui.esc(err.message)}</pre><p><a href="javascript:history.back()">Voltar</a></p></div>`));
    });
  });
  server.listen(port, () => log('info', `Painel no ar na porta ${port}`));
  return server;
}

module.exports = { start, handle, WEBHOOK_TOKEN };
