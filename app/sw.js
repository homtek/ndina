// Offline support. Bump VERSION when you change any file so phones pick up the update.
const VERSION = 'ndina-1.2.0';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/xlsx.js', 'js/core/weeklyxlsx.js', 'templates/ripoti-wiki-kanda-2.xlsx', 'js/config.js', 'js/i18n.js', 'js/store.js', 'js/ocr.js', 'js/share.js',
  'js/core/util.js', 'js/core/gepg.js', 'js/core/reportparse.js', 'js/core/pools.js', 'js/core/compile.js', 'js/core/format.js', 'js/core/license.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isVendor = req.url.includes('/vendor/');
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    // Big OCR files: cache first, saved the first time they are used.
    if (isVendor && hit) return hit;
    const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
    if (hit) { refresh.catch(() => {}); return hit; }       // app files: show cached, update in background
    try { return await refresh; } catch { return req.mode === 'navigate' ? cache.match('index.html') : Response.error(); }
  })());
});
