// Data minimisation for Sentry. The DSN is public and write-only, so we can't
// rely on transport secrecy — anything sensitive has to be removed before the
// event leaves the process.
//
// The original scrubber matched by KEY NAME and only walked request
// headers/data/cookies/extra/contexts. That misses URLs entirely, and URLs are
// where this app's secrets actually are:
//
//   • /accept-invite?token=<raw> — the invite token IS the credential
//   • #access_token=…&refresh_token=… — Supabase's recovery flow has no PKCE
//     (detectSessionInUrl), so a live session lands in the fragment
//
// Neither reaches the key-name scrubber: event.request.url was never passed to
// it, and navigation breadcrumbs store URLs under the keys `from`/`to`, which
// match no needle. Hence redactUrl, applied to both.

const SCRUB_NEEDLES = [
  'authorization', 'cookie', 'x-internal-secret', 'x-active-tenant',
  'signature_data', 'signature',
  'api_key', 'anthropic_api_key', 'voyage_api_key',
  'password', 'token', 'secret',
]

const REDACTED = '[redacted]'

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SCRUB_NEEDLES.some(needle => lower.includes(needle))
}

/** Replace values of any key whose name looks sensitive, recursively. */
export function scrub(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(scrub)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : scrub(v)
  }
  return out
}

// Both ?a=b&c=d and #a=b&c=d are the same shape, and Supabase uses the
// fragment form for recovery tokens.
function redactParams(raw: string): { value: string; touched: boolean } {
  if (!raw) return { value: raw, touched: false }
  const params = new URLSearchParams(raw)
  let touched = false
  for (const key of [...params.keys()]) {
    if (isSensitiveKey(key)) {
      params.set(key, REDACTED)
      touched = true
    }
  }
  return { value: touched ? params.toString() : raw, touched }
}

/**
 * Redact sensitive query-string and fragment values in a URL, preserving
 * whether it was absolute or relative. Never throws — an unparseable value is
 * dropped entirely rather than passed through.
 */
export function redactUrl(url: string): string {
  if (!url) return url

  try {
    const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(url)
    const parsed = new URL(url, 'https://scrub.invalid')

    const search = redactParams(parsed.search.replace(/^\?/, ''))
    const hash   = redactParams(parsed.hash.replace(/^#/, ''))
    if (!search.touched && !hash.touched) return url

    parsed.search = search.value ? `?${search.value}` : ''
    parsed.hash   = hash.value ? `#${hash.value}` : ''

    return isRelative
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.toString()
  } catch {
    return '[unparseable-url]'
  }
}

interface ScrubbableEvent {
  request?: { url?: string; headers?: unknown; data?: unknown; cookies?: unknown } | undefined
  extra?: unknown
  contexts?: unknown
  transaction?: string
}

interface ScrubbableBreadcrumb {
  data?: Record<string, unknown> | undefined
}

/** beforeSend hook — safe to share across the browser, server and edge inits. */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    if (event.request.url)     event.request.url     = redactUrl(event.request.url)
    if (event.request.headers) event.request.headers = scrub(event.request.headers)
    if (event.request.data)    event.request.data    = scrub(event.request.data)
    if (event.request.cookies) event.request.cookies = scrub(event.request.cookies)
  }
  // Transaction names are derived from the URL on client-side navigations.
  if (event.transaction) event.transaction = redactUrl(event.transaction)
  if (event.extra)       event.extra       = scrub(event.extra)
  if (event.contexts)    event.contexts    = scrub(event.contexts) as T['contexts']
  return event
}

/** beforeBreadcrumb hook. */
export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(crumb: T): T {
  if (!crumb.data) return crumb

  // Redact URL-valued fields first — `from`/`to`/`url` don't match any needle,
  // so the key-name pass below would walk straight past them.
  for (const field of ['from', 'to', 'url'] as const) {
    const value = crumb.data[field]
    if (typeof value === 'string') crumb.data[field] = redactUrl(value)
  }

  crumb.data = scrub(crumb.data) as Record<string, unknown>
  return crumb
}
