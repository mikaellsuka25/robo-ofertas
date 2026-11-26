// Monta o texto da promoção a partir de um modelo com variáveis (compatível com a Promium)
const store = require('./db');
const { brl } = require('./text');
const ai = require('./ai');

const { db } = store;

// ---------- Cupons ----------
function couponDiscount(c, price) {
  if (!c || !price) return 0;
  let d = c.kind === 'brl' ? Number(c.value) : price * Number(c.value) / 100;
  if (c.kind !== 'brl' && Number(c.max_discount) > 0) d = Math.min(d, Number(c.max_discount));
  return Math.max(0, Math.min(d, price));
}

// Escolhe o cupom de maior desconto que vale para a loja e o preço
function bestCoupon(ids, price, storeName = 'shopee') {
  if (!ids || !ids.length) return null;
  const now = Date.now();
  const rows = db.prepare(`SELECT * FROM coupons WHERE active=1 AND id IN (${ids.map(() => '?').join(',')})`).all(...ids.map(Number));
  const ok = rows.filter((c) => (c.store === 'any' || c.store === storeName) && (!c.expires_at || c.expires_at > now)
    && (!Number(c.min_price) || !price || price >= Number(c.min_price)));
  ok.sort((a, b) => couponDiscount(b, price) - couponDiscount(a, price));
  return ok[0] || null;
}

function couponValueLabel(c) {
  if (!c || !c.value) return '';
  return c.kind === 'brl' ? `R$ ${brl(c.value)}` : `${Number(c.value).toLocaleString('pt-BR')}%`;
}

// ---------- Modelos ----------
function pickTemplate(ids, storeName = 'shopee') {
  const all = ids && ids.length
    ? db.prepare(`SELECT * FROM templates WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids.map(Number))
    : [];
  return (all.find((t) => t.store === storeName) || all.find((t) => t.store === 'any') || all[0] || { body: store.get('default_template') }).body;
}

// Substitui as variáveis. Trechos [entre colchetes] somem se alguma variável deles estiver vazia;
// fora dos colchetes, a linha inteira some.
function fill(body, values) {
  const val = (k) => {
    const v = values[k];
    return v == null ? '' : String(v);
  };
  const VAR = /\{(\w+)\}/g;
  let out = String(body).replace(/\[([^\[\]\n]*\{\w+\}[^\[\]\n]*)\]/g, (_, inner) => {
    const keys = [...inner.matchAll(VAR)].map((m) => m[1]);
    return keys.every((k) => val(k) !== '') ? inner.replace(VAR, (__, k) => val(k)) : '';
  });
  out = out.split('\n').filter((line) => {
    const keys = [...line.matchAll(VAR)].map((m) => m[1]);
    return keys.every((k) => val(k) !== '');
  }).map((line) => line.replace(VAR, (_, k) => val(k)))
    .join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

// Calcula todas as variáveis de um produto
async function variables(p, opts = {}) {
  const price = opts.price != null ? opts.price : p.price;
  const oldPrice = opts.old_price != null ? opts.old_price : p.old_price;
  const coupon = opts.coupon || null;
  const cDisc = couponDiscount(coupon, price);
  const withCoupon = coupon && cDisc > 0 ? price - cDisc : null;
  const discount = oldPrice && (withCoupon || price) && oldPrice > (withCoupon || price)
    ? Math.round((1 - (withCoupon || price) / oldPrice) * 100) : (p.discount || 0);
  let ctaText = '';
  const needsAi = /\{(cta_ia|cta_ia_m|chamada)\}/.test(opts.template || '');
  if (needsAi) ctaText = opts.cta_ai || await ai.cta(p);
  const phrase = coupon && coupon.code
    ? String(store.get('coupon_phrase') || '').replace(/\{codigo\}/g, coupon.code).replace(/\{valor\}/g, couponValueLabel(coupon) || '')
    : '';
  const publicUrl = (store.get('public_url') || '').replace(/\/$/, '');
  return {
    nome: p.title || '', titulo: p.title || '',
    preco_original: oldPrice && oldPrice > price ? brl(oldPrice) : '',
    preco_antigo: oldPrice && oldPrice > price ? brl(oldPrice) : '',
    preco_atual: brl(withCoupon || price), preco: brl(withCoupon || price),
    preco_pix: '', preco_pix_s: '', parcelas: '', preco_programe_poupe: '', preco_unidade: '',
    desconto: discount > 0 ? String(discount) : '',
    link: opts.link || p.link || '',
    link_site: publicUrl && store.get('vitrine_enabled') === '1' && p.id ? `${publicUrl}/p/${p.id}` : (opts.link || p.link || ''),
    loja: 'Shopee',
    cta: opts.cta || p.cta || '',
    cta_ia: ctaText ? ai.upper(ctaText) : '', chamada: ctaText ? ai.upper(ctaText) : '',
    cta_ia_m: ctaText ? ai.sentence(ctaText) : '',
    cupom_codigo: coupon && coupon.code ? coupon.code : '',
    cupom_link: coupon && coupon.link ? coupon.link : '',
    cupom_texto: phrase,
    preco_com_cupom: withCoupon ? brl(withCoupon) : '',
    economia_cupom: cDisc ? brl(cDisc) : '',
    nota: p.rating ? Number(p.rating).toFixed(1) : '',
    vendas: p.sales ? Number(p.sales).toLocaleString('pt-BR') : '',
    comissao: p.commission ? Number(p.commission).toFixed(0) : '',
    texto: opts.extra_text || '',
  };
}

// Mensagem final de um produto
async function renderProduct(p, { templateIds, template, couponIds, coupon, ...opts } = {}) {
  const body = template || pickTemplate(templateIds, p.store || 'shopee');
  const price = opts.price != null ? opts.price : p.price;
  const c = coupon || bestCoupon(couponIds, price, p.store || 'shopee');
  const vars = await variables(p, { ...opts, coupon: c, template: body });
  let text = fill(body, vars);
  if (opts.extra_text && !/\{texto\}/.test(body)) text = `${text}\n\n${opts.extra_text}`.trim();
  return { text, coupon: c, vars };
}

module.exports = { fill, variables, renderProduct, bestCoupon, couponDiscount, pickTemplate, couponValueLabel };
