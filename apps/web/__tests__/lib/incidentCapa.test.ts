import { describe, it, expect } from 'vitest'
import {
  canVerify,
  classifyCapa,
  summarizeCapas,
  type CapaRow,
} from '@soteria/core/incidentCapa'

const NOW = new Date('2026-05-15T00:00:00Z')

function capa(overrides: Partial<CapaRow> & { id?: string } = {}): CapaRow {
  return {
    id:                    overrides.id ?? 'capa-1',
    status:                'open',
    due_at:                null,
    completed_at:          null,
    completed_by_user_id:  null,
    verified_effective_at: null,
    verified_by_user_id:   null,
    ...overrides,
  }
}

describe('classifyCapa', () => {
  it('classifies a fresh open CAPA with no due date as open', () => {
    expect(classifyCapa(capa(), NOW)).toBe('open')
  })

  it('classifies an in-progress CAPA inside its window as open', () => {
    const c = capa({
      status: 'in_progress',
      due_at: '2026-08-01T00:00:00Z',
    })
    expect(classifyCapa(c, NOW)).toBe('open')
  })

  it('classifies an open CAPA past its due date as overdue', () => {
    const c = capa({
      status: 'open',
      due_at: '2026-01-01T00:00:00Z',
    })
    expect(classifyCapa(c, NOW)).toBe('overdue')
  })

  it('classifies an in_progress CAPA past its due date as overdue', () => {
    const c = capa({
      status: 'in_progress',
      due_at: '2026-01-01T00:00:00Z',
    })
    expect(classifyCapa(c, NOW)).toBe('overdue')
  })

  it('does not flag completed-and-overdue as overdue (completion clears the SLA)', () => {
    // Once completed, the deadline is satisfied; it's now awaiting
    // a separate verifier. The badge should reflect that, not "OVERDUE".
    const c = capa({
      status:               'completed',
      due_at:               '2026-01-01T00:00:00Z',
      completed_at:         '2026-02-01T00:00:00Z',
      completed_by_user_id: 'user-a',
    })
    expect(classifyCapa(c, NOW)).toBe('awaiting_verification')
  })

  it('classifies a completed-but-not-verified CAPA as awaiting_verification', () => {
    const c = capa({
      status:               'completed',
      completed_at:         '2026-04-01T00:00:00Z',
      completed_by_user_id: 'user-a',
    })
    expect(classifyCapa(c, NOW)).toBe('awaiting_verification')
  })

  it('classifies a verified CAPA as verified regardless of dates', () => {
    const c = capa({
      status:                'verified',
      completed_at:          '2026-04-01T00:00:00Z',
      completed_by_user_id:  'user-a',
      verified_effective_at: '2026-04-15T00:00:00Z',
      verified_by_user_id:   'user-b',
    })
    expect(classifyCapa(c, NOW)).toBe('verified')
  })

  it('classifies a cancelled CAPA as cancelled', () => {
    expect(classifyCapa(capa({ status: 'cancelled' }), NOW)).toBe('cancelled')
  })

  it('treats unparseable due_at as no-due (does not crash, does not flag overdue)', () => {
    const c = capa({ status: 'open', due_at: 'not-a-date' })
    expect(classifyCapa(c, NOW)).toBe('open')
  })
})

describe('summarizeCapas', () => {
  it('returns all-zero counts for an empty list', () => {
    expect(summarizeCapas([], NOW)).toEqual({
      total:                 0,
      open:                  0,
      overdue:               0,
      awaiting_verification: 0,
      verified:              0,
      cancelled:             0,
    })
  })

  it('bucketizes a mixed list correctly', () => {
    const rows: CapaRow[] = [
      capa({ id: 'a', status: 'open' }),
      capa({ id: 'b', status: 'in_progress', due_at: '2026-01-01T00:00:00Z' }),   // overdue
      capa({ id: 'c', status: 'open', due_at: '2026-01-01T00:00:00Z' }),          // overdue
      capa({ id: 'd', status: 'completed', completed_at: '2026-04-01T00:00:00Z', completed_by_user_id: 'u1' }),
      capa({ id: 'e', status: 'verified', completed_at: '2026-04-01T00:00:00Z', completed_by_user_id: 'u1', verified_effective_at: '2026-04-10T00:00:00Z', verified_by_user_id: 'u2' }),
      capa({ id: 'f', status: 'cancelled' }),
    ]
    const summary = summarizeCapas(rows, NOW)
    expect(summary).toEqual({
      total:                 6,
      open:                  1,
      overdue:               2,
      awaiting_verification: 1,
      verified:              1,
      cancelled:             1,
    })
  })
})

describe('canVerify (different-verifier rule)', () => {
  const completed = capa({
    id:                   'capa-completed',
    status:               'completed',
    completed_at:         '2026-04-01T00:00:00Z',
    completed_by_user_id: 'user-a',
  })

  it('returns true when a different user attempts to verify a completed CAPA', () => {
    expect(canVerify(completed, 'user-b')).toBe(true)
  })

  it('returns false when the completer tries to verify their own work', () => {
    expect(canVerify(completed, 'user-a')).toBe(false)
  })

  it('returns false when verifier is null / undefined', () => {
    expect(canVerify(completed, null)).toBe(false)
    expect(canVerify(completed, undefined)).toBe(false)
    expect(canVerify(completed, '')).toBe(false)
  })

  it('returns false when the CAPA has not been completed yet', () => {
    const open = capa({ status: 'open' })
    expect(canVerify(open, 'user-b')).toBe(false)
  })

  it('returns false on an already-verified CAPA (re-verification not allowed)', () => {
    const verified = capa({
      status:                'verified',
      completed_at:          '2026-04-01T00:00:00Z',
      completed_by_user_id:  'user-a',
      verified_effective_at: '2026-04-10T00:00:00Z',
      verified_by_user_id:   'user-b',
    })
    expect(canVerify(verified, 'user-c')).toBe(false)
  })

  it('returns false on a cancelled CAPA', () => {
    const cancelled = capa({ status: 'cancelled' })
    expect(canVerify(cancelled, 'user-b')).toBe(false)
  })
})
