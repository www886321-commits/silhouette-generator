export const backgroundPresets = [
  { id: 'cloud-sea', name: '云海', file: 'cloud-sea.jpg', author: 'Taylor Van Riper', source: 'taylor-van-riper-yQorCngxzwI-unsplash.jpg' },
  { id: 'soft-sky', name: '柔蓝天空', file: 'soft-sky.jpg', author: 'Uriel', source: 'uriel-xtgONQzGgOE-unsplash.jpg' },
  { id: 'golden-sea', name: '金色海岸', file: 'golden-sea.jpg', author: 'Rafael Garcin', source: 'rafael-garcin-EFb-V85HuAA-unsplash.jpg' },
  { id: 'green-field', name: '晴空草地', file: 'green-field.jpg', author: 'Rodion Kutsaiev', source: 'rodion-kutsaiev-PEm_sLmJT-w-unsplash.jpg' },
  { id: 'pink-cloud', name: '粉云月色', file: 'pink-cloud.jpg', author: 'Szabo Viktor', source: 'szabo-viktor-28ZbKOWiZfs-unsplash.jpg' },
  { id: 'empty-grass', name: '整片草地', file: 'empty-grass.png', author: '用户提供', source: '空背景1-整片草地.png' },
  { id: 'school-hall', name: '教学楼大厅', file: 'school-hall.png', author: '用户提供', source: '空背景2-老教学楼大厅.png' },
  { id: 'concrete-coast', name: '海边混凝土岸', file: 'concrete-coast.png', author: '用户提供', source: '空背景3-海边混凝土岸.png' },
  { id: 'school-field', name: '操场草地天空', file: 'school-field.png', author: '用户提供', source: '空背景4-操场草地天空.png' },
] as const;

export function backgroundUrl(file: string, thumbnail = false) {
  const name = thumbnail ? file.replace(/\.(png|webp)$/i, '.jpg') : file;
  return new URL(`backgrounds/${thumbnail ? 'thumbs/' : ''}${name}`, document.baseURI).href;
}

export function loadBackgroundImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('背景图片加载失败，请重新选择或上传图片。'));
    image.src = url;
  });
}

type Color = { r: number; g: number; b: number; share: number };

export function imagePalette(image: CanvasImageSource): Color[] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, 48, 48);
  const bytes = context.getImageData(0, 0, 48, 48).data;
  const bins = new Map<number, { r: number; g: number; b: number; n: number }>();
  let total = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    if (bytes[i + 3] < 128) continue;
    const r = bytes[i], g = bytes[i + 1], b = bytes[i + 2];
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const bin = bins.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    bin.r += r; bin.g += g; bin.b += b; bin.n++; total++;
    bins.set(key, bin);
  }
  return [...bins.values()].sort((a, b) => b.n - a.n).slice(0, 12)
    .map(bin => ({ r: bin.r / bin.n, g: bin.g / bin.n, b: bin.b / bin.n, share: bin.n / Math.max(1, total) }));
}

function distance(a: Color, b: Color) {
  const mean = (a.r + b.r) / 2;
  return Math.sqrt((2 + mean / 256) * (a.r - b.r) ** 2 + 4 * (a.g - b.g) ** 2 + (2 + (255 - mean) / 256) * (a.b - b.b) ** 2);
}

export function paletteScore(a: Color[], b: Color[]) {
  if (!a.length || !b.length) return Infinity;
  const nearest = (source: Color[], target: Color[]) => source.reduce((sum, color) =>
    sum + color.share * Math.min(...target.map(other => distance(color, other))), 0)
    / source.reduce((sum, color) => sum + color.share, 0);
  return nearest(a, b) * .65 + nearest(b, a) * .35;
}

let presetPalettes: Promise<{ preset: typeof backgroundPresets[number]; palette: Color[] }[]> | undefined;
export async function recommendBackground(photo: CanvasImageSource) {
  presetPalettes ??= Promise.all(backgroundPresets.map(async preset => ({
    preset, palette: imagePalette(await loadBackgroundImage(backgroundUrl(preset.file, true))),
  }))).catch(error => { presetPalettes = undefined; throw error; });
  const palette = imagePalette(photo);
  return (await presetPalettes).map(candidate => ({ ...candidate, score: paletteScore(palette, candidate.palette) }))
    .sort((a, b) => a.score - b.score)[0].preset;
}

export function backgroundPreview(image: HTMLImageElement, limit = 1600) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
