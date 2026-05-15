import { describe, it, expect } from 'vitest'
import {
  canAddMember,
  canClosePermit,
  type LotoGroupPermitMember,
} from '@soteria/core/lotoGroupPermit'

function member(left_at: string | null): Pick<LotoGroupPermitMember, 'left_at'> {
  return { left_at }
}

describe('canAddMember', () => {
  it('blocks when the primary authorized employee is not assigned', () => {
    const r = canAddMember({ status: 'open', primary_authorized_employee_id: null })
    expect(r.canAdd).toBe(false)
    expect(r.reason).toMatch(/primary authorized employee/i)
  })

  it('blocks when the permit is closed', () => {
    const r = canAddMember({ status: 'closed', primary_authorized_employee_id: 'u-1' })
    expect(r.canAdd).toBe(false)
    expect(r.reason).toMatch(/closed/i)
  })

  it('allows when the primary is set and the permit is open', () => {
    const r = canAddMember({ status: 'open', primary_authorized_employee_id: 'u-1' })
    expect(r.canAdd).toBe(true)
    expect(r.reason).toBeNull()
  })

  it('allows on a shift_handed_off permit (the new primary can continue accepting members)', () => {
    const r = canAddMember({ status: 'shift_handed_off', primary_authorized_employee_id: 'u-2' })
    expect(r.canAdd).toBe(true)
  })
})

describe('canClosePermit', () => {
  it('blocks when at least one member is still attached', () => {
    const r = canClosePermit({ status: 'open' }, [member(null), member('2026-05-15T10:00:00Z')])
    expect(r.canClose).toBe(false)
    expect(r.reason).toMatch(/1 member still attached/i)
  })

  it('blocks when the permit is already closed', () => {
    const r = canClosePermit({ status: 'closed' }, [])
    expect(r.canClose).toBe(false)
    expect(r.reason).toMatch(/already closed/i)
  })

  it('allows when every member has left', () => {
    const r = canClosePermit({ status: 'open' }, [
      member('2026-05-15T08:00:00Z'),
      member('2026-05-15T09:00:00Z'),
    ])
    expect(r.canClose).toBe(true)
  })

  it('allows when the permit has no members at all', () => {
    const r = canClosePermit({ status: 'open' }, [])
    expect(r.canClose).toBe(true)
  })

  it('pluralizes the member-count message correctly', () => {
    const r = canClosePermit({ status: 'open' }, [member(null), member(null), member(null)])
    expect(r.reason).toMatch(/3 members still attached/i)
  })
})
