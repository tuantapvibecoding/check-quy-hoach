/* Service worker: app shell + data cached for offline use. Third-party map tiles are not cached. */
const OSM_CACHE = 'cqh-osm-v1';   // offline basemap survives app updates
const VERSION = 'cqh-v0.5.0';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/vn2000.js', 'js/version.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'data/catalog.json', 'data/thua-115-68.json', 'data/trang-trai-chu-puh.json'];

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(VERSION).then(c => c.addAll(SHELL)),
    caches.open(OSM_CACHE).then(c => c.addAll(['data/osm/index.json', 'data/osm/z0.json'])).catch(() => {}),   // province overview always offline
  ]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== OSM_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Map tiles (Google, Esri) are never stored by the app: their terms forbid caching for offline use.
  if (url.origin === location.origin && url.pathname.includes('/data/osm/')) {   // offline map: cache first, refresh in background
    e.respondWith(caches.open(OSM_CACHE).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request, { cache: 'no-cache' }).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; });
      if (hit) { net.catch(() => {}); return hit; }
      return net;
    }));
    return;
  }
  if (url.origin === location.origin) {                       // app files: network first (revalidated), cache when offline
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
