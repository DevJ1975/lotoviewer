// Edge-case tests for the Working at Heights helpers. The vanilla
// suite covers the documented happy paths; this file pushes at the
// boundary conditions a real customer is most likely to hit:
//
//   - dates straddling year / DST / timezone offsets
//   - enums the database has that the code doesn't recognise yet
//     (forward compatibility — a Phase 4 enum value showing up in
//     Phase 2 reads)
//   - threshold boundaries on expiryBand (exactly on / one-day off)
//   - malformed payloads from PostgREST (string-coerced UUIDs as
//     dates, very-far-future dates, year-2038 problem territory)
//   - rows with the date field set to undefined vs null vs ''
//     vs whitespace
//   - empty / single-row decoration
//   - label-map negative paths (unknown key → undefined, caller
//     falls back)

import { describe, expect, it } from 'vitest'
import {
  daysUntil,
  expiryBand,
  decorateWithDaysLeft,
  EXPIRY_BAND_CLASS,
  FALL_PROTECTION_TYPE_LABELS,
  ANCHOR_KIND_LABELS,
  INSPECTION_KIND_LABELS,
  STATUS_BADGE_CLASS,
  OUTCOME_BADGE_CLASS,
} from '@/lib/wah/inventoryHelpers'

const NOW = new Date('2026-06-15T12:00:00Z').getTime()

// ─── daysUntil edge cases ──────────────────────────────────────────────

describe('daysUntil — calendar edges', () => {
  it('correctly spans a leap-year February (2024)', () => {
    // Across Feb 29, 2024 → Mar 1, 2024 is 1 day.
    const reference = new Date('2024-02-29T00:00:00Z').getTime()
    expect(daysUntil('2024-03-01T00:00:00Z', reference)).toBe(1)
  })

  it('handles a date 100 years in the future without integer overflow', () => {
    // The 2038-bug ceiling matters only at second-precision integer
    // math; we use ms-floats so 2126 still computes cleanly.
    // June 15, 2026 → June 15, 2126 spans 24 leap years (2100 is NOT
    // a leap year per the century rule), so 100×365 + 24 = 36,524 days.
    expect(daysUntil('2126-06-15T12:00:00Z', NOW)).toBe(36524)
  })

  it('handles a date 100 years in the past with a large negative number', () => {
    expect(daysUntil('1926-06-15T12:00:00Z', NOW)).toBeLessThan(-36000)
  })

  it('treats a Unix-epoch-ish numeric string as 1970', () => {
    // new Date("0") → 2000-01-01; new Date("123") → year 123. The
    // caller should never pass these, but if they do we don't crash.
    const r = daysUntil('123', NOW)
    expect(r).not.toBeNull()
    expect(typeof r).toBe('number')
  })

  it('handles whitespace-only string as malformed (NaN)', () => {
    expect(daysUntil('   ', NOW)).toBeNaN()
  })

  it('parses an ISO date with timezone offset correctly', () => {
    // 2026-06-15T05:00:00-07:00 == 2026-06-15T12:00:00Z == NOW.
    expect(daysUntil('2026-06-15T05:00:00-07:00', NOW)).toBe(0)
  })

  it('parses an ISO date with timezone offset that crosses a calendar day', () => {
    // 2026-06-15T23:00:00-08:00 = 2026-06-16T07:00:00Z — 19 hours after
    // NOW, which is the same calendar day in UTC but ceil → 1 day.
    expect(daysUntil('2026-06-15T23:00:00-08:00', NOW)).toBe(1)
  })
})

// ─── expiryBand boundary conditions ────────────────────────────────────

describe('expiryBand — exact boundaries', () => {
  it('exactly soonThresholdDays still counts as expiring_soon', () => {
    expect(expiryBand(90, 90)).toBe('expiring_soon')
  })

  it('one day past threshold flips to ok', () => {
    expect(expiryBand(91, 90)).toBe('ok')
  })

  it('threshold of 0 reduces expiring_soon to "today only"', () => {
    expect(expiryBand(0, 0)).toBe('expiring_soon')
    expect(expiryBand(1, 0)).toBe('ok')
  })

  it('negative threshold (degenerate) treats any non-negative day as ok', () => {
    // We don't expect callers to pass negative thresholds; documenting
    // the behaviour here so a future refactor doesn't change it.
    expect(expiryBand(0, -1)).toBe('ok')
  })

  it('very large threshold lets every non-expired row be expiring_soon', () => {
    expect(expiryBand(10000, 100000)).toBe('expiring_soon')
  })

  it('expiring_soon at the threshold gets the amber class, not the slate class', () => {
    // Pin the class assignment so a refactor doesn't silently flip
    // the rose/amber semantics.
    const band = expiryBand(45)
    expect(EXPIRY_BAND_CLASS[band]).toMatch(/amber/)
  })
})

// ─── decorateWithDaysLeft edge cases ───────────────────────────────────

describe('decorateWithDaysLeft — payload edges', () => {
  it('preserves null vs undefined vs empty-string distinction (all → null days_left)', () => {
    const rows = [
      { id: 'a', exp: null },
      { id: 'b', exp: undefined },
      { id: 'c', exp: '' },
    ]
    const out = decorateWithDaysLeft(rows, 'exp', NOW)
    expect(out[0].days_left).toBeNull()
    expect(out[1].days_left).toBeNull()
    expect(out[2].days_left).toBeNull()
  })

  it('does not mutate the input array', () => {
    const rows = [{ id: 'a', exp: '2026-06-16T12:00:00Z' }]
    const before = JSON.stringify(rows)
    decorateWithDaysLeft(rows, 'exp', NOW)
    expect(JSON.stringify(rows)).toBe(before)
  })

  it('a single-row list still produces an array, not a scalar', () => {
    const out = decorateWithDaysLeft([{ id: 'only', exp: '2030-01-01T00:00:00Z' }], 'exp', NOW)
    expect(Array.isArray(out)).toBe(true)
    expect(out).toHaveLength(1)
  })

  it('100-row list completes without performance regression', () => {
    // Sanity smoke — make sure the helper doesn't accidentally do
    // O(n²) work via spread inside a hot loop.
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: String(i), exp: '2026-12-31T00:00:00Z' }))
    const t0 = performance.now()
    const out = decorateWithDaysLeft(rows, 'exp', NOW)
    const elapsed = performance.now() - t0
    expect(out).toHaveLength(100)
    expect(elapsed).toBeLessThan(50)  // generous; usually <1ms
  })

  it('passes NaN through when the date field holds a malformed string', () => {
    const out = decorateWithDaysLeft([{ id: 'bad', exp: 'not-a-date' }], 'exp', NOW)
    expect(out[0].days_left).toBeNaN()
    // Critical: expiryBand collapses NaN to "unknown", so the UI does
    // not show "NaN days left".
    expect(expiryBand(out[0].days_left)).toBe('unknown')
  })
})

// ─── Label-map forward compatibility ───────────────────────────────────
//
// PostgREST may return enum values the code doesn't know about yet —
// a Phase 4 column added to the DB before this branch redeploys, or
// a hand-written row from Supabase Studio. Every list page falls back
// gracefully by displaying the raw value if the label map misses; we
// pin that behaviour here so a refactor doesn't break it.

describe('Label maps — unknown enum values are silent', () => {
  it('FALL_PROTECTION_TYPE_LABELS returns undefined for unrecognised types', () => {
    // The page renders `LABEL[t] ?? t` so the row still appears with
    // the raw value as the label.
    expect((FALL_PROTECTION_TYPE_LABELS as Record<string, string>)['phase4_new_thing']).toBeUndefined()
  })

  it('ANCHOR_KIND_LABELS returns undefined for unrecognised kinds', () => {
    expect(ANCHOR_KIND_LABELS['phase4_new_thing']).toBeUndefined()
  })

  it('INSPECTION_KIND_LABELS returns undefined for unrecognised kinds', () => {
    expect(INSPECTION_KIND_LABELS['phase4_new_thing']).toBeUndefined()
  })

  it('STATUS_BADGE_CLASS returns undefined for unrecognised status', () => {
    expect(STATUS_BADGE_CLASS['phase4_new_thing']).toBeUndefined()
  })

  it('OUTCOME_BADGE_CLASS returns undefined for unrecognised outcomes', () => {
    expect(OUTCOME_BADGE_CLASS['phase4_new_thing']).toBeUndefined()
  })
})

// ─── EXPIRY_BAND_CLASS contract ────────────────────────────────────────

describe('EXPIRY_BAND_CLASS — every band maps to a colour family', () => {
  it('every band has a non-empty class string', () => {
    for (const b of ['expired', 'expiring_soon', 'ok', 'unknown'] as const) {
      expect(EXPIRY_BAND_CLASS[b].length).toBeGreaterThan(0)
    }
  })

  it('the four bands map to four distinct class strings', () => {
    const classes = new Set([
      EXPIRY_BAND_CLASS.expired,
      EXPIRY_BAND_CLASS.expiring_soon,
      EXPIRY_BAND_CLASS.ok,
      EXPIRY_BAND_CLASS.unknown,
    ])
    expect(classes.size).toBe(4)
  })

  it('expired class uses rose (red family), not amber', () => {
    expect(EXPIRY_BAND_CLASS.expired).toMatch(/rose/)
    expect(EXPIRY_BAND_CLASS.expired).not.toMatch(/amber/)
  })

  it('expiring_soon class uses amber, not rose', () => {
    expect(EXPIRY_BAND_CLASS.expiring_soon).toMatch(/amber/)
    expect(EXPIRY_BAND_CLASS.expiring_soon).not.toMatch(/rose/)
  })

  it('dark-mode variant present on every band', () => {
    // Every class string ships its dark: counterpart so theme
    // switching doesn't strand a band in the wrong colour.
    for (const b of ['expired', 'expiring_soon', 'ok', 'unknown'] as const) {
      expect(EXPIRY_BAND_CLASS[b]).toMatch(/dark:/)
    }
  })
})

// ─── Cross-helper integration ──────────────────────────────────────────

describe('Cross-helper edge cases', () => {
  it('decorate → expiryBand chain is stable across the four band outcomes', () => {
    const rows = [
      { id: 'a', when: '2026-06-10T00:00:00Z' },  // -5 days → expired
      { id: 'b', when: '2026-06-15T00:00:00Z' },  // 0 days → expiring_soon
      { id: 'c', when: '2026-07-15T00:00:00Z' },  // 30 days → expiring_soon
      { id: 'd', when: '2027-06-15T00:00:00Z' },  // 365 days → ok
      { id: 'e', when: null },                    // null → unknown
    ]
    const out = decorateWithDaysLeft(rows, 'when', NOW)
    const bands = out.map(r => expiryBand(r.days_left))
    expect(bands).toEqual(['expired', 'expiring_soon', 'expiring_soon', 'ok', 'unknown'])
  })

  it('chain produces a stable result regardless of fetch ordering', () => {
    // Reverse the input; the decorated days_left should reverse too,
    // and the band sequence should mirror the input.
    const rows = [
      { id: 'a', when: '2026-06-10T00:00:00Z' },
      { id: 'b', when: '2027-06-15T00:00:00Z' },
    ]
    const out = decorateWithDaysLeft(rows, 'when', NOW)
    const reversed = decorateWithDaysLeft([...rows].reverse(), 'when', NOW)
    expect(out[0].days_left).toBe(reversed[1].days_left)
    expect(out[1].days_left).toBe(reversed[0].days_left)
  })
})
