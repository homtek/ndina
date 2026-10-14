// Reads queued screenshots one by one, on the phone. Nothing is uploaded.
import { parseGepgText } from './core/gepg.js';
import { qPut, qKeys, qGet, qDel } from './store.js';
import { uid } from './core/util.js';

const BASE = new URL('./vendor/tesseract/', document.baseURI.replace(/[^/]*$/, '')).href;
export const progress = { running: false, total: 0, done: 0, current: '', stop: false, engineError: false };

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('engine'));
    document.head.appendChild(s);
  });
}

async function makeWorker() {
  await loadScript(BASE + 'tesseract.min.js');
  return window.Tesseract.createWorker('eng', 1, {
    workerPath: BASE + 'worker.min.js',
    corePath: BASE + 'core/',
    langPath: BASE + 'lang/',
    gzip: true,
  });
}

async function toCanvas(blob, maxW = 800) {
  let bmp;
  try { bmp = await createImageBitmap(blob); }
  catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(blob);
      img.onload = () => { res(img); URL.revokeObjectURL(url); }; img.onerror = rej; img.src = url;
    });
  }
  const w = bmp.width, h = bmp.height;
  const k = w > maxW ? maxW / w : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}

export async function enqueue(files) {
  for (const f of files) await qPut({ id: uid(), name: f.name || 'image', blob: f });
}
export const pendingCount = async () => (await qKeys()).length;

// onItem(result, fileName) is called after each screenshot; onProgress() after each step.
export async function run({ prefix, onItem, onProgress }) {
  if (progress.running) return;
  progress.running = true; progress.stop = false; progress.engineError = false; progress.done = 0;
  let wake = null;
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  const workers = [];
  try {
    const keys = await qKeys();
    progress.total = keys.length;
    onProgress();
    if (!keys.length) return;
    const n = (navigator.hardwareConcurrency || 2) >= 6 ? 2 : 1;
    try { for (let i = 0; i < n; i++) workers.push(await makeWorker()); }
    catch { progress.engineError = true; return; }
    let next = 0;
    await Promise.all(workers.map(async (w) => {
      while (!progress.stop && next < keys.length) {
        const id = keys[next++];
        const item = await qGet(id);
        if (!item) continue;
        progress.current = item.name;
        let res;
        try {
          const canvas = await toCanvas(item.blob);
          const { data } = await w.recognize(canvas);
          res = parseGepgText(data.text, { prefix });
        } catch { res = { ok: false, reason: 'ocr-error' }; }
        onItem(res, item.name);
        await qDel(id);
        progress.done++;
        onProgress();
      }
    }));
  } finally {
    await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
    try { await wake?.release(); } catch { /* ignore */ }
    progress.running = false; progress.current = '';
    onProgress();
  }
}
