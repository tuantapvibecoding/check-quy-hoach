/* Service worker: app shell + data cached for offline use; map tiles cached as you browse. */
const VERSION = 'cqh-v0.1.0';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/vn2000.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'data/catalog.json', 'data/thua-115-68.json', 'data/trang-trai-chu-puh.json'];
const TILE_CACHE = 'cqh-tiles-v1', TILE_LIMIT = 1500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILE_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'server.arcgisonline.com') {           // tiles: cache first, fill as browsed
    e.respondWith(caches.open(TILE_CACHE).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') {
        c.put(e.request, res.clone());
        c.keys().then(k => { if (k.length > TILE_LIMIT) k.slice(0, k.length - TILE_LIMIT).forEach(r => c.delete(r)); });
      }
      return res;
    }).catch(() => fetch(e.request)));
    return;
  }
  if (url.origin === location.origin) {                       // app files: network first, fall back to cache offline
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
