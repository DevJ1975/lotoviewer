// Pure helpers for the regulation-freshness cron (/api/cron/check-regulation-updates).
//
// Extracted from the route so the date logic is unit-testable without reaching
// eCFR or Supabase. The cron embeds these between a network fetch and a DB write;
// keeping them pure means the comparison rules — the part that's easy to get
// subtly wrong — are covered by fast, deterministic tests.

export interface EcfrVersion {
  amendment_date?: string
  date?:           string
  part?:           string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Newest amendment date eCFR reports for a CFR part, as an ISO date string, or
 * null when there are no usable dates. ISO dates sort lexicographically, so a
 * plain string sort is correct.
 */
export function pickLatestAmendment(versions: EcfrVersion[], part: string): string | null {
  const dates = versions
    .filter(v => !part || !v.part || v.part === part)
    .map(v => v.amendment_date ?? v.date)
    .filter((d): d is string => typeof d === 'string' && ISO_DATE.test(d))
  if (dates.length === 0) return null
  const sorted = dates.sort()
  return sorted[sorted.length - 1]
}

/**
 * True when the corpus needs a re-ingest: never ingested, or eCFR has a newer
 * amendment than the snapshot we last loaded. A null upstream date (eCFR
 * unreachable / no versions) is treated as "unknown" — never flips the flag.
 */
export function computeNeedsUpdate(
  latestAmendment: string | null,
  ingestedSnapshot: string | null,
): boolean {
  if (latestAmendment === null) return false
  if (!ingestedSnapshot) return true
  return latestAmendment > ingestedSnapshot
}
