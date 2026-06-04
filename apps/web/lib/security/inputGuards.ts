// Small, dependency-free input-safety primitives.
//
// These exist because two classes of bug recur across the API surface:
//   1. User free-text concatenated into an AI prompt with no length
//      bound → token-cost blowout / oversized request payloads.
//   2. User strings interpolated into a PostgREST `.or()` filter string
//      or an email envelope field, where a comma / paren / newline has
//      structural meaning the caller didn't intend.
//
// None of these are a substitute for the auth gate + RLS + the
// per-call tenant_id filter — those remain the real isolation boundary.
// These are defense-in-depth + robustness (avoid 400s on legitimate
// values containing punctuation) + cost control.
//
// Pure functions, no I/O, trivially unit-testable.

/**
 * Cap free text before it is concatenated into an AI prompt or stored.
 * Returns the input unchanged when within `max`; otherwise truncates on
 * a code-point boundary and appends a visible marker so a reviewer can
 * tell the model saw a clipped value.
 *
 * Default 5000 chars ≈ comfortably under a single Claude message while
 * preserving enough context for classification / summarization.
 */
export function clampText(value: string | null | undefined, max = 5000): string {
  if (!value) return ''
  if (value.length <= max) return value
  // Slice by code points, not UTF-16 units, so we never split a
  // surrogate pair and emit a lone half-character.
  const head = Array.from(value).slice(0, max).join('')
  return `${head}\n…[truncated ${value.length - head.length} chars]`
}

/**
 * Neutralize the characters that delimit branches inside a PostgREST
 * `.or()` / `.filter()` expression string. Commas separate OR branches,
 * parentheses group them, and a leading/trailing dot is operator syntax.
 * We replace them with spaces (ILIKE search tolerates the space; an
 * exact-match lookup simply won't match a value that legitimately
 * contained these, which is acceptable for the search/lookup surfaces
 * that use this).
 *
 * This is NOT the tenant-isolation boundary — every such query must
 * still carry its own `.eq('tenant_id', …)`. This only stops a value
 * from changing the *shape* of the filter expression.
 */
export function escapePostgrestFilterValue(value: string): string {
  return value.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Single-line email shape. Deliberately conservative: no display name,
// no comments, no quoted local parts — the app only ever sends to plain
// addresses. The key property is "contains no CR/LF or other control
// chars", which is what blocks SMTP header injection.
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/

/**
 * True iff `addr` is a single, well-formed email with no control
 * characters. Use to gate values that become an envelope field
 * (to / from / reply-to) before handing them to the mail provider —
 * a newline in any of those fields is a header-injection vector.
 */
export function isSafeEmailAddress(addr: string | null | undefined): boolean {
  if (!addr) return false
  if (/[\r\n\t\0]/.test(addr)) return false
  if (addr.length > 254) return false   // RFC 5321 max
  return EMAIL_RE.test(addr)
}
