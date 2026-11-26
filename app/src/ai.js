// Chamada (CTA) escrita por IA — opcional. Sem chave de IA, usa o banco de frases (chamadas.js).
const store = require('./db');
const { chamada } = require('./chamadas');
const { family } = require('./text');

const API = () => (process.env.ANTHROPIC_API || 'https://api.anthropic.com').replace(/\/$/, '');

async function askClaude(prompt, maxTokens = 80) {
  const key = (store.get('ai_key') || '').trim();
  if (!key) return null;
  const res = await fetch(`${API()}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: store.get('ai_model') || 'claude-haiku-5-5', max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`IA: ${(json.error && json.error.message) || res.status}`);
  const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  return text || null;
}

function clean(line) {
  return String(line || '').split('\n')[0].replace(/^["'“”*\s-]+|["'“”*\s]+$/g, '').replace(/[*_~]/g, '').trim().slice(0, 120);
}

// Devolve a chamada em "Frase normal" (o modelo coloca em MAIÚSCULAS quando pede {cta_ia})
async function cta(product) {
  if (product.cta_ai) return product.cta_ai;
  let text = null;
  try {
    text = await askClaude(
      `Você escreve a chamada (CTA) de uma oferta para um grupo de WhatsApp de promoções.\n` +
      `Orientações do dono do grupo: ${store.get('cta_guide')}\n\n` +
      `Produto: ${product.title}\nPreço: R$ ${product.price}${product.discount ? ` (${product.discount}% de desconto)` : ''}\n\n` +
      `Responda só com a frase, em português do Brasil, sem aspas e sem emojis.`);
  } catch (err) {
    store.log('erro', err.message);
  }
  text = clean(text);
  if (!text) return chamada(family(product), product.item_key || product.title, false); // banco de frases (não guarda)
  if (product.id) store.db.prepare('UPDATE products SET cta_ai=? WHERE id=?').run(text, product.id);
  product.cta_ai = text;
  return text;
}

const upper = (s) => String(s || '').toLocaleUpperCase('pt-BR');
const sentence = (s) => { const t = String(s || '').toLocaleLowerCase('pt-BR'); return t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1); };

module.exports = { cta, askClaude, upper, sentence };
