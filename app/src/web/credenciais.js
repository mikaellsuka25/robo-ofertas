// Credenciais: Shopee, IA e endereço público
const store = require('../db');
const shopee = require('../shopee');
const ai = require('../ai');
const { esc, field, select } = require('./ui');

module.exports = (r) => {
  r.get('/credenciais', (ctx) => {
    const s = store.all();
    const hasSecret = !!(s.shopee_secret || process.env.SHOPEE_SECRET);
    ctx.page('Credenciais', '/credenciais', `<h1>Credenciais</h1>
      <form method="post"><div class="card"><h2>Shopee <span class="pill ${s.shopee_app_id && hasSecret ? 'on' : 'off'}">${s.shopee_app_id && hasSecret ? 'ativa' : 'inativa'}</span></h2>
        <p class="muted">Em <b>affiliate.shopee.com.br</b> → menu <b>Open API</b>, copie o App ID e a Secret.</p>
        <div class="grid">
          ${field('shopee_app_id', 'App ID', s.shopee_app_id || process.env.SHOPEE_APP_ID || '', { attrs: 'inputmode="numeric"' })}
          <div><label>Secret</label><input name="shopee_secret" type="password" placeholder="${hasSecret ? '•••••• (já salva; em branco mantém)' : 'cole aqui'}"></div>
          ${field('shopee_subid', 'Sub ID padrão', s.shopee_subid, { hint: 'aparece nos relatórios da Shopee. Cada origem também marca o seu: busca, direto, monitor, clone…' })}
        </div><p class="row"><button name="testar" value="shopee" class="sec">Salvar e testar</button></p></div>
      <div class="card"><h2>IA para as chamadas <span class="pill ${s.ai_key ? 'on' : 'off'}">${s.ai_key ? 'ativa' : 'sem chave'}</span></h2>
        <p class="muted">Opcional. Com uma chave da API do Claude (console.anthropic.com), cada produto ganha uma chamada escrita sob medida em {cta_ia}. Sem chave, o robô usa o banco de frases prontas.</p>
        <div class="grid"><div><label>Chave da API</label><input name="ai_key" type="password" placeholder="${s.ai_key ? '•••••• (já salva; em branco mantém)' : 'sk-ant-...'}"></div>
        ${select('ai_model', 'Modelo', s.ai_model, [['claude-haiku-5-5', 'Claude Haiku 5.5 (rápido e barato)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5']])}</div>
        <p class="row"><button name="testar" value="ia" class="sec">Salvar e testar</button>${s.ai_key ? '<button name="apagar_ia" value="1" class="danger" onclick="return confirm(\'Apagar a chave da IA?\')">Apagar chave</button>' : ''}</p></div>
      <div class="card"><h2>Endereço público</h2>
        <p class="muted">Usado nos links da Vitrine, do Gerador e do Rotador. Num servidor, é algo como <code>http://123.45.67.89</code> ou o seu domínio. No computador de casa, deixe vazio.</p>
        ${field('public_url', 'Endereço', s.public_url, { attrs: 'placeholder="http://123.45.67.89"' })}</div>
      <p><button>Salvar tudo</button></p></form>`);
  });

  r.post('/credenciais', async (ctx) => {
    const f = ctx.form;
    if (f.shopee_app_id !== undefined) store.set('shopee_app_id', String(f.shopee_app_id).trim());
    if (f.shopee_secret) store.set('shopee_secret', String(f.shopee_secret).trim());
    if (f.shopee_subid !== undefined) store.set('shopee_subid', String(f.shopee_subid).replace(/[^A-Za-z0-9]/g, '').slice(0, 50) || 'robo');
    if (f.ai_key) store.set('ai_key', String(f.ai_key).trim());
    if (f.apagar_ia) store.set('ai_key', '');
    if (['claude-haiku-5-5', 'claude-sonnet-5-5'].includes(f.ai_model)) store.set('ai_model', f.ai_model);
    if (f.public_url !== undefined) {
      const u = String(f.public_url).trim().replace(/\/$/, '');
      if (u && !/^https?:\/\/[^\s]+$/.test(u)) return ctx.back('/credenciais', 'O endereço público precisa começar com http:// ou https://', true);
      store.set('public_url', u);
    }
    if (f.testar === 'shopee') {
      try {
        const nodes = await shopee.searchOffers({ keyword: 'fone', limit: 5 });
        return ctx.back('/credenciais', `✅ Shopee conectada! O teste trouxe ${nodes.length} produtos.`);
      } catch (e) { return ctx.back('/credenciais', `❌ A Shopee recusou: ${e.message}. Confira o App ID e a Secret.`, true); }
    }
    if (f.testar === 'ia') {
      try {
        const t = await ai.askClaude('Responda só com a palavra: ok', 10);
        return ctx.back('/credenciais', t ? '✅ IA conectada.' : 'Sem chave de IA salva.', !t);
      } catch (e) { return ctx.back('/credenciais', `❌ ${e.message}`, true); }
    }
    ctx.back('/credenciais', 'Salvo.');
  });
};
