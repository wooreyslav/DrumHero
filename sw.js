const CACHE = 'drumhero-v1';
const SHELL = ['./', './index.html', './player.js', './midi.js', './db.js', './config.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // index.json: conditional GET via ETag — cache if unchanged (304), update if changed (200)
  if (e.request.url.includes('index.json')) {
    e.respondWith((async () => {
      const cache  = await caches.open(CACHE);
      const cached = await cache.match(e.request);
      try {
        const init = {};
        const etag = cached?.headers.get('etag');
        if (etag) init.headers = { 'If-None-Match': etag };
        const res = await fetch(e.request.url, init);
        if (res.status === 304) return cached;
        if (res.ok) await cache.put(e.request, res.clone());
        return res;
      } catch {
        return cached ?? Response.error();
      }
    })());
    return;
  }

  // Everything else: network first, fallback cache
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
