// Produtos: busca dados na Shopee, gera o link de afiliado e guarda no Feed
const store = require('./db');
const shopee = require('./shopee');

const { db } = store;

function upsert(p, source) {
  const now = Date.now();
  const existing = p.item_key ? db.prepare('SELECT id FROM products WHERE item_key=? ORDER BY id DESC LIMIT 1').get(p.item_key) : null;
  if (existing) {
    db.prepare(`UPDATE products SET title=COALESCE(?,title), price=COALESCE(?,price), old_price=?, discount=?, commission=COALESCE(?,commission),
      rating=COALESCE(?,rating), sales=COALESCE(?,sales), image_url=COALESCE(?,image_url), link=COALESCE(?,link),
      origin_url=COALESCE(?,origin_url), shop_name=COALESCE(?,shop_name), updated_at=? WHERE id=?`)
      .run(p.title || null, p.price || null, p.old_price || null, p.discount || 0, p.commission ?? null, p.rating ?? null,
        p.sales ?? null, p.image_url || null, p.link || null, p.origin_url || null, p.shop_name || null, now, existing.id);
    return getProduct(existing.id);
  }
  const r = db.prepare(`INSERT INTO products(store,item_key,title,price,old_price,discount,commission,rating,sales,image_url,link,
    origin_url,shop_name,source,cta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(p.store || 'shopee', p.item_key || null, p.title || null, p.price || null, p.old_price || null, p.discount || 0,
      p.commission || 0, p.rating || 0, p.sales || 0, p.image_url || null, p.link || null, p.origin_url || null,
      p.shop_name || null, source || p.source || 'manual', p.cta || null, now, now);
  return getProduct(Number(r.lastInsertRowid));
}

const getProduct = (id) => db.prepare('SELECT * FROM products WHERE id=?').get(id);

// Um link qualquer da Shopee → produto com link de afiliado
async function fromLink(url, { source = 'direto', subId } = {}) {
  const resolved = await shopee.resolveLink(url);
  let p = null;
  if (resolved.shopId && resolved.itemId) {
    try {
      const node = await shopee.productById(resolved.shopId, resolved.itemId);
      if (node) p = shopee.normalize(node);
    } catch (err) {
      if (err.fatal) throw err;
      store.log('erro', `Dados do produto: ${err.message}`);
    }
  }
  const canonical = (p && p.origin_url) || (resolved.shopId ? `https://shopee.com.br/product/${resolved.shopId}/${resolved.itemId}` : resolved.url || url);
  let link;
  try {
    link = await shopee.shortLink(canonical, subId ? [subId] : undefined);
  } catch (err) {
    if (p && p.link) link = p.link; // a oferta já vem com link de afiliado
    else throw new Error(`Não consegui converter o link para afiliado: ${err.message}`);
  }
  if (!p) {
    p = { store: 'shopee', item_key: resolved.shopId ? `${resolved.shopId}.${resolved.itemId}` : null, title: null, origin_url: canonical };
  }
  p.link = link;
  return upsert(p, source);
}

// Troca todos os links da Shopee de um texto pelos seus links de afiliado (Clone)
async function convertLinksInText(text, opts = {}) {
  const links = shopee.findLinks(text);
  let out = String(text || '');
  const products = [];
  for (const l of links) {
    const p = await fromLink(l, opts); // se falhar, o erro sobe e a mensagem não é enviada
    products.push(p);
    out = out.split(l).join(p.link);
  }
  return { text: out, products };
}

module.exports = { upsert, getProduct, fromLink, convertLinksInText };
