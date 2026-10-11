import { LIMITS } from '../shared/parsers.js';

function loadBitmap(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file).catch(() => loadImg(file));
  }
  return loadImg(file);
}

function loadImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the image.'))), 'image/jpeg', quality);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the image.'));
    r.readAsDataURL(blob);
  });
}

// Shrinks to max 1600 px (never enlarges) and re-encodes as JPEG q0.8, lowering quality if it is still too big.
export async function prepareImage(file, maxSide = 1600) {
  if (!/^image\//.test(file.type || '')) throw new Error('Choose an image file (JPG, PNG or WEBP).');
  const bmp = await loadBitmap(file);
  const w0 = bmp.width;
  const h0 = bmp.height;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // flatten transparency (PNG) onto white
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  let blob = null;
  for (const q of [0.8, 0.7, 0.6, 0.5]) {
    blob = await toBlob(canvas, q);
    if (blob.size <= LIMITS.MAX_IMAGE_BYTES) break;
  }
  if (blob.size > LIMITS.MAX_IMAGE_BYTES) throw new Error('The image is too large even after shrinking it.');
  return { base64: await blobToBase64(blob), bytes: blob.size, width: w, height: h, previewUrl: URL.createObjectURL(blob) };
}
