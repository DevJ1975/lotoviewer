import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  buildAdminLinks,
  buildRenewalTimeline,
  buildRestrictions,
  chooseNextBestAction,
  choosePrimaryAction,
  fetchMyReadiness,
  isRecoverableReadinessError,
  statusFromExpiry,
  summarizeSupervisorRows,
  type EquipmentBadgeStatus,
  type TrainingRequirementStatus,
} from '@soteria/core/myReadiness'
import { setActiveSupabaseClient } from '@soteria/core/supabaseClient'

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

type MockSupabaseError = { message: string; code?: string }
type MockSupabaseResponse = { data: unknown; error: MockSupabaseError | null }

function ok(data: unknown): MockSupabaseResponse {
  return { data, error: null }
}

function fail(code: string, message: string): MockSupabaseResponse {
  return { data: null, error: { code, message } }
}

function query(response: MockSupabaseResponse) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    ilike: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(response),
    then: (
      resolve: (value: MockSupabaseResponse) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(response).then(resolve, reject),
  }
  return chain
}

function installSupabase(results: Record<string, MockSupabaseResponse | MockSupabaseResponse[]>) {
  const from = vi.fn((table: string) => {
    const value = results[table]
    const response = Array.isArray(value) ? value.shift() : value
    return query(response ?? ok([]))
  })

  setActiveSupabaseClient({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data:  { user: { id: 'user-1', email: 'worker@example.com' } },
        error: null,
      }),
    },
    from,
  } as unknown as SupabaseClient)

  return { from }
}

describe('My Safety Readiness rules', () => {
  describe('fetch resilience', () => {
    it('returns a setup state when readiness tables are not available yet', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      installSupabase({
        profiles: ok({
          id:            'user-1',
          email:         'worker@example.com',
          full_name:     'Jamie Rivera',
          avatar_url:    null,
          is_admin:      true,
          is_superadmin: false,
        }),
        worker_position_assignments: fail('42P01', 'relation "worker_position_assignments" does not exist'),
        bbs_leaderboard:             ok([]),
      })

      const readiness = await fetchMyReadiness()

      expect(readiness?.readinessLabel).toBe('Profile setup needed')
      expect(readiness?.nextBestAction).toMatch(/Assign a current position/i)
      expect(readiness?.training).toEqual([])
      expect(readiness?.equipmentBadges).toEqual([])
      expect(readiness?.adminLinks.map(l => l.id)).toEqual(['position', 'training', 'equipment'])
      warn.mockRestore()
    })

    it('does not crash on malformed training rows with missing completion dates', async () => {
      installSupabase({
        profiles: ok({
          id:            'user-1',
          email:         'worker@example.com',
          full_name:     'Jamie Rivera',
          avatar_url:    null,
          is_admin:      false,
          is_superadmin: false,
        }),
        worker_position_assignments: ok([{
          id:                 'assign-1',
          tenant_id:          'tenant-1',
          user_id:            'user-1',
          position_id:        'position-1',
          shift_label:        'Night shift',
          service_start_date: '2022-01-01',
          supervisor_user_id: null,
        }]),
        bbs_leaderboard: ok([{
          user_id:             'user-1',
          points_total:        42,
          observation_count:   3,
          safe_behavior_count: 2,
        }]),
        worker_positions: ok({
          id:         'position-1',
          title:      'Maintenance Technician II',
          department: 'Maintenance',
        }),
        position_training_requirements: ok([{
          id:                'req-1',
          role:              'authorized_employee',
          requirement_label: 'LOTO authorized employee',
          recurrence_months: 12,
        }]),
        position_equipment_requirements: ok([]),
        loto_training_records: ok([
          {
            id:             'dirty-record',
            worker_name:    'Jamie Rivera',
            role:           'authorized_employee',
            completed_at:   null,
            expires_at:     '2026-12-31',
            cert_authority: null,
            notes:          null,
            created_by:     null,
            created_at:     '2026-01-01',
            updated_at:     '2026-01-01',
          },
          {
            id:             'good-record',
            worker_name:    'Jamie Rivera',
            role:           'authorized_employee',
            completed_at:   '2026-03-01',
            expires_at:     '2026-12-31',
            cert_authority: null,
            notes:          null,
            created_by:     null,
            created_at:     '2026-03-01',
            updated_at:     '2026-03-01',
          },
        ]),
        equipment_operator_authorizations: ok([]),
      })

      const readiness = await fetchMyReadiness()

      expect(readiness?.assignment.positionTitle).toBe('Maintenance Technician II')
      expect(readiness?.training[0]).toMatchObject({
        label:       'LOTO authorized employee',
        completedAt: '2026-03-01',
        status:      'current',
      })
      expect(readiness?.leaderboard).toMatchObject({ rank: 1, pointsTotal: 42 })
    })

    it('classifies schema-cache errors as recoverable but preserves ordinary failures', () => {
      expect(isRecoverableReadinessError({ code: 'PGRST205', message: 'Could not find the table in the schema cache' })).toBe(true)
      expect(isRecoverableReadinessError({ code: '42703', message: 'column "avatar_url" does not exist' })).toBe(true)
      expect(isRecoverableReadinessError({ code: '40001', message: 'serialization failure' })).toBe(false)
    })
  })

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
