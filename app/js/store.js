// Everything lives on the phone: settings/entries in localStorage, the screenshot queue in IndexedDB.
import { todayIso } from './core/util.js';
import { CONFIG } from './config.js';

const KEY = 'ndina.v1';

const defaults = () => ({
  v: 1,
  settings: { name: '', lang: 'sw', prefix: CONFIG.controlPrefix, dateOverride: null },
  entries: [],
  filter: null,
  license: null, // { code }
  leader: { roster: [], sessions: {} },
});

function load() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    return {
      ...base, ...s,
      settings: { ...base.settings, ...(s.settings || {}) },
      leader: { ...base.leader, ...(s.leader || {}) },
    };
  } catch { return base; }
}

export let S = load();
export let storageError = false;

let timer = null;
export function save() { clearTimeout(timer); timer = setTimeout(saveNow, 100); }
export function saveNow() {
  clearTimeout(timer);
  try { localStorage.setItem(KEY, JSON.stringify(S)); storageError = false; }
  catch { storageError = true; }
}
export function replaceState(next) {
  const base = defaults();
  S = { ...base, ...next, settings: { ...base.settings, ...(next.settings || {}) }, leader: { ...base.leader, ...(next.leader || {}) } };
  saveNow();
}
export function resetAll() { S = defaults(); saveNow(); }
export const reportDate = () => S.settings.dateOverride || todayIso();

addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
addEventListener('pagehide', saveNow);

// ---- screenshot queue (IndexedDB, with in-memory fallback) ----
const mem = new Map();
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('ndina', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(() => null);
  }
  return dbp;
}
const tx = (d, mode, fn) => new Promise((res, rej) => {
  const t = d.transaction('queue', mode); const st = t.objectStore('queue');
  const rq = fn(st); t.oncomplete = () => res(rq?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
});
export async function qPut(item) { const d = await db(); if (!d) { mem.set(item.id, item); return; } await tx(d, 'readwrite', (s) => s.put(item)); }
export async function qKeys() { const d = await db(); if (!d) return [...mem.keys()]; return tx(d, 'readonly', (s) => s.getAllKeys()); }
export async function qGet(id) { const d = await db(); if (!d) return mem.get(id); return tx(d, 'readonly', (s) => s.get(id)); }
export async function qDel(id) { const d = await db(); if (!d) { mem.delete(id); return; } await tx(d, 'readwrite', (s) => s.delete(id)); }
export async function qClear() { const d = await db(); if (!d) { mem.clear(); return; } await tx(d, 'readwrite', (s) => s.clear()); }
