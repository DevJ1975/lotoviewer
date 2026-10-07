import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  adminGate, memberGate, allow, refuse, resetGates, fakeSupabase, jsonRequest, params, members,
  TENANT, FACILITY, OTHER_FACILITY, USER,
} from './_harness'
import { GET, POST } from '@/app/api/environmental/legal/route'
import { PATCH, DELETE } from '@/app/api/environmental/legal/[id]/route'
import { POST as EVALUATE } from '@/app/api/environmental/legal/[id]/evaluate/route'
import { POST as REVIEW } from '@/app/api/environmental/legal/[id]/review/route'

const ENTRY_ID = 'f0000000-0000-0000-0000-0000000000a1'
const TABLE = 'legal_register'
const OTHER_TENANT_FILE = '22222222-2222-2222-2222-222222222222/audit.pdf'
const OWN_FILE = `${TENANT}/audit.pdf`

const legalRow = (over: Record<string, unknown> = {}) => ({
  id: ENTRY_ID, tenant_id: TENANT, facility_id: FACILITY, title: 'County odor ordinance', citation: 'Cty Code 12.4', jurisdiction: 'CA',
  authority: null, summary: null, applicability_note: null, source_url: null, effective_date: null, status: 'active',
  review_frequency: 'annual', last_reviewed_at: null, next_review_due: null, tags: [], program: 'air', library_key: null, library_version: null,
  applicability: 'under_review', compliance_status: 'not_evaluated', last_evaluated_at: null, last_evaluated_by: null, evaluation_note: null,
  evidence_path: null, owner_user_id: null, source: 'tenant', ...over,
})

const validBody = (over: Record<string, unknown> = {}) => ({ title: 'County odor ordinance', citation: 'Cty Code 12.4', jurisdiction: 'CA', ...over })

/** The arguments of every `method` call the route made, e.g. each `.or(...)` filter. */
const callsOf = (db: ReturnType<typeof fakeSupabase>, method: string) =>
  db.calls.flatMap(c => c.ops.filter(o => o.method === method).map(o => o.args))

/** Pin the clock without touching timers, so promises and the fake client keep working. */
const freezeClockAt = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

beforeEach(resetGates)
afterEach(() => { vi.useRealTimers() })

describe('GET /api/environmental/legal', () => {
  const list = (query = '') => GET(jsonRequest(`/api/environmental/legal${query}`, 'GET'))

  it('passes a gate refusal straight through', async () => {
    refuse(memberGate, 403, 'Module is not enabled for this tenant')
    expect((await list()).status).toBe(403)
  })

  it('lists the tenant\'s entries as { entries }, scoped to the tenant', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: [legalRow(), legalRow({ id: 'e2' })] }] })
    allow(memberGate, db.client, { role: 'member' })
    const res = await list()
    expect(res.status).toBe(200)
    expect((await res.json()).entries).toHaveLength(2)
    expect(db.filtered(TABLE, 'tenant_id', TENANT)).toBe(true)
  })

  it('puts a review state on each entry', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: [
      legalRow({ last_reviewed_at: null }),
      legalRow({ last_reviewed_at: '2019-01-01T00:00:00Z', next_review_due: '2020-01-01' }),
      legalRow({ last_reviewed_at: '2019-01-01T00:00:00Z', next_review_due: '2099-01-01' }),
    ] }] })
    allow(memberGate, db.client)
    const { entries } = await (await list()).json()
    expect(entries.map((e: { review: string }) => e.review)).toEqual(['never_reviewed', 'overdue', 'ok'])
  })

  it('orders by program, then title', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: [] }] })
    allow(memberGate, db.client)
    await list()
    expect(callsOf(db, 'order').map(args => args[0])).toEqual(['program', 'title'])
  })

  describe('which site', () => {
    it('a site\'s list also holds the requirements that cover every site', async () => {
      const wholeCompany = legalRow({ id: 'e-all', facility_id: null })
      const db = fakeSupabase({ [TABLE]: [{ data: [legalRow(), wholeCompany] }] })
      allow(memberGate, db.client)
      const { entries } = await (await list()).json()
      expect(callsOf(db, 'or')).toEqual([[`facility_id.eq.${FACILITY},facility_id.is.null`]])
      // A plain equality on the site would hide the whole-company rows.
      expect(db.filtered(TABLE, 'facility_id', FACILITY)).toBe(false)
      expect(entries.map((e: { id: string }) => e.id)).toContain('e-all')
    })

    it('lets ?facility_id choose the site instead of the active one', async () => {
      const db = fakeSupabase({ [TABLE]: [{ data: [] }] })
      allow(memberGate, db.client)
      await list(`?facility_id=${OTHER_FACILITY}`)
      expect(callsOf(db, 'or')).toEqual([[`facility_id.eq.${OTHER_FACILITY},facility_id.is.null`]])
    })

    it('treats an empty ?facility_id= as not given', async () => {
      const db = fakeSupabase({ [TABLE]: [{ data: [] }] })
      allow(memberGate, db.client)
      await list('?facility_id=')
      expect(callsOf(db, 'or')).toEqual([[`facility_id.eq.${FACILITY},facility_id.is.null`]])
    })

    it('with no site at all it is the roll-up: no site filter', async () => {
      const db = fakeSupabase({ [TABLE]: [{ data: [] }] })
      allow(memberGate, db.client, { facilityId: null })
      await list()
      expect(callsOf(db, 'or')).toEqual([])
      expect(db.filtered(TABLE, 'facility_id', FACILITY)).toBe(false)
    })

    it('rejects a malformed facility id before querying', async () => {
      const db = fakeSupabase()
      allow(memberGate, db.client)
      const res = await list('?facility_id=nope')
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_id')
      expect(db.calls).toEqual([])
    })

    it('does not let the query string smuggle a filter into the site clause', async () => {
      const db = fakeSupabase()
      allow(memberGate, db.client)
      expect((await list(`?facility_id=${FACILITY},tenant_id.neq.x`)).status).toBe(400)
      expect(db.calls).toEqual([])
    })
  })

  describe('filters', () => {
    it('narrows by program, compliance status and applicability', async () => {
      const db = fakeSupabase({ [TABLE]: [{ data: [] }] })
      allow(memberGate, db.client)
      await list('?program=air&compliance_status=non_compliant&applicability=applicable')
      expect(db.filtered(TABLE, 'program', 'air')).toBe(true)
      expect(db.filtered(TABLE, 'compliance_status', 'non_compliant')).toBe(true)
      expect(db.filtered(TABLE, 'applicability', 'applicable')).toBe(true)
    })

    it('applies only the filters that were given', async () => {
      const db = fakeSupabase({ [TABLE]: [{ data: [] }] })
      allow(memberGate, db.client)
      await list('?program=&compliance_status=attention')
      expect(callsOf(db, 'eq').map(args => args[0]).sort()).toEqual(['compliance_status', 'tenant_id'])
    })

    it('refuses a value that is not one of the choices, naming the choices, and queries nothing', async () => {
      const db = fakeSupabase()
      allow(memberGate, db.client)
      const res = await list('?program=other&compliance_status=fine&applicability=maybe')
      const body = await res.json()
      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid')
      expect(body.details).toHaveLength(3)
      expect(body.details[0]).toMatch(/program must be one of: stormwater/)
      expect(db.calls).toEqual([])
    })
  })

  it('answers 500 without leaking the database error', async () => {
    allow(memberGate, fakeSupabase({ [TABLE]: [{ error: { message: 'relation exploded' } }] }).client)
    const res = await list()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('POST /api/environmental/legal', () => {
  const create = (body: unknown) => POST(jsonRequest('/api/environmental/legal', 'POST', body))

  it('is for tenant admins: a refusal from the admin gate stops it before any query', async () => {
    const db = fakeSupabase()
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await create(validBody())).status).toBe(403)
    expect(db.calls).toEqual([])
  })

  it('rejects malformed JSON and an invalid entry, listing every problem', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    const bad = await POST(new Request('https://example.com/x', { method: 'POST', body: '{' }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_json')

    const res = await create({ program: 'nonsense', effective_date: 'soon' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid')
    expect(body.details.length).toBeGreaterThan(3)
    expect(db.calls).toEqual([])
  })

  describe('source_url', () => {
    it('refuses javascript: and every scheme but http and https', async () => {
      const db = fakeSupabase()
      allow(adminGate, db.client)
      for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.test/rule', '//example.test/rule']) {
        const res = await create(validBody({ source_url: url }))
        expect(res.status, url).toBe(400)
        expect(JSON.stringify(await res.json()), url).toMatch(/source_url must be a web address starting with http/)
      }
      expect(db.calls).toEqual([])
    })

    it('accepts http and https', async () => {
      for (const url of ['http://example.test/rule', 'https://example.test/rule']) {
        const db = fakeSupabase({ [TABLE]: [{ data: legalRow({ source_url: url }) }] })
        allow(adminGate, db.client)
        expect((await create(validBody({ source_url: url }))).status, url).toBe(201)
        expect(db.arg(TABLE, 'insert')).toMatchObject({ source_url: url })
      }
    })
  })

  describe('evidence_path', () => {
    it('refuses a file in another tenant\'s folder, and a way out of its own', async () => {
      const db = fakeSupabase()
      allow(adminGate, db.client)
      for (const path of [OTHER_TENANT_FILE, `${TENANT}/../22222222-2222-2222-2222-222222222222/audit.pdf`, 'audit.pdf']) {
        expect((await create(validBody({ evidence_path: path }))).status, path).toBe(400)
      }
      expect(db.calls).toEqual([])
    })

    it('accepts a file in the tenant\'s own folder', async () => {
      const db = fakeSupabase({ [TABLE]: [{ data: legalRow({ evidence_path: OWN_FILE }) }] })
      allow(adminGate, db.client)
      expect((await create(validBody({ evidence_path: OWN_FILE }))).status).toBe(201)
      expect(db.arg(TABLE, 'insert')).toMatchObject({ evidence_path: OWN_FILE })
    })
  })

  it('creates a custom entry on the active site and stamps who made it', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow() }] })
    allow(adminGate, db.client)
    const res = await create(validBody({ program: 'air', tags: ['odor'] }))
    expect(res.status).toBe(201)
    expect((await res.json()).entry.id).toBe(ENTRY_ID)
    expect(db.arg(TABLE, 'insert')).toMatchObject({
      tenant_id: TENANT, facility_id: FACILITY, created_by: USER, source: 'tenant',
      title: 'County odor ordinance', citation: 'Cty Code 12.4', jurisdiction: 'CA', program: 'air', tags: ['odor'],
    })
  })

  it('takes the site from the body over the active one, and an explicit null makes it a whole-company requirement', async () => {
    const other = fakeSupabase({ [TABLE]: [{ data: legalRow({ facility_id: OTHER_FACILITY }) }] })
    allow(adminGate, other.client)
    await create(validBody({ facility_id: OTHER_FACILITY }))
    expect(other.arg(TABLE, 'insert')).toMatchObject({ facility_id: OTHER_FACILITY })

    const wide = fakeSupabase({ [TABLE]: [{ data: legalRow({ facility_id: null }) }] })
    allow(adminGate, wide.client)
    await create(validBody({ facility_id: null }))
    expect(wide.arg(TABLE, 'insert')).toMatchObject({ facility_id: null })
  })

  it('with no active site and none given, adds a whole-company requirement rather than refusing', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow({ facility_id: null }) }] })
    allow(adminGate, db.client, { facilityId: null })
    expect((await create(validBody())).status).toBe(201)
    expect(db.arg(TABLE, 'insert')).toMatchObject({ facility_id: null })
  })

  it('never takes the evaluation or the server-owned columns from the body', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow() }] })
    allow(adminGate, db.client)
    await create(validBody({
      source: 'library', library_key: 'cwa-402', applicability: 'applicable', compliance_status: 'compliant', evaluation_note: 'all good',
      last_evaluated_at: '2026-01-01T00:00:00Z', last_evaluated_by: OTHER_FACILITY, created_by: OTHER_FACILITY, tenant_id: OTHER_FACILITY,
    }))
    const sent = db.arg(TABLE, 'insert') as Record<string, unknown>
    expect(sent).toMatchObject({ source: 'tenant', created_by: USER, tenant_id: TENANT })
    for (const column of ['library_key', 'applicability', 'compliance_status', 'evaluation_note', 'last_evaluated_at', 'last_evaluated_by']) {
      expect(sent, column).not.toHaveProperty(column)
    }
  })

  it('refuses a new entry whose owner is not a member of the account, before inserting', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow() }] })
    allow(adminGate, db.client)
    const res = await create(validBody({ owner_user_id: USER }))
    expect(res.status).toBe(400)
    expect(db.used(TABLE, 'insert')).toEqual([])
    members.add(USER)
    expect((await create(validBody({ owner_user_id: USER }))).status).toBe(201)
  })

  it('answers 409 for a duplicate and 404 for a site or owner that is not the tenant\'s', async () => {
    allow(adminGate, fakeSupabase({ [TABLE]: [{ error: { message: 'dup', code: '23505' } }] }).client)
    const duplicate = await create(validBody())
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json()).error).toBe('duplicate_entry')

    allow(adminGate, fakeSupabase({ [TABLE]: [{ error: { message: 'fk', code: '23503' } }] }).client)
    const missing = await create(validBody({ facility_id: OTHER_FACILITY }))
    expect(missing.status).toBe(404)
    expect((await missing.json()).error).toBe('reference_not_found')
  })

  it('answers 500 without leaking the database error', async () => {
    allow(adminGate, fakeSupabase({ [TABLE]: [{ error: { message: 'relation exploded' } }] }).client)
    const res = await create(validBody())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('PATCH /api/environmental/legal/[id]', () => {
  const patch = (body: unknown, id = ENTRY_ID) => PATCH(jsonRequest(`/api/environmental/legal/${id}`, 'PATCH', body), params({ id }))

  it('is for tenant admins', async () => {
    const db = fakeSupabase()
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await patch({ summary: 'x' })).status).toBe(403)
    expect(db.calls).toEqual([])
  })

  it('rejects a malformed id and malformed JSON', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    expect((await patch({}, 'nope')).status).toBe(400)
    const bad = await PATCH(new Request('https://example.com/x', { method: 'PATCH', body: '{' }), params({ id: ENTRY_ID }))
    expect((await bad.json()).error).toBe('invalid_json')
    expect(db.calls).toEqual([])
  })

  it('answers 404 for an entry that is not there, and updates nothing', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await patch({ summary: 'x' })).status).toBe(404)
    expect(db.used(TABLE, 'update')).toEqual([])
  })

  it('changes only what was sent and keeps the entry on its own site', async () => {
    const db = fakeSupabase({ [TABLE]: [
      { data: legalRow({ authority: 'US EPA', summary: 'old' }) },
      { data: legalRow({ authority: 'US EPA', summary: 'new' }) },
    ] })
    allow(adminGate, db.client)
    const res = await patch({ summary: 'new' })
    expect(res.status).toBe(200)
    expect((await res.json()).entry.summary).toBe('new')
    expect(db.arg(TABLE, 'update')).toMatchObject({ facility_id: FACILITY, title: 'County odor ordinance', authority: 'US EPA', summary: 'new', program: 'air' })
    expect(db.filtered(TABLE, 'tenant_id', TENANT)).toBe(true)
    expect(db.filtered(TABLE, 'id', ENTRY_ID)).toBe(true)
  })

  it('moves the entry only when the body names another site, or null for the whole company', async () => {
    const moved = fakeSupabase({ [TABLE]: [{ data: legalRow() }, { data: legalRow({ facility_id: OTHER_FACILITY }) }] })
    allow(adminGate, moved.client)
    await patch({ facility_id: OTHER_FACILITY })
    expect(moved.arg(TABLE, 'update')).toMatchObject({ facility_id: OTHER_FACILITY })

    const wide = fakeSupabase({ [TABLE]: [{ data: legalRow() }, { data: legalRow({ facility_id: null }) }] })
    allow(adminGate, wide.client)
    await patch({ facility_id: null })
    expect(wide.arg(TABLE, 'update')).toMatchObject({ facility_id: null })
  })

  it('cannot change the evaluation, the review dates or any server-owned column', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow() }, { data: legalRow() }] })
    allow(adminGate, db.client)
    const res = await patch({
      summary: 'edited', applicability: 'not_applicable', compliance_status: 'non_compliant', evaluation_note: 'sneaky',
      last_evaluated_at: '2026-01-01T00:00:00Z', last_evaluated_by: OTHER_FACILITY, last_reviewed_at: '2026-01-01T00:00:00Z',
      next_review_due: '2099-01-01', library_key: 'cwa-402', library_version: 'x', source: 'library', tenant_id: OTHER_FACILITY, status: 'repealed',
    })
    expect(res.status).toBe(200)
    const sent = db.arg(TABLE, 'update') as Record<string, unknown>
    expect(sent).toMatchObject({ summary: 'edited' })
    for (const column of [
      'applicability', 'compliance_status', 'evaluation_note', 'last_evaluated_at', 'last_evaluated_by', 'last_reviewed_at',
      'next_review_due', 'library_key', 'library_version', 'source', 'tenant_id', 'status',
    ]) expect(sent, column).not.toHaveProperty(column)
  })

  it('edits a library entry\'s descriptive fields too', async () => {
    const library = legalRow({ source: 'library', library_key: 'cwa-402', jurisdiction: 'federal' })
    const db = fakeSupabase({ [TABLE]: [{ data: library }, { data: library }] })
    allow(adminGate, db.client)
    members.add(USER)
    expect((await patch({ owner_user_id: USER, review_frequency: 'biennial' })).status).toBe(200)
    expect(db.arg(TABLE, 'update')).toMatchObject({ owner_user_id: USER, review_frequency: 'biennial', jurisdiction: 'federal' })
  })

  it('refuses to assign an owner who is not a member of the account, and updates nothing', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow() }, { data: legalRow() }] })
    allow(adminGate, db.client)
    const res = await patch({ owner_user_id: USER })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/member of this account/)
    expect(db.used(TABLE, 'update')).toEqual([])
  })

  it('does not re-check an owner who is already assigned', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow({ owner_user_id: USER }) }, { data: legalRow({ owner_user_id: USER }) }] })
    allow(adminGate, db.client)
    expect((await patch({ summary: 'edited' })).status).toBe(200)
  })

  it('refuses an edit that would make the entry invalid, and updates nothing', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow() }] })
    allow(adminGate, db.client)
    for (const body of [
      { source_url: 'javascript:alert(1)' }, { title: '' }, { jurisdiction: 'nowhere' }, { evidence_path: OTHER_TENANT_FILE },
      { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, { review_frequency: 'weekly' },
    ]) {
      const res = await patch(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await res.json()).error).toBe('invalid')
    }
    expect(db.used(TABLE, 'update')).toEqual([])
  })

  it('answers 409 for a duplicate and 404 for a site that is not the tenant\'s', async () => {
    allow(adminGate, fakeSupabase({ [TABLE]: [{ data: legalRow() }, { error: { message: 'dup', code: '23505' } }] }).client)
    expect((await patch({ facility_id: OTHER_FACILITY })).status).toBe(409)
    allow(adminGate, fakeSupabase({ [TABLE]: [{ data: legalRow() }, { error: { message: 'fk', code: '23503' } }] }).client)
    expect((await patch({ facility_id: OTHER_FACILITY })).status).toBe(404)
  })

  it('answers 500 without leaking the database error, whether the read or the write failed', async () => {
    for (const script of [
      [{ error: { message: 'relation exploded' } }],
      [{ data: legalRow() }, { error: { message: 'relation exploded' } }],
    ]) {
      allow(adminGate, fakeSupabase({ [TABLE]: script }).client)
      const res = await patch({ summary: 'x' })
      expect(res.status).toBe(500)
      expect(JSON.stringify(await res.json())).not.toContain('exploded')
    }
  })
})

describe('DELETE /api/environmental/legal/[id]', () => {
  const remove = (id = ENTRY_ID) => DELETE(jsonRequest(`/api/environmental/legal/${id}`, 'DELETE'), params({ id }))

  it('is admin-only', async () => {
    const db = fakeSupabase()
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await remove()).status).toBe(403)
    expect(db.calls).toEqual([])
  })

  it('rejects a malformed id', async () => {
    allow(adminGate, fakeSupabase().client)
    expect((await remove('nope')).status).toBe(400)
  })

  it('answers 404 for an entry that is not there, and deletes nothing', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await remove()).status).toBe(404)
    expect(db.used(TABLE, 'delete')).toEqual([])
  })

  it('deletes a custom entry, scoped to the tenant, with no warning', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: { id: ENTRY_ID, source: 'tenant' } }, { data: null }] })
    allow(adminGate, db.client)
    const res = await remove()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(db.used(TABLE, 'delete')).toHaveLength(1)
    expect(db.filtered(TABLE, 'tenant_id', TENANT)).toBe(true)
    expect(db.filtered(TABLE, 'id', ENTRY_ID)).toBe(true)
  })

  it('deletes a library entry too, and warns that applying the library again will bring it back', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: { id: ENTRY_ID, source: 'library' } }, { data: null }] })
    allow(adminGate, db.client)
    const res = await remove()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.warning).toMatch(/Applying the library again will bring it back/)
    expect(db.used(TABLE, 'delete')).toHaveLength(1)
  })

  it('answers 500 without leaking the database error', async () => {
    allow(adminGate, fakeSupabase({ [TABLE]: [{ data: { id: ENTRY_ID, source: 'tenant' } }, { error: { message: 'relation exploded' } }] }).client)
    const res = await remove()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('POST /api/environmental/legal/[id]/evaluate', () => {
  const evaluate = (body: unknown, id = ENTRY_ID) =>
    EVALUATE(jsonRequest(`/api/environmental/legal/${id}/evaluate`, 'POST', body), params({ id }))

  it('is admin-only, and stops before any query', async () => {
    const db = fakeSupabase()
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await evaluate({ applicability: 'applicable' })).status).toBe(403)
    expect(db.calls).toEqual([])
  })

  it('rejects a malformed id and malformed JSON', async () => {
    allow(adminGate, fakeSupabase().client)
    expect((await evaluate({ applicability: 'applicable' }, 'nope')).status).toBe(400)
    const bad = await EVALUATE(new Request('https://example.com/x', { method: 'POST', body: '{' }), params({ id: ENTRY_ID }))
    expect((await bad.json()).error).toBe('invalid_json')
  })

  it('records the evaluation, who made it and when', async () => {
    freezeClockAt('2026-10-07T15:30:00.000Z')
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow({ applicability: 'applicable', compliance_status: 'compliant' }) }] })
    allow(adminGate, db.client)
    const res = await evaluate({ applicability: 'applicable', compliance_status: 'compliant', note: 'Checked the log on site' })
    expect(res.status).toBe(200)
    expect((await res.json()).entry.compliance_status).toBe('compliant')
    expect(db.arg(TABLE, 'update')).toEqual({
      applicability: 'applicable', compliance_status: 'compliant', evaluation_note: 'Checked the log on site',
      last_evaluated_at: '2026-10-07T15:30:00.000Z', last_evaluated_by: USER,
    })
    expect(db.filtered(TABLE, 'tenant_id', TENANT)).toBe(true)
    expect(db.filtered(TABLE, 'id', ENTRY_ID)).toBe(true)
  })

  it('an evaluation without a rating leaves the entry not evaluated', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow() }] })
    allow(adminGate, db.client)
    await evaluate({ applicability: 'under_review' })
    expect(db.arg(TABLE, 'update')).toMatchObject({ applicability: 'under_review', compliance_status: 'not_evaluated', evaluation_note: null })
  })

  describe('the rules a rating must follow', () => {
    it('an attention or non-compliant rating must say what is wrong', async () => {
      const db = fakeSupabase()
      allow(adminGate, db.client)
      for (const status of ['attention', 'non_compliant']) {
        const res = await evaluate({ applicability: 'applicable', compliance_status: status })
        const body = await res.json()
        expect(res.status, status).toBe(400)
        expect(body.error).toBe('invalid')
        expect(body.details[0], status).toMatch(/needs a note/)
      }
      expect((await evaluate({ applicability: 'applicable', compliance_status: 'attention', note: '   ' })).status).toBe(400)
      expect(db.calls).toEqual([])
    })

    it('a requirement that is not applicable cannot be rated: the conflict is refused, not quietly overridden', async () => {
      const db = fakeSupabase()
      allow(adminGate, db.client)
      const res = await evaluate({ applicability: 'not_applicable', compliance_status: 'compliant' })
      expect(res.status).toBe(400)
      expect((await res.json()).details[0]).toMatch(/cannot also be rated/)
      expect(db.calls).toEqual([])
    })

    it('a not-applicable entry with no rating is stored as not evaluated, with the reason', async () => {
      const db = fakeSupabase({ [TABLE]: [{ data: legalRow({ applicability: 'not_applicable' }) }] })
      allow(adminGate, db.client)
      expect((await evaluate({ applicability: 'not_applicable', note: 'No outfalls at this site' })).status).toBe(200)
      expect(db.arg(TABLE, 'update')).toMatchObject({
        applicability: 'not_applicable', compliance_status: 'not_evaluated', evaluation_note: 'No outfalls at this site',
      })
    })

    it('refuses values it does not know and a note that is too long', async () => {
      allow(adminGate, fakeSupabase().client)
      for (const body of [
        {}, { applicability: 'maybe' }, { applicability: 'applicable', compliance_status: 'fine' },
        { applicability: 'applicable', note: 'x'.repeat(2001) }, { applicability: 'applicable', note: 5 },
      ]) expect((await evaluate(body)).status, JSON.stringify(body)).toBe(400)
    })
  })

  describe('evidence_path', () => {
    it('may be set in the same call, in the tenant\'s own folder', async () => {
      const db = fakeSupabase({ [TABLE]: [{ data: legalRow({ evidence_path: OWN_FILE }) }] })
      allow(adminGate, db.client)
      expect((await evaluate({ applicability: 'applicable', compliance_status: 'compliant', evidence_path: OWN_FILE })).status).toBe(200)
      expect(db.arg(TABLE, 'update')).toMatchObject({ evidence_path: OWN_FILE })
    })

    it('refuses a file in another tenant\'s folder, and a way out of its own', async () => {
      const db = fakeSupabase()
      allow(adminGate, db.client)
      for (const path of [OTHER_TENANT_FILE, `${TENANT}/../22222222-2222-2222-2222-222222222222/audit.pdf`]) {
        const res = await evaluate({ applicability: 'applicable', evidence_path: path })
        expect(res.status, path).toBe(400)
        expect((await res.json()).details).toEqual(['evidence_path must be a file you uploaded to this account.'])
      }
      expect(db.calls).toEqual([])
    })

    it('left out, it keeps the evidence the entry has; sent as null, it clears it', async () => {
      const kept = fakeSupabase({ [TABLE]: [{ data: legalRow() }] })
      allow(adminGate, kept.client)
      await evaluate({ applicability: 'applicable' })
      expect(kept.arg(TABLE, 'update')).not.toHaveProperty('evidence_path')

      const cleared = fakeSupabase({ [TABLE]: [{ data: legalRow() }] })
      allow(adminGate, cleared.client)
      await evaluate({ applicability: 'applicable', evidence_path: null })
      expect(cleared.arg(TABLE, 'update')).toMatchObject({ evidence_path: null })
    })

    it('reports a bad rating and a bad file together', async () => {
      allow(adminGate, fakeSupabase().client)
      const res = await evaluate({ applicability: 'applicable', compliance_status: 'attention', evidence_path: OTHER_TENANT_FILE })
      expect((await res.json()).details).toHaveLength(2)
    })
  })

  it('takes nothing but the evaluation from the body: the evaluator, the time and the descriptive fields are not its to set', async () => {
    freezeClockAt('2026-10-07T15:30:00.000Z')
    const db = fakeSupabase({ [TABLE]: [{ data: legalRow() }] })
    allow(adminGate, db.client)
    await evaluate({
      applicability: 'applicable', last_evaluated_by: OTHER_FACILITY, last_evaluated_at: '1999-01-01T00:00:00Z',
      title: 'Renamed', source: 'library', library_key: 'cwa-402', tenant_id: OTHER_FACILITY, next_review_due: '2099-01-01',
    })
    const sent = db.arg(TABLE, 'update') as Record<string, unknown>
    expect(sent).toMatchObject({ last_evaluated_by: USER, last_evaluated_at: '2026-10-07T15:30:00.000Z' })
    for (const column of ['title', 'source', 'library_key', 'tenant_id', 'next_review_due']) expect(sent, column).not.toHaveProperty(column)
  })

  it('answers 404 for an entry that is not there', async () => {
    allow(adminGate, fakeSupabase({ [TABLE]: [{ data: null }] }).client)
    const res = await evaluate({ applicability: 'applicable' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('answers 500 without leaking the database error', async () => {
    allow(adminGate, fakeSupabase({ [TABLE]: [{ error: { message: 'relation exploded' } }] }).client)
    const res = await evaluate({ applicability: 'applicable' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('POST /api/environmental/legal/[id]/review', () => {
  const review = (id = ENTRY_ID, body?: unknown) =>
    REVIEW(jsonRequest(`/api/environmental/legal/${id}/review`, 'POST', body), params({ id }))

  it('is admin-only, and stops before any query', async () => {
    const db = fakeSupabase()
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await review()).status).toBe(403)
    expect(db.calls).toEqual([])
  })

  it('rejects a malformed id', async () => {
    allow(adminGate, fakeSupabase().client)
    expect((await review('nope')).status).toBe(400)
  })

  it('answers 404 for an entry that is not there, and updates nothing', async () => {
    const db = fakeSupabase({ [TABLE]: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await review()).status).toBe(404)
    expect(db.used(TABLE, 'update')).toEqual([])
  })

  it('records the review now and sets the next one a year out for an annual entry', async () => {
    freezeClockAt('2026-10-07T15:30:00.000Z')
    const db = fakeSupabase({ [TABLE]: [
      { data: { id: ENTRY_ID, review_frequency: 'annual' } },
      { data: legalRow({ last_reviewed_at: '2026-10-07T15:30:00.000Z', next_review_due: '2027-10-07' }) },
    ] })
    allow(adminGate, db.client)
    const res = await review()
    expect(res.status).toBe(200)
    expect((await res.json()).entry.next_review_due).toBe('2027-10-07')
    expect(db.arg(TABLE, 'update')).toEqual({ last_reviewed_at: '2026-10-07T15:30:00.000Z', next_review_due: '2027-10-07' })
    expect(db.filtered(TABLE, 'tenant_id', TENANT)).toBe(true)
    expect(db.filtered(TABLE, 'id', ENTRY_ID)).toBe(true)
  })

  it('sets the next review two years out for a biennial entry', async () => {
    freezeClockAt('2026-10-07T15:30:00.000Z')
    const db = fakeSupabase({ [TABLE]: [{ data: { id: ENTRY_ID, review_frequency: 'biennial' } }, { data: legalRow() }] })
    allow(adminGate, db.client)
    await review()
    expect(db.arg(TABLE, 'update')).toMatchObject({ next_review_due: '2028-10-07' })
  })

  it('reviews yearly an entry that has no frequency, or one the table holds in a form we do not know', async () => {
    freezeClockAt('2026-10-07T15:30:00.000Z')
    for (const frequency of [null, 'quarterly']) {
      const db = fakeSupabase({ [TABLE]: [{ data: { id: ENTRY_ID, review_frequency: frequency } }, { data: legalRow() }] })
      allow(adminGate, db.client)
      await review()
      expect(db.arg(TABLE, 'update'), String(frequency)).toMatchObject({ next_review_due: '2027-10-07' })
    }
  })

  it('dates the review itself: a body cannot back-date it or choose the next date', async () => {
    freezeClockAt('2026-10-07T15:30:00.000Z')
    const db = fakeSupabase({ [TABLE]: [{ data: { id: ENTRY_ID, review_frequency: 'annual' } }, { data: legalRow() }] })
    allow(adminGate, db.client)
    await review(ENTRY_ID, { last_reviewed_at: '1999-01-01T00:00:00Z', next_review_due: '2099-01-01', review_frequency: 'biennial' })
    expect(db.arg(TABLE, 'update')).toEqual({ last_reviewed_at: '2026-10-07T15:30:00.000Z', next_review_due: '2027-10-07' })
  })

  it('answers 500 without leaking the database error, whether the read or the write failed', async () => {
    for (const script of [
      [{ error: { message: 'relation exploded' } }],
      [{ data: { id: ENTRY_ID, review_frequency: 'annual' } }, { error: { message: 'relation exploded' } }],
    ]) {
      allow(adminGate, fakeSupabase({ [TABLE]: script }).client)
      const res = await review()
      expect(res.status).toBe(500)
      expect(JSON.stringify(await res.json())).not.toContain('exploded')
    }
  })
})
