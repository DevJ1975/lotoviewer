// Checks the environmental validators share.

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A YYYY-MM-DD that is a real calendar day. "2026-02-30" has the shape but is not
 * one, and "2026-13-01" does not even parse (toISOString throws on an invalid Date,
 * so that is checked first).
 */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
