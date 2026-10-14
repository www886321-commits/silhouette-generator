/** Non-destructive, object-local effects. Grid coordinates use source pixels,
 * so preview zoom, transforms and export scale never reseed or resize the grid. */
export type DotShape = 'dot' | 'square' | 'diamond' | 'ellipse' | 'line';
export type HalftoneSettings = {
  enabled: boolean; cellSize: number; shape: DotShape;
  angle: number; mix: number; sharpness: number;
  colorMode: 'photo' | 'solid'; solidColor: string; dotSize: number; density: number;
};
export type SilhouetteSettings = {
  style: 'clean' | 'pixel'; cellSize: number;
  textEnabled: boolean; text: string; textColor: string;
  density: number; fontSize: number; seed: number;
};
export const defaultHalftone: HalftoneSettings = {
  enabled: false, cellSize: 18, shape: 'dot', angle: 0, mix: 100, sharpness: 60,
  colorMode: 'photo', solidColor: '#FFFFFF', dotSize: 10, density: 65,
};
export const defaultSilhouette: SilhouetteSettings = {
  style: 'clean', cellSize: 24, textEnabled: false,
  text: 'PIXEL PATH — AFTERIMAGE', textColor: '#ffffff', density: 18, fontSize: 80, seed: 1,
};

function surface(source: HTMLCanvasElement, maxEdge: number, outputScale = 1) {
  const scale = Math.min(outputScale, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  return canvas;
}
function sampler(source: HTMLCanvasElement) {
  const canvas = surface(source, 1024), context = canvas.getContext('2d', {willReadFrequently: true})!;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const sx = canvas.width / source.width, sy = canvas.height / source.height;
  return (x: number, y: number, step: number, angle = 0) => {
    let alpha = 0, r = 0, g = 0, b = 0;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (const dy of [-.3, 0, .3]) for (const dx of [-.3, 0, .3]) {
      const px = Math.floor((x + (dx * cos - dy * sin) * step) * sx);
      const py = Math.floor((y + (dx * sin + dy * cos) * step) * sy);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
      const index = (py * canvas.width + px) * 4, a = data[index + 3] / 255;
      alpha += a; r += data[index] * a; g += data[index + 1] * a; b += data[index + 2] * a;
    }
    return {coverage: alpha / 9, r: alpha ? Math.round(r / alpha) : 0,
      g: alpha ? Math.round(g / alpha) : 0, b: alpha ? Math.round(b / alpha) : 0};
  };
}

export function halftoneSubject(source: HTMLCanvasElement, settings: HalftoneSettings, maxEdge = Infinity, outputScale = 1) {
  if (!settings.enabled || settings.mix === 0) return source;
  const canvas = surface(source, maxEdge, outputScale), context = canvas.getContext('2d')!;
  const dots = surface(source, maxEdge, outputScale), dotContext = dots.getContext('2d')!;
  const w = source.width, h = source.height;
  const solid = settings.colorMode === 'solid';
  const imageScale = Math.max(w, h) / 1000;
  // In solid mode spacing and diameter are independent source-space measurements.
  const step = (solid ? 1000 / Math.max(1, settings.density) : Math.max(1, settings.cellSize)) * imageScale;
  const angle = settings.angle * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const sample = sampler(source), span = Math.hypot(w, h) / 2 + step;
  dotContext.scale(dots.width / w, dots.height / h);
  dotContext.translate(w / 2, h / 2); dotContext.rotate(angle);
  for (let gy = Math.floor(-span / step); gy <= Math.ceil(span / step); gy++) {
    for (let gx = Math.floor(-span / step); gx <= Math.ceil(span / step); gx++) {
      const x = (gx + .5) * step, y = (gy + .5) * step;
      const nativeX = w / 2 + x * cos - y * sin, nativeY = h / 2 + x * sin + y * cos;
      if (nativeX < -step || nativeY < -step || nativeX > w + step || nativeY > h + step) continue;
      const color = sample(nativeX, nativeY, step, angle);
      if (color.coverage < .32) continue;
      const luminance = (color.r * .2126 + color.g * .7152 + color.b * .0722) / 255;
      const radius = solid ? Math.max(1, settings.dotSize) * imageScale / 2
        : step * (.47 - luminance * (.08 + settings.sharpness / 100 * .2));
      dotContext.fillStyle = solid ? settings.solidColor : `rgb(${color.r},${color.g},${color.b})`;
      dotContext.beginPath();
      if (settings.shape === 'square') dotContext.rect(x-radius, y-radius, radius*2, radius*2);
      else if (settings.shape === 'diamond') {
        dotContext.moveTo(x,y-radius);dotContext.lineTo(x+radius,y);dotContext.lineTo(x,y+radius);dotContext.lineTo(x-radius,y);dotContext.closePath();
      } else if (settings.shape === 'ellipse') dotContext.ellipse(x,y,radius,radius*.58,0,0,Math.PI*2);
      else if (settings.shape === 'line') dotContext.rect(x-step*.46,y-radius*.22,step*.92,radius*.44);
      else dotContext.arc(x,y,radius,0,Math.PI*2);
      dotContext.fill();
    }
  }
  if (settings.mix < 100) {
    context.globalAlpha = 1 - settings.mix / 100;
    context.drawImage(source,0,0,canvas.width,canvas.height);
  }
  context.globalAlpha = settings.mix / 100; context.drawImage(dots,0,0);
  context.globalAlpha = 1; dots.width = dots.height = 1;
  return canvas;
}

function randomCell(x: number, y: number, seed: number, salt = 0) {
  let n = Math.imul(x + 113, 374761393) ^ Math.imul(y + 271, 668265263) ^ Math.imul(seed + salt, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Font size is relative to the source image, not to a pixel-effect cell.
 * Keep these coordinates independent of preview resolution and export scale. */
export function scatterTextMetrics(width: number, height: number, settings: Pick<SilhouetteSettings, 'fontSize' | 'cellSize'>) {
  const imageScale = Math.max(width, height) / 1000;
  const fontSize = 24 * Math.max(1, settings.fontSize) / 100 * imageScale;
  // Large letters need more room, but changing pixel size must not shrink them.
  const spacing = Math.max(Math.max(1, settings.cellSize) * imageScale, fontSize * 1.2);
  return { fontSize, spacing };
}

export function silhouetteSubject(source: HTMLCanvasElement, fill: string, settings: SilhouetteSettings, maxEdge = Infinity, outputScale = 1, basePhoto?: CanvasImageSource) {
  const canvas = surface(source,maxEdge,outputScale), context = canvas.getContext('2d')!;
  const w = source.width, h = source.height, sx = canvas.width / w, sy = canvas.height / h;
  const step = Math.max(1, settings.cellSize) * Math.max(w,h) / 1000;
  const sample = sampler(source), columns = Math.ceil(w / step), rows = Math.ceil(h / step);
  if (basePhoto) {
    context.drawImage(basePhoto, 0, 0, canvas.width, canvas.height);
  } else if (settings.style === 'clean') {
    context.drawImage(source,0,0,canvas.width,canvas.height);
    const pixels = context.getImageData(0,0,canvas.width,canvas.height);
    for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=pixels.data[i]>12?255:0;
    context.putImageData(pixels,0,0);
    context.globalCompositeOperation = 'source-in';context.fillStyle = fill;
    context.fillRect(0,0,canvas.width,canvas.height);context.globalCompositeOperation = 'source-over';
  } else {
    context.fillStyle = fill;
    for (let y=0;y<rows;y++)for(let x=0;x<columns;x++) {
      if (sample((x+.5)*step,(y+.5)*step,step).coverage < .35) continue;
      const left = Math.round(x*step*sx), top = Math.round(y*step*sy);
      context.fillRect(left,top,Math.round((x+1)*step*sx)-left,Math.round((y+1)*step*sy)-top);
    }
  }
  const letters = Array.from(settings.text).filter(letter=>letter.trim());
  if (settings.textEnabled && letters.length && settings.density > 0) {
    const textMetrics = scatterTextMetrics(w, h, settings);
    const textStep = textMetrics.spacing;
    const textColumns = Math.ceil(w / textStep), textRows = Math.ceil(h / textStep);
    const mask = surface(source,maxEdge,outputScale);mask.getContext('2d')!.drawImage(canvas,0,0);
    context.save();context.scale(sx,sy);
    context.fillStyle = settings.textColor;context.textAlign = 'center';context.textBaseline = 'middle';
    context.font = `bold ${textMetrics.fontSize}px "Courier New", "Microsoft YaHei", monospace`;
    for(let y=0;y<textRows;y++)for(let x=0;x<textColumns;x++) {
      if(randomCell(x,y,settings.seed) >= settings.density/100)continue;
      if(sample((x+.5)*textStep,(y+.5)*textStep,textStep).coverage < .72)continue;
      const letter = letters[Math.floor(randomCell(x,y,settings.seed,41)*letters.length)];
      const jitterX = (randomCell(x,y,settings.seed,67)-.5)*textStep*.26;
      const jitterY = (randomCell(x,y,settings.seed,89)-.5)*textStep*.26;
      // No maxWidth: it would squeeze large glyphs back into tiny pixel cells.
      context.fillText(letter,(x+.5)*textStep+jitterX,(y+.5)*textStep+jitterY);
    }
    context.restore();context.globalCompositeOperation = 'destination-in';context.drawImage(mask,0,0);
    context.globalCompositeOperation = 'source-over';mask.width=mask.height=1;
  }
  return canvas;
}
