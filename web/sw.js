// Service worker: keeps the app on the device so it opens with no signal.
// Strategy: the app shell (this site's own files) is served from the cache; a new version
// is fetched in the background when online and waits until the page asks to switch.
// Requests to other sites (the Anthropic API) are never touched.
const VERSION = '__VERSION__';
const CACHE = 'route-table-' + VERSION;
const SHELL = __ASSETS__;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('route-table-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // API calls go straight to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // any page load inside the app's scope gets the app (query strings ignored)
    const key = req.mode === 'navigate' ? new URL('./', self.location).href : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) { return (await cache.match(new URL('./', self.location).href)) || Response.error(); }
  })());
});
