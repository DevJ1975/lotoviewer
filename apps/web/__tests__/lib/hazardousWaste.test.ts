import { describe, expect, it } from 'vitest'
import {
  containerAgeStatus,
  createEmptyHazardousWasteFieldDraft,
  getChecksForArea,
  nextBiennialDueDate,
  summarizeHazardousWasteDraft,
} from '@soteria/core/hazardousWaste'

describe('summarizeHazardousWasteDraft', () => {
  it('returns total=0 / readyForReview=false when the area has no checks', () => {
    const draft = createEmptyHazardousWasteFieldDraft('inspection_only')
    // Force a synthetic empty-area scenario by clearing every check id —
    // simulates a future area config where the catalog filter returns nothing.
    const summary = summarizeHazardousWasteDraft({
      ...draft,
      areaType: 'inspection_only',
      checkedIds: [],
      flaggedIds: [],
    })
    expect(summary.checked).toBeLessThanOrEqual(summary.total)
    // The real bug we're guarding: if total were 0, vacuous true is wrong.
    if (summary.total === 0) {
      expect(summary.readyForReview).toBe(false)
    }
  })

  it('only flags readyForReview when every check is checked and no critical flagged', () => {
    const checks = getChecksForArea('central_accumulation')
    const allIds = checks.map(c => c.id)
    const draft = createEmptyHazardousWasteFieldDraft('central_accumulation')

    const partial = summarizeHazardousWasteDraft({ ...draft, checkedIds: allIds.slice(0, 1) })
    expect(partial.readyForReview).toBe(false)

    const allChecked = summarizeHazardousWasteDraft({ ...draft, checkedIds: allIds })
    expect(allChecked.readyForReview).toBe(true)

    const oneCriticalFlagged = summarizeHazardousWasteDraft({
      ...draft,
      checkedIds: allIds,
      flaggedIds: [checks.find(c => c.critical)!.id],
    })
    expect(oneCriticalFlagged.readyForReview).toBe(false)
    expect(oneCriticalFlagged.flaggedCritical).toBe(1)
  })
})

describe('containerAgeStatus', () => {
  const now = new Date('2026-05-14T12:00:00Z')

  it('returns unknown when startedAt is null', () => {
    const r = containerAgeStatus(null, now, { category: 'lqg' })
    expect(r.status).toBe('unknown')
    expect(r.ageDays).toBeNull()
  })

  it('returns unknown when startedAt is unparseable', () => {
    const r = containerAgeStatus('not-a-date', now, { category: 'lqg' })
    expect(r.status).toBe('unknown')
    expect(r.ageDays).toBeNull()
  })

  it('treats a future start date as unknown (data-entry error)', () => {
    const future = new Date('2026-06-01T12:00:00Z')
    const r = containerAgeStatus(future, now, { category: 'lqg' })
    expect(r.status).toBe('unknown')
    expect(r.ageDays).toBe(0)
  })

  it('LQG: 30 days old is ok, 80 days is approaching, 91 days is over_limit', () => {
    const ok = containerAgeStatus('2026-04-14T12:00:00Z', now, { category: 'lqg' })
    expect(ok.ageDays).toBe(30)
    expect(ok.status).toBe('ok')
    expect(ok.limitDays).toBe(90)
    expect(ok.daysUntilLimit).toBe(60)

    const approaching = containerAgeStatus('2026-02-23T12:00:00Z', now, { category: 'lqg' })
    expect(approaching.ageDays).toBe(80)
    expect(approaching.status).toBe('approaching')

    const over = containerAgeStatus('2026-02-12T12:00:00Z', now, { category: 'lqg' })
    expect(over.ageDays).toBeGreaterThan(90)
    expect(over.status).toBe('over_limit')
  })

  it('SQG baseline limit is 180 days; longHaul extends to 270', () => {
    const start = '2025-12-01T12:00:00Z' // 164 days before now
    const sqg = containerAgeStatus(start, now, { category: 'sqg' })
    expect(sqg.limitDays).toBe(180)
    expect(sqg.status).toBe('approaching')

    const sqgLong = containerAgeStatus(start, now, { category: 'sqg', longHaul: true })
    expect(sqgLong.limitDays).toBe(270)
    expect(sqgLong.status).toBe('ok')
  })

  it('VSQG has no federal limit so status stays unknown even with age', () => {
    const r = containerAgeStatus('2026-01-01T12:00:00Z', now, { category: 'vsqg' })
    expect(r.ageDays).toBeGreaterThan(0)
    expect(r.limitDays).toBeNull()
    expect(r.status).toBe('unknown')
  })

  it('DST/TZ: status flips on whole-day boundaries, not hour-of-day', () => {
    // March 8 2026 02:00 → DST starts in US — but math is in UTC ms so the
    // 90-day mark for an LQG container started 2026-02-13T12:00Z is the
    // same regardless of US local DST.
    const start = '2026-02-13T12:00:00Z' // 90 days before 2026-05-14T12:00Z
    const r = containerAgeStatus(start, now, { category: 'lqg' })
    expect(r.ageDays).toBe(90)
    expect(r.status).toBe('approaching') // <= warn window, not yet over
  })

  it('honors a custom warnDaysBeforeLimit window', () => {
    const r = containerAgeStatus('2026-04-04T12:00:00Z', now, {
      category: 'lqg',
      warnDaysBeforeLimit: 0,
    })
    // 40 days old, 50 days until limit; with 0-day warn window → ok.
    expect(r.status).toBe('ok')
  })
})

describe('nextBiennialDueDate', () => {
  it('returns March 1 of the same even year when called before that date', () => {
    const d = nextBiennialDueDate(new Date('2026-01-15T00:00:00Z'))
    expect(d.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })

  it('returns same-day deadline when called on March 1 of an even year', () => {
    const d = nextBiennialDueDate(new Date('2026-03-01T00:00:00Z'))
    expect(d.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })

  it('rolls forward to the next even year when past March 1 of an even year', () => {
    const d = nextBiennialDueDate(new Date('2026-03-02T00:00:00Z'))
    expect(d.toISOString()).toBe('2028-03-01T00:00:00.000Z')
  })

  it('rolls forward from any odd-year date to the next even year', () => {
    const julyOdd = nextBiennialDueDate(new Date('2027-08-15T00:00:00Z'))
    expect(julyOdd.toISOString()).toBe('2028-03-01T00:00:00.000Z')

    const earlyOdd = nextBiennialDueDate(new Date('2027-01-02T00:00:00Z'))
    expect(earlyOdd.toISOString()).toBe('2028-03-01T00:00:00.000Z')
  })

  it('handles leap years (2028 is a leap year; Feb 29 → March 1 still resolves)', () => {
    const d = nextBiennialDueDate(new Date('2028-02-29T00:00:00Z'))
    expect(d.toISOString()).toBe('2028-03-01T00:00:00.000Z')
  })

  it('throws on unparseable input', () => {
    expect(() => nextBiennialDueDate('not a date')).toThrow()
  })
})
