import type { XapiEndpoint, XapiPostResult, XapiStatement } from './types'

// Server-only xAPI client. Posts a Statement to an LRS using the
// vendor-issued key/secret as HTTP Basic auth. The X-Experience-API-
// Version header is mandatory per spec §6.2; LRSs reject the request
// without it.
//
// The function never throws — failures are returned as
// { ok: false, … } so the caller writes one audit row either way.

const STATEMENT_PATH = '/statements'
const REQUEST_TIMEOUT_MS = 8_000

export async function postStatement(
  endpoint: XapiEndpoint,
  statement: XapiStatement,
  fetcher: typeof fetch = fetch,
): Promise<XapiPostResult> {
  const url = joinStatementUrl(endpoint.endpointUrl)
  const auth = basicAuthHeader(endpoint.authKey, endpoint.authSecret)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type':            'application/json',
        'X-Experience-API-Version': endpoint.version,
        'Authorization':            auth,
      },
      body: JSON.stringify(statement),
      signal: controller.signal,
    })
    const body = truncate(await safeText(res), 4_000)
    if (res.ok) {
      return { ok: true, status: res.status, body }
    }
    return {
      ok: false,
      status: res.status,
      body,
      error: `LRS returned ${res.status}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, body: '', error: message }
  } finally {
    clearTimeout(timer)
  }
}

// Strips trailing slash + appends /statements so callers can store
// the LRS base URL (with or without trailing slash) and the function
// keeps working either way.
export function joinStatementUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '')
  if (trimmed.endsWith(STATEMENT_PATH)) return trimmed
  return `${trimmed}${STATEMENT_PATH}`
}

export function basicAuthHeader(key: string, secret: string): string {
  // btoa is available in Node 18+ and the Edge runtime — both targets
  // Next.js supports today.
  const encoded = btoa(`${key}:${secret}`)
  return `Basic ${encoded}`
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text() } catch { return '' }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}
