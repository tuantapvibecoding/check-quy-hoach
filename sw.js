/* Service worker: app shell + data cached for offline use. Third-party map tiles are not cached. */
const VERSION = 'cqh-v0.4.0';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/vn2000.js', 'js/version.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'data/catalog.json', 'data/thua-115-68.json', 'data/trang-trai-chu-puh.json'];

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Map tiles (Google, Esri) are never stored by the app: their terms forbid caching for offline use.
  if (url.origin === location.origin) {                       // app files: network first (revalidated), cache when offline
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
