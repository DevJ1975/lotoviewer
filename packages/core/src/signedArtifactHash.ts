// SHA-256 hashing for sealed audit artifacts — works in both browser
// and Node.
//
// Why this lives in @soteria/core (not apps/web/lib): the same digest
// must be computable client-side (when the review-portal signoff flow
// finalizes a placard PDF) and server-side (verification routes, future
// background reconcilers). Wrapping `crypto.subtle.digest` keeps the
// algorithm + lowercase-hex encoding single-source.
//
// Threat model: we are NOT signing — anyone who has the bytes can
// recompute the hash. The hash is used as an integrity stamp: if a
// later download produces a different SHA-256, the bytes were modified
// after sign-off. The actual non-repudiation guarantee comes from
// recording the hash in the `loto_signed_pdf_artifacts` table behind
// audit log + RLS.

const HEX = '0123456789abcdef'

/**
 * Returns the lowercase-hex SHA-256 of the given bytes. Equivalent to
 * `openssl dgst -sha256 -hex <file>` on the same input.
 *
 * Throws if `crypto.subtle` is unavailable — every supported runtime
 * (Node ≥18, modern browsers, iOS Safari ≥11) ships it, so a thrown
 * error here is a deployment-config problem, not a per-call concern.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto subtle API is not available in this runtime')
  }
  // crypto.subtle.digest accepts a BufferSource. We slice the underlying
  // ArrayBuffer so callers passing a view over a larger buffer (e.g. a
  // Uint8Array from a typed-array allocation) hash only their region,
  // not the full backing memory. WebKit on iOS is also stricter about
  // accepting Uint8Array directly here than Chromium.
  const view = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', view)
  return bytesToHex(new Uint8Array(digest))
}

function bytesToHex(bytes: Uint8Array): string {
  // Manual loop is meaningfully faster than `.map(b => b.toString(16))`
  // on the 32-byte SHA-256 output — relevant when the cover sheet
  // hashes dozens of permits in a tight loop.
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    out += HEX[(b >> 4) & 0x0f]
    out += HEX[b & 0x0f]
  }
  return out
}
