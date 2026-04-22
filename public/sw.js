/* global self, caches, fetch */
// Hand-rolled service worker for the LOTO PWA. Three runtime cache strategies:
//   - /_next/static/*  → cache-first  (hashed filenames are immutable)
//   - HTML navigations → network-first, fall back to cached shell
//   - Supabase Storage → cache-first with stale-while-revalidate
//
// Bump CACHE_VERSION whenever the strategies change so old SW clients clear
// their stores cleanly via the activate handler.
const CACHE_VERSION = 'v3'
const STATIC_CACHE  = `loto-static-${CACHE_VERSION}`
const HTML_CACHE    = `loto-html-${CACHE_VERSION}`
const IMAGE_CACHE   = `loto-images-${CACHE_VERSION}`
const KNOWN_CACHES  = [STATIC_CACHE, HTML_CACHE, IMAGE_CACHE]

// Critical app-shell routes warmed at install time so a worker can launch
// the app cold-offline and reach the screens they use most. Hashed JS
// chunks are still cached at runtime — they change every deploy and aren't
// stable enough to precache by URL.
const APP_SHELL = [
  '/',
  '/login',
  '/welcome',
  '/decommission',
  '/status',
  '/manifest.json',
  '/icon',
  '/apple-icon',
]

// New SWs wait until the page asks to activate them. This lets us prompt the
// user with an "Update available · Refresh" toast instead of swapping caches
// out from under their current task. The first install is special-cased
// inside the page (no other SW to take over from), so first-load behavior
// is unchanged.
self.addEventListener('install', event => {
  // Best-effort precache: missing or 5xx responses are skipped instead of
  // failing the whole install — runtime caching picks them up later.
  event.waitUntil((async () => {
    const cache = await caches.open(HTML_CACHE)
    await Promise.all(APP_SHELL.map(async path => {
      try {
        const res = await fetch(path, { cache: 'reload' })
        if (res.ok) await cache.put(path, res.clone())
      } catch { /* offline at install time → leave for runtime */ }
    }))
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(n => !KNOWN_CACHES.includes(n)).map(n => caches.delete(n)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never cache Supabase API or auth responses — too risky and they need
  // fresh JWTs/RLS evaluations on every call.
  if (url.hostname.endsWith('.supabase.co') && !url.pathname.startsWith('/storage/')) return

  // Strategy: cache-first for hashed Next.js static assets.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // Strategy: stale-while-revalidate for Supabase Storage images (placard
  // photos, signed PDFs). Lets workers see photos offline; updates silently.
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/')) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE))
    return
  }

  // Strategy: network-first for HTML navigations, cache as offline fallback.
  if (request.mode === 'navigate' || (request.headers.get('accept') ?? '').includes('text/html')) {
    event.respondWith(networkFirst(request, HTML_CACHE))
    return
  }

  // Strategy: cache-first for everything else under our origin (icons,
  // manifest, fonts). External hosts pass through.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
  }
})

// Fire-and-forget cache write that swallows quota / opaque-response errors
// so they don't surface as unhandled promise rejections in the SW log.
function safePut(cache, request, response) {
  cache.put(request, response).catch(() => { /* quota or opaque-response */ })
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const res = await fetch(request)
    if (res && res.ok) safePut(cache, request, res.clone())
    return res
  } catch (err) {
    if (cached) return cached
    throw err
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(request)
    if (res && res.ok) safePut(cache, request, res.clone())
    return res
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    // Last-ditch: return a tiny inline offline page so navigations don't error.
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
      '<style>body{font:14px system-ui;padding:2rem;text-align:center;color:#475569}</style>' +
      '<h1 style="color:#1B3A6B">You\'re offline</h1>' +
      '<p>The LOTO app will be available when you reconnect.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
    )
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request).then(res => {
    if (res && res.ok) safePut(cache, request, res.clone())
    return res
  }).catch(() => cached)
  return cached ?? fetchPromise
}

// Listen for in-page messages so the InstallPrompt component can ask the SW
// to skip waiting on demand (used after the user clicks "Update available").
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
