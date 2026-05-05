import { describe, it, expect } from 'vitest'
import { bumpStatus, calibrationOverdue, BUMP_TEST_WINDOW_MS } from '@/lib/gasMeters'
import type { GasMeter } from '@soteria/core/types'

const NOW = new Date('2026-04-26T12:00:00Z').getTime()

function meter(partial: Partial<GasMeter>): GasMeter {
  return {
    instrument_id:        'BW-MCXL-7841',
    description:          null,
    last_bump_at:         null,
    last_calibration_at:  null,
    next_calibration_due: null,
    decommissioned:       false,
    notes:                null,
    created_at:           '2026-04-01T00:00:00Z',
    updated_at:           '2026-04-01T00:00:00Z',
    ...partial,
  }
}

describe('bumpStatus', () => {
  it('returns "unknown" when the meter is not in the register', () => {
    expect(bumpStatus(null, NOW)).toEqual({ kind: 'unknown' })
  })

  it('returns "never" when the meter exists but has no bump on record', () => {
    expect(bumpStatus(meter({ last_bump_at: null }), NOW)).toEqual({ kind: 'never' })
  })

  it('returns "fresh" when bumped within the 24h window', () => {
    const r = bumpStatus(meter({ last_bump_at: new Date(NOW - 4 * 3600_000).toISOString() }), NOW)
    expect(r.kind).toBe('fresh')
    if (r.kind === 'fresh') expect(r.hoursSince).toBe(4)
  })

  it('returns "overdue" when bumped longer than 24h ago', () => {
    const r = bumpStatus(meter({ last_bump_at: new Date(NOW - 30 * 3600_000).toISOString() }), NOW)
    expect(r.kind).toBe('overdue')
    if (r.kind === 'overdue') expect(r.hoursSince).toBe(30)
  })

  it('treats the 24h boundary as fresh (off-by-one safety)', () => {
    const r = bumpStatus(meter({ last_bump_at: new Date(NOW - BUMP_TEST_WINDOW_MS).toISOString() }), NOW)
    expect(r.kind).toBe('fresh')
  })

  it('treats an unparseable last_bump_at as "never" — fail-closed', () => {
    expect(bumpStatus(meter({ last_bump_at: 'not-a-date' as unknown as string }), NOW)).toEqual({ kind: 'never' })
  })

  // Future timestamps are weird but possible (clock drift, manual entry).
  // Returning 'fresh' is intentional — the bump-test window is "within 24h
  // of now" and a future timestamp trivially satisfies that. If we ever
  // change this, this test pins the prior behavior so the change is loud.
  it('treats a future last_bump_at as "fresh" with hoursSince clamped to 0', () => {
    const r = bumpStatus(meter({ last_bump_at: new Date(NOW + 3 * 3600_000).toISOString() }), NOW)
    expect(r.kind).toBe('fresh')
    if (r.kind === 'fresh') expect(r.hoursSince).toBe(0)
  })
})

describe('calibrationOverdue', () => {
  it('is false when the meter has no next_calibration_due', () => {
    expect(calibrationOverdue(meter({}), NOW)).toBe(false)
  })

  it('is true when due date is in the past', () => {
    expect(calibrationOverdue(meter({ next_calibration_due: new Date(NOW - 24 * 3600_000).toISOString() }), NOW)).toBe(true)
  })

  it('is false when due date is in the future', () => {
    expect(calibrationOverdue(meter({ next_calibration_due: new Date(NOW + 7 * 24 * 3600_000).toISOString() }), NOW)).toBe(false)
  })

  it('is false on an unparseable due date', () => {
    expect(calibrationOverdue(meter({ next_calibration_due: 'garbage' as unknown as string }), NOW)).toBe(false)
  })

  it('is false when the meter is null (unknown meter, no signal)', () => {
    expect(calibrationOverdue(null, NOW)).toBe(false)
  })
})
