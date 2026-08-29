import { describe, it, expect } from 'vitest'
import { pickLatestAmendment, computeNeedsUpdate } from '@/lib/regulationFreshness'

// The cron's date logic lives in these pure helpers so the comparison rules —
// which part is current, what counts as "newer" — are pinned without hitting
// eCFR or Supabase.

describe('pickLatestAmendment', () => {
  it('returns the newest amendment date for the part', () => {
    expect(pickLatestAmendment([
      { amendment_date: '2024-05-20', part: '1910' },
      { amendment_date: '2026-01-08', part: '1910' },
      { amendment_date: '2023-07-19', part: '1910' },
    ], '1910')).toBe('2026-01-08')
  })

  it('ignores versions from other parts', () => {
    expect(pickLatestAmendment([
      { amendment_date: '2030-01-01', part: '1926' },
      { amendment_date: '2026-01-08', part: '1910' },
    ], '1910')).toBe('2026-01-08')
  })

  it('falls back to `date` when amendment_date is absent', () => {
    expect(pickLatestAmendment([{ date: '2025-03-03', part: '1910' }], '1910')).toBe('2025-03-03')
  })

  it('skips malformed dates and returns null when none are usable', () => {
    expect(pickLatestAmendment([{ amendment_date: 'n/a', part: '1910' }], '1910')).toBeNull()
    expect(pickLatestAmendment([], '1910')).toBeNull()
  })
})

describe('computeNeedsUpdate', () => {
  it('is true when the corpus was never ingested', () => {
    expect(computeNeedsUpdate('2026-01-08', null)).toBe(true)
  })

  it('is true when eCFR is newer than the ingested snapshot', () => {
    expect(computeNeedsUpdate('2026-01-08', '2025-05-07')).toBe(true)
  })

  it('is false when the snapshot is current or ahead', () => {
    expect(computeNeedsUpdate('2026-01-08', '2026-01-08')).toBe(false)
    expect(computeNeedsUpdate('2026-01-08', '2026-05-07')).toBe(false)
  })

  it('is false when the upstream date is unknown (eCFR unreachable)', () => {
    expect(computeNeedsUpdate(null, '2025-01-01')).toBe(false)
  })
})
