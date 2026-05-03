// Stateless HMAC-signed inspector tokens. The token is the only auth
// for the /inspector view — anyone with the URL can read every CS and
// hot-work permit issued in the encoded window for the duration of the
// encoded expiry.
//
// We intentionally do NOT use a DB-backed token table here. The trade-
// off:
//   - Pros: zero DB churn; admins can mint a URL freely; no migration
//     coupling; no cleanup of expired rows.
//   - Cons: tokens are unrevocable until they expire. If you mint a
//     30-day token and need to revoke it the next day, you'd have to
//     rotate INSPECTOR_TOKEN_SECRET (which invalidates EVERY live
//     token). For inspector access this is acceptable: the inspection
//     window is short, the audience is known, and the secret rotation
//     is the nuclear option.
//
// If you need finer-grained revocation later, swap to DB tokens with
// the same signature — same payload shape, same verifyToken() contract.

import { createHmac, timingSafeEqual } from 'crypto'

// Payload shape encoded in the URL. Compact field names because they
// end up as query-string params. exp is a unix timestamp in seconds
// (chosen for compactness and easy human readability vs. ms).
export interface InspectorTokenPayload {
  start: string   // YYYY-MM-DD inclusive
  end:   string   // YYYY-MM-DD inclusive
  exp:   number   // unix seconds
  // A free-text label for audit (the admin enters it when minting,
  // e.g. "Cal/OSHA inspection 2026-05"). Surfaced on the inspector
  // view so the inspector knows which engagement they're looking at.
  label: string
}

const HMAC_LEN = 32   // bytes (SHA-256)

// Build the canonical signing string. Field order is fixed so the
// signature is reproducible regardless of how the JS object was built.
// Newline separator instead of pipe so values that happen to contain
// pipes (free-text labels) don't collide with the delimiter.
function canonicalize(p: InspectorTokenPayload): string {
  return [
    `start:${p.start}`,
    `end:${p.end}`,
    `exp:${p.exp}`,
    `label:${p.label}`,
  ].join('\n')
}

// base64url without padding — URL-safe and shorter than hex.
function base64url(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromBase64url(s: string): Buffer {
  // Restore padding so Buffer.from('base64') accepts it.
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

// Sign a payload with the secret. Returns just the signature, not a
// full token string — the caller assembles the URL.
export function signInspectorPayload(p: InspectorTokenPayload, secret: string): string {
  const mac = createHmac('sha256', secret).update(canonicalize(p)).digest()
  return base64url(mac)
}

// Verify a signature against a payload and the same secret. Returns
// either { ok: true, payload } or { ok: false, reason }. Constant-time
// comparison via timingSafeEqual so a wrong-length signature can't
// be probed bit-by-bit.
export function verifyInspectorToken(args: {
  payload: InspectorTokenPayload
  sig:     string
  secret:  string
  // nowSec defaults to Date.now()/1000; tests pin it for determinism.
  nowSec?: number
}): { ok: true } | { ok: false; reason: string } {
  const { payload, sig, secret } = args
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000)

  // Validate payload shape so a malformed query string is rejected
  // before we spend time computing HMACs.
  if (typeof payload.start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.start)) return { ok: false, reason: 'Invalid start date' }
  if (typeof payload.end   !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.end))   return { ok: false, reason: 'Invalid end date' }
  if (payload.start > payload.end) return { ok: false, reason: 'Start date is after end date' }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return { ok: false, reason: 'Invalid expiry' }
  if (payload.exp < nowSec) return { ok: false, reason: 'Token has expired' }
  if (typeof payload.label !== 'string') return { ok: false, reason: 'Invalid label' }
  // Caps a label at a reasonable length so a multi-MB query string
  // can't be used to abuse the verifier or downstream renderers.
  if (payload.label.length > 200) return { ok: false, reason: 'Label too long' }

  const expected = createHmac('sha256', secret).update(canonicalize(payload)).digest()
  let received: Buffer
  try { received = fromBase64url(sig) }
  catch { return { ok: false, reason: 'Invalid signature encoding' } }
  if (received.length !== HMAC_LEN) return { ok: false, reason: 'Invalid signature length' }
  if (!timingSafeEqual(expected, received)) return { ok: false, reason: 'Bad signature' }
  return { ok: true }
}

// Build a complete `/inspector?…` URL from a payload + secret. Caller
// supplies the origin (the request's window.location.origin or the
// configured app URL) so the URL is absolute and copy-pasteable.
export function buildInspectorUrl(args: {
  origin:  string
  payload: InspectorTokenPayload
  secret:  string
}): string {
  const sig = signInspectorPayload(args.payload, args.secret)
  const params = new URLSearchParams({
    start: args.payload.start,
    end:   args.payload.end,
    exp:   String(args.payload.exp),
    label: args.payload.label,
    sig,
  })
  // Strip a trailing slash on the origin so we don't double up.
  const o = args.origin.replace(/\/$/, '')
  return `${o}/inspector?${params.toString()}`
}
