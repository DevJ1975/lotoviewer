import type { ParsedSdsPayload } from '@soteria/core/chemicals'

// Deterministic SDS-parser fallback (services/sds-parser).
//
// When Anthropic is unavailable — a usage-limit/credit 400, a 429, a 5xx, or
// no key configured — the SDS parse route can hand the PDF to the standalone
// FastAPI parser instead of failing. It returns the SAME ParsedSdsPayload
// shape, so the route persists and reviews it identically (the deterministic
// parser caps its own confidence at "medium", so a human still reviews).
//
// Entirely opt-in: with SDS_PARSER_URL unset this is a no-op and the route
// behaves exactly as before. Set SDS_PARSER_URL (and, if the service requires
// it, SDS_PARSER_API_KEY) to enable.

const TIMEOUT_MS = 30_000

/** True when the operator has pointed the deployment at a parser service. */
export function sdsFallbackConfigured(): boolean {
  return Boolean(process.env.SDS_PARSER_URL)
}

/**
 * Should we fall back to the deterministic parser for this Anthropic error?
 *
 * Only for "the AI is unavailable" classes — a rate limit (429), a server
 * error (5xx), or a usage-limit/credit/quota rejection (400 with a telltale
 * message). A plain 400 (e.g. a malformed/oversized PDF) is NOT one of these:
 * the deterministic parser would hit the same bad input, so we surface the
 * real error instead. Duck-typed so this module stays free of the SDK.
 */
export function isAiUnavailable(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  const message = err instanceof Error ? err.message : ''
  if (status === 429) return true
  if (typeof status === 'number' && status >= 500 && status < 600) return true
  if (status === 400 && /usage limit|credit balance|spend|quota|rate limit/i.test(message)) return true
  return false
}

/**
 * POST the PDF to the parser service's /parse/file endpoint. Returns the parsed
 * payload, or null when the fallback isn't configured or the call fails — the
 * caller then surfaces the original Anthropic error. Never throws.
 */
export async function parseSdsViaFallback(pdf: Buffer): Promise<ParsedSdsPayload | null> {
  const base = process.env.SDS_PARSER_URL
  if (!base) return null

  const url = `${base.replace(/\/+$/, '')}/parse/file`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const form = new FormData()
    // Copy into a plain Uint8Array — a Node Buffer's ArrayBufferLike backing
    // isn't directly assignable to BlobPart under the DOM lib types.
    form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'sds.pdf')

    const headers: Record<string, string> = {}
    const apiKey = process.env.SDS_PARSER_API_KEY
    if (apiKey) headers['x-api-key'] = apiKey

    const resp = await fetch(url, { method: 'POST', body: form, headers, signal: ctrl.signal })
    if (!resp.ok) return null
    return (await resp.json()) as ParsedSdsPayload
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
