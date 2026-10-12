export type SegmentationProgress = { message: string; percent?: number };
export type SegmentResult = { blob: Blob; device: string };
export type SegmentOptions = { cpu?: boolean; progress: (update: SegmentationProgress) => void };

let running = false;
let worker: Worker | undefined;
let workerUsable = true;
let requestId = 0;
let localPath: Promise<string | undefined> | undefined;
let cachedResult: { input: Blob; output: SegmentResult } | undefined;

async function resources() {
  localPath ??= fetch(new URL('models/resources.json', document.baseURI)).then(async response => {
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return undefined;
    const value = await response.json();
    return value['/models/isnet_fp16'] ? new URL('models/', document.baseURI).href : undefined;
  }).catch(() => undefined);
  return localPath;
}

async function gpuReady() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch { return false; }
}

export function progressMessage(key: string, current: number, total: number): SegmentationProgress {
  if (key.startsWith('compute:')) return { message: '正在识别人物和主体轮廓…' };
  const percent = total > 0 ? Math.min(100, Math.round(current / total * 100)) : undefined;
  return { message: key.includes('model') ? '正在加载识别模型' : '正在准备图像处理组件', percent };
}

class WorkerUnavailable extends Error {}

export async function segment(input: Blob, options: SegmentOptions): Promise<SegmentResult> {
  if (running) throw new Error('正在处理上一张照片，请稍候再试。');
  if (cachedResult?.input === input) {
    options.progress({ message: '已读取本次照片的识别缓存', percent: 100 });
    return cachedResult.output;
  }
  running = true;
  try {
    options.progress({ message: '正在检查浏览器处理能力…' });
    if (!('WebAssembly' in globalThis)) throw new Error('此浏览器没有 WebAssembly，请使用新版 Chrome、Edge、Firefox 或 Safari。');
    const publicPath = await resources();
    const device = !options.cpu && await gpuReady() ? 'gpu' : 'cpu';
    const canWorker = !options.cpu && workerUsable && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
    let used = device;
    const configFor = (backend: 'cpu' | 'gpu') => ({ model: 'isnet_fp16' as const, device: backend, publicPath, proxyToWorker: false, output: { format: 'image/x-rgba8' as const, quality: 1 } });
    const runInline = async () => {
      used = 'cpu';
      options.progress({ message: '正在使用 CPU 兼容模式，请稍候…' });
      const { removeBackground } = await import('@imgly/background-removal');
      return await removeBackground(input, { ...configFor('cpu'), progress: (key, current, total) => options.progress(progressMessage(key, current, total)) });
    };
    const runWorker = async (backend: 'cpu' | 'gpu') => {
      // Return raw RGBA. Some WebKit builds expose OffscreenCanvas without convertToBlob.
      // Encoding on the main thread through HTMLCanvasElement.toBlob works across browsers.
      const config = configFor(backend);
        try { worker ??= new Worker(new URL('./segmentation.worker.ts', import.meta.url), { type: 'module' }); }
        catch { throw new WorkerUnavailable('浏览器阻止了独立识别线程。'); }
        const activeWorker = worker;
        const id = ++requestId;
        return await new Promise<Blob>((resolve, reject) => {
          // Terminating the worker also frees a stalled ONNX session; retry starts a clean one.
          const timer = setTimeout(() => { cleanup(); activeWorker.terminate(); worker = undefined; reject(new Error('处理超时，请尝试兼容模式或较小的照片。')); }, 240_000);
          const startup = setTimeout(() => { cleanup(); activeWorker.terminate(); worker = undefined; reject(new WorkerUnavailable('独立识别线程未能启动。')); }, 12_000);
          const cleanup = () => { clearTimeout(timer); clearTimeout(startup); activeWorker.removeEventListener('message', onMessage); activeWorker.removeEventListener('error', onError); };
          const onMessage = (event: MessageEvent) => {
            if (event.data.ready) { clearTimeout(startup); return; }
            if (event.data.id !== id) return;
            if (event.data.progress) { clearTimeout(startup); options.progress(event.data.progress); }
            else { cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.blob); }
          };
          const onError = (event: ErrorEvent) => { event.preventDefault(); cleanup(); activeWorker.terminate(); worker = undefined; reject(new WorkerUnavailable(event.message || '浏览器无法运行独立识别线程。')); };
          activeWorker.addEventListener('message', onMessage); activeWorker.addEventListener('error', onError);
          try { activeWorker.postMessage({ id, input, config }); }
          catch { cleanup(); activeWorker.terminate(); worker = undefined; reject(new WorkerUnavailable('独立识别线程无法接收照片。')); }
        });
    };
    const run = async (backend: 'cpu' | 'gpu'): Promise<Blob> => {
      if (!canWorker || !workerUsable) return runInline();
      try { return await runWorker(backend); }
      catch (error) {
        if (!(error instanceof WorkerUnavailable)) throw error;
        workerUsable = false;
        worker?.terminate(); worker = undefined;
        options.progress({ message: '独立线程不可用，已自动切换 CPU 兼容模式…' });
        return runInline();
      }
    };
    let blob: Blob;
    try { blob = await run(device); }
    catch (error) {
      if (device === 'cpu') throw error;
      options.progress({ message: 'GPU 无法完成处理，正在切换 CPU 兼容模式…' });
      worker?.terminate(); worker = undefined;
      used = 'cpu'; blob = await run('cpu');
    }
    if (blob.type.startsWith('image/x-rgba8')) {
      const width = Number(blob.type.match(/width=(\d+)/)?.[1]);
      const height = Number(blob.type.match(/height=(\d+)/)?.[1]);
      const pixels = new Uint8ClampedArray(await blob.arrayBuffer());
      if (!width || !height || pixels.length !== width * height * 4) throw new Error('识别结果尺寸不完整，请重试。');
      let foreground = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 96) foreground++;
      if (foreground < 8) throw new Error('未识别到可用主体，请选择轮廓更清晰的照片或调整识别方式。');
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法编码透明蒙版。')), 'image/png'));
      canvas.width = canvas.height = 1;
    }
    const output = { blob, device: used === 'gpu' ? 'GPU 加速' : 'CPU 兼容' };
    cachedResult = { input, output };
    return output;
  } finally { running = false; }
}
