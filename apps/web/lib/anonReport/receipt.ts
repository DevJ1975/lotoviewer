// Receipt PIN generation and verification for anonymous reports.
//
// On submit, the reporter optionally generates a 6-character
// alphanumeric PIN. We store sha256(report_number || pin) on the
// incident row; the PIN itself is shown ONCE on the success screen
// and never persisted server-side.
//
// Later they hit /report/status with (report_number, pin) and we
// recompute the hash to find the row. Brute force is bounded by
// the IP-throttle (migration 085).
//
// Alphabet excludes O/0/I/1/L to reduce transcription errors when
// a worker writes the PIN on a sticky note.

import { createHash, randomInt } from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const PIN_LEN  = 6

export function generateReceiptPin(): string {
  let out = ''
  for (let i = 0; i < PIN_LEN; i++) {
    out += ALPHABET[randomInt(0, ALPHABET.length)]
  }
  return out
}

// Normalise human input: strip whitespace, uppercase. We don't
// disambiguate visually-similar characters (those are excluded
// from the alphabet at generation time anyway).
export function normalizePin(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

export function hashReceipt(reportNumber: string, pin: string): string {
  const norm = normalizePin(pin)
  return createHash('sha256').update(`${reportNumber}::${norm}`).digest('hex')
}

export function isValidPinFormat(pin: string): boolean {
  const norm = normalizePin(pin)
  if (norm.length !== PIN_LEN) return false
  for (const c of norm) if (!ALPHABET.includes(c)) return false
  return true
}
