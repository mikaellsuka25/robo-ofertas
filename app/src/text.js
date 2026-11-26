// Utilidades de texto: semelhança entre produtos, filtros e formatação
const STOP = new Set(('de da do das dos e com para por em no na nos nas a o as os um uma kit jogo conjunto par ' +
  'pecas pcs pc unidades un und cm mm m ml l kg g x novo nova original promocao oferta frete gratis envio ' +
  'imediato pronta entrega lancamento premium luxo top super mega estilo tipo cor cores varias modelo mini grande pequeno').split(' '));

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function words(title) {
  return fold(title).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => w.replace(/(oes|aes)$/, 'ao').replace(/s$/, '')); // plural simples: cadeiras -> cadeira
}

// "Família" do produto = primeira palavra importante do título (cadeira, espelho, toalha...)
function family(o) {
  const w = words(o && o.title);
  return w[0] || (o && o.keyword ? words(o.keyword)[0] : null) || null;
}

// Quanto dois títulos se parecem (0 a 1)
function similarity(a, b) {
  const A = new Set(words(a).slice(0, 8)), B = new Set(words(b).slice(0, 8));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

function isDuplicate(o, existing) {
  return existing.some((e) =>
    (e.item_key && o.item_key && e.item_key === o.item_key) ||
    (e.image_url && o.image_url && e.image_url === o.image_url) ||
    (similarity(o.title, e.title) >= 0.6 &&
      (!e.price || !o.price || Math.abs(e.price - o.price) / Math.max(e.price, o.price) <= 0.35)));
}

// Lista separada por vírgula ou linha → palavras (sem acento, minúsculas)
const list = (s) => String(s || '').split(/[,\n]/).map((w) => fold(w).trim()).filter(Boolean);

// Filtros da automação. Devolve null (passou) ou o motivo do bloqueio.
function checkFilters(f, { text = '', price = 0, discount = 0 }) {
  if (!f) return null;
  const t = fold(text);
  const block = list(f.block).find((w) => t.includes(w));
  if (block) return `bloqueado pela palavra "${block}"`;
  const only = list(f.only);
  if (only.length && !only.some((w) => t.includes(w))) return 'não contém nenhuma palavra obrigatória';
  if (Number(f.price_min) > 0 && price && price < Number(f.price_min)) return `preço abaixo de R$ ${f.price_min}`;
  if (Number(f.price_max) > 0 && price && price > Number(f.price_max)) return `preço acima de R$ ${f.price_max}`;
  if (Number(f.min_discount) > 0 && discount < Number(f.min_discount)) return `desconto menor que ${f.min_discount}%`;
  return null;
}

// "de => para" por linha (vazio depois de => remove). Nunca mexe em links.
function applyReplacements(text, rules) {
  const pairs = String(rules || '').split('\n').map((l) => l.split('=>')).filter((p) => p.length === 2 && p[0].trim())
    .map(([a, b]) => [a.trim(), b.trim()]);
  if (!pairs.length) return text;
  return String(text).split(/(https?:\/\/\S+)/).map((part, i) => {
    if (i % 2) return part; // é um link
    for (const [a, b] of pairs) {
      const re = new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      part = part.replace(re, b);
    }
    return part;
  }).join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}

// Apaga as linhas que contêm algum destes termos (ex.: "curadoria", "@outroafiliado"). Nunca apaga linhas com link.
function removeLines(text, terms) {
  const list_ = String(terms || '').split(/[,\n]/).map((w) => fold(w).trim()).filter(Boolean);
  if (!list_.length) return text;
  return String(text).split('\n').filter((line) => /https?:\/\//.test(line) || !list_.some((w) => fold(line).includes(w)))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const brl = (n) => (n == null || !isFinite(n) || n === '' ? '' :
  Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// "R$ 1.234,56", "1234,56", "89.90" → 89.9
function parsePrice(s) {
  let t = String(s || '').replace(/[^\d.,]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : null;
}

module.exports = { removeLines, fold, words, family, similarity, isDuplicate, list, checkFilters, applyReplacements, brl, parsePrice };
