// Service worker: makes the site installable and opens instantly.
// Pages and code: network first (always the latest version), cache as a fallback offline.
// NHL data (/api): always fresh from the network; the last answer is kept for offline use.
const CACHE = 'statsnhl-v1';
const SHELL = ['/', '/style.css', '/js/app.js', '/js/data.js', '/js/model.js', '/js/rink3d.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Three.js and fonts from CDNs never change for a given URL: cache first.
  if (url.origin !== location.origin) {
    if (/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
      e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
    }
    return;
  }
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && !url.pathname.startsWith('/api/img/')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))),
  );
});
