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
  const RPC = 'rpc:env_complete_obligation'
  // The deadline is read before the function runs (is it one of ours?) and after (what it is now).
  const script = (rpc: { data?: unknown; error?: { message: string; code?: string } } = { data: 'event-1' }, before: unknown = row(), after: unknown = row({ next_due_at: '2026-12-31' })) =>
    fakeSupabase({ compliance_calendar_obligations: [{ data: before }, { data: after }], [RPC]: [rpc] })

  it('passes a gate refusal through', async () => {
    refuse(memberGate, 403, 'Module is not enabled for this tenant')
    expect((await complete(body)).status).toBe(403)
  })

  it('needs the due date being completed', async () => {
    allow(memberGate, fakeSupabase().client)
    const res = await complete({})
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/occurrence_at/)
  })

  it('refuses evidence from another tenant\'s folder, and a path that climbs out of its own', async () => {
    const db = script()
    allow(memberGate, db.client, { role: 'admin' })
    expect((await complete({ ...body, evidence_id: '22222222-2222-2222-2222-222222222222/x.pdf' })).status).toBe(400)
    expect((await complete({ ...body, evidence_id: `${TENANT}/../x.pdf` })).status).toBe(400)
    expect(db.used(RPC, 'rpc')).toEqual([])
  })

  it('refuses a note that is too long, before asking the database', async () => {
    const db = script()
    allow(memberGate, db.client, { role: 'admin' })
    expect((await complete({ ...body, note: 'x'.repeat(2001) })).status).toBe(400)
    expect(db.used(RPC, 'rpc')).toEqual([])
  })

  it('hands the completion to the database function with exactly what the caller asked, and returns the deadline as it now stands', async () => {
    const db = script()
    allow(memberGate, db.client, { role: 'admin' })
    const evidence = `${TENANT}/reports/q3.pdf`
    const res = await complete({ ...body, note: ' filed ', evidence_id: evidence })
    expect(res.status).toBe(200)
    expect(db.arg(RPC, 'rpc')).toEqual({
      p_obligation_id: OB, p_due_on: '2026-09-30', p_note: ' filed ', p_evidence_id: evidence, p_inspection_id: null,
    })
    expect(await res.json()).toMatchObject({ obligation: { id: OB, next_due_at: '2026-12-31' } })
  })

  it('does not move the deadline or log the completion itself: the function does both in one transaction', async () => {
    const db = script()
    allow(memberGate, db.client, { role: 'admin' })
    await complete(body)
    expect(db.used('compliance_calendar_obligations', 'update')).toEqual([])
    expect(db.used('compliance_calendar_events', 'insert')).toEqual([])
  })

  it('only reaches the suite\'s own deadlines: it looks the deadline up in this account\'s environmental category first', async () => {
    const db = script()
    allow(memberGate, db.client, { role: 'admin' })
    await complete(body)
    const lookup = db.used('compliance_calendar_obligations', 'select')[0]!
    expect(lookup.ops).toContainEqual({ method: 'eq', args: ['tenant_id', TENANT] })
    expect(lookup.ops).toContainEqual({ method: 'eq', args: ['category', 'environmental'] })
    expect(lookup.ops).toContainEqual({ method: 'eq', args: ['id', OB] })
  })

  it('answers 404 for a deadline that is not there or is not one of ours, without calling the function', async () => {
    const db = script({ data: 'event-1' }, null)
    allow(memberGate, db.client, { role: 'admin' })
    expect((await complete(body)).status).toBe(404)
    expect(db.used(RPC, 'rpc')).toEqual([])
  })

  it('answers 404, never 403, when the function says the caller may not complete it, so a deadline\'s existence is not confirmed', async () => {
    allow(memberGate, script({ error: { code: 'P0002', message: 'obligation x not found' } }).client, { role: 'member', userId: OWNER })
    const res = await complete(body)
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toMatch(/owner|admin|forbidden/i)
  })

  it('reports a deadline that has already moved on as stale', async () => {
    const stale = { code: '23514', message: 'The occurrence due on 2026-09-30 is already recorded; the next one is due on 2026-12-31.' }
    allow(memberGate, script({ error: stale }).client, { role: 'admin' })
    const res = await complete(body)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('stale')
  })

  it('reports a deadline that is not open', async () => {
    allow(memberGate, script({ error: { code: '23514', message: 'This deadline is dismissed, so there is nothing due to record.' } }).client, { role: 'admin' })
    const res = await complete(body)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('not_open')
  })

  it('shows any other refusal from the function as a conflict with its reason', async () => {
    allow(memberGate, script({ error: { code: '23514', message: 'Evidence must be a file in this account.' } }).client, { role: 'admin' })
    const res = await complete(body)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'cannot_complete', details: ['Evidence must be a file in this account.'] })
  })

  it('does not leak an unexpected database error', async () => {
    allow(memberGate, script({ error: { code: 'XX000', message: 'relation "secret_table" is broken' } }).client, { role: 'admin' })
    const res = await complete(body)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret_table')
  })
})
