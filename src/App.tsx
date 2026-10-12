import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { segment } from "./segmentation";
import { backgroundPresets, backgroundPreview, backgroundUrl, loadBackgroundImage, recommendBackground } from "./backgrounds";
import { adjustedPhoto, canvasBlob, exportSize, innerShadow, recommendColors, textureTile, type Layout } from "./editor-utils";
import { defaultHalftone, defaultSilhouette, halftoneSubject, silhouetteSubject, type DotShape, type HalftoneSettings, type SilhouetteSettings } from './subject-effects';
import { framesFor, swapPanelObjects } from './composition';
import {
  ArrowDown,
  ArrowClockwise,
  ArrowCounterClockwise,
  BookOpenText,
  Check,
  CornersOut,
  DownloadSimple,
  DotsSixVertical,
  GlobeSimple,
  ImageSquare,
  Palette,
  Selection,
  SlidersHorizontal,
  Sparkle,
  UploadSimple,
  UserCircle,
  UserFocus,
  WechatLogo,
  X,
} from "@phosphor-icons/react";

type Tool = "edit" | "finish";
type Layer = "background" | "solid" | "silhouette" | "subject";
type Transformable = Exclude<Layer, "solid">;
type MaskLayer = Extract<Layer, "silhouette" | "subject">;
type MaskMode = "none" | "paint" | "erase";
type T = { x: number; y: number; scale: number; rotation: number };
type Frame = { x: number; y: number; w: number; h: number };
type Bounds = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
type DragState =
  | { id: number; kind: "move"; layer: Transformable; p: Point }
  | { id: number; kind: "mask"; layer: MaskLayer; p: Point };
type TransformGesture = {
  id: number;
  kind: "move" | "scale" | "rotate";
  layer: Transformable;
  startPoint: Point;
  startTransform: T;
  startDistance: number;
  startAngle: number;
};
type MaskHistoryEntry = {
  x: number;
  y: number;
  before: ImageData;
  after: ImageData;
};
type MaskStroke = {
  before: HTMLCanvasElement;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const canvasPresets = [
  ["original", "自动", 0],
  ["1:1", "1:1", 1],
  ["4:5", "4:5", 4 / 5],
  ["3:4", "3:4", 3 / 4],
  ["2:3", "2:3", 2 / 3],
  ["3:2", "3:2", 3 / 2],
  ["4:3", "4:3", 4 / 3],
  ["16:9", "16:9", 16 / 9],
  ["9:16", "9:16", 9 / 16],
] as const;

const colors = ["#F2E527", "#F294B7", "#D6422B", "#3155D9", "#78905A"];
const defaultLayerOrder: Layer[] = ['silhouette', 'subject', 'solid', 'background'];
const psdLayerNames: Record<Layer, string> = { silhouette: '04 纯色剪影', subject: '03 实体主体', solid: '02 纯色背景', background: '01 剪影背景' };
const layerNames: Record<Layer, string> = {
  background: "剪影背景",
  solid: "纯色背景",
  silhouette: "纯色剪影",
  subject: "实体主体",
};
const layerNotes: Record<Layer, string> = {
  background: "通用图、纯色或原图挖空",
  solid: "承接实体主体",
  silhouette: "放在新背景上",
  subject: "移到纯色区域",
};

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });

function fitBase(
  frame: Frame,
  iw: number,
  ih: number,
  fit: "cover" | "contain",
) {
  return fit === "cover"
    ? Math.max(frame.w / iw, frame.h / ih)
    : Math.min(frame.w / iw, frame.h / ih);
}

function drawFit(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  iw: number,
  ih: number,
  frame: Frame,
  transform: T,
  canvasW: number,
  canvasH: number,
  fit: "cover" | "contain",
) {
  const scale = fitBase(frame, iw, ih, fit) * transform.scale;
  context.save();
  context.translate(transform.x * canvasW, transform.y * canvasH);
  context.rotate((transform.rotation * Math.PI) / 180);
  context.drawImage(
    image,
    (-iw * scale) / 2,
    (-ih * scale) / 2,
    iw * scale,
    ih * scale,
  );
  context.restore();
}

function maskFill(subject: HTMLCanvasElement, color: string, max = Infinity) {
  const canvas = document.createElement("canvas");
  const ratio = Math.min(1, max / Math.max(subject.width, subject.height));
  canvas.width = Math.round(subject.width * ratio);
  canvas.height = Math.round(subject.height * ratio);
  const context = canvas.getContext("2d")!;
  context.drawImage(subject, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const hex = color.replace("#", "");
  const value = Number.parseInt(
    hex.length === 3 ? hex.replace(/./g, "$&$&") : hex,
    16,
  );
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] > 12) {
      image.data[i] = red;
      image.data[i + 1] = green;
      image.data[i + 2] = blue;
      image.data[i + 3] = 255;
    } else {
      image.data[i + 3] = 0;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function solidifyAlpha(canvas: HTMLCanvasElement, threshold = 96) {
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < image.data.length; i += 4) {
    image.data[i] = image.data[i] > threshold ? 255 : 0;
  }
  context.putImageData(image, 0, 0);
}

function cutOriginalBackground(original: HTMLImageElement, subject: HTMLCanvasElement, limit = 1600) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, limit / Math.max(original.naturalWidth, original.naturalHeight));
  canvas.width = Math.round(original.naturalWidth * scale); canvas.height = Math.round(original.naturalHeight * scale);
  const context = canvas.getContext('2d')!;
  context.drawImage(original, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(subject, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function scanAlpha(canvas: HTMLCanvasElement): Bounds {
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width;
  let top = canvas.height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < canvas.height; y += 2) {
    for (let x = 0; x < canvas.width; x += 2) {
      if (data[(y * canvas.width + x) * 4 + 3] > 20) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (left > right || top > bottom)
    return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function autoTransforms(
  layout: Layout,
  split: number,
  size: { w: number; h: number },
  bounds: Bounds,
  iw: number,
  ih: number,
  originalBackdrop = false,
  swapped = false,
): Record<Transformable, T> {
  const frames = framesFor(layout, split, size.w, size.h, swapped);
  const photoBase = fitBase(frames.photo, iw, ih, "contain");
  const subjectBase = fitBase(frames.solid, iw, ih, "contain");
  const centerX = bounds.x + bounds.w / 2 - iw / 2;
  const centerY = bounds.y + bounds.h / 2 - ih / 2;
  const photo: T = {
    x: (frames.photo.x + frames.photo.w / 2) / size.w,
    y: (frames.photo.y + frames.photo.h / 2) / size.h,
    scale: 1,
    rotation: 0,
  };
  const pixelScale = originalBackdrop ? photoBase : Math.min(frames.photo.w * .82 / bounds.w, frames.photo.h * .82 / bounds.h,
    frames.solid.w * .82 / bounds.w, frames.solid.h * .82 / bounds.h, photoBase * 2.8, subjectBase * 2.8);
  const object = (frame: Frame, base: number): T => ({
    x: (frame.x + frame.w / 2 - centerX * pixelScale) / size.w,
    y: (frame.y + frame.h / 2 - centerY * pixelScale) / size.h,
    scale: pixelScale / base, rotation: 0,
  });
  const subject = object(frames.solid, subjectBase);
  const silhouette = originalBackdrop ? { ...photo } : object(frames.photo, photoBase);
  if (layout === "overlay" || layout === "echo") {
    const centered = { x: .5, y: .5, scale: 1, rotation: 0 };
    return {
      background: centered,
      silhouette: { ...silhouette, x: silhouette.x + (layout === "echo" ? .05 : 0) },
      subject,
    };
  }
  return { background: photo, silhouette, subject };
}

function grain(
  context: CanvasRenderingContext2D,
  w: number,
  h: number,
  alpha: number,
) {
  context.save();
  context.globalAlpha = alpha / 28;
  context.globalCompositeOperation = "soft-light";
  context.fillStyle = context.createPattern(textureTile(), "repeat")!;
  context.fillRect(0, 0, w, h);
  context.restore();
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const backgroundFileRef = useRef<HTMLInputElement>(null);
  const originalRef = useRef<HTMLImageElement | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const processingRef = useRef(false);
  const rawMaskRef = useRef<HTMLCanvasElement | null>(null);
  const innerCacheRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const toneCacheRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const subjectRef = useRef<HTMLCanvasElement | null>(null);
  const subjectEffectRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const backgroundRef = useRef<HTMLImageElement | null>(null);
  const backgroundPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const originalBackgroundRef = useRef<HTMLCanvasElement | null>(null);
  const fullOriginalBackgroundRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundRequestRef = useRef(0);
  const boundsRef = useRef<Bounds | null>(null);
  const maskCacheRef = useRef<{
    key: string;
    canvas: HTMLCanvasElement;
  } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const transformGestureRef = useRef<TransformGesture | null>(null);
  const brushCursorRef = useRef<HTMLDivElement>(null);
  const maskStrokeRef = useRef<MaskStroke | null>(null);
  const maskHistoryRef = useRef<{
    undo: MaskHistoryEntry[];
    redo: MaskHistoryEntry[];
  }>({ undo: [], redo: [] });

  const [hasImage, setHasImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [progressPercent, setProgressPercent] = useState<number | undefined>();
  const [processingMode, setProcessingMode] = useState("");
  const [suggestedColors, setSuggestedColors] = useState<string[]>(colors);
  const [sceneMode, setSceneMode] = useState<'image' | 'solid' | 'original'>('original');
  const [originalLinked, setOriginalLinked] = useState(true);
  const [sceneColor, setSceneColor] = useState('#DFE8E4');
  const [backgroundId, setBackgroundId] = useState('');
  const [backgroundName, setBackgroundName] = useState('自动匹配照片色彩');
  const [backgroundRevision, setBackgroundRevision] = useState(0);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [autoBackground, setAutoBackground] = useState(false);
  const [alphaThreshold, setAlphaThreshold] = useState(96);
  const [exportScale, setExportScale] = useState(2);
  const [maskView, setMaskView] = useState(false);
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<Layout>("horizontal");
  const [split, setSplit] = useState(50);
  const [panelsSwapped, setPanelsSwapped] = useState(false);
  const [size, setSize] = useState({ w: 1080, h: 1350 });
  const [color, setColor] = useState(colors[0]);
  const [mono, setMono] = useState(false);
  const [tone, setTone] = useState(0);
  const [outer, setOuter] = useState(0);
  const [inner, setInner] = useState(0);
  const [blur, setBlur] = useState(18);
  const [texture, setTexture] = useState("none");
  const [halftone, setHalftone] = useState<HalftoneSettings>(defaultHalftone);
  const [silhouetteEffect, setSilhouetteEffect] = useState<SilhouetteSettings>(defaultSilhouette);
  const [transforms, setTransforms] = useState<Record<Transformable, T>>({
    background: { x: 0.25, y: 0.5, scale: 1, rotation: 0 },
    silhouette: { x: 0.25, y: 0.5, scale: 1, rotation: 0 },
    subject: { x: 0.75, y: 0.5, scale: 1, rotation: 0 },
  });
  const [active, setActive] = useState<Layer>("silhouette");
  const [layerOrder, setLayerOrder] = useState<Layer[]>(defaultLayerOrder);
  const draggedLayerRef = useRef<Layer | null>(null);
  const [layerDrop, setLayerDrop] = useState<{ layer: Layer; after: boolean } | null>(null);
  const [tool, setTool] = useState<Tool>("edit");
  const [sheet, setSheet] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [maskMode, setMaskMode] = useState<MaskMode>("none");
  const [paintSize, setPaintSize] = useState(6);
  const [eraserSize, setEraserSize] = useState(6);
  const [maskRevision, setMaskRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [canvasPreset, setCanvasPreset] = useState("original");
  const [customWidth, setCustomWidth] = useState("1080");
  const [customHeight, setCustomHeight] = useState("1350");
  const [canvasRatioLocked, setCanvasRatioLocked] = useState(true);
  const [displayWidth, setDisplayWidth] = useState<number>();
  const [wechatOpen, setWechatOpen] = useState(false);

  const frames = useCallback(
    (W = size.w, H = size.h) => framesFor(layout, split, W, H, panelsSwapped),
    [layout, size.h, size.w, split, panelsSwapped],
  );

  const fitCanvasToStage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const style = getComputedStyle(stage);
    const availableW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    let availableH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 42;
    for (const child of stage.querySelectorAll<HTMLElement>(':scope > .stage-meta, :scope > .object-switch, :scope > .runtime-note, :scope > .mask-status, :scope > .error-note')) {
      const spacing = getComputedStyle(child);
      availableH -= child.getBoundingClientRect().height + parseFloat(spacing.marginTop || '0') + parseFloat(spacing.marginBottom || '0');
    }
    const width = Math.max(1, Math.floor(Math.min(availableW, Math.max(1, availableH) * size.w / size.h)));
    setDisplayWidth(current => current === width ? current : width);
  }, [size.w, size.h]);

  useEffect(() => {
    const frame = requestAnimationFrame(fitCanvasToStage);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fitCanvasToStage) : null;
    if (stageRef.current) observer?.observe(stageRef.current);
    window.addEventListener('resize', fitCanvasToStage);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', fitCanvasToStage); };
  }, [fitCanvasToStage, hasImage, maskMode, error, processingMode]);

  const changeCustomDimension = (dimension: 'width' | 'height', value: string) => {
    if (dimension === 'width') setCustomWidth(value); else setCustomHeight(value);
    const amount = Number(value);
    if (!canvasRatioLocked || !value || !Number.isFinite(amount) || amount <= 0) return;
    if (dimension === 'width') setCustomHeight(String(Math.round(amount * size.h / size.w)));
    else setCustomWidth(String(Math.round(amount * size.w / size.h)));
  };

  const render = useCallback(
    (
      canvas: HTMLCanvasElement,
      multiplier = 1,
      only?: Layer,
      guides = false,
    ) => {
      const W = size.w;
      const H = size.h;
      canvas.width = Math.round(W * multiplier);
      canvas.height = Math.round(H * multiplier);
      const context = canvas.getContext("2d")!;
      context.save();
      context.scale(multiplier, multiplier);
      const frame = frames(W, H);
      if (!only) {
        context.fillStyle = "#EEECE4";
        context.fillRect(0, 0, W, H);
      }
      const original = originalRef.current;
      const subject = subjectRef.current;
      const background = sceneMode === 'original' && original && subject
        ? (multiplier > .95 ? (fullOriginalBackgroundRef.current ??= cutOriginalBackground(original, subject, Infinity))
          : (originalBackgroundRef.current ??= cutOriginalBackground(original, subject)))
        : (multiplier > .95 ? backgroundRef.current : backgroundPreviewRef.current);
      const backgroundImage = sceneMode === 'original' ? original : backgroundRef.current;
      if (!original || !subject) {
        context.restore();
        return;
      }
      if (maskView && multiplier < .95 && !only) {
        context.fillStyle = "#f8f6ef";
        context.fillRect(0, 0, W, H);
        context.fillStyle = "#d9d5cb";
        for (let y = 0; y < H; y += 24) for (let x = 0; x < W; x += 24)
          if ((x / 24 + y / 24) % 2 === 0) context.fillRect(x, y, 24, 24);
        const maskLayer = active === "subject" && layout !== "overlay" ? "subject" : "silhouette";
        drawFit(context, subject, subject.width, subject.height, maskLayer === "subject" ? frame.solid : frame.photo, transforms[maskLayer], W, H, "contain");
        context.restore(); return;
      }

      const drawBackground = () => {
        context.save();
        context.beginPath();
        context.rect(
          frame.photo.x,
          frame.photo.y,
          frame.photo.w,
          frame.photo.h,
        );
        context.clip();
        if (sceneMode !== 'original') {
          context.fillStyle = sceneColor;
          context.fillRect(frame.photo.x, frame.photo.y, frame.photo.w, frame.photo.h);
        }
        if (sceneMode !== 'solid' && background && backgroundImage) {
        const filters: string[] = [];
        if (mono) filters.push("grayscale(1)");
        if (tone) filters.push(`saturate(${1 + tone / 100})`);
        let tonedBackground: CanvasImageSource = background;
        if (filters.length) {
          if (typeof context.filter === "string") context.filter = filters.join(" ");
          else {
            const bw = background instanceof HTMLImageElement ? background.naturalWidth : background.width;
            const bh = background instanceof HTMLImageElement ? background.naturalHeight : background.height;
            const key = `${sceneMode}-${backgroundRevision}-${sceneMode === 'original' ? maskRevision : 0}-${bw}-${mono}-${tone}`;
            if (!toneCacheRef.current || toneCacheRef.current.key !== key) toneCacheRef.current = { key, canvas: adjustedPhoto(background, bw, bh, mono, tone) };
            tonedBackground = toneCacheRef.current.canvas;
          }
        }
        drawFit(
          context,
          tonedBackground,
          backgroundImage.naturalWidth,
          backgroundImage.naturalHeight,
          frame.photo,
          transforms.background,
          W,
          H,
          sceneMode === 'original' ? 'contain' : 'cover',
        );
        }
        context.restore();
      };

      const drawSolid = () => {
        if (layout !== 'vertical' && layout !== 'horizontal') return;
        context.fillStyle = color;
        context.fillRect(
          frame.solid.x,
          frame.solid.y,
          frame.solid.w,
          frame.solid.h,
        );
      };
      const drawObject = (
        image: CanvasImageSource,
        transform: T,
        targetFrame: Frame,
        fit: "cover" | "contain",
        shadow = false,
      ) => {
        context.save();
        // The panel sets initial fitting only. Foreground layers may overlap
        // either panel; the output canvas remains their only clipping boundary.
        if (shadow && outer) {
          context.shadowColor = `rgba(12,10,8,${outer / 100})`;
          context.shadowBlur = blur * multiplier;
          context.shadowOffsetX = blur * multiplier / 3;
          context.shadowOffsetY = blur * multiplier / 3;
        }
        drawFit(
          context,
          image,
          subject.width,
          subject.height,
          targetFrame,
          transform,
          W,
          H,
          fit,
        );
        context.restore();
      };

      const drawSilhouette = () => {
        const maskLimit = multiplier < .95 ? 1600 : Infinity;
        const effectScale = multiplier < .95 ? 1 : Math.min(Math.sqrt(24_000_000 / (subject.width * subject.height)), 8192 / Math.max(subject.width, subject.height),
          Math.max(1, fitBase(frame.photo, subject.width, subject.height, 'contain') * transforms.silhouette.scale * multiplier));
        const maskKey = `${color}-${maskRevision}-${maskLimit}-${effectScale}-${JSON.stringify(silhouetteEffect)}`;
        if (!maskCacheRef.current || maskCacheRef.current.key !== maskKey) {
          maskCacheRef.current = { key: maskKey, canvas: silhouetteEffect.style === 'clean' && !silhouetteEffect.textEnabled
            ? maskFill(subject, color, maskLimit) : silhouetteSubject(subject, color, silhouetteEffect, maskLimit, effectScale) };
        }
        const colorMask = maskCacheRef.current.canvas;
        drawObject(
          colorMask,
          transforms.silhouette,
          frame.photo,
          "contain",
          true,
        );
        if (inner) {
          const edgeKey = `${maskKey}-${inner}-${blur}-${colorMask.width}`;
          if (!innerCacheRef.current || innerCacheRef.current.key !== edgeKey) {
            const spread = Math.max(1, blur * colorMask.width / size.w);
            innerCacheRef.current = { key: edgeKey, canvas: innerShadow(colorMask, inner, spread) };
          }
          drawObject(innerCacheRef.current.canvas, transforms.silhouette, frame.photo, "contain");
        }
      };

      const drawSubject = () => {
        if (layout === 'overlay') return;
        let image = subject;
        if (halftone.enabled) {
          const limit = multiplier < .95 ? 1600 : Infinity;
          const effectScale = multiplier < .95 ? 1 : Math.min(Math.sqrt(24_000_000 / (subject.width * subject.height)), 8192 / Math.max(subject.width, subject.height),
            Math.max(1, fitBase(frame.solid, subject.width, subject.height, 'contain') * transforms.subject.scale * multiplier));
          const key = `${maskRevision}-${limit}-${effectScale}-${JSON.stringify(halftone)}`;
          if (!subjectEffectRef.current || subjectEffectRef.current.key !== key) {
            subjectEffectRef.current = { key, canvas: halftoneSubject(subject, halftone, limit, effectScale) };
          }
          image = subjectEffectRef.current.canvas;
        }
        drawObject(image, transforms.subject, frame.solid, 'contain');
      };
      const renderLayer: Record<Layer, () => void> = { background: drawBackground, solid: drawSolid, silhouette: drawSilhouette, subject: drawSubject };
      if (only) renderLayer[only]();
      else [...layerOrder].reverse().forEach(layer => renderLayer[layer]());

      if (!only) {
        if (texture === "paper") {
          context.fillStyle = "#765f4310";
          for (let y = 0; y < H; y += 6) context.fillRect(0, y, W, 1);
        }
        if (texture === "grain") grain(context, W, H, 28);
      }

      if (guides && hasImage) {
        context.save();
        context.strokeStyle = "rgba(255,255,255,.95)";
        context.lineWidth = 3;
        context.setLineDash([12, 8]);
        if (active === "background" || active === "solid") {
          const selectedFrame =
            active === "background" ? frame.photo : frame.solid;
          context.strokeRect(
            selectedFrame.x + 3,
            selectedFrame.y + 3,
            selectedFrame.w - 6,
            selectedFrame.h - 6,
          );
        } else if (boundsRef.current) {
          const selectedFrame =
            active === "silhouette" ? frame.photo : frame.solid;
          const fit = "contain";
          const transform = transforms[active];
          const base =
            fitBase(selectedFrame, subject.width, subject.height, fit) *
            transform.scale;
          const bounds = boundsRef.current;
          context.translate(transform.x * W, transform.y * H);
          context.rotate((transform.rotation * Math.PI) / 180);
          context.strokeRect(
            (bounds.x - subject.width / 2) * base,
            (bounds.y - subject.height / 2) * base,
            bounds.w * base,
            bounds.h * base,
          );
        }
        context.restore();
      }
      context.restore();
    },
    [
      active,
      blur,
      color,
      frames,
      hasImage,
      inner,
      maskRevision,
      mono,
      outer,
      size.h,
      size.w,
      texture,
      tone,
      transforms,
      layout,
      maskView,
      sceneMode, sceneColor, backgroundRevision,
      layerOrder,
      halftone, silhouetteEffect,
    ],
  );

  useEffect(() => {
    const scheduled = requestAnimationFrame(() => {
      if (canvasRef.current) render(canvasRef.current, Math.min(.9, 1400 / Math.max(size.w, size.h)), undefined, false);
    });
    return () => cancelAnimationFrame(scheduled);
  }, [render]);

  useEffect(() => {
    const stop = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  const reorderLayer = (moving: Layer, target: Layer, after = false) => {
    if (moving === target) return;
    setLayerOrder(current => {
      const next = current.filter(layer => layer !== moving);
      next.splice(next.indexOf(target) + (after ? 1 : 0), 0, moving);
      return next;
    });
    setLayerDrop(null);
  };

  const setObject = (layer: Transformable, patch: Partial<T>) => {
    setTransforms((current) => ({
      ...current,
      [layer]: { ...current[layer], ...patch },
      ...(layer === 'background' && sceneMode === 'original' && originalLinked ? { silhouette: { ...current.background, ...patch } } : {}),
    }));
  };

  const installBackground = (image: HTMLImageElement, id: string, name: string) => {
    const previous = backgroundPreviewRef.current;
    backgroundRef.current = image;
    backgroundPreviewRef.current = backgroundPreview(image);
    if (previous) previous.width = previous.height = 1;
    toneCacheRef.current = null;
    setBackgroundId(id); setBackgroundName(name); setSceneMode('image');
    setBackgroundRevision(value => value + 1);
    const frame = frames().photo;
    setTransforms(current => ({ ...current, background: { x: (frame.x + frame.w / 2) / size.w, y: (frame.y + frame.h / 2) / size.h, scale: 1, rotation: 0 } }));
  };

  const chooseBackground = async (id: string, automatic = false, photo = originalRef.current) => {
    const request = ++backgroundRequestRef.current;
    setBackgroundLoading(true);
    try {
      const preset = automatic && photo ? await recommendBackground(photo) : backgroundPresets.find(item => item.id === id);
      if (!preset) throw new Error('请选择背景图片。');
      const image = await loadBackgroundImage(backgroundUrl(preset.file));
      if (request !== backgroundRequestRef.current) return;
      installBackground(image, preset.id, preset.name);
      setAutoBackground(automatic);
      setError('');
    } catch (error) {
      if (request === backgroundRequestRef.current) {
        setError(error instanceof Error ? error.message : '背景加载失败。');
        if (!backgroundRef.current) setSceneMode('solid');
      }
    } finally { if (request === backgroundRequestRef.current) setBackgroundLoading(false); }
  };

  const uploadBackground = async (file?: File) => {
    if (!file || busy || exporting) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError('背景请选择 JPG、PNG 或 WebP。'); return; }
    if (file.size > 80 * 1024 * 1024) { setError('背景超过 80 MB，请先缩小图片。'); return; }
    const request = ++backgroundRequestRef.current;
    const url = URL.createObjectURL(file);
    setBackgroundLoading(true);
    try {
      const image = await loadBackgroundImage(url);
      if (image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('背景超过 3200 万像素，请先缩小图片。');
      if (request !== backgroundRequestRef.current) return;
      installBackground(image, 'custom', file.name);
      setAutoBackground(false); setActive('background'); setError('');
    } catch (error) { if (request === backgroundRequestRef.current) setError(error instanceof Error ? error.message : '背景上传失败。'); }
    finally { URL.revokeObjectURL(url); if (request === backgroundRequestRef.current) setBackgroundLoading(false); }
  };

  const alignOriginalBackground = () => {
    const original = originalRef.current, bounds = boundsRef.current;
    if (!original || !bounds) return;
    const automatic = autoTransforms(layout, split, size, bounds, original.naturalWidth, original.naturalHeight, true, panelsSwapped);
    setTransforms(current => ({ ...current, background: automatic.background, silhouette: automatic.silhouette }));
    setOriginalLinked(true);
  };

  const changeLayout = (nextLayout: Layout) => {
    setLayout(nextLayout);
    const original = originalRef.current;
    const bounds = boundsRef.current;
    if (original && bounds) {
      setTransforms(
        autoTransforms(
          nextLayout,
          split,
          size,
          bounds,
          original.naturalWidth,
          original.naturalHeight,
          sceneMode === 'original',
          panelsSwapped,
        ),
      );
    }
  };

  const changeSplit = (nextSplit: number) => {
    const oldFrames = framesFor(layout, split, size.w, size.h, panelsSwapped);
    const nextFrames = framesFor(layout, nextSplit, size.w, size.h, panelsSwapped);
    const original = originalRef.current;
    setSplit(nextSplit);
    if (!original) return;
    setTransforms((current) => {
      const moveWithFrame = (
        transform: T,
        oldFrame: Frame,
        nextFrame: Frame,
        fit: "cover" | "contain",
        iw = original.naturalWidth,
        ih = original.naturalHeight,
      ): T => {
        const oldBase = fitBase(
          oldFrame,
          iw,
          ih,
          fit,
        );
        const nextBase = fitBase(
          nextFrame,
          iw,
          ih,
          fit,
        );
        return {
          ...transform,
          x:
            transform.x +
            (nextFrame.x + nextFrame.w / 2 - oldFrame.x - oldFrame.w / 2) /
              size.w,
          y:
            transform.y +
            (nextFrame.y + nextFrame.h / 2 - oldFrame.y - oldFrame.h / 2) /
              size.h,
          scale: transform.scale * (oldBase / nextBase),
        };
      };
      return {
        background: moveWithFrame(
          current.background,
          oldFrames.photo,
          nextFrames.photo,
          sceneMode === 'original' ? 'contain' : 'cover',
          sceneMode === 'original' ? original.naturalWidth : backgroundRef.current?.naturalWidth,
          sceneMode === 'original' ? original.naturalHeight : backgroundRef.current?.naturalHeight,
        ),
        silhouette: moveWithFrame(
          current.silhouette,
          oldFrames.photo,
          nextFrames.photo,
          "contain",
        ),
        subject: moveWithFrame(
          current.subject,
          oldFrames.solid,
          nextFrames.solid,
          "contain",
        ),
      };
    });
  };

  const applyCanvasSize = (
    nextSize: { w: number; h: number },
    presetId: string,
  ) => {
    const normalized = {
      w: Math.min(6000, Math.max(320, Math.round(nextSize.w))),
      h: Math.min(6000, Math.max(320, Math.round(nextSize.h))),
    };
    const original = originalRef.current;
    setCanvasPreset(presetId);
    setSize(normalized);
    setCustomWidth(String(normalized.w));
    setCustomHeight(String(normalized.h));
    if (original && boundsRef.current) {
      setTransforms(
        autoTransforms(
          layout,
          split,
          normalized,
          boundsRef.current,
          original.naturalWidth,
          original.naturalHeight,
          sceneMode === 'original',
          panelsSwapped,
        ),
      );
    }
  };

  const changeCanvasPreset = (id: string, presetRatio: number) => {
    const original = originalRef.current;
    const originalRatio = original
      ? original.naturalWidth / original.naturalHeight
      : size.w / size.h;
    const ratio = presetRatio || originalRatio * (layout === "horizontal" ? 2 : layout === "vertical" ? .5 : 1);
    const nextSize =
      ratio >= 1
        ? { w: 1350, h: Math.round(1350 / ratio) }
        : { w: Math.round(1350 * ratio), h: 1350 };
    applyCanvasSize(nextSize, id);
  };

  const applyCustomCanvas = () => {
    const width = Number(customWidth);
    const height = Number(customHeight);
    applyCanvasSize(
      {
        w: Number.isFinite(width) ? width : size.w,
        h: Number.isFinite(height) ? height : size.h,
      },
      "custom",
    );
  };

  const upload = async (file?: File, cpu = false) => {
    if (!file) return;
    if (processingRef.current) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError("请选择 JPG、PNG 或 WebP 照片。"); return; }
    if (file.size > 80 * 1024 * 1024) { setError("照片超过 80 MB，请先缩小后再导入。"); return; }
    processingRef.current = true;
    pendingFileRef.current = file;
    setBusy(true);
    setError("");
    setMaskMode("none");
    try {
      const originalUrl = URL.createObjectURL(file);
      const original = await load(originalUrl);
      URL.revokeObjectURL(originalUrl);
      if (original.naturalWidth * original.naturalHeight > 32_000_000) throw new Error("照片超过 3200 万像素，请先缩小后导入。");
      const ratio = original.naturalWidth / original.naturalHeight;
      const nextSize =
        ratio >= 1
          ? { w: 1350, h: Math.round(1350 / ratio) }
          : { w: Math.round(1350 * ratio), h: 1350 };
      setProgress("正在使用精细模型提取主体");
      // Decode once before inference, so EXIF orientation is identical in the mask and original.
      const prepared = document.createElement("canvas");
      const inputScale = Math.min(1, 2560 / Math.max(original.naturalWidth, original.naturalHeight));
      prepared.width = Math.round(original.naturalWidth * inputScale);
      prepared.height = Math.round(original.naturalHeight * inputScale);
      prepared.getContext("2d")!.drawImage(original, 0, 0, prepared.width, prepared.height);
      const preparedPixels = prepared.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, prepared.width, prepared.height);
      const input = new Blob([preparedPixels.data], { type: `image/x-rgba8;width=${prepared.width};height=${prepared.height}` });
      prepared.width = prepared.height = 1;
      const result = await segment(input, {
        cpu, progress: update => { setProgress(update.message); setProgressPercent(update.percent); },
      });
      const blob = result.blob;
      setProcessingMode(result.device);
      maskHistoryRef.current = { undo: [], redo: [] };
      setHistoryRevision(value => value + 1);
      setProgress("正在整理实心蒙版与构图…");
      setProgressPercent(undefined);
      const subjectUrl = URL.createObjectURL(blob);
      const subjectImage = await load(subjectUrl);
      URL.revokeObjectURL(subjectUrl);
      const subjectCanvas = document.createElement("canvas");
      subjectCanvas.width = original.naturalWidth;
      subjectCanvas.height = original.naturalHeight;
      subjectCanvas.getContext("2d")!.drawImage(subjectImage, 0, 0, subjectCanvas.width, subjectCanvas.height);
      const rawMask = document.createElement("canvas");
      rawMask.width = subjectCanvas.width; rawMask.height = subjectCanvas.height;
      rawMask.getContext("2d")!.drawImage(subjectCanvas, 0, 0);
      rawMaskRef.current = rawMask;
      // Preserve the original RGB pixels, then apply only the alpha from the AI result.
      const sc = subjectCanvas.getContext("2d")!;
      sc.clearRect(0, 0, subjectCanvas.width, subjectCanvas.height);
      sc.drawImage(original, 0, 0, subjectCanvas.width, subjectCanvas.height);
      sc.globalCompositeOperation = "destination-in"; sc.drawImage(rawMask, 0, 0); sc.globalCompositeOperation = "source-over";
      solidifyAlpha(subjectCanvas, alphaThreshold);
      originalRef.current = original;
      subjectRef.current = subjectCanvas;
      subjectEffectRef.current = null;
      originalBackgroundRef.current = null;
      fullOriginalBackgroundRef.current = null;
      const bounds = scanAlpha(subjectCanvas);
      boundsRef.current = bounds;
      maskCacheRef.current = null;
      innerCacheRef.current = null;
      toneCacheRef.current = null;
      const palette = recommendColors(original);
      setSuggestedColors(palette);
      if (!hasImage) setSceneColor(palette[4]);
      setMono(false); setTone(0);
      // Every new subject starts with its original, aligned cutout backdrop.
      // Keep the last replacement image available, but do not auto-install it.
      ++backgroundRequestRef.current; setBackgroundLoading(false);
      setSceneMode('original'); setAutoBackground(false); setOriginalLinked(true);
      setPanelsSwapped(false);
      const suggestedLayout: Layout =
        bounds.h > bounds.w * 1.12 ? "horizontal" : "vertical";
      const compositionRatio = ratio * (suggestedLayout === "horizontal" ? 2 : .5);
      const compositionSize = compositionRatio >= 1
        ? { w: 1800, h: Math.round(1800 / compositionRatio) }
        : { w: Math.round(1350 * compositionRatio), h: 1350 };
      setSize(compositionSize);
      setCustomWidth(String(compositionSize.w)); setCustomHeight(String(compositionSize.h)); setCanvasPreset("original");
      setLayout(suggestedLayout);
      setSplit(50);
      setTransforms(
        autoTransforms(
          suggestedLayout,
          50,
          compositionSize,
          bounds,
          original.naturalWidth,
          original.naturalHeight,
          true,
        ),
      );
      setActive("silhouette");
      setTool("edit");
      setHasImage(true);
      setMaskRevision((value) => value + 1);
    } catch (uploadError) {
      console.error(uploadError);
      const detail = uploadError instanceof Error ? uploadError.message : String(uploadError);
      setError(/fetch|network|resource|download/i.test(detail)
        ? "识别资源加载失败。请确认已完整解压本地工具包，或连接网络后重试；也可选择 CPU 兼容重试。"
        : /memory|alloc|size/i.test(detail)
          ? "当前设备内存不足，请尝试较小的照片或 CPU 兼容模式。"
          : `主体处理失败：${detail}。可用下方按钮重试。`);
    } finally {
      setBusy(false);
      processingRef.current = false;
    }
  };

  const saveBlob = (blob: Blob, name: string) => {
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 800);
  };

  const exportDimensions = exportSize(size.w, size.h, exportScale);
  const exportMultiplier = exportDimensions.factor;

  const download = async (format: "png" | "jpeg" | "webp", cutout = false) => {
    if (!hasImage || exporting || busy || backgroundLoading) return;
    setExporting(true);
    setProgress(cutout ? "正在生成透明剪影…" : "正在使用原图重新渲染高清图片…");
    const output = document.createElement("canvas");
    try {
      await new Promise(resolve => setTimeout(resolve, 40));
      if (cutout) {
        const subject = subjectRef.current!;
        const effect = silhouetteEffect.style === 'clean' && !silhouetteEffect.textEnabled
          ? maskFill(subject, color) : silhouetteSubject(subject, color, silhouetteEffect);
        const bounds = scanAlpha(effect);
        output.width = bounds.w; output.height = bounds.h;
        output.getContext("2d")!.drawImage(effect, -bounds.x, -bounds.y);
      } else render(output, exportMultiplier);
      setProgress("正在编码图片文件…");
      const blob = await canvasBlob(output, `image/${format}`);
      if (blob.type !== `image/${format}`) throw new Error("浏览器不支持此格式，请选择 PNG 或 JPG。");
      saveBlob(blob, `afterimage${cutout ? "-silhouette" : ""}.${format === "jpeg" ? "jpg" : format}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出失败，请降低尺寸后重试。");
    } finally {
      output.width = output.height = 1;
      fullOriginalBackgroundRef.current = null;
      setExporting(false);
    }
  };

  const exportPsd = async () => {
    if (!hasImage || exporting || busy || backgroundLoading) return;
    setExporting(true);
    setProgress("正在整理 PSD 独立图层…");
    try {
      await new Promise(resolve => setTimeout(resolve, 40));
      if (size.w * size.h > 12_000_000) throw new Error("PSD 请使用不超过 1200 万像素的画布，以减少图层内存占用。");
      const { writePsd } = await import("ag-psd");
      const make = (
        kind: Layer,
      ) => {
        const output = document.createElement("canvas");
        render(output, 1, kind);
        return output;
      };
      const composite = document.createElement("canvas");
      render(composite, 1);
      const textureCanvas = document.createElement("canvas");
      textureCanvas.width = size.w; textureCanvas.height = size.h;
      const textureContext = textureCanvas.getContext("2d")!;
      if (texture === "paper") {
        textureContext.fillStyle = "#765f4310";
        for (let y = 0; y < size.h; y += 6) textureContext.fillRect(0, y, size.w, 1);
      } else if (texture === "grain") {
        textureContext.fillStyle = textureContext.createPattern(textureTile(), "repeat")!;
        textureContext.fillRect(0, 0, size.w, size.h);
      }
      const data = writePsd({
        width: size.w,
        height: size.h,
        canvas: composite,
        children: [
          ...(texture !== "none" ? [{ name: "05 表面质感", canvas: textureCanvas, blendMode: texture === "grain" ? "soft light" as const : "normal" as const }] : []),
          ...layerOrder.map(layer => ({ name: psdLayerNames[layer], canvas: make(layer) })),
        ],
      });
      saveBlob(
        new Blob([data], { type: "image/vnd.adobe.photoshop" }),
        "afterimage-layers.psd",
      );
    } catch (exportError) {
      console.error(exportError);
      setError(exportError instanceof Error ? exportError.message : "PSD 生成失败，请尝试尺寸更小的图片。");
    } finally {
      setExporting(false);
      fullOriginalBackgroundRef.current = null;
    }
  };

  const pointerPoint = (event: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  const pointToSource = (point: Point, layer: "silhouette" | "subject") => {
    const subject = subjectRef.current;
    if (!subject) return null;
    const frame = frames()[layer === "silhouette" ? "photo" : "solid"];
    const fit = "contain";
    const transform = transforms[layer];
    const dx = point.x * size.w - transform.x * size.w;
    const dy = point.y * size.h - transform.y * size.h;
    const angle = (-transform.rotation * Math.PI) / 180;
    const rotatedX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const rotatedY = dx * Math.sin(angle) + dy * Math.cos(angle);
    const base =
      fitBase(frame, subject.width, subject.height, fit) * transform.scale;
    return {
      x: rotatedX / base + subject.width / 2,
      y: rotatedY / base + subject.height / 2,
      base,
    };
  };

  const alphaHit = (point: Point, layer: "silhouette" | "subject") => {
    if (layer === "subject" && layout === "overlay") return false;
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false;
    const subject = subjectRef.current;
    const source = pointToSource(point, layer);
    if (!subject || !source) return false;
    if (
      source.x < 0 ||
      source.y < 0 ||
      source.x >= subject.width ||
      source.y >= subject.height
    )
      return false;
    // Effect holes and enlarged pixel blocks participate in visible-layer picking.
    // Brush repair still maps to the unmodified source mask.
    const hitImage = maskMode !== 'none' || maskView ? subject
      : layer === 'subject' && halftone.enabled ? subjectEffectRef.current?.canvas ?? subject
      : layer === 'silhouette' && silhouetteEffect.style === 'pixel' ? maskCacheRef.current?.canvas ?? subject : subject;
    const alpha = hitImage
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(Math.floor(source.x * hitImage.width / subject.width), Math.floor(source.y * hitImage.height / subject.height), 1, 1).data[3];
    return alpha > 24;
  };

  const pickLayer = (point: Point): Layer => {
    const frame = frames();
    const px = point.x * size.w;
    const py = point.y * size.h;
    const inPhoto =
      px >= frame.photo.x &&
      px <= frame.photo.x + frame.photo.w &&
      py >= frame.photo.y &&
      py <= frame.photo.y + frame.photo.h;
    const inSolid = px >= frame.solid.x && px <= frame.solid.x + frame.solid.w && py >= frame.solid.y && py <= frame.solid.y + frame.solid.h;
    for (const layer of layerOrder) {
      if (layer === 'subject' && alphaHit(point, 'subject')) return layer;
      if (layer === 'silhouette' && alphaHit(point, 'silhouette')) return layer;
      if (layer === 'solid' && inSolid && (layout === 'horizontal' || layout === 'vertical')) return layer;
      if (layer === 'background' && inPhoto) {
        if (sceneMode !== 'original') return layer;
        const original = originalRef.current, cutout = originalBackgroundRef.current;
        if (!original || !cutout) continue;
        const t = transforms.background, a = -t.rotation * Math.PI / 180;
        const dx = px - t.x * size.w, dy = py - t.y * size.h;
        const base = fitBase(frame.photo, original.naturalWidth, original.naturalHeight, 'contain') * t.scale;
        const x = Math.floor(((dx * Math.cos(a) - dy * Math.sin(a)) / base + original.naturalWidth / 2) * cutout.width / original.naturalWidth);
        const y = Math.floor(((dx * Math.sin(a) + dy * Math.cos(a)) / base + original.naturalHeight / 2) * cutout.height / original.naturalHeight);
        if (x >= 0 && y >= 0 && x < cutout.width && y < cutout.height && cutout.getContext('2d', {willReadFrequently:true})!.getImageData(x,y,1,1).data[3] > 24) return layer;
      }
    }
    return inPhoto ? 'background' : 'solid';
  };

  const activeBrushSize = maskMode === "erase" ? eraserSize : paintSize;

  const brushLayerAt = (point: Point): MaskLayer => {
    if (layout === "overlay") return "silhouette";
    if (maskView) return active === "subject" ? "subject" : "silhouette";
    const picked = pickLayer(point);
    if (picked === "subject" || picked === "silhouette") return picked;
    // Preserve the selected mask for painting back an erased region, including
    // portions moved across the divider. A stroke keeps this target throughout.
    if (active === "subject" || active === "silhouette") {
      const source = pointToSource(point, active), subject = subjectRef.current;
      if (source && subject && source.x >= 0 && source.y >= 0 &&
          source.x < subject.width && source.y < subject.height) return active;
    }
    const frame = frames().photo;
    const x = point.x * size.w, y = point.y * size.h;
    return x >= frame.x && x <= frame.x + frame.w && y >= frame.y && y <= frame.y + frame.h ? "silhouette" : "subject";
  };

  const beginMaskStroke = () => {
    const subject = subjectRef.current;
    if (!subject) return;
    const before = document.createElement("canvas");
    before.width = subject.width;
    before.height = subject.height;
    before.getContext("2d")!.drawImage(subject, 0, 0);
    maskStrokeRef.current = {
      before,
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    };
  };

  const stampMask = (point: Point, layer: MaskLayer) => {
    const subject = subjectRef.current;
    const original = originalRef.current;
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false;
    const source = pointToSource(point, layer);
    if (!subject || !original || !source) return false;
    if (
      source.x < 0 ||
      source.y < 0 ||
      source.x >= subject.width ||
      source.y >= subject.height
    )
      return false;
    const radius = activeBrushSize / source.base;
    const stroke = maskStrokeRef.current;
    if (stroke) {
      stroke.left = Math.min(stroke.left, source.x - radius - 2);
      stroke.top = Math.min(stroke.top, source.y - radius - 2);
      stroke.right = Math.max(stroke.right, source.x + radius + 2);
      stroke.bottom = Math.max(stroke.bottom, source.y + radius + 2);
    }
    const context = subject.getContext("2d")!;
    if (maskMode === "erase") {
      context.save();
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = "#000";
      context.beginPath();
      context.arc(source.x, source.y, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    } else if (maskMode === "paint") {
      context.save();
      context.beginPath();
      context.arc(source.x, source.y, radius, 0, Math.PI * 2);
      context.clip();
      context.globalCompositeOperation = "source-over";
      context.drawImage(original, 0, 0, subject.width, subject.height);
      context.restore();
    }
    return true;
  };

  const commitMaskPreview = () => {
    maskCacheRef.current = null;
    setMaskRevision((value) => value + 1);
  };

  const refreshMaskBackground = () => {
    originalBackgroundRef.current = null;
    fullOriginalBackgroundRef.current = null;
    innerCacheRef.current = null;
    if (subjectRef.current) {
      boundsRef.current = scanAlpha(subjectRef.current);
    }
    maskCacheRef.current = null;
    setMaskRevision((value) => value + 1);
  };

  const finishMask = () => {
    refreshMaskBackground();
    setMaskMode("none");
    if (brushCursorRef.current) brushCursorRef.current.style.display = "none";
  };

  const undoMask = () => {
    const subject = subjectRef.current;
    const entry = maskHistoryRef.current.undo.pop();
    if (!subject || !entry) return;
    subject.getContext("2d")!.putImageData(entry.before, entry.x, entry.y);
    maskHistoryRef.current.redo.push(entry);
    setHistoryRevision((value) => value + 1);
    refreshMaskBackground();
  };

  const redoMask = () => {
    const subject = subjectRef.current;
    const entry = maskHistoryRef.current.redo.pop();
    if (!subject || !entry) return;
    subject.getContext("2d")!.putImageData(entry.after, entry.x, entry.y);
    maskHistoryRef.current.undo.push(entry);
    setHistoryRevision((value) => value + 1);
    refreshMaskBackground();
  };

  const applyThreshold = () => {
    if (!rawMaskRef.current || !originalRef.current || !subjectRef.current) return;
    const subject = subjectRef.current, context = subject.getContext("2d")!;
    context.clearRect(0, 0, subject.width, subject.height);
    context.drawImage(originalRef.current, 0, 0, subject.width, subject.height);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(rawMaskRef.current, 0, 0);
    context.globalCompositeOperation = "source-over";
    solidifyAlpha(subject, alphaThreshold);
    maskHistoryRef.current = { undo: [], redo: [] };
    setHistoryRevision(value => value + 1);
    refreshMaskBackground();
  };

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable || busy || exporting) return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redoMask() : undoMask(); }
        if (event.key.toLowerCase() === "y") { event.preventDefault(); redoMask(); }
      }
      if (event.key === "Escape") finishMask();
      if (maskMode !== "none" && (event.key === "[" || event.key === "]")) {
        event.preventDefault();
        const set = maskMode === "erase" ? setEraserSize : setPaintSize;
        const maximum = maskMode === "erase" ? 180 : 140;
        set(value => Math.max(1, Math.min(maximum, value + (event.key === "]" ? 4 : -4))));
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [maskMode, busy, exporting, maskRevision]);

  const commitMaskStroke = () => {
    const subject = subjectRef.current;
    const stroke = maskStrokeRef.current;
    maskStrokeRef.current = null;
    if (!subject || !stroke || !Number.isFinite(stroke.left)) return;
    solidifyAlpha(subject);
    const x = Math.max(0, Math.floor(stroke.left));
    const y = Math.max(0, Math.floor(stroke.top));
    const right = Math.min(subject.width, Math.ceil(stroke.right));
    const bottom = Math.min(subject.height, Math.ceil(stroke.bottom));
    const width = right - x;
    const height = bottom - y;
    if (width <= 0 || height <= 0) return;
    const before = stroke.before
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(x, y, width, height);
    const after = subject
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(x, y, width, height);
    let changed = false;
    for (let index = 0; index < before.data.length; index += 4) {
      if (
        before.data[index] !== after.data[index] ||
        before.data[index + 1] !== after.data[index + 1] ||
        before.data[index + 2] !== after.data[index + 2] ||
        before.data[index + 3] !== after.data[index + 3]
      ) {
        changed = true;
        break;
      }
    }
    if (changed) {
      maskHistoryRef.current.undo.push({ x, y, before, after });
      if (maskHistoryRef.current.undo.length > 15)
        maskHistoryRef.current.undo.shift();
      const memory = () => maskHistoryRef.current.undo.reduce((total, entry) => total + entry.before.data.byteLength + entry.after.data.byteLength, 0);
      while (maskHistoryRef.current.undo.length > 1 && memory() > 64 * 1024 * 1024) maskHistoryRef.current.undo.shift();
      maskHistoryRef.current.redo = [];
      setHistoryRevision((value) => value + 1);
    }
    stroke.before.width = stroke.before.height = 1;
    refreshMaskBackground();
  };

  const positionBrushCursor = (point: Point, visible = true) => {
    const cursor = brushCursorRef.current;
    if (!cursor) return;
    cursor.style.left = `${point.x * 100}%`;
    cursor.style.top = `${point.y * 100}%`;
    cursor.style.display = visible ? "block" : "none";
  };

  const pointerDown = (event: React.PointerEvent) => {
    if (!hasImage || busy || exporting || backgroundLoading) return;
    canvasRef.current?.setPointerCapture(event.pointerId);
    const point = pointerPoint(event);
    if (maskMode !== "none") {
      const layer = brushLayerAt(point);
      setActive(layer);
      beginMaskStroke();
      stampMask(point, layer);
      commitMaskPreview();
      dragRef.current = { id: event.pointerId, kind: "mask", layer, p: point };
      return;
    }
    const selected = pickLayer(point);
    setActive(selected);
    if (selected !== "solid" && !(selected === 'background' && sceneMode === 'solid')) {
      dragRef.current = {
        id: event.pointerId,
        kind: "move",
        layer: selected,
        p: point,
      };
    }
  };

  const pointerMove = (event: React.PointerEvent) => {
    const point = pointerPoint(event);
    if (maskMode !== "none") positionBrushCursor(point);
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.kind === "mask") {
      const dx = (point.x - drag.p.x) * size.w;
      const dy = (point.y - drag.p.y) * size.h;
      const distance = Math.hypot(dx, dy);
      const steps = Math.max(
        1,
        Math.ceil(distance / Math.max(0.5, activeBrushSize * 0.3)),
      );
      for (let index = 1; index <= steps; index++) {
        stampMask({
          x: drag.p.x + (point.x - drag.p.x) * (index / steps),
          y: drag.p.y + (point.y - drag.p.y) * (index / steps),
        }, drag.layer);
      }
      drag.p = point;
      commitMaskPreview();
      return;
    }
    const old = drag.p;
    drag.p = point;
    setObject(drag.layer, {
      x: transforms[drag.layer].x + point.x - old.x,
      y: transforms[drag.layer].y + point.y - old.y,
    });
  };

  const pointerUp = () => {
    if (dragRef.current?.kind === "mask") commitMaskStroke();
    dragRef.current = null;
  };

  const beginTransformGesture = (
    event: React.PointerEvent<HTMLElement>,
    kind: TransformGesture["kind"],
    layer: Transformable,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (layer === 'background' && sceneMode === 'solid') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPoint(event);
    const transform = transforms[layer];
    const dx = (point.x - transform.x) * size.w;
    const dy = (point.y - transform.y) * size.h;
    transformGestureRef.current = {
      id: event.pointerId,
      kind,
      layer,
      startPoint: point,
      startTransform: { ...transform },
      startDistance: Math.max(1, Math.hypot(dx, dy)),
      startAngle: Math.atan2(dy, dx),
    };
  };

  const updateTransformGesture = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = transformGestureRef.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerPoint(event);
    if (gesture.kind === "move") {
      setObject(gesture.layer, {
        x: gesture.startTransform.x + point.x - gesture.startPoint.x,
        y: gesture.startTransform.y + point.y - gesture.startPoint.y,
      });
      return;
    }
    const dx = (point.x - gesture.startTransform.x) * size.w;
    const dy = (point.y - gesture.startTransform.y) * size.h;
    if (gesture.kind === "scale") {
      const ratio = Math.hypot(dx, dy) / gesture.startDistance;
      setObject(gesture.layer, {
        scale: Math.min(
          4,
          Math.max(0.15, gesture.startTransform.scale * ratio),
        ),
      });
      return;
    }
    const angle = Math.atan2(dy, dx);
    setObject(gesture.layer, {
      rotation:
        gesture.startTransform.rotation +
        ((angle - gesture.startAngle) * 180) / Math.PI,
    });
  };

  const endTransformGesture = (event: React.PointerEvent<HTMLElement>) => {
    if (transformGestureRef.current?.id === event.pointerId) {
      transformGestureRef.current = null;
    }
  };

  const selectionGeometry = useMemo(() => {
    if (!hasImage) return null;
    const frame = frames();
    if (active === "solid" || (active === 'background' && sceneMode === 'solid')) {
      const solidFrame = active === 'solid' ? frame.solid : frame.photo;
      return {
        left: (solidFrame.x / size.w) * 100,
        top: (solidFrame.y / size.h) * 100,
        width: (solidFrame.w / size.w) * 100,
        height: (solidFrame.h / size.h) * 100,
        originX: ((solidFrame.x + solidFrame.w / 2) / size.w) * 100,
        originY: ((solidFrame.y + solidFrame.h / 2) / size.h) * 100,
        rotation: 0,
      };
    }
    const transform = transforms[active];
    if (active === "background") {
      const background = sceneMode === 'original' ? originalRef.current : backgroundRef.current;
      if (!background) return null;
      const base =
        fitBase(frame.photo, background.naturalWidth, background.naturalHeight, sceneMode === 'original' ? 'contain' : 'cover') *
        transform.scale;
      return {
        left:
          ((transform.x * size.w - (background.naturalWidth * base) / 2) / size.w) *
          100,
        top:
          ((transform.y * size.h - (background.naturalHeight * base) / 2) / size.h) *
          100,
        width: (background.naturalWidth * base * 100) / size.w,
        height: (background.naturalHeight * base * 100) / size.h,
        originX: transform.x * 100,
        originY: transform.y * 100,
        rotation: transform.rotation,
      };
    }
    const subject = subjectRef.current;
    const bounds = boundsRef.current;
    if (!subject || !bounds) return null;
    const selectedFrame = active === "silhouette" ? frame.photo : frame.solid;
    const fit = "contain";
    const base =
      fitBase(selectedFrame, subject.width, subject.height, fit) *
      transform.scale;
    return {
      left:
        ((transform.x * size.w + (bounds.x - subject.width / 2) * base) /
          size.w) *
        100,
      top:
        ((transform.y * size.h + (bounds.y - subject.height / 2) * base) /
          size.h) *
        100,
      width: (bounds.w * base * 100) / size.w,
      height: (bounds.h * base * 100) / size.h,
      originX: transform.x * 100,
      originY: transform.y * 100,
      rotation: transform.rotation,
    };
  }, [active, frames, hasImage, maskRevision, size.h, size.w, transforms, sceneMode, backgroundRevision]);

  const transformControls = (layer: Transformable) => (
    <>
      <Range
        name="横向位置"
        min={-20}
        max={120}
        value={transforms[layer].x * 100}
        set={(value) => setObject(layer, { x: value / 100 })}
      />
      <Range
        name="纵向位置"
        min={-20}
        max={120}
        value={transforms[layer].y * 100}
        set={(value) => setObject(layer, { y: value / 100 })}
      />
      <Range
        name="大小"
        min={20}
        max={280}
        value={transforms[layer].scale * 100}
        set={(value) => setObject(layer, { scale: value / 100 })}
      />
      <Range
        name="旋转"
        min={-45}
        max={45}
        value={transforms[layer].rotation}
        set={(value) => setObject(layer, { rotation: value })}
      />
    </>
  );

  const editPanel = useMemo(
    () => (
      <>
        <Title t="图层与构图" s="点击画面或图层，下面的控制会跟随切换" />
        <Sec l="画布比例">
          <div className="ratio-grid">
            {canvasPresets.map(([id, label, ratio]) => (
              <button
                key={id}
                className={canvasPreset === id ? "active" : ""}
                onClick={() => changeCanvasPreset(id, ratio)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className={`custom-size ${canvasPreset === "custom" ? "active" : ""}`}
          >
            <label>
              <span>宽度</span>
              <input
                type="number"
                min={320}
                max={6000}
                inputMode="numeric"
                value={customWidth}
                onChange={(event) => changeCustomDimension('width', event.target.value)}
              />
              <i>px</i>
            </label>
            <label>
              <span>高度</span>
              <input
                type="number"
                min={320}
                max={6000}
                inputMode="numeric"
                value={customHeight}
                onChange={(event) => changeCustomDimension('height', event.target.value)}
              />
              <i>px</i>
            </label>
            <button className="secondary" onClick={applyCustomCanvas}>
              应用尺寸
            </button>
          </div>
          <label className="check-control"><input type="checkbox" checked={canvasRatioLocked} onChange={event => setCanvasRatioLocked(event.target.checked)} />锁定宽高比</label>
          <p className="control-note size-note">支持 320-6000 px</p>
        </Sec>
        <Sec l="版式">
          <div className="layout-grid two compact-layouts">
            {(["vertical", "horizontal", "overlay", "echo"] as Layout[]).map((item) => (
              <button
                className={`layout-card ${layout === item ? "active" : ""}`}
                onClick={() => changeLayout(item)}
                key={item}
              >
                <span className={`layout-thumb ${item} ${panelsSwapped ? 'swapped' : ''}`}>
                  <i />
                  <b />
                </span>
                <strong>{{vertical: "上下", horizontal: "左右", overlay: "剪影覆盖", echo: "残影"}[item]}</strong>
              </button>
            ))}
          </div>
          {(layout === "vertical" || layout === "horizontal") && <Range
            name="区域比例"
            min={25}
            max={75}
            value={split}
            set={changeSplit}
          />}
          {(layout === 'vertical' || layout === 'horizontal') && <>
            <button type="button" className="secondary full swap-panels" disabled={!hasImage || busy || exporting || backgroundLoading}
              onClick={() => {
                setTransforms(current => swapPanelObjects(current, layout, split, size, panelsSwapped));
                setPanelsSwapped(current => !current); setMaskMode('none'); setMaskView(false);
              }}>{layout === 'horizontal' ? '对调左右分区' : '对调上下分区'}</button>
            <p className="control-note" aria-live="polite">{layout === 'horizontal'
              ? (panelsSwapped ? '实体区在左 · 剪影区在右' : '剪影区在左 · 实体区在右')
              : (panelsSwapped ? '实体区在上 · 剪影区在下' : '剪影区在上 · 实体区在下')} · 剪影区 {split}% · 不镜像图片</p>
          </>}
        </Sec>

        <Sec l="剪影背景">
          <div className="background-controls" aria-busy={backgroundLoading}
            onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
            onDrop={event => { event.preventDefault(); event.stopPropagation(); uploadBackground(event.dataTransfer.files?.[0]); }}>
            <Seg options={[["image", "图片背景"], ["solid", "纯色背景"], ["original", "原图挖空"]]} value={sceneMode} set={value => {
              ++backgroundRequestRef.current; setBackgroundLoading(false);
              setSceneMode(value as 'image' | 'solid' | 'original'); setAutoBackground(false); setActive('background');
              if (value === 'image' && !backgroundRef.current) chooseBackground('cloud-sea', true);
              if (value === 'original') alignOriginalBackground();
            }} />
            {sceneMode === 'image' ? <>
              <div className="background-grid">
                {backgroundPresets.map(preset => <button type="button" key={preset.id}
                  className={`background-preset ${backgroundId === preset.id ? 'active' : ''}`}
                  aria-label={`选择背景 ${preset.name}`} aria-pressed={backgroundId === preset.id}
                  onClick={() => { setActive('background'); chooseBackground(preset.id); }}>
                  <img src={backgroundUrl(preset.file, true)} alt={preset.name} loading="lazy" />
                  <span>{preset.name}</span>
                </button>)}
              </div>
              <button type="button" className="secondary full background-upload" disabled={backgroundLoading}
                onClick={() => backgroundFileRef.current?.click()}
                onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
                onDrop={event => { event.preventDefault(); event.stopPropagation(); uploadBackground(event.dataTransfer.files?.[0]); }}>
                <UploadSimple />上传背景图片
              </button>
              <button type="button" className="secondary full" disabled={!hasImage || backgroundLoading}
                onClick={() => { setActive('background'); chooseBackground('', true); }}>按照片颜色匹配</button>
              <p className="control-note background-choice" aria-live="polite">
                {backgroundLoading ? '正在载入背景…' : `${autoBackground ? '自动匹配' : '当前背景'} · ${backgroundName}`}
              </p>
              <p className="control-note">可在画布上移动、缩放和旋转背景；背景与剪影独立，不使用原照片背景。</p>
            </> : sceneMode === 'solid' ? <>
              <label className="scene-color">背景颜色<input type="color" aria-label="剪影背景颜色" value={sceneColor}
                onChange={event => {setSceneColor(event.target.value); setAutoBackground(false);}} /></label>
              <div className="scene-swatches">{suggestedColors.map(swatch => <button type="button" key={swatch}
                aria-label={`背景颜色 ${swatch}`} style={{background: swatch}} onClick={() => setSceneColor(swatch)} />)}</div>
              <p className="control-note">纯色只填充剪影所在分区，不改变另一半的人物背景色。</p>
            </> : <>
              <p className="control-note">保留原照片，人物区域透明挖空，纯色剪影覆盖原位置。切换时只重新对齐原图背景和剪影，不改变实体主体。</p>
              <label className="check-control"><input type="checkbox" checked={originalLinked} onChange={event => setOriginalLinked(event.target.checked)} />原图背景变换时同步剪影</label>
              <button type="button" className="secondary full" disabled={!hasImage} onClick={alignOriginalBackground}>重新对齐原图与剪影</button>
            </>}
          </div>
        </Sec>

        <Sec l="图层">
          <div className="layer-list">
            {layerOrder.map(layer => (
              <div key={layer} data-layer={layer}
                className={`layer-entry ${layerDrop?.layer === layer ? (layerDrop.after ? 'drop-after' : 'drop-before') : ''}`}
                draggable={!busy && !exporting && !backgroundLoading}
                onDragStart={event => { draggedLayerRef.current = layer; event.dataTransfer.setData('application/x-afterimage-layer', layer); event.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={event => { if (!draggedLayerRef.current) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
                  const rect = event.currentTarget.getBoundingClientRect(); const after = event.clientY > rect.top + rect.height / 2;
                  setLayerDrop(current => current?.layer === layer && current.after === after ? current : { layer, after }); }}
                onDrop={event => { event.preventDefault(); event.stopPropagation(); const moving = draggedLayerRef.current;
                  const rect = event.currentTarget.getBoundingClientRect(); if (moving) reorderLayer(moving, layer, event.clientY > rect.top + rect.height / 2);
                  draggedLayerRef.current = null; setLayerDrop(null); }}
                onDragEnd={() => { draggedLayerRef.current = null; setLayerDrop(null); }}>
                <span className="layer-grip" title="拖动图层调整顺序"><DotsSixVertical /></span>
                <button className={`layer-select ${active === layer ? "active" : ""}`}
                  onClick={() => { setActive(layer); if (layer === "background" || layer === "solid") { setMaskMode("none"); setMaskView(false); } }}
                >
                  <span
                    className={`layer-mark ${layer}`}
                    style={
                      layer === "solid" ? { background: color } : undefined
                    }
                  />
                  <span>
                    <strong>{layerNames[layer]}</strong>
                    <small>{layerNotes[layer]}</small>
                  </span>
                </button>
              </div>
            ))}
          </div>
          <p className="control-note">拖动上下排序，上方图层显示在前；顺序同步到图片与 PSD 导出。</p>
        </Sec>

        <Sec l={`当前图层  ${layerNames[active]}`}>
          {active === "solid" || (active === 'background' && sceneMode === 'solid') ? (
            <p className="control-note">
              纯色背景跟随区域边界。拖动上方“区域比例”即可改变它的大小。
            </p>
          ) : (
            <>
              {transformControls(active)}
              <button
                className="secondary full"
                onClick={() => {
                  const original = originalRef.current;
                  const bounds = boundsRef.current;
                  if (!original || !bounds) return;
                  const automatic = autoTransforms(
                    layout,
                    split,
                    size,
                    bounds,
                    original.naturalWidth,
                    original.naturalHeight,
                    sceneMode === 'original',
                    panelsSwapped,
                  );
                  setObject(active, automatic[active]);
                }}
              >
                重置当前图层
              </button>
            </>
          )}
        </Sec>

        {active === 'subject' && (
          <Sec l="实体主体效果">
            <Seg options={[["off", "原照片"], ["on", "彩色半调"]]}
              value={halftone.enabled ? 'on' : 'off'} set={value => setHalftone(current => ({...current, enabled: value === 'on'}))} />
            {halftone.enabled && <div className="effect-controls">
              <Range name="网点大小" min={4} max={64} value={halftone.cellSize} set={cellSize => setHalftone(current => ({...current, cellSize}))} />
              <label className="effect-field">网点形状<select aria-label="网点形状" value={halftone.shape}
                onChange={event => setHalftone(current => ({...current, shape: event.target.value as DotShape}))}>
                <option value="dot">圆点 · Dot</option><option value="square">方块 · Square</option>
                <option value="diamond">菱形 · Diamond</option><option value="ellipse">椭圆 · Ellipse</option><option value="line">线条 · Line</option>
              </select></label>
              <Range name="网点角度" min={-90} max={90} value={halftone.angle} set={angle => setHalftone(current => ({...current, angle}))} />
              <Range name="半调混合" min={0} max={100} value={halftone.mix} set={mix => setHalftone(current => ({...current, mix}))} />
              <Range name="半调锐度" min={0} max={100} value={halftone.sharpness} set={sharpness => setHalftone(current => ({...current, sharpness}))} />
              <p className="control-note">保留原照片颜色，以规则网点组成主体。混合 100 为纯网点；0 为原照片。网点之间露出下方图层。</p>
            </div>}
          </Sec>
        )}
        {active === 'silhouette' && (
          <Sec l="剪影轮廓与散落文字">
            <Seg options={[["clean", "实心轮廓"], ["pixel", "像素轮廓"]]} value={silhouetteEffect.style}
              set={style => setSilhouetteEffect(current => ({...current, style: style as SilhouetteSettings['style']}))} />
            <div className="effect-controls">
              {(silhouetteEffect.style === 'pixel' || silhouetteEffect.textEnabled) && <Range name={silhouetteEffect.style === 'pixel' ? '像素大小' : '文字间距'} min={4} max={64} value={silhouetteEffect.cellSize}
                set={cellSize => setSilhouetteEffect(current => ({...current, cellSize}))} />}
              <label className="check-control"><input type="checkbox" aria-label="启用散落文字" checked={silhouetteEffect.textEnabled}
                onChange={event => setSilhouetteEffect(current => ({...current, textEnabled: event.target.checked}))} />添加散落文字</label>
              {silhouetteEffect.textEnabled && <>
                <label className="effect-text-label">文字内容<textarea aria-label="散落文字内容" value={silhouetteEffect.text} maxLength={500}
                  placeholder="输入你喜欢的文字，字符会散落在轮廓内"
                  onChange={event => setSilhouetteEffect(current => ({...current, text: event.target.value}))} /></label>
                <Range name="文字密度" min={1} max={100} value={silhouetteEffect.density} set={density => setSilhouetteEffect(current => ({...current, density}))} />
                <Range name="散落字号" min={30} max={600} value={silhouetteEffect.fontSize} set={fontSize => setSilhouetteEffect(current => ({...current, fontSize}))} />
                <p className="control-note">字号按照片尺寸等比例缩放，独立于像素大小；放大剪影或高清导出时，文字会同步变大。</p>
                <label className="effect-field">散落文字颜色<input type="color" aria-label="散落文字颜色" value={silhouetteEffect.textColor}
                  onChange={event => setSilhouetteEffect(current => ({...current, textColor: event.target.value}))} /></label>
                <button type="button" className="secondary full" onClick={() => setSilhouetteEffect(current => ({...current, seed: current.seed + 1}))}>换一种散落排列</button>
              </>}
              <p className="control-note">像素轮廓为实心方块；文字仅散落在剪影内部。关掉文字即可保留纯像素效果，切回实心轮廓并关闭文字可恢复原剪影。</p>
            </div>
          </Sec>
        )}

        {(active === "solid" || active === "silhouette") && (
          <Sec l="纯色">
            <div className="swatches">
              {suggestedColors.map((swatch) => (
                <button
                  key={swatch}
                  style={{ background: swatch }}
                  className={color === swatch ? "selected" : ""}
                  onClick={() => setColor(swatch)}
                  aria-label={`颜色 ${swatch}`}
                >
                  {color === swatch && <Check />}
                </button>
              ))}
              <label className="custom-swatch" style={{ background: color }}>
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
                <span>+</span>
              </label>
            </div>
          </Sec>
        )}

        {active === "background" && sceneMode !== 'solid' && (
          <Sec l="背景图片色调">
            <Seg
              options={[
                ["color", "保持原色"],
                ["mono", "黑白"],
              ]}
              value={mono ? "mono" : "color"}
              set={(value) => setMono(value === "mono")}
            />
            <Range
              name="饱和度"
              min={-60}
              max={80}
              value={tone}
              set={setTone}
            />
          </Sec>
        )}

        {active === "silhouette" && (
          <Sec l="剪影阴影">
            <Range
              name="外阴影"
              min={0}
              max={100}
              value={outer}
              set={setOuter}
            />
            <Range
              name="内边缘"
              min={0}
              max={100}
              value={inner}
              set={setInner}
            />
            <Range
              name="柔化范围"
              min={0}
              max={70}
              value={blur}
              set={setBlur}
            />
          </Sec>
        )}

        {(active === "silhouette" || active === "subject") && (
          <Sec l="自由涂抹">
            <label className="check-control"><input type="checkbox" checked={maskView} onChange={event => setMaskView(event.target.checked)} />查看透明蒙版</label>
            <Range name="轮廓识别阈值" min={24} max={200} value={alphaThreshold} set={setAlphaThreshold} />
            <button className="secondary full" disabled={!hasImage || busy} onClick={applyThreshold}>重新应用实心轮廓</button>
            <p className="control-note">降低阈值保留细节；重新应用会清除手动画笔修改。</p>
            <p className="control-note">
              可直接在纯色剪影或实体主体上涂抹。画笔取回原图像素，橡皮擦删除区域；两边共享轮廓并同步更新，圆圈为实际作用范围。
            </p>
            <Range
              name="画笔大小"
              min={1}
              max={140}
              value={paintSize}
              set={setPaintSize}
            />
            <Range
              name="橡皮大小"
              min={1}
              max={180}
              value={eraserSize}
              set={setEraserSize}
            />
            <div className="repair-actions">
              <button
                className={maskMode === "paint" ? "active" : ""}
                onClick={() => {
                  setMaskMode("paint");
                  if (layout === "overlay") setActive("silhouette");
                  setSheet(false);
                }}
              >
                自由涂抹
              </button>
              <button
                className={maskMode === "erase" ? "active" : ""}
                onClick={() => {
                  setMaskMode("erase");
                  if (layout === "overlay") setActive("silhouette");
                  setSheet(false);
                }}
              >
                橡皮擦
              </button>
            </div>
            <div className="history-actions">
              <button
                className="secondary"
                disabled={maskHistoryRef.current.undo.length === 0}
                onClick={undoMask}
              >
                撤销
              </button>
              <button
                className="secondary"
                disabled={maskHistoryRef.current.redo.length === 0}
                onClick={redoMask}
              >
                重做
              </button>
            </div>
            <p className="control-note history-note">最多 15 步 · Ctrl/⌘ Z 撤销 · Ctrl/⌘ Shift Z 重做 · [ ] 调笔刷</p>
          </Sec>
        )}
        <Sec l="表面质感">
          <Seg options={[["none", "无"], ["paper", "纸纹"], ["grain", "颗粒"]]} value={texture} set={setTexture} />
          <p className="control-note">默认不添加质感。选择“无”可关闭纸纹和颗粒，预览与导出同步。</p>
        </Sec>
      </>
    ),
    [
      active,
      blur,
      canvasPreset,
      color,
      eraserSize,
      historyRevision,
      inner,
      layout,
      maskMode,
      maskRevision,
      mono,
      outer,
      paintSize,
      customHeight,
      customWidth,
      size,
      split,
      tone,
      transforms,
      suggestedColors, alphaThreshold, maskView, busy, texture,
      sceneMode, sceneColor, backgroundId, backgroundName, autoBackground, backgroundLoading, backgroundRevision, hasImage,
      originalLinked,
      layerOrder, layerDrop,
      canvasRatioLocked,
      halftone, silhouetteEffect,
      panelsSwapped,
    ],
  );

  const finishPanel = (
    <>
      <Title t="高清导出" s="选择框和修补提示不会进入导出图片" />
      <Sec l="导出分辨率">
        <Seg options={[["1", "1×"], ["2", "2× 高清"], ["4", "4× 超清"]]} value={String(exportScale)} set={value => setExportScale(Number(value))} />
        <p className="control-note">从原图与独立图层重新渲染。{exportDimensions.limited ? "已按浏览器内存预算限制尺寸。" : "选择框与工具按钮不会进入图片。"}</p>
      </Sec>
      <div className="export-card">
        <strong>
          {Math.round(size.w * exportMultiplier)} ×{" "}
          {Math.round(size.h * exportMultiplier)} px
        </strong>
        <button
          className="primary full"
          disabled={!hasImage || exporting || busy || backgroundLoading}
          onClick={() => download("png")}
        >
          <DownloadSimple />
          {exporting ? "生成中…" : "导出 PNG"}
        </button>
        <button
          className="secondary full"
          disabled={!hasImage || exporting || busy || backgroundLoading}
          onClick={() => download("jpeg")}
        >
          导出 JPG
        </button>
        <button className="secondary full" disabled={!hasImage || exporting || busy || backgroundLoading} onClick={() => download("webp")}>导出 WebP</button>
        <button className="secondary full" disabled={!hasImage || exporting || busy || backgroundLoading} onClick={() => download("png", true)}>导出透明剪影 PNG</button>
        <button
          className="secondary full desktop-psd"
          disabled={!hasImage || exporting || busy || backgroundLoading}
          onClick={exportPsd}
        >
          导出分层 PSD
        </button>
      </div>
      {exporting && <p className="control-note" role="status">{progress}</p>}
    </>
  );

  const panel = tool === "edit" ? editPanel : finishPanel;

  return (
    <main
      className="app-shell"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const dropped = event.dataTransfer.files?.[0];
        if (dropped) upload(dropped);
      }}
    >
      <div className="workspace">
        <section className="side-panel">
      <header className="topbar">
        <div className="brand">
          <span>剪影生成器</span>
          <small>AFTERIMAGE</small>
        </div>

        <nav className="creator-strip" aria-label="作者与创意链接">
          <span className="creator-item creator-author">
            <UserCircle aria-hidden="true" />
            <span className="creator-label">作者</span>
            <strong>安鱼</strong>
          </span>

          <a
            className="creator-item creator-link"
            href="https://www.anyusj.com/"
            target="_blank"
            rel="noopener noreferrer"
            title="点击前往"
            data-tip="点击前往"
          >
            <GlobeSimple aria-hidden="true" />
            <span className="creator-label">创意网站</span>
            <strong>ANYUSJ.COM</strong>
          </a>

          <div
            className={`wechat-popover ${wechatOpen ? "open" : ""}`}
            onMouseLeave={() => setWechatOpen(false)}
          >
            <button
              type="button"
              className="creator-item wechat-trigger"
              aria-expanded={wechatOpen}
              aria-controls="wechat-qr-card"
              title="查看公众号二维码"
              onClick={() => setWechatOpen((current) => !current)}
            >
              <WechatLogo aria-hidden="true" />
              <span className="creator-label">公众号</span>
              <strong>安鱼设计资源</strong>
            </button>
            <div
              className="qr-card"
              id="wechat-qr-card"
              role="tooltip"
              aria-hidden={!wechatOpen}
            >
              <img
                src={new URL('assets/anyusj-wechat-qr.png', document.baseURI).href}
                alt="安鱼设计资源公众号二维码"
              />
              <span>微信扫码关注</span>
            </div>
          </div>

          <a
            className="creator-item creator-link"
            href="https://xhslink.cn/m/5g1EQhRumkz"
            target="_blank"
            rel="noopener noreferrer"
            title="点击前往"
            data-tip="点击前往"
          >
            <BookOpenText aria-hidden="true" />
            <span className="creator-label">小红书</span>
            <strong>ANYU安鱼设计资源</strong>
          </a>
        </nav>

        <div className="top-actions">
          <span className="privacy">照片仅在此设备处理</span>
          <button
            className="secondary replace"
            disabled={busy || exporting || backgroundLoading}
            onClick={() => fileRef.current?.click()}
          >
            <UploadSimple />
            {hasImage ? "更换照片" : "上传照片"}
          </button>
        </div>
      </header>

        <nav className="sidebar-tabs" aria-label="编辑面板">
          <ToolButton
            id="edit"
            label="编辑"
            icon={<CornersOut />}
            active={tool === "edit"}
            set={setTool}
          />
          <ToolButton
            id="finish"
            label="导出"
            icon={<SlidersHorizontal />}
            active={tool === "finish"}
            set={setTool}
          />
        </nav>
        <div className="sidebar-content"><fieldset disabled={busy || exporting} className="panel-fieldset">{panel}</fieldset></div>
        <footer className="sidebar-footer">
          <span>作者：安鱼</span>
          <nav aria-label="作者链接">
            <a href="https://www.anyusj.com/" target="_blank" rel="noopener noreferrer" title="点击前往"><GlobeSimple />ANYUSJ.COM</a>
            <div className="footer-wechat" onMouseEnter={() => setWechatOpen(true)} onMouseLeave={() => setWechatOpen(false)}>
              <button onClick={() => setWechatOpen(value => !value)} aria-expanded={wechatOpen}><WechatLogo />公众号</button>
              {wechatOpen && <div className="footer-qr"><img src={new URL('assets/anyusj-wechat-qr.png', document.baseURI).href} alt="安鱼设计资源公众号二维码" /><span>安鱼设计资源</span></div>}
            </div>
            <a href="https://xhslink.cn/m/5g1EQhRumkz" target="_blank" rel="noopener noreferrer" title="点击前往"><BookOpenText />小红书</a>
          </nav>
          <small>照片仅在此设备处理</small>
          <small className="legal-links">© 2026 安鱼 · <a href={new URL('about.html', document.baseURI).href} target="_blank" rel="noopener noreferrer">开源许可与源码</a> · 不提供担保</small>
        </footer>
        </section>

        <section className="stage" ref={stageRef}>
          <div className="stage-meta">
            <span>
              AUTO · {size.w} × {size.h}
            </span>
            <span className="canvas-view-controls">
              <button type="button" className="canvas-fit" onClick={fitCanvasToStage} title="保持原比例完整显示，不改变导出尺寸"><CornersOut />适应窗口</button>
              <small>{displayWidth ? Math.round(displayWidth / size.w * 100) : 100}%</small>
              {hasImage ? `当前图层  ${layerNames[active]}` : "等待照片"}
            </span>
          </div>
          <div
            className={`canvas-wrap ${!hasImage ? "empty" : ""} ${maskMode !== "none" ? "repairing" : ""}`}
            style={
              {
                aspectRatio: `${size.w} / ${size.h}`,
                ...(displayWidth ? { width: displayWidth } : {}),
                "--canvas-ratio": size.w / size.h,
              } as React.CSSProperties
            }
          >
            <canvas
              ref={canvasRef}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onPointerEnter={(event) => {
                if (maskMode !== "none")
                  positionBrushCursor(pointerPoint(event));
              }}
              onPointerLeave={() => {
                if (!dragRef.current && brushCursorRef.current)
                  brushCursorRef.current.style.display = "none";
              }}
            />
            {hasImage && maskMode === "none" && !maskView && !busy && !exporting && selectionGeometry && (
              <div
                className="transform-overlay"
                onPointerMove={updateTransformGesture}
                onPointerUp={endTransformGesture}
                onPointerCancel={endTransformGesture}
              >
                <div
                  className="transform-layer"
                  style={{
                    transformOrigin: `${selectionGeometry.originX}% ${selectionGeometry.originY}%`,
                    transform: `rotate(${selectionGeometry.rotation}deg)`,
                  }}
                >
                  <div
                    className={`transform-box ${active === "solid" ? "locked" : ""}`}
                    style={{
                      left: `${selectionGeometry.left}%`,
                      top: `${selectionGeometry.top}%`,
                      width: `${selectionGeometry.width}%`,
                      height: `${selectionGeometry.height}%`,
                    }}
                    onPointerDown={(event) => {
                      const selected = pickLayer(pointerPoint(event));
                      setActive(selected);
                      if (selected !== "solid" && !(selected === 'background' && sceneMode === 'solid')) beginTransformGesture(event, "move", selected);
                    }}
                  >
                    {active !== "solid" && !(active === 'background' && sceneMode === 'solid') && (
                      <>
                        {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                          <button
                            key={corner}
                            className={`transform-handle ${corner}`}
                            aria-label="缩放图层"
                            onPointerDown={(event) =>
                              beginTransformGesture(event, "scale", active)
                            }
                          />
                        ))}
                        <button
                          className="rotate-handle"
                          aria-label="旋转图层"
                          onPointerDown={(event) =>
                            beginTransformGesture(event, "rotate", active)
                          }
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            {hasImage && maskMode !== "none" && (
              <div
                ref={brushCursorRef}
                className={`brush-cursor ${maskMode}`}
                style={{
                  width: `${(activeBrushSize * 2 * 100) / size.w}%`,
                  aspectRatio: "1 / 1",
                }}
              />
            )}
            {!hasImage && (
              <button
                className="upload-empty"
                onClick={() => fileRef.current?.click()}
              >
                <span>
                  <ImageSquare />
                </span>
                <strong>从一张照片开始</strong>
                <small>点击选择，或把图片拖到这里</small>
                <em>JPG · PNG · WEBP</em>
              </button>
            )}
            {busy && (
              <div className="processing">
                <Sparkle weight="fill" />
                <strong role="status">{progress}{progressPercent !== undefined ? ` ${progressPercent}%` : ""}</strong>
                <span>主体识别与背景配色均在本地完成</span>
                <i />
              </div>
            )}
          </div>

          {hasImage && maskMode === "none" && (
            <div className="object-switch">
              {(
                ["background", "solid", "silhouette", "subject"] as Layer[]
              ).map((layer) => (
                <button
                  key={layer}
                  className={active === layer ? "active" : ""}
                  onClick={() => setActive(layer)}
                >
                  {layer === "background" && <ImageSquare />}
                  {layer === "solid" && <Palette />}
                  {layer === "silhouette" && <Selection />}
                  {layer === "subject" && <UserFocus />}
                  {layerNames[layer]}
                </button>
              ))}
            </div>
          )}

          {hasImage && maskMode !== "none" && (
            <div className="mask-status">
              <span>
                {maskMode === "paint" ? "自由涂抹" : "橡皮擦"} ·{" "}
                {layerNames[active]} · {activeBrushSize}px
              </span>
              <div className="mask-target-switch">
                <button className={active === "silhouette" ? "active" : ""} onClick={() => setActive("silhouette")} aria-label="在纯色剪影上涂抹">纯色剪影</button>
                <button className={active === "subject" ? "active" : ""} disabled={layout === "overlay"} onClick={() => setActive("subject")} aria-label="在实体主体上涂抹">实体主体</button>
              </div>
              <div className="mask-history-actions">
                <button
                  disabled={maskHistoryRef.current.undo.length === 0}
                  onClick={undoMask}
                  aria-label="撤销涂抹"
                  title="撤销"
                >
                  <ArrowCounterClockwise />
                </button>
                <button
                  disabled={maskHistoryRef.current.redo.length === 0}
                  onClick={redoMask}
                  aria-label="重做涂抹"
                  title="重做"
                >
                  <ArrowClockwise />
                </button>
              </div>
              <button className="mask-finish" onClick={finishMask}>
                完成修补
              </button>
            </div>
          )}

          {processingMode && hasImage && <p className="runtime-note">{processingMode} · 照片在本机处理</p>}
          {error && (
            <div className="error-note" role="alert">
              <span>{error}</span>
              {pendingFileRef.current && !busy && <button className="secondary" onClick={() => upload(pendingFileRef.current!, true)}>CPU 兼容重试</button>}
              <button onClick={() => setError("")} aria-label="关闭错误提示">
                <X />
              </button>
            </div>
          )}
        </section>
      </div>

      <div className="mobile-bar">
        <ToolButton
          id="edit"
          label="编辑"
          icon={<CornersOut />}
          active={tool === "edit"}
          set={(next) => {
            setTool(next);
            setSheet(true);
          }}
        />
        <ToolButton
          id="finish"
          label="导出"
          icon={<SlidersHorizontal />}
          active={tool === "finish"}
          set={(next) => {
            setTool(next);
            setSheet(true);
          }}
        />
      </div>

      {sheet && (
        <>
          <button
            className="sheet-scrim"
            onClick={() => setSheet(false)}
            aria-label="关闭面板"
          />
          <section className="bottom-sheet">
            <div className="sheet-handle" />
            <button
              className="sheet-close"
              onClick={() => setSheet(false)}
              aria-label="收起面板"
            >
              <ArrowDown />
            </button>
            {panel}
          </section>
        </>
      )}

      <input
        ref={fileRef}
        hidden
        type="file"
        aria-label="上传主体照片"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; upload(file); }}
      />
      <input ref={backgroundFileRef} hidden type="file" aria-label="选择背景图片文件"
        accept="image/jpeg,image/png,image/webp"
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; uploadBackground(file); }} />
    </main>
  );
}

function Title({ t, s }: { t: string; s: string }) {
  return (
    <div className="panel-title">
      <span>{t}</span>
      <p>{s}</p>
    </div>
  );
}

function Sec({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <section className="control-section">
      <label>{l}</label>
      {children}
    </section>
  );
}

function Seg({
  options,
  value,
  set,
}: {
  options: string[][];
  value: string;
  set: (value: string) => void;
}) {
  return (
    <div className="segment">
      {options.map(([id, label]) => (
        <button
          className={value === id ? "active" : ""}
          onClick={() => set(id)}
          key={id}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Range({
  name,
  min,
  max,
  value,
  set,
}: {
  name: string;
  min: number;
  max: number;
  value: number;
  set: (value: number) => void;
}) {
  return (
    <label className="range-row">
      <span>
        {name}
        <b>{Math.round(value)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => set(Number(event.target.value))}
      />
    </label>
  );
}

function ToolButton({
  id,
  label,
  icon,
  active,
  set,
}: {
  id: Tool;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  set: (value: Tool) => void;
}) {
  return (
    <button
      className={`tool-button ${active ? "active" : ""}`}
      onClick={() => set(id)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
