export type Layout = 'vertical' | 'horizontal' | 'overlay' | 'echo';
export type Frame = { x: number; y: number; w: number; h: number };

export function exportSize(w: number, h: number, requested: number) {
  const factor = Math.min(requested, 8192 / Math.max(w, h), Math.sqrt(24_000_000 / (w * h)));
  return { factor, width: Math.round(w * factor), height: Math.round(h * factor), limited: factor < requested };
}

let noiseTile: HTMLCanvasElement | undefined;
export function textureTile() {
  if (noiseTile) return noiseTile;
  noiseTile = document.createElement('canvas');
  noiseTile.width = noiseTile.height = 192;
  const ctx = noiseTile.getContext('2d')!;
  const data = ctx.createImageData(192, 192);
  let seed = 3871;
  for (let i = 0; i < data.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = seed >>> 24;
    data.data[i + 3] = 28;
  }
  ctx.putImageData(data, 0, 0);
  return noiseTile;
}

export function recommendColors(image: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, 48, 48);
  const pixels = ctx.getImageData(0, 0, 48, 48).data;
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const item = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    item.count++; item.r += r; item.g += g; item.b += b;
    buckets.set(key, item);
  }
  const main = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  const r = main.r / main.count / 255, g = main.g / main.count / 255, b = main.b / main.count / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = delta === 0 ? 38 : max === r ? ((g - b) / delta) * 60 : max === g ? ((b - r) / delta + 2) * 60 : ((r - g) / delta + 4) * 60;
  hue = (hue + 360) % 360;
  const hex = (h: number, s: number, l: number) => {
    const a = s * Math.min(l, 1 - l);
    const channel = (n: number) => {
      const k = (n + h / 30) % 12;
      return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0');
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
  };
  return [hex(hue, .48, .57), hex((hue + 180) % 360, .75, .64), hex((hue + 30) % 360, .75, .70), hex((hue + 150) % 360, .72, .44), hex(hue, .25, .88)];
}

export function canvasBlob(canvas: HTMLCanvasElement, format: string, quality = .95) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('浏览器未能编码图片，请降低导出尺寸后重试。')), format, quality));
}

// Blur the complement of alpha, then clip back inside. Uses pixels instead of context.filter
// so WebKit/Safari without Canvas filters still get the same single inner edge.
export function innerShadow(mask: HTMLCanvasElement, strength: number, spread: number) {
  const canvas = document.createElement('canvas');
  canvas.width = mask.width; canvas.height = mask.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const source = mask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, mask.width, mask.height);
  const { width, height } = mask;
  const radius = Math.max(1, Math.min(160, Math.round(spread)));
  const span = radius * 2 + 1;
  const horizontal = new Uint8Array(width * height);
  const outside = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? 255 : 255 - source.data[(y * width + x) * 4 + 3];
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += outside(x, y);
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = Math.round(sum / span);
      sum += outside(x + radius + 1, y) - outside(x - radius, y);
    }
  }
  const output = ctx.createImageData(width, height);
  const sample = (x: number, y: number) => y < 0 || y >= height ? 255 : horizontal[y * width + x];
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += sample(x, y);
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      output.data[i] = 8; output.data[i + 1] = 7; output.data[i + 2] = 6;
      output.data[i + 3] = Math.round(sum / span * strength / 100 * source.data[i + 3] / 255);
      sum += sample(x, y + radius + 1) - sample(x, y - radius);
    }
  }
  ctx.putImageData(output, 0, 0);
  return canvas;
}

export function adjustedPhoto(image: CanvasImageSource, width: number, height: number, mono: boolean, saturation: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  const amount = mono ? 0 : 1 + saturation / 100;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const luma = .2126 * pixels.data[i] + .7152 * pixels.data[i + 1] + .0722 * pixels.data[i + 2];
    for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] = luma + (pixels.data[i + channel] - luma) * amount;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
