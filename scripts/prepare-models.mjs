// Fetch the version-pinned assets required by the existing IMG.LY inference library.
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const base = 'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/';
await mkdir(root, { recursive: true });
const response = await fetch(base + 'resources.json');
if (!response.ok) throw new Error('Model manifest download failed: ' + response.status);
const manifest = await response.json();
const subset = Object.fromEntries(Object.entries(manifest).filter(([key]) => key.includes('onnxruntime-web') || key === '/models/isnet_fp16'));
const chunks = new Map();
for (const resource of Object.values(subset)) for (const chunk of resource.chunks) chunks.set(chunk.name, chunk.offsets[1] - chunk.offsets[0]);
let completed = 0;
const tasks = [...chunks.entries()];
async function download() {
  while (tasks.length) {
    const [name, bytes] = tasks.pop();
    const target = path.join(root, name);
    try { if ((await stat(target)).size === bytes) { completed++; continue; } } catch {}
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(base + name, { signal: AbortSignal.timeout(90_000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length !== bytes) throw new Error('Incomplete chunk ' + name);
        await writeFile(target, data);
        lastError = undefined; break;
      } catch (error) { lastError = error; }
    }
    if (lastError) throw lastError;
    console.log('Model assets: ' + ++completed + '/' + chunks.size);
  }
}
await Promise.all([download(), download(), download()]);
await writeFile(path.join(root, 'resources.json'), JSON.stringify(subset));
const actual = JSON.parse(await readFile(path.join(root, 'resources.json'), 'utf8'));
console.log('Offline model assets ready: ' + Object.keys(actual).length + ' resources.');
