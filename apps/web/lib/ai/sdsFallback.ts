import type { ParsedSdsPayload } from '@soteria/core/chemicals'

// Deterministic SDS-parser fallback (services/sds-parser).
//
// When Anthropic is unavailable — a usage-limit/credit 400, a 429, a 5xx, or
// no key configured — the SDS parse route can hand the PDF to the standalone
// FastAPI parser instead of failing. It returns the SAME ParsedSdsPayload
// shape, so the route persists and reviews it identically (the deterministic
// parser caps its own confidence at "medium", so a human still reviews).
//
// The route first asks the service to parse in the background
// (enqueueSdsParseJob): a scanned SDS needs OCR, which can take minutes and
// outlast this request. A service without background jobs switched on answers
// 503, and the route then parses synchronously (parseSdsViaFallback).
//
// Entirely opt-in: with SDS_PARSER_URL unset this is a no-op and the route
// behaves exactly as before. Set SDS_PARSER_URL (and, if the service requires
// it, SDS_PARSER_API_KEY) to enable.

const PARSE_TIMEOUT_MS = 30_000
// Enqueueing is two small database writes on the service; anything slower
// means it is struggling, and the synchronous path is the better bet.
const ENQUEUE_TIMEOUT_MS = 10_000

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
 * Ask the service to parse an SDS in the background (POST /jobs/parse-sds).
 * Its worker OCRs the PDF if needed and stages the result into the SDS Review
 * Queue. Returns the job id, or null when the fallback isn't configured, the
 * service has background jobs off (503), or the call fails — the caller then
 * parses synchronously. Never throws.
 */
export async function enqueueSdsParseJob(
  ids: { sdsId: string; tenantId: string; userId: string },
): Promise<{ jobId: string } | null> {
  const url = serviceUrl('/jobs/parse-sds')
  if (!url) return null

  const body = JSON.stringify({ sds_id: ids.sdsId, tenant_id: ids.tenantId, requested_by: ids.userId })
  const headers = serviceHeaders({ 'content-type': 'application/json' })
  try {
    const resp = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(ENQUEUE_TIMEOUT_MS) })
    if (resp.status !== 202) return null
    const json = (await resp.json()) as { job_id?: unknown }
    return typeof json.job_id === 'string' ? { jobId: json.job_id } : null
  } catch {
    return null
  }
}

/**
 * POST the PDF to the parser service's /parse/file endpoint. Returns the parsed
 * payload, or null when the fallback isn't configured or the call fails — the
 * caller then surfaces the original Anthropic error. Never throws.
 */
export async function parseSdsViaFallback(pdf: Buffer): Promise<ParsedSdsPayload | null> {
  const url = serviceUrl('/parse/file')
  if (!url) return null

  const form = new FormData()
  // Copy into a plain Uint8Array — a Node Buffer's ArrayBufferLike backing
  // isn't directly assignable to BlobPart under the DOM lib types.
  form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'sds.pdf')
  try {
    const resp = await fetch(url, {
      method: 'POST', body: form, headers: serviceHeaders(), signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
    })
    if (!resp.ok) return null
    return (await resp.json()) as ParsedSdsPayload
  } catch {
    return null
  }
}

function serviceUrl(path: string): string | null {
  const base = process.env.SDS_PARSER_URL
  return base ? `${base.replace(/\/+$/, '')}${path}` : null
}

function serviceHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const apiKey = process.env.SDS_PARSER_API_KEY
  return apiKey ? { ...headers, 'x-api-key': apiKey } : headers
}
