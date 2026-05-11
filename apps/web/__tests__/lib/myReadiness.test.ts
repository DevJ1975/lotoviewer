import { describe, expect, it } from 'vitest'
import {
  buildAdminLinks,
  buildRenewalTimeline,
  buildRestrictions,
  chooseNextBestAction,
  choosePrimaryAction,
  statusFromExpiry,
  summarizeSupervisorRows,
  type EquipmentBadgeStatus,
  type TrainingRequirementStatus,
} from '@soteria/core/myReadiness'

function training(overrides: Partial<TrainingRequirementStatus> = {}): TrainingRequirementStatus {
  return {
    id:               'tr-1',
    role:             'authorized_employee',
    label:            'LOTO authorized employee',
    recurrenceMonths: 12,
    status:           'current',
    completedAt:      '2026-01-01',
    expiresAt:        '2026-12-31',
    evidenceHref:     '/admin/training-records',
    evidenceLabel:    'Training record',
    ...overrides,
  }
}

function equipment(overrides: Partial<EquipmentBadgeStatus> = {}): EquipmentBadgeStatus {
  return {
    id:              'eq-1',
    equipmentFamily: 'forklift_electric',
    label:           'Electric forklift operator',
    status:          'current',
    issuedAt:        '2026-01-01',
    evaluationDueAt: '2026-12-31',
    expiresAt:       '2026-12-31',
    evidenceHref:    '/equipment-readiness',
    evidenceLabel:   'Authorization record',
    ...overrides,
  }
}

describe('My Safety Readiness rules', () => {
  describe('admin edit path', () => {
    it('returns manage links for admins', () => {
      expect(buildAdminLinks(true).map(l => l.id)).toEqual(['position', 'training', 'equipment'])
    })

    it('hides manage links for non-admin workers', () => {
      expect(buildAdminLinks(false)).toEqual([])
    })
  })

  describe('clear work restrictions', () => {
    it('restricts missing and overdue training or equipment', () => {
      const restrictions = buildRestrictions(
        [training({ id: 'missing-training', status: 'missing', expiresAt: null })],
        [equipment({ id: 'expired-equipment', status: 'overdue', expiresAt: '2026-01-01' })],
      )

      expect(restrictions).toHaveLength(2)
      expect(restrictions.map(r => r.label)).toEqual(['LOTO authorized employee', 'Electric forklift operator'])
      expect(restrictions[0].reason).toMatch(/not on file/i)
      expect(restrictions[1].reason).toMatch(/expired on 2026-01-01/i)
    })

    it('does not restrict current or due-soon items', () => {
      expect(buildRestrictions(
        [training({ status: 'due_soon' })],
        [equipment({ status: 'current' })],
      )).toEqual([])
    })
  })

  describe('upcoming renewals timeline', () => {
    it('sorts training and equipment due in the next 90 days', () => {
      const timeline = buildRenewalTimeline(
        [
          training({ id: 'later', label: 'HazCom', expiresAt: '2026-03-20', status: 'current' }),
          training({ id: 'soon', label: 'Fire watch', expiresAt: '2026-01-15', status: 'due_soon' }),
        ],
        [equipment({ id: 'eq', label: 'Forklift', expiresAt: '2026-02-01', status: 'current' })],
        '2026-01-01',
      )

      expect(timeline.map(i => i.label)).toEqual(['Fire watch', 'Forklift', 'HazCom'])
      expect(timeline[0].daysUntilDue).toBe(14)
    })

    it('excludes overdue, missing-date, and outside-window items', () => {
      const timeline = buildRenewalTimeline(
        [
          training({ id: 'overdue', expiresAt: '2025-12-31', status: 'overdue' }),
          training({ id: 'none', expiresAt: null, status: 'current' }),
          training({ id: 'far', expiresAt: '2026-06-01', status: 'current' }),
        ],
        [equipment({ id: 'no-date', expiresAt: null, evaluationDueAt: null, status: 'current' })],
        '2026-01-01',
      )

      expect(timeline).toEqual([])
    })
  })

  describe('evidence and certificate link state', () => {
    it('keeps available evidence links on completed records', () => {
      expect(training().evidenceHref).toBe('/admin/training-records')
      expect(equipment().evidenceLabel).toBe('Authorization record')
    })

    it('allows disabled evidence placeholders for workers without access', () => {
      const row = training({ evidenceHref: null, evidenceLabel: 'Record missing' })
      expect(row.evidenceHref).toBeNull()
      expect(row.evidenceLabel).toBe('Record missing')
    })
  })

  describe('supervisor team view', () => {
    it('summarizes direct report readiness and sorts restricted first', () => {
      const rows = summarizeSupervisorRows({
        assignments: [
          { user_id: 'u-ready', position_id: 'p1', shift_label: 'Day' },
          { user_id: 'u-gap', position_id: 'p2', shift_label: 'Night' },
          { user_id: 'u-due', position_id: 'p1', shift_label: 'Swing' },
        ],
        profiles: [
          { id: 'u-ready', full_name: 'Casey Ready', email: 'ready@example.com' },
          { id: 'u-gap', full_name: 'Ari Gap', email: 'gap@example.com' },
          { id: 'u-due', full_name: 'Blake Due', email: 'due@example.com' },
        ],
        positions: [
          { id: 'p1', title: 'Operator', department: 'Packaging' },
          { id: 'p2', title: 'Mechanic', department: 'Maintenance' },
        ],
        matrixRows: [
          { user_id: 'u-ready', status: 'current' },
          { user_id: 'u-gap', status: 'missing' },
          { user_id: 'u-due', status: 'due_soon' },
        ],
      })

      expect(rows.map(r => r.status)).toEqual(['restricted', 'attention', 'ready'])
      expect(rows[0]).toMatchObject({ userId: 'u-gap', openGapCount: 1 })
      expect(rows[1]).toMatchObject({ userId: 'u-due', dueSoonCount: 1 })
    })

    it('treats a direct report with no matrix rows as ready with zero counts', () => {
      const rows = summarizeSupervisorRows({
        assignments: [{ user_id: 'u1', position_id: null, shift_label: null }],
        profiles:    [{ id: 'u1', full_name: null, email: 'u1@example.com' }],
        positions:   [],
        matrixRows:  [],
      })

      expect(rows[0]).toMatchObject({ status: 'ready', openGapCount: 0, dueSoonCount: 0 })
    })
  })

  describe('badge and expiry status edge cases', () => {
    it('classifies missing, no-expiry, overdue, due-today, and future dates', () => {
      expect(statusFromExpiry(null, '2026-01-01', false)).toBe('missing')
      expect(statusFromExpiry(null, '2026-01-01', true)).toBe('current')
      expect(statusFromExpiry('2025-12-31', '2026-01-01', true)).toBe('overdue')
      expect(statusFromExpiry('2026-01-01', '2026-01-01', true)).toBe('due_soon')
      expect(statusFromExpiry('2026-03-01', '2026-01-01', true)).toBe('current')
    })
  })

  describe('mobile primary action', () => {
    it('sends ready workers to pre-use inspections', () => {
      expect(choosePrimaryAction('ready', [], [])).toEqual({
        label: 'Start pre-use inspection',
        href:  '/equipment-readiness',
        tone:  'ready',
      })
    })

    it('sends due-soon workers to renewals and restricted workers to fixes', () => {
      expect(choosePrimaryAction('attention', [training({ status: 'due_soon' })], [])).toMatchObject({
        label: 'Schedule renewal',
        href:  '#renewals',
      })
      expect(choosePrimaryAction('restricted', [training({ status: 'missing' })], [])).toMatchObject({
        label: 'View required fixes',
        href:  '#restrictions',
      })
    })
  })

  describe('next best action priority', () => {
    it('prioritizes training gaps before equipment gaps and renewals', () => {
      const action = chooseNextBestAction(
        [training({ label: 'Fire watch', status: 'missing' })],
        [equipment({ label: 'Forklift', status: 'overdue' })],
      )

      expect(action).toMatch(/Fire watch/)
    })

    it('falls back to routine checks when there is nothing due or missing', () => {
      expect(chooseNextBestAction([training()], [equipment()])).toMatch(/routine field checks/i)
    })
  })
})
