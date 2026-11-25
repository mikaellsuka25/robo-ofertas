// Cliente da Open API de Afiliados da Shopee (oficial)
// Assinatura: SHA256(AppId + Timestamp + corpo JSON exato + Secret)
const crypto = require('node:crypto');

const ENDPOINT = process.env.SHOPEE_ENDPOINT || 'https://open-api.affiliate.shopee.com.br/graphql';

function credentials() {
  const store = require('./db'); // as chaves podem ser salvas pelo painel
  const appId = (store.get('shopee_app_id') || process.env.SHOPEE_APP_ID || '').trim();
  const secret = (store.get('shopee_secret') || process.env.SHOPEE_SECRET || '').trim();
  if (!appId || !secret) throw new Error('Falta o App ID e a Secret da Shopee (painel → Configurações).');
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
        throw new Error(`Shopee: ${msg}`);
      }
      if (!res.ok) throw new Error(`Shopee HTTP ${res.status}`);
      return json.data;
    } catch (err) {
      lastErr = err;
      if (/assinatura|signature|credential|Invalid/i.test(err.message)) break; // não adianta repetir
      await new Promise((r) => setTimeout(r, 2000 * attempt));
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
  const data = await gql(query, { keyword, sortType, page, limit });
  return (data && data.productOfferV2 && data.productOfferV2.nodes) || [];
}

// Transforma qualquer link da Shopee em link de afiliado curto
async function shortLink(originUrl, subId = 'whatsapp') {
  const query = `mutation($url:String!,$subIds:[String]){
    generateShortLink(input:{originUrl:$url, subIds:$subIds}){ shortLink } }`;
  const data = await gql(query, { url: originUrl, subIds: [subId] });
  return data.generateShortLink.shortLink;
}

// Converte o formato da Shopee para o formato do robô
function normalize(node) {
  const price = Number(node.priceMin) || 0;
  const discount = Math.round(Number(node.priceDiscountRate) || 0);
  // A API não devolve o "preço de antes"; estimamos pelo desconto
  const oldPrice = discount > 0 && discount < 100 ? price / (1 - discount / 100) : null;
  return {
    source: 'shopee',
    item_key: String(node.itemId),
    title: node.productName,
    price,
    old_price: oldPrice,
    discount,
    commission: (Number(node.commissionRate) || 0) * 100, // vem como 0.12 = 12%
    rating: Number(node.ratingStar) || 0,
    sales: Number(node.sales) || 0,
    image_url: node.imageUrl,
    link: node.offerLink || node.productLink,
  };
}

module.exports = { searchOffers, shortLink, normalize, signHeader, gql };
