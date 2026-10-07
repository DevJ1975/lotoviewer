import { describe, it, expect } from 'vitest'
import { validateDeadline, toDeadlineRow, parseDeadlineRow, type DeadlineInput } from '../../environmental/deadlines'

const OWNER = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const body = (over: Record<string, unknown> = {}) => ({ title: 'Landlord stormwater inspection', next_due_at: '2026-12-31', cadence: 'annual', ...over })
const created = (over: Record<string, unknown> = {}) => {
  const r = validateDeadline(body(over))
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.deadline
}

describe('validateDeadline', () => {
  it('accepts the minimum (a title and a date) and applies the defaults', () => {
    expect(validateDeadline({ title: 'X', next_due_at: '2026-12-31' })).toMatchObject({
      ok: true, deadline: { title: 'X', cadence: 'annual', leadDays: 30, dueAnchor: 'fixed', status: 'open', program: null, facilityId: null, ownerUserId: null },
    })
  })

  it('needs a title and a date, and says so', () => {
    const r = validateDeadline({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/title is required.*next_due_at is required/)
  })

  it('refuses dates that are not real, and cadences that do not exist', () => {
    expect(validateDeadline(body({ next_due_at: '2026-02-30' })).ok).toBe(false)
    expect(validateDeadline(body({ next_due_at: 'soon' })).ok).toBe(false)
    expect(validateDeadline(body({ cadence: 'weekly' })).ok).toBe(false)
  })

  it('requires a day count for a custom cadence, and drops it for any other', () => {
    expect(validateDeadline(body({ cadence: 'custom_days' })).ok).toBe(false)
    expect(validateDeadline(body({ cadence: 'custom_days', cadence_days: 45 }))).toMatchObject({ ok: true, deadline: { cadenceDays: 45 } })
    expect(validateDeadline(body({ cadence: 'quarterly', cadence_days: 45 }))).toMatchObject({ ok: true, deadline: { cadenceDays: null } })
    for (const bad of [0, -3, 2.5, 4000, '10']) expect(validateDeadline(body({ cadence: 'custom_days', cadence_days: bad })).ok, String(bad)).toBe(false)
  })

  it('bounds the reminder window and constrains program, anchor and status', () => {
    for (const bad of [-1, 366, 7.5, '30']) expect(validateDeadline(body({ lead_days: bad })).ok, String(bad)).toBe(false)
    expect(validateDeadline(body({ lead_days: 0 })).ok).toBe(true)
    expect(validateDeadline(body({ program: 'noise' })).ok).toBe(false)
    expect(validateDeadline(body({ program: 'air' })).ok).toBe(true)
    expect(validateDeadline(body({ due_anchor: 'whenever' })).ok).toBe(false)
    expect(validateDeadline(body({ due_anchor: 'period_end' })).ok).toBe(true)
    expect(validateDeadline(body({ status: 'done' })).ok).toBe(false)
  })

  it('takes an owner and a site as ids or null', () => {
    expect(validateDeadline(body({ owner_user_id: OWNER }))).toMatchObject({ ok: true, deadline: { ownerUserId: OWNER } })
    expect(validateDeadline(body({ owner_user_id: 'me' })).ok).toBe(false)
    expect(validateDeadline(body({ facility_id: null })).ok).toBe(true)
  })

  it('keeps unmentioned fields on a partial update, and can clear an owner', () => {
    const first = created({ owner_user_id: OWNER, program: 'air', lead_days: 14 })
    expect(validateDeadline({ next_due_at: '2027-03-31' }, first)).toMatchObject({
      ok: true, deadline: { title: first.title, ownerUserId: OWNER, program: 'air', leadDays: 14, nextDueAt: '2027-03-31' },
    })
    expect(validateDeadline({ owner_user_id: null }, first)).toMatchObject({ ok: true, deadline: { ownerUserId: null } })
  })

  it('refuses an update that blanks the title', () => {
    expect(validateDeadline({ title: '  ' }, created()).ok).toBe(false)
  })
})

describe('deadline row mapping', () => {
  it('round-trips through the table columns', () => {
    const d = created({ owner_user_id: OWNER, program: 'stormwater', cadence: 'custom_days', cadence_days: 45, due_anchor: 'period_end', lead_days: 10, regulatory_ref: 'IGP §XVI', description: 'd' })
    expect(parseDeadlineRow(toDeadlineRow(d))).toEqual(d)
  })

  it('reads a sparse row without throwing', () => {
    const d: DeadlineInput = parseDeadlineRow({ title: 'X', cadence: 'once', next_due_at: '2026-01-01' })
    expect(d).toMatchObject({ leadDays: 30, dueAnchor: 'fixed', status: 'open', program: null })
  })
})
