import { describe, it, expect, beforeEach } from 'vitest'
import {
  adminGate, memberGate, allow, refuse, resetGates, fakeSupabase, jsonRequest, params, members,
  TENANT, FACILITY, USER,
} from './_harness'
import { GET, POST } from '@/app/api/environmental/calendar/route'
import { PATCH } from '@/app/api/environmental/calendar/[id]/route'
import { POST as COMPLETE } from '@/app/api/environmental/calendar/[id]/complete/route'

const OB = 'c0000000-0000-0000-0000-000000000001'
const OWNER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

const row = (over: Record<string, unknown> = {}) => ({
  id: OB, tenant_id: TENANT, facility_id: FACILITY, title: 'Quarterly visual assessment', description: null, regulatory_ref: null,
  category: 'environmental', cadence: 'quarterly', cadence_days: null, next_due_at: '2026-09-30', status: 'open', program: 'stormwater',
  lead_days: 30, due_anchor: 'period_end', owner_user_id: null, ...over,
})

beforeEach(resetGates)

describe('GET /api/environmental/calendar', () => {
  const get = (url = '/api/environmental/calendar') => GET(jsonRequest(url, 'GET'))

  it('passes a gate refusal through', async () => {
    refuse(memberGate, 403, 'Module is not enabled for this tenant')
    expect((await get()).status).toBe(403)
  })

  it('lists open environmental deadlines for the active site plus those shared by every site', async () => {
    const db = fakeSupabase({
      compliance_calendar_obligations: [{ data: [row(), row({ id: 'ob-2', next_due_at: '2099-01-01' })] }],
      compliance_calendar_events: [{ data: [{ obligation_id: OB, completed_at: '2026-06-30T10:00:00Z' }, { obligation_id: OB, completed_at: '2026-03-31T10:00:00Z' }] }],
    })
    allow(memberGate, db.client, { role: 'member' })
    const body = await (await get()).json()
    expect(db.filtered('compliance_calendar_obligations', 'category', 'environmental')).toBe(true)
    expect(db.filtered('compliance_calendar_obligations', 'status', 'open')).toBe(true)
    expect(db.calls[0]!.ops).toContainEqual({ method: 'or', args: [`facility_id.eq.${FACILITY},facility_id.is.null`] })
    expect(body.obligations[0]).toMatchObject({ id: OB, last_completed_at: '2026-06-30T10:00:00Z' })
    expect(body.obligations[1]).toMatchObject({ urgency: 'upcoming', last_completed_at: null })
    expect(typeof body.obligations[0].days_until).toBe('number')
  })

  it('classifies a past-due deadline as overdue using its own reminder window', async () => {
    allow(memberGate, fakeSupabase({ compliance_calendar_obligations: [{ data: [row({ next_due_at: '2020-01-01' })] }], compliance_calendar_events: [{ data: [] }] }).client)
    expect((await (await get()).json()).obligations[0].urgency).toBe('overdue')
  })

  it('does not look up completions when there is nothing to complete', async () => {
    const db = fakeSupabase({ compliance_calendar_obligations: [{ data: [] }] })
    allow(memberGate, db.client)
    await get()
    expect(db.used('compliance_calendar_events', 'select')).toEqual([])
  })

  it('supports roll-up, a status filter, a program filter, and rejects what it does not know', async () => {
    const db = fakeSupabase({ compliance_calendar_obligations: [{ data: [] }] })
    allow(memberGate, db.client, { facilityId: null })
    await get('/api/environmental/calendar?status=all&program=air')
    const ops = db.calls[0]!.ops
    expect(ops.some(o => o.method === 'or')).toBe(false)
    expect(ops.some(o => o.method === 'eq' && o.args[0] === 'status')).toBe(false)
    expect(ops).toContainEqual({ method: 'eq', args: ['program', 'air'] })

    allow(memberGate, fakeSupabase().client)
    expect((await get('/api/environmental/calendar?status=nonsense')).status).toBe(400)
    expect((await get('/api/environmental/calendar?facility_id=nope')).status).toBe(400)
  })
})

describe('POST /api/environmental/calendar', () => {
  const post = (body: unknown) => POST(jsonRequest('/api/environmental/calendar', 'POST', body))
  const valid = { title: 'Landlord inspection', next_due_at: '2026-12-31', cadence: 'annual', program: 'stormwater' }

  it('is admin-only', async () => {
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await post(valid)).status).toBe(403)
  })

  it('rejects an invalid deadline with every problem listed, before any query', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    const res = await post({ cadence: 'weekly' })
    expect(res.status).toBe(400)
    expect((await res.json()).details.length).toBeGreaterThan(1)
    expect(db.calls).toEqual([])
  })

  it('creates an environmental deadline on the active site, recorded as the tenant\'s own', async () => {
    const db = fakeSupabase({ facilities: [{ data: { id: FACILITY } }], compliance_calendar_obligations: [{ data: row() }] })
    allow(adminGate, db.client)
    const res = await post(valid)
    expect(res.status).toBe(201)
    expect(db.arg('compliance_calendar_obligations', 'insert')).toMatchObject({
      tenant_id: TENANT, facility_id: FACILITY, category: 'environmental', source: 'tenant', created_by: USER, title: 'Landlord inspection', program: 'stormwater',
    })
  })

  it('refuses a new deadline whose owner is not a member of the account, before any insert', async () => {
    const db = fakeSupabase({ facilities: [{ data: { id: FACILITY } }], compliance_calendar_obligations: [{ data: row() }] })
    allow(adminGate, db.client)
    const res = await post({ ...valid, owner_user_id: OWNER })
    expect(res.status).toBe(400)
    expect(db.used('compliance_calendar_obligations', 'insert')).toEqual([])
    members.add(OWNER)
    expect((await post({ ...valid, owner_user_id: OWNER })).status).toBe(201)
  })

  it('makes a deadline shared by every site when facility_id is explicitly null, without a site lookup', async () => {
    const db = fakeSupabase({ compliance_calendar_obligations: [{ data: row({ facility_id: null }) }] })
    allow(adminGate, db.client)
    await post({ ...valid, facility_id: null })
    expect(db.arg('compliance_calendar_obligations', 'insert')).toMatchObject({ facility_id: null })
    expect(db.used('facilities', 'select')).toEqual([])
  })

  it('refuses a site the caller cannot see', async () => {
    allow(adminGate, fakeSupabase({ facilities: [{ data: null }] }).client)
    const res = await post({ ...valid, facility_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/environmental/calendar/[id]', () => {
  const patch = (body: unknown, id = OB) => PATCH(jsonRequest(`/api/environmental/calendar/${id}`, 'PATCH', body), params({ id }))

  it('only reaches environmental deadlines', async () => {
    const db = fakeSupabase({ compliance_calendar_obligations: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await patch({ lead_days: 10 })).status).toBe(404)
    expect(db.filtered('compliance_calendar_obligations', 'category', 'environmental')).toBe(true)
  })

  it('assigns an owner and changes the reminder window, keeping everything else and ignoring a site change', async () => {
    const db = fakeSupabase({ compliance_calendar_obligations: [{ data: row() }, { data: row({ owner_user_id: OWNER, lead_days: 10 }) }] })
    allow(adminGate, db.client)
    members.add(OWNER)
    const res = await patch({ owner_user_id: OWNER, lead_days: 10, facility_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' })
    expect(res.status).toBe(200)
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({
      owner_user_id: OWNER, lead_days: 10, facility_id: FACILITY, title: 'Quarterly visual assessment', cadence: 'quarterly', next_due_at: '2026-09-30',
    })
  })

  it('refuses to assign someone who is not a member of the account, and updates nothing', async () => {
    const db = fakeSupabase({ compliance_calendar_obligations: [{ data: row() }, { data: row() }] })
    allow(adminGate, db.client)
    const res = await patch({ owner_user_id: OWNER })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/member of this account/)
    expect(db.used('compliance_calendar_obligations', 'update')).toEqual([])
  })

  it('does not re-check an owner who is already assigned, so an old assignment never blocks an edit', async () => {
    const db = fakeSupabase({ compliance_calendar_obligations: [{ data: row({ owner_user_id: OWNER }) }, { data: row({ owner_user_id: OWNER, lead_days: 7 }) }] })
    allow(adminGate, db.client)
    expect((await patch({ lead_days: 7 })).status).toBe(200)
  })

  it('can dismiss a deadline', async () => {
    const db = fakeSupabase({ compliance_calendar_obligations: [{ data: row() }, { data: row({ status: 'dismissed' }) }] })
    allow(adminGate, db.client)
    await patch({ status: 'dismissed' })
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({ status: 'dismissed' })
  })

  it('rejects a bad id and an invalid change', async () => {
    allow(adminGate, fakeSupabase({ compliance_calendar_obligations: [{ data: row() }] }).client)
    expect((await patch({}, 'nope')).status).toBe(400)
    expect((await patch({ next_due_at: 'soon' })).status).toBe(400)
  })
})

describe('POST /api/environmental/calendar/[id]/complete', () => {
  const complete = (body: unknown, id = OB) => COMPLETE(jsonRequest(`/api/environmental/calendar/${id}/complete`, 'POST', body), params({ id }))
  const body = { occurrence_at: '2026-09-30' }
  const script = (over: Record<string, unknown> = {}, moved: unknown[] = [row({ next_due_at: '2026-12-31' })]) => fakeSupabase({
    compliance_calendar_obligations: [{ data: row(over) }, { data: moved }],
    compliance_calendar_events: [{ data: null }],
  })

  it('needs the due date being completed', async () => {
    allow(memberGate, fakeSupabase().client)
    const res = await complete({})
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/occurrence_at/)
  })

  it('refuses evidence from another tenant\'s folder', async () => {
    allow(memberGate, fakeSupabase().client, { role: 'admin' })
    expect((await complete({ ...body, evidence_id: '22222222-2222-2222-2222-222222222222/x.pdf' })).status).toBe(400)
  })

  it('lets an admin complete it, logs the completion, and moves the deadline to the next quarter end', async () => {
    const db = script()
    allow(memberGate, db.client, { role: 'admin' })
    const res = await complete({ ...body, note: ' filed ' })
    expect(res.status).toBe(200)
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({ next_due_at: '2026-12-31' })
    expect(db.arg('compliance_calendar_events', 'insert')).toMatchObject({ tenant_id: TENANT, obligation_id: OB, occurrence_at: '2026-09-30', completed_by: USER, note: 'filed' })
  })

  it('keeps a quarter-end deadline on quarter ends (Mar 31 -> Jun 30)', async () => {
    const db = script({ next_due_at: '2026-03-31' })
    allow(memberGate, db.client, { role: 'admin' })
    await complete({ occurrence_at: '2026-03-31' })
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({ next_due_at: '2026-06-30' })
  })

  it('lets the person it is assigned to complete it, but not another member', async () => {
    const owned = script({ owner_user_id: OWNER })
    allow(memberGate, owned.client, { role: 'member', userId: OWNER })
    expect((await complete(body)).status).toBe(200)

    const other = script({ owner_user_id: OWNER })
    allow(memberGate, other.client, { role: 'member', userId: USER })
    const res = await complete(body)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('owner_or_admin_required')
    expect(other.used('compliance_calendar_events', 'insert')).toEqual([])
  })

  it('refuses a deadline that has already moved on, saying where it is now, and changes nothing', async () => {
    const db = script({ next_due_at: '2026-12-31' })
    allow(memberGate, db.client, { role: 'admin' })
    const res = await complete(body)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'stale', next_due_at: '2026-12-31' })
    expect(db.used('compliance_calendar_obligations', 'update')).toEqual([])
    expect(db.used('compliance_calendar_events', 'insert')).toEqual([])
  })

  it('moves the deadline only if it still sits on that date, so two clicks cannot both win', async () => {
    const db = script()
    allow(memberGate, db.client, { role: 'admin' })
    await complete(body)
    const update = db.used('compliance_calendar_obligations', 'update')[0]!
    expect(update.ops).toContainEqual({ method: 'eq', args: ['next_due_at', '2026-09-30'] })
    expect(update.ops).toContainEqual({ method: 'eq', args: ['status', 'open'] })
  })

  it('reports the loser of a race as stale and logs nothing', async () => {
    const db = script({}, [])
    allow(memberGate, db.client, { role: 'admin' })
    expect((await complete(body)).status).toBe(409)
    expect(db.used('compliance_calendar_events', 'insert')).toEqual([])
  })

  it('closes a once-only deadline instead of moving it', async () => {
    const db = script({ cadence: 'once' }, [row({ status: 'completed' })])
    allow(memberGate, db.client, { role: 'admin' })
    await complete(body)
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({ status: 'completed' })
  })

  it('refuses a deadline that is not open', async () => {
    allow(memberGate, script({ status: 'dismissed' }).client, { role: 'admin' })
    const res = await complete(body)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('not_open')
  })

  it('puts the deadline back if the completion could not be recorded', async () => {
    const db = fakeSupabase({
      compliance_calendar_obligations: [{ data: row() }, { data: [row({ next_due_at: '2026-12-31' })] }, { data: null }],
      compliance_calendar_events: [{ error: { message: 'disk full' } }],
    })
    allow(memberGate, db.client, { role: 'admin' })
    const res = await complete(body)
    expect(res.status).toBe(500)
    const updates = db.used('compliance_calendar_obligations', 'update')
    expect(updates).toHaveLength(2)
    expect(updates[1]!.ops.find(o => o.method === 'update')!.args[0]).toMatchObject({ next_due_at: '2026-09-30', status: 'open' })
  })

  it('answers 404 for a deadline that is not there', async () => {
    allow(memberGate, fakeSupabase({ compliance_calendar_obligations: [{ data: null }] }).client, { role: 'admin' })
    expect((await complete(body)).status).toBe(404)
  })
})
