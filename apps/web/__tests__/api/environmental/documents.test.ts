import { beforeEach, describe, expect, it, vi } from 'vitest'

// The /api/environmental/documents routes: upload, register, review, decide.
// The gate, storage, database and service are all faked; what is asserted is
// who may do what, that scoping comes from the gate (never the request body),
// and that nothing is filed without an admin's explicit approval.

const TENANT = '22222222-2222-2222-2222-222222222222'
const FACILITY = '55555555-5555-5555-5555-555555555555'
const DOC = '44444444-4444-4444-4444-444444444444'
const USER = 'user-1'

// A chainable, awaitable fake query that records every call.
class Query {
  calls: Array<[string, unknown[]]> = []
  constructor(private result: unknown) {}
  private record(name: string) { return (...args: unknown[]) => { this.calls.push([name, args]); return this } }
  select = this.record('select'); insert = this.record('insert'); update = this.record('update')
  delete = this.record('delete'); eq = this.record('eq'); in = this.record('in')
  order = this.record('order'); limit = this.record('limit')
  maybeSingle() { this.calls.push(['maybeSingle', []]); return Promise.resolve(this.result) }
  then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve(this.result).then(resolve, reject) }
  called(name: string) { return this.calls.filter(([n]) => n === name).map(([, a]) => a) }
}

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  adminQueues: {} as Record<string, unknown[]>,
  adminQueries: [] as Array<{ table: string; query: unknown }>,
  authedQueues: {} as Record<string, unknown[]>,
  authedQueries: [] as Array<{ table: string; query: unknown }>,
  storage: {
    list: vi.fn(), remove: vi.fn(), createSignedUploadUrl: vi.fn(), createSignedUrl: vi.fn(), buckets: [] as string[],
  },
  enqueue: vi.fn(),
  sanitize: vi.fn(),
}))

vi.mock('@/lib/auth/tenantGate', () => ({ requireTenantModuleMember: m.gate }))
vi.mock('@/lib/serviceJobs', () => ({ enqueueServiceJob: m.enqueue }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/security/sanitizeError', async () => {
  const { NextResponse } = await import('next/server')
  return { sanitizeError: (e: unknown, route: string) => { m.sanitize(e, route); return NextResponse.json({ error: 'internal' }, { status: 500 }) } }
})
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const query = (m.adminQueues[table] ?? []).shift() ?? new Query({ data: null, error: null })
      m.adminQueries.push({ table, query })
      return query
    },
    storage: { from: (bucket: string) => { m.storage.buckets.push(bucket); return m.storage } },
  }),
}))

const queueAdmin = (table: string, ...results: unknown[]) => { (m.adminQueues[table] ??= []).push(...results.map(r => new Query(r))) }
const queueAuthed = (table: string, ...results: unknown[]) => { (m.authedQueues[table] ??= []).push(...results.map(r => new Query(r))) }
const adminQueriesFor = (table: string) => m.adminQueries.filter(q => q.table === table).map(q => q.query as Query)
const authedQueriesFor = (table: string) => m.authedQueries.filter(q => q.table === table).map(q => q.query as Query)

function gateAs(overrides: Record<string, unknown> = {}) {
  m.gate.mockResolvedValue({
    ok: true, userId: USER, tenantId: TENANT, facilityId: FACILITY, role: 'admin',
    authedClient: {
      from: (table: string) => {
        const query = (m.authedQueues[table] ?? []).shift() ?? new Query({ data: null, error: null })
        m.authedQueries.push({ table, query })
        return query
      },
    },
    ...overrides,
  })
}

const req = (body?: unknown, method = 'POST') =>
  new Request('http://localhost/api/environmental/documents', {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
const params = (id = DOC) => ({ params: Promise.resolve({ id }) })

const proposalRow = (over: Record<string, unknown> = {}) => ({
  id: DOC, tenant_id: TENANT, facility_id: FACILITY, storage_path: `${TENANT}/${DOC}.pdf`, file_name: 'permit.pdf',
  status: 'needs_review', doc_type: 'air_permit', doc_type_confidence: 'high', overall_confidence: 'medium',
  via_ocr: false, error: null, reviewed_fields: [], obligation_ids: [], reviewed_by: null, reviewed_at: null,
  created_at: '2026-10-07T00:00:00Z',
  extraction: { notes: 'n', fields: [
    { key: 'permit_number', label: 'Permit number', value: 'F98765', confidence: 'medium', evidence: 'Permit No.: F98765', repaired: false },
    { key: 'expiration_date', label: 'Expiration date', value: '2027-04-30', confidence: 'high', evidence: 'Expires: April 30, 2027', repaired: false },
  ] },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(m.adminQueues)) delete m.adminQueues[k]
  for (const k of Object.keys(m.authedQueues)) delete m.authedQueues[k]
  m.adminQueries.length = 0; m.authedQueries.length = 0; m.storage.buckets.length = 0
  m.storage.list.mockResolvedValue({ data: [{ name: `${DOC}.pdf` }], error: null })
  m.storage.remove.mockResolvedValue({ data: [], error: null })
  m.storage.createSignedUploadUrl.mockImplementation(async (path: string) => ({ data: { path, token: 'tok' }, error: null }))
  m.storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/doc.pdf' }, error: null })
  m.enqueue.mockResolvedValue({ jobId: 'job-1' })
  gateAs()
})

describe('POST /api/environmental/documents/upload-url', () => {
  const call = async () => (await import('@/app/api/environmental/documents/upload-url/route')).POST(req())

  it('passes a gate rejection straight through', async () => {
    m.gate.mockResolvedValue({ ok: false, status: 403, message: 'Module is not enabled for this tenant' })
    const res = await call()
    expect(res.status).toBe(403)
    expect(m.storage.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('asks for the environmental module', async () => {
    await call()
    expect(m.gate).toHaveBeenCalledWith(expect.anything(), 'environmental')
  })

  it('refuses a viewer and a roll-up view with no facility', async () => {
    gateAs({ role: 'viewer' })
    expect((await call()).status).toBe(403)
    gateAs({ facilityId: null })
    expect((await call()).status).toBe(400)
    expect(m.storage.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('chooses the object path itself, under the caller\'s tenant', async () => {
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.path).toBe(`${TENANT}/${body.document_id}.pdf`)
    expect(body.token).toBe('tok')
    expect(m.storage.buckets).toEqual(['environmental-docs'])
  })
})

describe('GET /api/environmental/documents', () => {
  it("lists through the caller's own RLS-scoped client, without the large extraction", async () => {
    queueAuthed('document_extractions', { data: [{ id: DOC, file_name: 'permit.pdf' }], error: null })
    const { GET } = await import('@/app/api/environmental/documents/route')
    const res = await GET(req(undefined, 'GET'))
    expect(await res.json()).toEqual({ documents: [{ id: DOC, file_name: 'permit.pdf' }] })
    const [select] = authedQueriesFor('document_extractions')[0].called('select')
    expect(select[0]).not.toContain('extraction')
    expect(m.adminQueries).toEqual([])
  })
})

describe('POST /api/environmental/documents (register an upload)', () => {
  const register = async (body: unknown = { document_id: DOC, file_name: 'permit.pdf' }) =>
    (await import('@/app/api/environmental/documents/route')).POST(req(body))

  beforeEach(() => {
    queueAdmin('document_extractions', { count: 0, error: null }, { error: null }, { error: null })
  })

  it('refuses a viewer and a roll-up view', async () => {
    gateAs({ role: 'viewer' })
    expect((await register()).status).toBe(403)
    gateAs({ facilityId: null })
    expect((await register()).status).toBe(400)
  })

  it.each([
    ['a missing id', { file_name: 'a.pdf' }],
    ['a malformed id', { document_id: '../../etc', file_name: 'a.pdf' }],
    ['a blank file name', { document_id: DOC, file_name: '  ' }],
    ['an oversized file name', { document_id: DOC, file_name: 'x'.repeat(256) }],
  ])('rejects %s', async (_n, body) => {
    expect((await register(body)).status).toBe(400)
    expect(m.enqueue).not.toHaveBeenCalled()
  })

  it('will not register an upload that is not in storage', async () => {
    m.storage.list.mockResolvedValue({ data: [], error: null })
    const res = await register()
    expect(res.status).toBe(400)
    expect(adminQueriesFor('document_extractions')).toHaveLength(0)
    expect(m.enqueue).not.toHaveBeenCalled()
  })

  it('looks for the file under the caller\'s tenant, whatever the client sent', async () => {
    await register({ document_id: DOC, file_name: 'a.pdf', storage_path: 'other-tenant/x.pdf', tenant_id: 'other' })
    expect(m.storage.list).toHaveBeenCalledWith(TENANT, expect.objectContaining({ search: `${DOC}.pdf` }))
  })

  it('stops a tenant with too many documents still waiting', async () => {
    m.adminQueues.document_extractions = [new Query({ count: 20, error: null })]
    const res = await register()
    expect(res.status).toBe(429)
    expect(m.enqueue).not.toHaveBeenCalled()
  })

  it('records the document from the gate (tenant, facility, user) and queues the read', async () => {
    const res = await register({ document_id: DOC.toUpperCase(), file_name: ' permit.pdf ', tenant_id: 'forged', facility_id: 'forged' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ document: { id: DOC, status: 'processing' } })

    const [[inserted]] = adminQueriesFor('document_extractions')[1].called('insert')
    expect(inserted).toEqual({
      id: DOC, tenant_id: TENANT, facility_id: FACILITY, storage_path: `${TENANT}/${DOC}.pdf`,
      file_name: 'permit.pdf', created_by: USER,
    })
    expect(m.enqueue).toHaveBeenCalledWith({
      kind: 'document_extract', tenantId: TENANT, payload: { document_id: DOC }, requestedBy: USER, dedupeKey: DOC,
    })
    expect(adminQueriesFor('document_extractions')[2].called('update')[0][0]).toEqual({ job_id: 'job-1' })
  })

  it('removes the row and the file, and says so, when the service cannot take the job', async () => {
    m.enqueue.mockResolvedValue(null)
    m.adminQueues.document_extractions = [new Query({ count: 0, error: null }), new Query({ error: null }), new Query({ error: null })]
    const res = await register()
    expect(res.status).toBe(503)
    expect(adminQueriesFor('document_extractions')[2].calls.map(([n]) => n)).toContain('delete')
    expect(m.storage.remove).toHaveBeenCalledWith([`${TENANT}/${DOC}.pdf`])
  })

  it('does not report success when the record could not be saved', async () => {
    m.adminQueues.document_extractions = [new Query({ count: 0, error: null }), new Query({ error: { code: '23505' } })]
    const res = await register()
    expect(res.status).toBe(500)
    expect(m.enqueue).not.toHaveBeenCalled()
  })
})

describe('GET /api/environmental/documents/[id] and /url', () => {
  it('returns the proposal but never the internal storage key', async () => {
    queueAuthed('document_extractions', { data: proposalRow(), error: null })
    const { GET } = await import('@/app/api/environmental/documents/[id]/route')
    const res = await GET(req(undefined, 'GET'), params())
    const { document } = await res.json()
    expect(document.id).toBe(DOC)
    expect(document.extraction.fields).toHaveLength(2)
    expect(document).not.toHaveProperty('storage_path')
  })

  it('404s a document the caller cannot see (RLS returns no row)', async () => {
    queueAuthed('document_extractions', { data: null, error: null })
    const { GET } = await import('@/app/api/environmental/documents/[id]/route')
    expect((await GET(req(undefined, 'GET'), params())).status).toBe(404)
  })

  it('rejects a malformed id before any query', async () => {
    const { GET } = await import('@/app/api/environmental/documents/[id]/route')
    expect((await GET(req(undefined, 'GET'), params('nope'))).status).toBe(400)
    expect(m.authedQueries).toEqual([])
  })

  it('signs the stored path only after the caller\'s own view has found the document', async () => {
    queueAuthed('document_extractions', { data: proposalRow(), error: null })
    const { GET } = await import('@/app/api/environmental/documents/[id]/url/route')
    const res = await GET(req(undefined, 'GET'), params())
    expect(await res.json()).toEqual({ url: 'https://signed.example/doc.pdf', expires_in: 300 })
    expect(m.storage.createSignedUrl).toHaveBeenCalledWith(`${TENANT}/${DOC}.pdf`, 300)
  })

  it('signs nothing for a document the caller cannot see', async () => {
    queueAuthed('document_extractions', { data: null, error: null })
    const { GET } = await import('@/app/api/environmental/documents/[id]/url/route')
    expect((await GET(req(undefined, 'GET'), params())).status).toBe(404)
    expect(m.storage.createSignedUrl).not.toHaveBeenCalled()
  })
})

describe('POST /api/environmental/documents/[id]/approve', () => {
  const approve = async (body: unknown, id = DOC) =>
    (await import('@/app/api/environmental/documents/[id]/approve/route')).POST(req(body), params(id))
  const all = [{ index: 0, value: 'F98765' }, { index: 1, value: '2027-04-30' }]

  beforeEach(() => {
    queueAuthed('document_extractions', { data: proposalRow(), error: null })
    queueAdmin('document_extractions', { data: [{ id: DOC }], error: null }, { error: null })
    queueAuthed('compliance_calendar_obligations', { data: [{ id: 'ob-1' }], error: null })
  })

  it.each(['member', 'viewer'])('is for admins: refuses a %s before looking at anything', async (role) => {
    gateAs({ role })
    expect((await approve({ accepted: all })).status).toBe(403)
    expect(m.authedQueries).toEqual([])
    expect(m.adminQueries).toEqual([])
  })

  it('refuses a document that is not waiting for review', async () => {
    m.authedQueues.document_extractions = [new Query({ data: proposalRow({ status: 'approved' }), error: null })]
    const res = await approve({ accepted: all })
    expect(res.status).toBe(409)
    expect(m.adminQueries).toEqual([])
  })

  it.each([
    ['a field the service never found', { accepted: [{ index: 9, value: 'x' }] }],
    ['an empty selection', { accepted: [] }],
    ['a missing selection', {}],
  ])('validates the selection against the proposal: %s', async (_name, body) => {
    expect((await approve(body)).status).toBe(400)
    expect(m.adminQueries).toEqual([])
  })

  it('rejects an impossible corrected date instead of filing it', async () => {
    const res = await approve({ accepted: [{ index: 1, value: '2027-02-30' }] })
    expect(res.status).toBe(400)
    expect(m.adminQueries).toEqual([])
  })

  it('claims the document (guarded on status) and files an expiry as a calendar entry that names its source', async () => {
    const res = await approve({ accepted: all })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, obligation_ids: ['ob-1'] })

    const claim = adminQueriesFor('document_extractions')[0]
    const [[claimed]] = claim.called('update')
    expect(claimed).toMatchObject({ status: 'approved', reviewed_by: USER })
    expect((claimed as { reviewed_fields: unknown[] }).reviewed_fields).toHaveLength(2)
    expect(claim.called('eq')).toEqual(expect.arrayContaining([['tenant_id', TENANT], ['status', 'needs_review']]))

    const [[rows]] = authedQueriesFor('compliance_calendar_obligations')[0].called('insert')
    expect(rows).toEqual([expect.objectContaining({
      title: 'Air permit F98765 expires', next_due_at: '2027-04-30', cadence: 'once', category: 'environmental',
      evidence_id: `document_extractions:${DOC}`, tenant_id: TENANT, source: 'tenant', created_by: USER,
    })])
    expect(adminQueriesFor('document_extractions')[1].called('update')[0][0]).toEqual({ obligation_ids: ['ob-1'] })
  })

  it('files nothing on the calendar when asked not to', async () => {
    const res = await approve({ accepted: all, create_obligations: false })
    expect(res.status).toBe(200)
    expect(authedQueriesFor('compliance_calendar_obligations')).toHaveLength(0)
  })

  it('files nothing on the calendar when no deadline was confirmed', async () => {
    await approve({ accepted: [{ index: 0, value: 'F98765' }] })
    expect(authedQueriesFor('compliance_calendar_obligations')).toHaveLength(0)
  })

  it('marks a corrected value as edited in what it stores', async () => {
    await approve({ accepted: [{ index: 0, value: 'F98766' }], create_obligations: false })
    const [[claimed]] = adminQueriesFor('document_extractions')[0].called('update')
    expect((claimed as { reviewed_fields: unknown[] }).reviewed_fields).toEqual([
      { key: 'permit_number', label: 'Permit number', value: 'F98766', edited: true },
    ])
  })

  it('creates nothing if someone else decided it first', async () => {
    m.adminQueues.document_extractions = [new Query({ data: [], error: null })]
    const res = await approve({ accepted: all })
    expect(res.status).toBe(409)
    expect(authedQueriesFor('compliance_calendar_obligations')).toHaveLength(0)
  })

  it('puts the document back in the queue if the calendar entry could not be created', async () => {
    m.authedQueues.compliance_calendar_obligations = [new Query({ data: null, error: { code: '42501' } })]
    m.adminQueues.document_extractions = [new Query({ data: [{ id: DOC }], error: null }), new Query({ error: null })]
    const res = await approve({ accepted: all })
    expect(res.status).toBe(500)
    const revert = adminQueriesFor('document_extractions')[1]
    expect(revert.called('update')[0][0]).toMatchObject({ status: 'needs_review', reviewed_by: null, reviewed_at: null })
    expect(revert.called('eq')).toEqual(expect.arrayContaining([['status', 'approved']]))
  })
})

describe('POST /api/environmental/documents/[id]/reject', () => {
  const reject = async () => (await import('@/app/api/environmental/documents/[id]/reject/route')).POST(req({}), params())

  beforeEach(() => {
    queueAuthed('document_extractions', { data: proposalRow(), error: null })
    queueAdmin('document_extractions', { data: [{ id: DOC }], error: null })
  })

  it('is for admins', async () => {
    gateAs({ role: 'member' })
    expect((await reject()).status).toBe(403)
    expect(m.adminQueries).toEqual([])
  })

  it('discards a proposal, guarded on it still being undecided', async () => {
    const res = await reject()
    expect(res.status).toBe(200)
    const q = adminQueriesFor('document_extractions')[0]
    expect(q.called('update')[0][0]).toMatchObject({ status: 'rejected', reviewed_by: USER })
    expect(q.called('in')).toEqual([['status', ['needs_review', 'failed']]])
    expect(q.called('eq')).toEqual(expect.arrayContaining([['tenant_id', TENANT]]))
  })

  it('reports a document that was already decided', async () => {
    m.adminQueues.document_extractions = [new Query({ data: [], error: null })]
    expect((await reject()).status).toBe(409)
  })
})
