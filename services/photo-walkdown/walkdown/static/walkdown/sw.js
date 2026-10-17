/* global self, caches, fetch, clients */
// Service worker for the photo walkdown. It exists so a department keeps
// working with no signal:
//   /static/*   stale-while-revalidate (files are not content-hashed)
//   /thumb/*    cache-first (the URL carries the photo's version)
//   navigations network-first with a short timeout, falling back to the
//               copy saved by "Download for offline", then /offline/
//   precache    requests carrying X-Walkdown-Precache (the Download for
//               offline button) are fetched fresh and saved in the right cache
// API calls, sign-in, and HTMX partial requests always go to the network.
// Bump VERSION when these strategies change.
const VERSION = 'v1';
const STATIC_CACHE = `walkdown-static-${VERSION}`;
const PAGE_CACHE = `walkdown-pages-${VERSION}`;
const THUMB_CACHE = `walkdown-thumbs-${VERSION}`;
const KNOWN_CACHES = [STATIC_CACHE, PAGE_CACHE, THUMB_CACHE];
const NETWORK_TIMEOUT_MS = 4000;
const SHELL = ['/offline/', '/manifest.webmanifest'];
// Django marks cookie-dependent pages "Vary: Cookie", and a service worker
// never sees the Cookie header, so matching must not compare it.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PAGE_CACHE);
    await Promise.all(SHELL.map(async (path) => {
      try {
        const response = await fetch(path, { cache: 'reload' });
        if (response.ok) await cache.put(path, response);
      } catch (error) { /* offline during install: runtime caching fills it in */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => !KNOWN_CACHES.includes(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, MATCH);
  const refresh = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

async function thumbnail(request) {
  const cache = await caches.open(THUMB_CACHE);
  const cached = await cache.match(request, MATCH);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.headers.get('Cache-Control') !== 'no-store') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Offline and this exact version was never saved: an older copy of the
    // same photo slot is better than a broken image.
    return (await cache.match(request, { ignoreSearch: true, ignoreVary: true })) || Response.error();
  }
}

async function navigation(request) {
  const cache = await caches.open(PAGE_CACHE);
  const network = fetch(request).then((response) => {
    // Never keep a redirect to the sign-in page as if it were the page.
    if (response.ok && !response.redirected) cache.put(request, response.clone());
    return response;
  });
  try {
    const first = await Promise.race([network, timeout(NETWORK_TIMEOUT_MS)]);
    if (first) return first;
    return (await cache.match(request, MATCH)) || (await network);
  } catch (error) {
    return (await cache.match(request, MATCH)) || (await cache.match('/offline/', MATCH)) || Response.error();
  }
}

// Fetch fresh from the network and keep the copy for offline use.
async function precache(request) {
  const response = await fetch(request, { cache: 'reload', signal: AbortSignal.timeout(30000) });
  if (response.ok && !response.redirected) {
    const name = new URL(request.url).pathname.startsWith('/thumb/') ? THUMB_CACHE : PAGE_CACHE;
    (await caches.open(name)).put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.headers.get('HX-Request')) return;
  if (request.headers.get('X-Walkdown-Precache')) {
    event.respondWith(precache(request));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/login/')
      || url.pathname.startsWith('/logout/') || url.pathname === '/sw.js'
      || url.pathname.startsWith('/r/') || url.pathname.startsWith('/c/')
      || url.pathname.startsWith('/report/')) return;

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(staleWhileRevalidate(request));
  } else if (url.pathname.startsWith('/thumb/')) {
    event.respondWith(thumbnail(request));
  } else if (request.mode === 'navigate' || url.pathname.startsWith('/precache/')
             || url.pathname === '/manifest.webmanifest') {
    event.respondWith(navigation(request));
  }
});
