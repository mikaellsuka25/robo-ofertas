// Cliente da Open API de Afiliados da Shopee (oficial)
// Assinatura: SHA256(AppId + Timestamp + corpo JSON exato + Secret)
const crypto = require('node:crypto');

const ENDPOINT = process.env.SHOPEE_ENDPOINT || 'https://open-api.affiliate.shopee.com.br/graphql';

function credentials() {
  const store = require('./db');
  const appId = (store.get('shopee_app_id') || process.env.SHOPEE_APP_ID || '').trim();
  const secret = (store.get('shopee_secret') || process.env.SHOPEE_SECRET || '').trim();
  if (!appId || !secret) throw new Error('Falta o App ID e a Secret da Shopee (Credenciais).');
  return { appId, secret };
}

function signHeader(appId, secret, body, ts = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHash('sha256').update(appId + ts + body + secret).digest('hex');
  return `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${signature}`;
}

async function gql(query, variables = {}) {
  const { appId, secret } = credentials();
  const body = JSON.stringify({ query, variables });
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: signHeader(appId, secret, body) },
        body,
        signal: AbortSignal.timeout(20000),
      });
      const json = await res.json().catch(() => ({}));
      if (json.errors && json.errors.length) {
        const e = json.errors[0];
        const msg = (e.extensions && e.extensions.message) || e.message || 'erro desconhecido';
        const err = new Error(`Shopee: ${msg}`);
        err.fatal = /signature|credential|invalid|auth|permission/i.test(msg);
        throw err;
      }
      if (!res.ok) throw new Error(`Shopee HTTP ${res.status}`);
      return json.data;
    } catch (err) {
      lastErr = err;
      if (err.fatal) break; // credencial errada: não adianta repetir
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

const OFFER_FIELDS = `itemId shopId productName imageUrl priceMin priceMax priceDiscountRate
  ratingStar sales commissionRate productLink offerLink shopName`;

// sortType: 1 relevância, 2 mais vendidos, 3 maior preço, 4 menor preço, 5 maior comissão
async function searchOffers({ keyword, sortType = 2, page = 1, limit = 50 }) {
  const query = `query($keyword:String,$sortType:Int,$page:Int,$limit:Int){
    productOfferV2(keyword:$keyword, sortType:$sortType, page:$page, limit:$limit){
      nodes{ ${OFFER_FIELDS} } pageInfo{ page limit hasNextPage }
    }}`;
  const data = await gql(query, { keyword: keyword || undefined, sortType, page, limit });
  return (data && data.productOfferV2 && data.productOfferV2.nodes) || [];
}

// Um produto específico (para links colados por você ou por outros afiliados)
async function productById(shopId, itemId) {
  const s = String(shopId).replace(/\D/g, ''), i = String(itemId).replace(/\D/g, '');
  if (!s || !i) return null;
  const query = `query{ productOfferV2(shopId:${s}, itemId:${i}, page:1, limit:1){ nodes{ ${OFFER_FIELDS} } } }`;
  const data = await gql(query);
  const nodes = (data && data.productOfferV2 && data.productOfferV2.nodes) || [];
  return nodes[0] || null;
}

// Transforma qualquer link da Shopee em link de afiliado curto
async function shortLink(originUrl, subIds) {
  const store = require('./db');
  const ids = (subIds && subIds.length ? subIds : [store.get('shopee_subid') || 'robo'])
    .map((s) => String(s).replace(/[^A-Za-z0-9]/g, '').slice(0, 50)).filter(Boolean);
  const query = `mutation($url:String!,$subIds:[String]){
    generateShortLink(input:{originUrl:$url, subIds:$subIds}){ shortLink } }`;
  const data = await gql(query, { url: originUrl, subIds: ids });
  return data.generateShortLink.shortLink;
}

// ---------- Links ----------
const SHOPEE_URL_RE = /https?:\/\/(?:[\w-]+\.)*(?:shopee\.com\.br|shp\.ee|shope\.ee)\/[^\s<>"'*~)\]]*/gi;

function findLinks(text) {
  return [...new Set((String(text || '').match(SHOPEE_URL_RE) || []).map((u) => u.replace(/[.,;!?]+$/, '')))];
}

function idsFromUrl(url) {
  let u = String(url || '');
  try { u = decodeURIComponent(u); } catch {}
  const pats = [/-i\.(\d+)\.(\d+)/, /\/product\/(\d+)\/(\d+)/, /\/opaanlp\/(\d+)\/(\d+)/, /[?&]shopid=(\d+).*?[?&]itemid=(\d+)/i];
  for (const p of pats) { const m = u.match(p); if (m) return { shopId: m[1], itemId: m[2] }; }
  const m = u.match(/[?&]itemid=(\d+).*?[?&]shopid=(\d+)/i);
  if (m) return { shopId: m[2], itemId: m[1] };
  return null;
}

// Segue redirecionamentos de links curtos (s.shopee.com.br, shp.ee) até achar o produto
async function resolveLink(url) {
  let current = url;
  for (let i = 0; i < 6; i++) {
    const ids = idsFromUrl(current);
    if (ids) return { ...ids, url: current };
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' },
      });
    } catch { return { url: current }; }
    const loc = res.headers.get('location');
    if (loc) { current = new URL(loc, current).toString(); continue; }
    // alguns links curtos redirecionam por HTML/JS
    const html = await res.text().catch(() => '');
    const m = html.match(/https?:\/\/shopee\.com\.br\/[^"'\s<>]+/);
    if (m && m[0] !== current) { current = m[0].replace(/\\u002F/g, '/'); continue; }
    break;
  }
  return { ...(idsFromUrl(current) || {}), url: current };
}

// Converte o formato da Shopee para o formato do robô
function normalize(node) {
  const price = Number(node.priceMin) || 0;
  const discount = Math.round(Number(node.priceDiscountRate) || 0);
  // A API não devolve o "preço de antes"; estimamos pelo desconto
  const oldPrice = discount > 0 && discount < 100 ? Math.round((price / (1 - discount / 100)) * 100) / 100 : null;
  return {
    store: 'shopee',
    item_key: `${node.shopId}.${node.itemId}`,
    title: node.productName,
    price,
    old_price: oldPrice,
    discount,
    commission: (Number(node.commissionRate) || 0) * 100, // vem como 0.12 = 12%
    rating: Number(node.ratingStar) || 0,
    sales: Number(node.sales) || 0,
    image_url: node.imageUrl,
    link: node.offerLink || node.productLink,
    origin_url: node.productLink,
    shop_name: node.shopName || '',
  };
}

module.exports = { searchOffers, productById, shortLink, normalize, signHeader, gql, findLinks, idsFromUrl, resolveLink, SHOPEE_URL_RE };
