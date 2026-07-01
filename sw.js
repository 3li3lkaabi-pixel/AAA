// Service worker for "ذكاء" PWA
// Strategy:
//  - Navigations (HTML): network-first, fall back to cached shell when offline.
//  - Static assets (JS/CSS/img/font): stale-while-revalidate.
//  - Version bump the cache name to roll out new assets cleanly.

const VERSION = 'v2';
const PRECACHE = `thaka-precache-${VERSION}`;
const RUNTIME = `thaka-runtime-${VERSION}`;

// Paths are relative to the service worker's scope, so the app also works
// when deployed inside a sub-directory.
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) =>
      // addAll fails atomically; use individual puts so one missing file
      // doesn't block the whole install.
      Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          fetch(new Request(url, { cache: 'reload' }))
            .then((res) => (res.ok ? cache.put(url, res) : null))
            .catch(() => null)
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = new Set([PRECACHE, RUNTIME]);
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !keep.has(name)).map((name) => caches.delete(name))
      );
      // Speed up navigation for supported browsers.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

// Allow the page to trigger an immediate activation of a waiting worker.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET; let the browser deal with everything else.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Don't cache cross-origin requests (e.g. Google Fonts CSS) beyond runtime;
  // and never intercept non-http(s) schemes.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // App shell / navigations: network-first.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;
          const network = await fetch(request);
          const cache = await caches.open(RUNTIME);
          cache.put('./index.html', network.clone());
          return network;
        } catch (err) {
          const cached =
            (await caches.match('./index.html')) || (await caches.match('./'));
          return cached || new Response('غير متصل بالإنترنت', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })()
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(RUNTIME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => null);

      return cached || (await network) || new Response('', { status: 504 });
    })()
  );
});
