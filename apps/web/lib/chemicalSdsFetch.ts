// Defensive HTTP fetch for manufacturer SDS URLs.
//
// Used by the drift-monitor cron + the per-product "Check for revision"
// button. Manufacturer URLs are user-supplied (per chemical) and we
// hit them server-side, so this module enforces:
//
//   - Scheme allowlist: https only.
//   - Hostname allowlist by suffix-match. Manufacturers come and go;
//     we keep this short and conservative, with an env override
//     (CHEMICAL_SDS_HOST_ALLOWLIST, comma-separated) for tenants who
//     need to add their vendor.
//   - SSRF mitigation: refuse URLs whose hostname resolves to a
//     private/loopback/link-local address.
//   - Size + timeout caps.
//   - Content-type must be application/pdf (text/html guarantees a
//     redirector page and would just confuse the AI).
//
// On failure we return a structured Result the caller logs into
// chemical_sds_revision_checks; we never throw inside.

import * as Sentry from '@sentry/nextjs'
import { promises as dns } from 'node:dns'

const DEFAULT_ALLOWLIST: readonly string[] = [
  // Major distributors with stable SDS URLs.
  'sigmaaldrich.com',
  'fishersci.com',
  'thermofisher.com',
  'mscdirect.com',
  'grainger.com',
  'vwr.com',
  'avantorsciences.com',
  // Government / academic SDS aggregators (read-only).
  'osha.gov',
  'cdc.gov',
  'nih.gov',
  'pubchem.ncbi.nlm.nih.gov',
  'echa.europa.eu',
]

const MAX_PDF_BYTES   = 25_000_000      // matches our upload cap
const FETCH_TIMEOUT_MS = 30_000

export type FetchOutcome =
  | 'ok'
  | 'allowlist_blocked'
  | 'private_address_blocked'
  | 'invalid_scheme'
  | 'invalid_url'
  | 'timeout'
  | 'too_large'
  | 'wrong_content_type'
  | 'http_error'
  | 'network_error'

export interface FetchResult {
  outcome:      FetchOutcome
  /** HTTP status (when we got that far). */
  httpStatus?:  number
  contentType?: string
  /** Bytes of the PDF when outcome === 'ok'. */
  bytes?:       Uint8Array
  /** sha256 hex of `bytes`. */
  sha256?:      string
  /** Final URL after redirects. */
  finalUrl?:    string
  /** Operator-readable explanation; safe to write into the audit log. */
  detail?:      string
}

export function getHostAllowlist(): readonly string[] {
  const env = process.env.CHEMICAL_SDS_HOST_ALLOWLIST?.trim()
  if (!env) return DEFAULT_ALLOWLIST
  const extra = env.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return [...DEFAULT_ALLOWLIST, ...extra]
}

export function isHostAllowed(hostname: string, allowlist = getHostAllowlist()): boolean {
  const lower = hostname.toLowerCase()
  return allowlist.some(suffix =>
    lower === suffix || lower.endsWith('.' + suffix),
  )
}

// IPv4 + IPv6 ranges that should never be fetchable by a tenant URL.
function isPrivateAddress(addr: string): boolean {
  // IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) {
    const [a, b] = addr.split('.').map(n => Number.parseInt(n, 10))
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 0) return true
    if (a >= 224) return true                 // multicast / experimental
    return false
  }
  // IPv6 — collapse to the test-for-prefix form.
  const lower = addr.toLowerCase()
  if (lower === '::1') return true            // loopback
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true  // ULA
  if (lower.startsWith('fe80:')) return true   // link-local
  if (lower.startsWith('::ffff:')) {           // IPv4-mapped
    const v4 = lower.split('::ffff:').pop() ?? ''
    if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return isPrivateAddress(v4)
  }
  return false
}

async function resolvesPublicly(hostname: string): Promise<boolean> {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true })
    if (records.length === 0) return false
    return records.every(r => !isPrivateAddress(r.address))
  } catch {
    return false
  }
}

async function sha256Hex(buf: Uint8Array): Promise<string> {
  // crypto.subtle.digest expects a BufferSource — wrap in an
  // ArrayBuffer view so the lib.dom + lib.webworker overload picks
  // up correctly under stricter TS settings.
  const data: BufferSource = buf.buffer instanceof ArrayBuffer
    ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    : new Uint8Array(buf)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const arr = Array.from(new Uint8Array(digest))
  return arr.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Fetch a manufacturer SDS URL with guards. Never throws — returns a
 * Result whose `outcome` field reflects what happened.
 */
export async function fetchSdsPdf(rawUrl: string): Promise<FetchResult> {
  let url: URL
  try { url = new URL(rawUrl) }
  catch { return { outcome: 'invalid_url', detail: rawUrl } }

  if (url.protocol !== 'https:') {
    return { outcome: 'invalid_scheme', detail: url.protocol }
  }

  if (!isHostAllowed(url.hostname)) {
    return {
      outcome: 'allowlist_blocked',
      detail:  `Host "${url.hostname}" is not in CHEMICAL_SDS_HOST_ALLOWLIST.`,
    }
  }

  if (!(await resolvesPublicly(url.hostname))) {
    return {
      outcome: 'private_address_blocked',
      detail:  `Host "${url.hostname}" resolves to a private/loopback address or could not be resolved.`,
    }
  }

  const ac = new AbortController()
  const tid = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      method:   'GET',
      redirect: 'follow',
      signal:   ac.signal,
      headers:  {
        // Many manufacturer sites return 403 to default UAs.
        'user-agent': 'SoteriaField-SDS-Drift/1.0 (+https://soteriafield.app)',
        'accept':     'application/pdf',
      },
    })
    if (!resp.ok) {
      return { outcome: 'http_error', httpStatus: resp.status, finalUrl: resp.url }
    }
    // Redirect-aware SSRF check: even though the initial host passed
    // the allowlist + private-IP guard, redirect:'follow' can land us
    // somewhere else entirely. An allowlisted host with an open
    // redirect could 302 us to attacker-controlled infrastructure or
    // to an internal IP via a same-host redirect. Re-validate the
    // FINAL URL before reading the body.
    if (resp.url && resp.url !== url.toString()) {
      let finalUrl: URL
      try { finalUrl = new URL(resp.url) }
      catch {
        return { outcome: 'invalid_url', detail: `Redirect target unparseable: ${resp.url}` }
      }
      if (finalUrl.protocol !== 'https:') {
        return { outcome: 'invalid_scheme', detail: `Redirected to ${finalUrl.protocol}` }
      }
      if (!isHostAllowed(finalUrl.hostname)) {
        return {
          outcome:    'allowlist_blocked',
          finalUrl:   resp.url,
          detail:     `Redirected to "${finalUrl.hostname}", which is not in the allowlist.`,
        }
      }
      if (!(await resolvesPublicly(finalUrl.hostname))) {
        return {
          outcome:  'private_address_blocked',
          finalUrl: resp.url,
          detail:   `Redirected to "${finalUrl.hostname}", which resolves to a private/loopback address.`,
        }
      }
    }
    const contentType = (resp.headers.get('content-type') ?? '').toLowerCase()
    if (!contentType.includes('application/pdf') && !contentType.startsWith('binary/octet-stream')) {
      return {
        outcome:     'wrong_content_type',
        httpStatus:  resp.status,
        contentType,
        finalUrl:    resp.url,
      }
    }

    const declared = Number.parseInt(resp.headers.get('content-length') ?? '0', 10) || 0
    if (declared > 0 && declared > MAX_PDF_BYTES) {
      return { outcome: 'too_large', httpStatus: resp.status, contentType, finalUrl: resp.url }
    }

    // Stream-with-cap: a malicious server could omit content-length and
    // dribble bytes forever. Cap on read.
    const reader = resp.body?.getReader()
    if (!reader) {
      return { outcome: 'network_error', detail: 'No response body' }
    }
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > MAX_PDF_BYTES) {
          await reader.cancel().catch(() => {})
          return { outcome: 'too_large', httpStatus: resp.status, contentType, finalUrl: resp.url }
        }
        chunks.push(value)
      }
    }

    const bytes = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { bytes.set(c, off); off += c.byteLength }

    return {
      outcome:     'ok',
      httpStatus:  resp.status,
      contentType,
      finalUrl:    resp.url,
      bytes,
      sha256:      await sha256Hex(bytes),
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { outcome: 'timeout' }
    }
    Sentry.captureException(err, { tags: { source: 'sds-fetch' } })
    return {
      outcome: 'network_error',
      detail:  err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(tid)
  }
}
