/* global self, caches, fetch */
// Hand-rolled service worker for the LOTO PWA. Three runtime cache strategies:
//   - /_next/static/*  → cache-first  (hashed filenames are immutable)
//   - HTML navigations → network-first, fall back to cached shell
//   - Supabase Storage → cache-first with stale-while-revalidate
//
// Bump CACHE_VERSION whenever the strategies change so old SW clients clear
// their stores cleanly via the activate handler.
// v5 (2026-04-26) — / is now a home screen rather than the LOTO equipment
// dashboard. PWA clients on iPad were serving the cached old / shell from
// v4. Bumping the version forces the activate handler to evict stale
// caches on next launch.
// v6 (2026-04-27) — added Web Push handlers (push + notificationclick).
// Bumping the version so existing PWA clients re-register the worker
// and pick up the new event listeners.
// v7 (2026-05-08) — skip the SW entirely for /api/* GETs. These were
// falling through to the same-origin cacheFirst branch, which froze
// list endpoints (e.g. /api/safety-boards) on the first 200 response;
// newly created rows never appeared in the UI until the cache was
// cleared. API calls are short and JWT-bound — let the network handle
// them.
// v8 (2026-05-12) — added an opt-in STRIKE video cache and a Range-
// request handler so a downloaded training video plays offline AND
// supports seeking on iOS Safari. Bump forces the activate handler
// to retire pre-v8 caches.
const CACHE_VERSION = 'v8'
const STATIC_CACHE  = `loto-static-${CACHE_VERSION}`
const HTML_CACHE    = `loto-html-${CACHE_VERSION}`
const IMAGE_CACHE   = `loto-images-${CACHE_VERSION}`
// Video cache is intentionally NOT version-bumped on every SW change.
// We pin its name so existing downloads survive deploys; learners who
// pre-downloaded modules before a flight should not lose them just
// because we shipped an unrelated CSS tweak.
const VIDEO_CACHE   = 'loto-strike-video-v1'
const KNOWN_CACHES  = [STATIC_CACHE, HTML_CACHE, IMAGE_CACHE, VIDEO_CACHE]

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

  // Never cache our own API routes. They return JWT/tenant-scoped JSON
  // that has to reflect the latest writes (creating a board, posting a
  // message, etc.). The default same-origin branch below is cache-first
  // and would happily freeze the first 200 response forever.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return

  // Strategy: cache-first for hashed Next.js static assets.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // Strategy: serve STRIKE training videos from the dedicated offline
  // cache when we've explicitly downloaded them. Honour Range requests so
  // <video> seeking and iOS Safari's segment-by-segment playback work
  // even when the device is offline. The cache key is the raw storage
  // path (e.g. "global/loto/refresh.mp4"); learners and Studio agree on
  // this key via lib/offline/strikeOffline.ts.
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/')) {
    if (looksLikeStrikeVideo(url)) {
      event.respondWith(serveStrikeVideo(request, url))
      return
    }
    // Fall back to the existing SWR for non-video Supabase Storage assets
    // (placard photos, signed PDFs).
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
      '<p>Soteria LOTO Pro will be available when you reconnect.</p>',
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

// Listen for in-page messages. The InstallPrompt component asks the SW to
// skip waiting after an "Update available" toast; the STRIKE offline
// manager (lib/offline/strikeOffline.ts) drives downloads, deletes, and
// usage queries through this channel because the SW is the only context
// with direct access to Cache Storage from inside the page tree.
self.addEventListener('message', event => {
  const data = event.data
  if (data === 'SKIP_WAITING') { self.skipWaiting(); return }
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return

  const port = event.ports && event.ports[0]
  const reply = payload => { if (port) port.postMessage(payload) }

  switch (data.type) {
    case 'STRIKE_DOWNLOAD_VIDEO':
      // Download fetches the entire file once, stores it whole. We do not
      // stream-chunk into the cache because Cache Storage stores complete
      // Responses; partial bodies cannot be progressively appended.
      event.waitUntil(handleStrikeDownload(data.path, data.signedUrl).then(reply, err =>
        reply({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      ))
      return
    case 'STRIKE_DELETE_VIDEO':
      event.waitUntil(handleStrikeDelete(data.path).then(reply, err =>
        reply({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      ))
      return
    case 'STRIKE_LIST_VIDEOS':
      event.waitUntil(handleStrikeList().then(reply, err =>
        reply({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      ))
      return
    case 'STRIKE_HAS_VIDEO':
      event.waitUntil(handleStrikeHas(data.path).then(reply, err =>
        reply({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      ))
      return
    default:
      // Unknown message — ignore silently. Senders use MessageChannels for
      // replies they care about, so a missing reply is a fine signal.
      return
  }
})

// ── STRIKE offline video cache ─────────────────────────────────────────
//
// We cache the raw bytes of each downloaded video at a normalized URL
// derived from the storage path. Signed Supabase URLs are NOT used as
// cache keys because they include short-lived tokens that change every
// time the player refreshes — we'd never hit the cache. The page-side
// helper (strikeOffline.ts) and this worker both rely on the same
// strikeCacheKey() construction.

function looksLikeStrikeVideo(url) {
  // Supabase Storage paths look like /storage/v1/object/{public|sign}/<bucket>/<path>.
  // The STRIKE bucket is private, so signed URLs are the realistic case.
  const segs = url.pathname.split('/').filter(Boolean)
  // ['storage','v1','object','sign','strike-media', ...rest]
  return segs[0] === 'storage' && segs[4] === 'strike-media'
}

function strikePathFromUrl(url) {
  const segs = url.pathname.split('/').filter(Boolean)
  // Drop the leading ['storage','v1','object','sign|public','strike-media'] prefix.
  if (segs.length < 6 || segs[4] !== 'strike-media') return null
  return segs.slice(5).join('/')
}

function strikeCacheKey(path) {
  // Plain HTTPS-style URL inside our own origin namespace. Using a fake
  // host means signed-URL token churn does not affect lookups, and using
  // a Request object lets us round-trip with cache.match() cleanly.
  return new Request(`https://strike-offline/${path}`, { method: 'GET' })
}

async function serveStrikeVideo(request, url) {
  const path = strikePathFromUrl(url)
  if (!path) return fetch(request)
  const cache = await caches.open(VIDEO_CACHE)
  const cached = await cache.match(strikeCacheKey(path))
  if (!cached) {
    // Not pre-downloaded — let the network handle it. We intentionally do
    // not auto-cache here; videos are large and the learner should opt in
    // via the "Download for offline" button.
    try { return await fetch(request) }
    catch { return new Response('', { status: 504, statusText: 'Offline' }) }
  }

  const range = request.headers.get('range')
  if (!range) return new Response(await cached.clone().blob(), {
    status: 200,
    headers: cached.headers,
  })

  // Build a 206 Partial Content response from the cached body so iOS
  // Safari can seek. Range syntax is `bytes=start-end` or `bytes=start-`.
  const blob = await cached.clone().blob()
  const total = blob.size
  const match = /bytes=(\d+)-(\d+)?/.exec(range)
  if (!match) return new Response(blob, { status: 200, headers: cached.headers })
  const start = Number(match[1])
  const end = match[2] ? Math.min(total - 1, Number(match[2])) : total - 1
  if (Number.isNaN(start) || start >= total || end < start) {
    return new Response('', {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}` },
    })
  }
  const slice = blob.slice(start, end + 1)
  const headers = new Headers(cached.headers)
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`)
  headers.set('Content-Length', String(slice.size))
  headers.set('Accept-Ranges', 'bytes')
  return new Response(slice, { status: 206, statusText: 'Partial Content', headers })
}

async function handleStrikeDownload(path, signedUrl) {
  if (typeof path !== 'string' || !path || typeof signedUrl !== 'string' || !signedUrl) {
    return { ok: false, error: 'path and signedUrl are required' }
  }
  const res = await fetch(signedUrl)
  if (!res.ok) return { ok: false, error: `Fetch failed: ${res.status}` }
  // Preserve content-type and a far-future cache header so the cached
  // response is self-describing if anything ever reads it directly.
  const blob = await res.blob()
  const headers = new Headers()
  const ct = res.headers.get('content-type'); if (ct) headers.set('Content-Type', ct)
  headers.set('Content-Length', String(blob.size))
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'private, max-age=31536000, immutable')
  const stored = new Response(blob, { status: 200, headers })
  const cache = await caches.open(VIDEO_CACHE)
  await cache.put(strikeCacheKey(path), stored)
  return { ok: true, path, size: blob.size }
}

async function handleStrikeDelete(path) {
  if (typeof path !== 'string' || !path) return { ok: false, error: 'path is required' }
  const cache = await caches.open(VIDEO_CACHE)
  const removed = await cache.delete(strikeCacheKey(path))
  return { ok: true, removed }
}

async function handleStrikeList() {
  const cache = await caches.open(VIDEO_CACHE)
  const requests = await cache.keys()
  const entries = []
  let total = 0
  for (const req of requests) {
    const u = new URL(req.url)
    if (u.host !== 'strike-offline') continue
    const path = u.pathname.replace(/^\//, '')
    const res = await cache.match(req)
    const size = res ? Number(res.headers.get('Content-Length') ?? 0) : 0
    entries.push({ path, size })
    total += size
  }
  return { ok: true, entries, total }
}

async function handleStrikeHas(path) {
  if (typeof path !== 'string' || !path) return { ok: false, error: 'path is required' }
  const cache = await caches.open(VIDEO_CACHE)
  const hit = await cache.match(strikeCacheKey(path))
  return { ok: true, present: !!hit }
}

// ── Web Push (migration 016) ──────────────────────────────────────────────
//
// Payload shape (sent by /api/push/dispatch):
//   { title: string, body: string, url?: string, tag?: string }
//
// `tag` deduplicates notifications — pushing two events for the same
// permit collapses to a single notification on iOS / Android instead of
// stacking. `url` is the deep-link to open when the user taps; defaults
// to '/' if absent. The whole handler is wrapped so a malformed payload
// still produces a generic notification rather than dropping silently.
self.addEventListener('push', event => {
  let payload = { title: 'SoteriaField', body: 'New notification', url: '/', tag: undefined }
  try {
    if (event.data) {
      const parsed = event.data.json()
      payload = { ...payload, ...parsed }
    }
  } catch {
    // Non-JSON payload — fall through with the defaults above.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body:   payload.body,
      tag:    payload.tag,
      data:   { url: payload.url },
      icon:   '/icon',
      badge:  '/icon',
    }),
  )
})

// Open the deep link from the notification when tapped. If a Soteria tab
// is already open, focus it and navigate; otherwise open a new one.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if (c.url.includes(self.location.origin)) {
        await c.focus()
        // Navigate the focused tab to the deep link.
        if (c.navigate) { try { await c.navigate(url) } catch { /* ignore */ } }
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url)
  })())
})
