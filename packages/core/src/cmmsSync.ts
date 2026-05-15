// CMMS bidirectional-sync helpers — HMAC signing and inbound-payload
// validation. Pure functions; no DB or network. Used by both:
//
//   /api/cmms/[integration_id]/webhook — inbound webhook handler. Calls
//     `verifyHmacSignature` against the X-Soteria-Signature header and
//     `parseInboundEvent` to map the raw body to a typed event.
//
//   future integration cron — calls `signHmac` to sign outbound POSTs
//     to the CMMS with the same secret + HMAC-SHA256 scheme.
//
// One scheme, one verifier, one source of truth for both legs.

const CMMS_EVENT_TYPES = [
  'work_order.opened',
  'work_order.updated',
  'work_order.closed',
  'work_order.cancelled',
] as const

export type CmmsEventType = typeof CMMS_EVENT_TYPES[number]

export interface CmmsInboundEvent {
  event_type:           CmmsEventType
  work_order_id:        string
  equipment_id:         string
  status:               string
  /** ISO timestamp when the WO transitioned to its current state. */
  occurred_at:          string | null
  /** Whatever extra fields the CMMS supplied — preserved for audit. */
  extra:                Record<string, unknown>
}

export interface CmmsParseError {
  field:   string
  message: string
}

export type CmmsParseResult =
  | { ok: true;  event: CmmsInboundEvent }
  | { ok: false; errors: CmmsParseError[] }

interface CmmsInboundPayload {
  event_type?:    unknown
  work_order_id?: unknown
  equipment_id?:  unknown
  status?:        unknown
  occurred_at?:   unknown
  [key: string]:  unknown
}

/**
 * Validate and normalize an inbound CMMS webhook payload. Accepts the
 * canonical { event_type, work_order_id, equipment_id, status } shape;
 * everything else falls into `extra` so the audit log preserves it.
 *
 * Strict on the four required fields, lenient on `occurred_at` (many
 * legacy CMMS systems don't carry one — we substitute the receive
 * time at the persistence boundary in that case).
 */
export function parseInboundEvent(payload: unknown): CmmsParseResult {
  const errors: CmmsParseError[] = []
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: [{ field: '_root', message: 'payload must be an object' }] }
  }
  const raw = payload as CmmsInboundPayload

  const eventType = typeof raw.event_type === 'string' ? raw.event_type.trim() : ''
  if (!eventType) {
    errors.push({ field: 'event_type', message: 'event_type is required' })
  } else if (!(CMMS_EVENT_TYPES as readonly string[]).includes(eventType)) {
    errors.push({ field: 'event_type', message: `event_type must be one of ${CMMS_EVENT_TYPES.join(', ')}` })
  }

  const workOrderId = typeof raw.work_order_id === 'string' ? raw.work_order_id.trim() : ''
  if (!workOrderId) errors.push({ field: 'work_order_id', message: 'work_order_id is required' })

  const equipmentId = typeof raw.equipment_id === 'string' ? raw.equipment_id.trim() : ''
  if (!equipmentId) errors.push({ field: 'equipment_id', message: 'equipment_id is required' })

  const status = typeof raw.status === 'string' ? raw.status.trim() : ''
  if (!status) errors.push({ field: 'status', message: 'status is required' })

  if (errors.length > 0) return { ok: false, errors }

  const occurredAt = typeof raw.occurred_at === 'string' && raw.occurred_at.trim() !== ''
    ? raw.occurred_at.trim()
    : null

  // Strip the validated fields from `extra` so audit isn't duplicated.
  const extra: Record<string, unknown> = { ...raw }
  delete extra.event_type
  delete extra.work_order_id
  delete extra.equipment_id
  delete extra.status
  delete extra.occurred_at

  return {
    ok: true,
    event: {
      event_type:    eventType as CmmsEventType,
      work_order_id: workOrderId,
      equipment_id:  equipmentId,
      status,
      occurred_at:   occurredAt,
      extra,
    },
  }
}

// ── HMAC helpers ────────────────────────────────────────────────────
//
// Outbound: sign the raw body (UTF-8 bytes) with HMAC-SHA256 using
// the integration's webhook_secret. Header format mirrors GitHub:
//   X-Soteria-Signature: sha256=<lowercase-hex>
// Inbound: recompute the HMAC over the raw body and timing-safe-compare
// against the header value.

const SIG_PREFIX = 'sha256='

/**
 * Compute HMAC-SHA256 of `body` keyed by `secret`. Returns the
 * "sha256=<lowercase-hex>" string ready to drop into the signature
 * header. Works in both browser and Node via Web Crypto subtle.
 */
export async function signHmac(secret: string, body: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto subtle API is not available')
  }
  const keyBytes = new TextEncoder().encode(secret)
  const bodyBytes = new TextEncoder().encode(body)
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, bodyBytes)
  return SIG_PREFIX + bytesToHex(new Uint8Array(sig))
}

/**
 * Constant-time compare of the inbound `X-Soteria-Signature` header
 * against a fresh HMAC of the raw body. Returns true when the header
 * matches a valid signature for `body` under `secret`, false on any
 * mismatch (wrong key, malformed header, length skew). Constant-time
 * comparison resists timing attacks that could probe the secret.
 */
export async function verifyHmacSignature(
  secret: string,
  body:    string,
  header:  string | null | undefined,
): Promise<boolean> {
  if (typeof header !== 'string' || !header.startsWith(SIG_PREFIX)) return false
  const expected = await signHmac(secret, body)
  return constantTimeEqual(expected, header)
}

function bytesToHex(bytes: Uint8Array): string {
  const HEX = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    out += HEX[(b >> 4) & 0x0f]
    out += HEX[b & 0x0f]
  }
  return out
}

/**
 * Constant-time string equality for HMAC signature comparison. Returns
 * false immediately when lengths differ — that leak is acceptable
 * because the signature format is fixed-length (`sha256=` + 64 hex).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
