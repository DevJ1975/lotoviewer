import { describe, it, expect } from 'vitest'
import { validateTraining, TRAINING_ROLE_LABELS } from '@/lib/trainingRecords'
import type { TrainingRecord, TrainingRole } from '@/lib/types'

const ASOF = new Date('2026-04-26T12:00:00Z')

function rec(p: Partial<TrainingRecord> & Pick<TrainingRecord, 'worker_name' | 'role'>): TrainingRecord {
  return {
    id:             'r-1',
    completed_at:   '2026-01-01',
    expires_at:     '2027-01-01',
    cert_authority: null,
    notes:          null,
    created_by:     null,
    created_at:     '2026-01-01T00:00:00Z',
    updated_at:     '2026-01-01T00:00:00Z',
    ...p,
  }
}

describe('validateTraining', () => {
  it('returns no issues when everyone has a current cert', () => {
    const records: TrainingRecord[] = [
      rec({ worker_name: 'Maria', role: 'entrant'   }),
      rec({ worker_name: 'Tomás', role: 'attendant' }),
    ]
    expect(validateTraining({ entrants: ['Maria'], attendants: ['Tomás'], records, asOf: ASOF })).toEqual([])
  })

  it('flags an entrant with no record at all', () => {
    const issues = validateTraining({
      entrants:   ['Maria'],
      attendants: [],
      records:    [],
      asOf:       ASOF,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ worker_name: 'Maria', slot: 'entrant', kind: 'missing' })
  })

  it('flags an attendant with no record at all', () => {
    const issues = validateTraining({
      entrants:   [],
      attendants: ['Tomás'],
      records:    [],
      asOf:       ASOF,
    })
    expect(issues[0].slot).toBe('attendant')
  })

  it('flags an expired cert and reports the expiry date', () => {
    const records: TrainingRecord[] = [
      rec({ worker_name: 'Maria', role: 'entrant', completed_at: '2024-01-01', expires_at: '2025-01-01' }),
    ]
    const issues = validateTraining({ entrants: ['Maria'], attendants: [], records, asOf: ASOF })
    expect(issues[0].kind).toBe('expired')
    expect(issues[0].expired_on).toBe('2025-01-01')
  })

  it('treats null expires_at as no expiry — cert never lapses', () => {
    const records: TrainingRecord[] = [
      rec({ worker_name: 'Maria', role: 'entrant', expires_at: null, completed_at: '2020-01-01' }),
    ]
    expect(validateTraining({ entrants: ['Maria'], attendants: [], records, asOf: ASOF })).toEqual([])
  })

  it('matches names case-insensitively — pasted rosters can mismatch case', () => {
    const records: TrainingRecord[] = [
      rec({ worker_name: 'maria', role: 'entrant' }),
    ]
    expect(validateTraining({
      entrants:   ['Maria'],
      attendants: [],
      records, asOf: ASOF,
    })).toEqual([])
  })

  it('an entry-supervisor cert covers entrant duties (higher standard satisfies lower)', () => {
    const records: TrainingRecord[] = [
      rec({ worker_name: 'Maria', role: 'entry_supervisor' }),
    ]
    expect(validateTraining({
      entrants:   ['Maria'],
      attendants: [],
      records, asOf: ASOF,
    })).toEqual([])
  })

  it('a rescuer cert covers entrant duties', () => {
    const records: TrainingRecord[] = [
      rec({ worker_name: 'Maria', role: 'rescuer' }),
    ]
    expect(validateTraining({
      entrants:   ['Maria'],
      attendants: [],
      records, asOf: ASOF,
    })).toEqual([])
  })

  it('but an entrant cert does NOT cover attendant duties (different supervision skill)', () => {
    const records: TrainingRecord[] = [
      rec({ worker_name: 'Tomás', role: 'entrant' }),
    ]
    const issues = validateTraining({
      entrants:   [],
      attendants: ['Tomás'],
      records, asOf: ASOF,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('missing')
  })

  it('"other" role does NOT satisfy any slot — site-specific certs alone do not authorize entry', () => {
    const records: TrainingRecord[] = [
      rec({ worker_name: 'Maria', role: 'other' }),
    ]
    const issues = validateTraining({
      entrants:   ['Maria'],
      attendants: [],
      records, asOf: ASOF,
    })
    expect(issues[0].kind).toBe('missing')
  })

  it('uses the freshest cert per (name, role) when multiple exist', () => {
    // Worker has an old expired entrant cert and a new current one;
    // gate must NOT flag them based on the stale row.
    const records: TrainingRecord[] = [
      rec({ id: 'old',   worker_name: 'Maria', role: 'entrant', completed_at: '2024-01-01', expires_at: '2025-01-01' }),
      rec({ id: 'fresh', worker_name: 'Maria', role: 'entrant', completed_at: '2026-01-01', expires_at: '2027-01-01' }),
    ]
    expect(validateTraining({
      entrants:   ['Maria'],
      attendants: [],
      records, asOf: ASOF,
    })).toEqual([])
  })

  it('returns an issue per name when multiple are missing', () => {
    const issues = validateTraining({
      entrants:   ['Maria', 'Jose'],
      attendants: ['Tomás'],
      records:    [],
      asOf:       ASOF,
    })
    expect(issues).toHaveLength(3)
    expect(issues.map(i => i.worker_name).sort()).toEqual(['Jose', 'Maria', 'Tomás'])
  })

  it('treats today as still-valid (boundary safety) — cert expiring today does NOT flag', () => {
    const records: TrainingRecord[] = [
      rec({ worker_name: 'Maria', role: 'entrant', completed_at: '2025-04-26', expires_at: '2026-04-26' }),
    ]
    expect(validateTraining({
      entrants:   ['Maria'],
      attendants: [],
      records, asOf: ASOF,
    })).toEqual([])
  })
})

describe('TRAINING_ROLE_LABELS', () => {
  it('has a label for every role', () => {
    for (const role of ['entrant', 'attendant', 'entry_supervisor', 'rescuer', 'other'] as TrainingRole[]) {
      expect(TRAINING_ROLE_LABELS[role]).toBeTruthy()
    }
  })
})
