// Tratamento de imagem: recorte, fundo branco e marca d'água (usa a biblioteca sharp, se disponível)
const store = require('./db');

let sharp = null;
try { sharp = require('sharp'); } catch { /* sem sharp: as imagens saem originais */ }

const escXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

async function loadBuffer(image) {
  if (image.base64) return Buffer.from(image.base64.replace(/^data:[^,]+,/, ''), 'base64');
  const res = await fetch(image.url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`imagem HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function watermarkSvg(width, height) {
  const text = (store.get('watermark_text') || '').trim().slice(0, 30);
  if (!text) return null;
  const scale = { pequena: 0.035, media: 0.05, grande: 0.07 }[store.get('watermark_size')] || 0.05;
  const font = Math.max(14, Math.round(width * scale));
  const padX = Math.round(font * 0.8), padY = Math.round(font * 0.45);
  const w = Math.round(text.length * font * 0.6 + padX * 2), h = font + padY * 2;
  const margin = Math.round(width * 0.03);
  const corners = [[margin, margin], [width - w - margin, margin], [margin, height - h - margin], [width - w - margin, height - h - margin]];
  const [x, y] = corners[Math.floor(Math.random() * 4)];
  const op = Math.min(1, Math.max(0.1, Number(store.get('watermark_opacity') || 70) / 100));
  const color = /^#[0-9a-f]{3,8}$/i.test(store.get('watermark_color')) ? store.get('watermark_color') : '#7b1838';
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <g opacity="${op}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${color}"/>
    <text x="${x + w / 2}" y="${y + h / 2}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${font}" font-weight="700"
      fill="#fff" text-anchor="middle" dominant-baseline="central">${escXml(text)}</text></g></svg>`);
}

// style: padrao (recorte quadrado central) | enquadrada (quadrado com fundo branco) | original
async function prepare(image, style = 'padrao') {
  const wm = store.get('watermark_enabled') === '1' && (store.get('watermark_text') || '').trim();
  if (!sharp || (!wm && style === 'original') || !image) return image;
  try {
    const input = await loadBuffer(image);
    let pipe = sharp(input).rotate();
    const SIZE = 1000;
    if (style === 'padrao') pipe = pipe.resize(SIZE, SIZE, { fit: 'cover', position: 'centre' });
    else if (style === 'enquadrada') pipe = pipe.resize(SIZE, SIZE, { fit: 'contain', background: '#ffffff' });
    let buf = await pipe.flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
    if (wm) {
      const meta = await sharp(buf).metadata();
      const svg = watermarkSvg(meta.width, meta.height);
      if (svg) buf = await sharp(buf).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 88 }).toBuffer();
    }
    return { base64: buf.toString('base64'), mimetype: 'image/jpeg' };
  } catch (err) {
    store.log('erro', `Imagem: ${err.message} (enviando a original)`);
    return image;
  }
}

module.exports = { prepare, available: () => !!sharp };
