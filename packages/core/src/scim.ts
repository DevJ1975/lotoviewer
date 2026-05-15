// SCIM 2.0 (RFC 7643 / 7644) — minimal user-schema parser + token
// hashing helpers. Pure functions, no I/O.
//
// We implement the bits we actually need to ingest user records from
// an IdP (Okta, Azure AD, Google Workspace SCIM endpoint). The shape
// is wider in the spec — `groups`, `roles`, `phoneNumbers`,
// extension schemas — but our v1 only needs:
//   - userName       (email-style identifier; RFC 7643 §4.1.1)
//   - name.formatted or name.givenName + familyName  (RFC 7643 §4.1.1)
//   - emails[].value with primary=true               (RFC 7643 §4.1.2)
//   - active                                          (RFC 7643 §4.1.1)
//   - externalId                                      (RFC 7643 §3.1)
//
// Everything else from the IdP payload is preserved verbatim in the
// audit log but ignored for the workforce-record insert/update.

/**
 * Normalized SCIM user shape — only the fields we actually use. The
 * raw payload is preserved separately for audit so a field we
 * currently ignore can be revisited without a re-import.
 */
export interface ScimUser {
  /** Stable IdP-side identifier. RFC 7643 §3.1. Required by us so we
   * have an upsert key for `loto_workers.scim_external_id`. */
  externalId:  string
  userName:    string
  fullName:    string
  primaryEmail: string | null
  active:      boolean
}

export interface ScimParseError {
  field:   string
  message: string
}

export type ScimParseResult =
  | { ok: true;  user: ScimUser }
  | { ok: false; errors: ScimParseError[] }

interface ScimEmailValue {
  value:   unknown
  primary?: unknown
  type?:    unknown
}

interface ScimNameValue {
  formatted?:  unknown
  givenName?:  unknown
  familyName?: unknown
}

interface ScimRawPayload {
  schemas?:    unknown
  externalId?: unknown
  userName?:   unknown
  name?:       unknown
  emails?:     unknown
  active?:     unknown
  displayName?: unknown
}

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'

/**
 * Parse a SCIM 2.0 User resource. The spec is verbose — we accept
 * what's required for our workforce-record use case and reject only
 * when a hard requirement is missing or malformed.
 *
 * Conservative: we silently allow `schemas` to be missing because
 * Okta and Azure AD both occasionally drop it on PATCH payloads.
 * When present, it must include the core User schema URN.
 */
export function parseScimUser(payload: unknown): ScimParseResult {
  const errors: ScimParseError[] = []

  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: [{ field: '_root', message: 'payload must be an object' }] }
  }

  const raw = payload as ScimRawPayload

  if (Array.isArray(raw.schemas)) {
    const schemas = raw.schemas as unknown[]
    const hasUserSchema = schemas.some(s => typeof s === 'string' && s === SCIM_USER_SCHEMA)
    if (schemas.length > 0 && !hasUserSchema) {
      errors.push({ field: 'schemas', message: `must include "${SCIM_USER_SCHEMA}"` })
    }
  }

  const externalId = typeof raw.externalId === 'string' && raw.externalId.trim() !== ''
    ? raw.externalId.trim()
    : null
  if (!externalId) {
    errors.push({ field: 'externalId', message: 'externalId is required (used as upsert key)' })
  }

  const userName = typeof raw.userName === 'string' && raw.userName.trim() !== ''
    ? raw.userName.trim()
    : null
  if (!userName) {
    errors.push({ field: 'userName', message: 'userName is required' })
  }

  // `name` is an object in the spec — be tolerant of clients that send
  // a string in `displayName` instead.
  const nameObj = (raw.name && typeof raw.name === 'object')
    ? raw.name as ScimNameValue
    : null
  const fullName = extractFullName(nameObj, raw.displayName)
  if (!fullName) {
    errors.push({ field: 'name', message: 'name.formatted, displayName, or both givenName+familyName required' })
  }

  const primaryEmail = extractPrimaryEmail(raw.emails)

  // Default to active=true when omitted. Per RFC 7643 §4.1.1 the field
  // is optional and "client SHOULD provide it"; treating an absent
  // field as active matches Okta's defaults.
  const active = raw.active === undefined ? true : Boolean(raw.active)

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    user: {
      externalId: externalId!,
      userName:   userName!,
      fullName:   fullName!,
      primaryEmail,
      active,
    },
  }
}

function extractFullName(name: ScimNameValue | null, displayName: unknown): string | null {
  if (name?.formatted && typeof name.formatted === 'string' && name.formatted.trim() !== '') {
    return name.formatted.trim()
  }
  if (name?.givenName || name?.familyName) {
    const parts = [name.givenName, name.familyName]
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .map(s => s.trim())
    if (parts.length > 0) return parts.join(' ')
  }
  if (typeof displayName === 'string' && displayName.trim() !== '') {
    return displayName.trim()
  }
  return null
}

function extractPrimaryEmail(emails: unknown): string | null {
  if (!Array.isArray(emails)) return null
  const list = emails as ScimEmailValue[]
  // RFC 7643 §4.1.2: at most one entry per multi-valued attribute can
  // be primary. If a `primary: true` is found, use that; otherwise fall
  // back to the first valid entry.
  const primary = list.find(e => typeof e === 'object' && e !== null && e.primary === true)
  const candidate = primary ?? list.find(e => typeof e === 'object' && e !== null)
  if (!candidate) return null
  const value = candidate.value
  return typeof value === 'string' && value.includes('@') ? value.trim() : null
}

/**
 * SHA-256 the raw token and return lowercase hex. Works in both the
 * browser (Web Crypto) and Node (built-in `crypto.subtle`). Used to
 * compare an inbound bearer token against the stored `token_hash`.
 *
 * Throws if `crypto.subtle` is unavailable — every supported runtime
 * (Node ≥18, modern browsers) ships it.
 */
export async function sha256HexString(value: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto subtle API is not available in this runtime')
  }
  const bytes = new TextEncoder().encode(value)
  // crypto.subtle.digest needs a BufferSource; slice to the exact view
  // (see signedArtifactHash.ts for the same WebKit-on-iOS quirk).
  const view = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', view)
  return bytesToHex(new Uint8Array(digest))
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
 * Generate a random opaque token suitable for use as a SCIM bearer.
 * 32 random bytes encoded as base64url — 43 chars, ~256 bits of
 * entropy. Plenty for an integration token that is hashed at rest
 * and revocable by the admin.
 *
 * The token is returned to the admin once and never persisted in
 * plaintext; only `sha256HexString(token)` lives in `scim_tokens.token_hash`.
 */
export function generateScimToken(): string {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Web Crypto getRandomValues is not available in this runtime')
  }
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

function base64UrlEncode(bytes: Uint8Array): string {
  // btoa() is the most portable encoder available in both browser
  // and Node (≥16). Convert to URL-safe alphabet (no padding) so the
  // token is safe in Authorization headers without escaping.
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const b64 = typeof btoa !== 'undefined'
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
