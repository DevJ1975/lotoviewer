import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fakeSupabase, type Call, type Result } from '../environmental/_fakeSupabase'

// The manifest routes under /api/hazardous-waste/manifests. The gate and the Supabase client are
// scripted, the way the neighbouring container route tests do, so each test can say what the
// database answered and check what the route asked and what it told the client. The database's
// own rules are exercised against a real Postgres in __tests__/migrations/hazardousWasteManifests.db.test.ts.

// ── gate and sanitizer ──────────────────────────────────────────────────────
const gateMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantModuleMember: (...a: unknown[]) => gateMock(...a),
}))
const hoisted = vi.hoisted(() => ({ sanitized: [] as unknown[] }))
vi.mock('@/lib/security/sanitizeError', () => ({
  sanitizeError: (error: unknown) => { hoisted.sanitized.push(error); return Response.json({ error: 'internal' }, { status: 500 }) },
}))

import { GET as listManifests, POST as createManifest } from '@/app/api/hazardous-waste/manifests/route'
import { GET as getManifest, PATCH as patchManifest } from '@/app/api/hazardous-waste/manifests/[id]/route'
import { POST as transitionManifest } from '@/app/api/hazardous-waste/manifests/[id]/transition/route'
import { GET as shippableContainers } from '@/app/api/hazardous-waste/manifests/shippable-containers/route'

const TENANT = '11111111-1111-1111-1111-111111111111'
const SITE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const OTHER_USER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
const MANIFEST = 'f0000000-0000-4000-8000-0000000000a1'
const CONTAINER_1 = 'c0000000-0000-4000-8000-000000000001'
const CONTAINER_2 = 'c0000000-0000-4000-8000-000000000002'

type Role = 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'

function allow(client: unknown, over: Partial<{ facilityId: string | null; role: Role; userId: string }> = {}) {
  gateMock.mockResolvedValue({
    ok: true, tenantId: TENANT, userId: over.userId ?? USER, userEmail: 'u@example.com',
    facilityId: over.facilityId === undefined ? SITE : over.facilityId, role: over.role ?? 'member', authedClient: client,
    tenantName: 'Acme', tenantModules: { 'hazardous-waste': true }, tenantSettings: null,
  })
}

const manifestRow = (over: Record<string, unknown> = {}) => ({
  id: MANIFEST, tenant_id: TENANT, facility_id: SITE, manifest_tracking_number: '123456789ELC', status: 'draft', jurisdiction: 'federal',
  generator_category: 'lqg', generator_epa_id: 'CAL000123456', transporter_epa_id: null, tsdf_epa_id: null, transporter_name: null,
  tsdf_name: null, waste_codes: ['D001'], dot_description: null, electronic: false, shipped_on: null, completed_on: null,
  exception_reported_on: null, notes: null, created_by: USER, created_at: '2026-03-01T09:00:00Z', updated_at: '2026-03-01T09:00:00Z', ...over,
})
const link = (container: string, label: string, shipment = MANIFEST) =>
  ({ shipment_id: shipment, container: { id: container, label, status: 'in_shipment', stream: { name: 'Spent solvent' } } })

const withCount = (data: unknown, count: number): Result => ({ data, count } as Result)
const eqValue = (call: Call | undefined, column: string) => call?.ops.find(o => o.method === 'eq' && o.args[0] === column)?.args[1]
const op = (call: Call | undefined, method: string) => call?.ops.find(o => o.method === method)?.args
const request = (url: string, method = 'GET', body?: unknown) => new Request(`https://example.com${url}`, {
  method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
/** The error a Postgres refusal arrives as. */
const dbError = (code: string, message: string, details?: string) => ({ error: { code, message, details } })

beforeEach(() => {
  gateMock.mockReset()
  hoisted.sanitized.length = 0
})
afterEach(() => { vi.useRealTimers() })

describe('GET /api/hazardous-waste/manifests', () => {
  it('passes a gate refusal straight through', async () => {
    gateMock.mockResolvedValue({ ok: false, status: 403, message: 'Module is not enabled for this tenant' })
    const res = await listManifests(request('/api/hazardous-waste/manifests'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Module is not enabled for this tenant' })
  })

  it('lists the active site\'s manifests for a plain member, newest first, with containers and the clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-04-06T10:00:00Z'))
    const db = fakeSupabase({
      hazardous_waste_shipments: [withCount([manifestRow({ status: 'shipped', shipped_on: '2026-03-01' })], 1)],
      hazardous_waste_shipment_containers: [{ data: [link(CONTAINER_2, 'Drum B'), link(CONTAINER_1, 'Drum A')] }],
    })
    allow(db.client, { role: 'member' })

    const res = await listManifests(request('/api/hazardous-waste/manifests'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(db.filtered('hazardous_waste_shipments', 'tenant_id', TENANT)).toBe(true)
    expect(db.filtered('hazardous_waste_shipments', 'facility_id', SITE)).toBe(true)
    expect(db.filtered('hazardous_waste_shipment_containers', 'tenant_id', TENANT)).toBe(true)
    expect(op(db.calls[0], 'order')).toEqual(['created_at', { ascending: false }])
    expect(body.total).toBe(1)
    expect(body.manifests[0].containers).toEqual([
      { id: CONTAINER_1, label: 'Drum A', status: 'in_shipment', stream_name: 'Spent solvent' },
      { id: CONTAINER_2, label: 'Drum B', status: 'in_shipment', stream_name: 'Spent solvent' },
    ])
    expect(body.manifests[0].clock).toMatchObject({ stage: 'follow_up_due', daysSinceShipped: 36, exceptionReportDueOn: '2026-04-15' })
  })

  it('leaves cancelled manifests out unless asked, and does not filter by site in the roll-up view', async () => {
    const db = fakeSupabase({ hazardous_waste_shipments: [withCount([], 0)] })
    allow(db.client, { facilityId: null })
    await listManifests(request('/api/hazardous-waste/manifests'))
    expect(db.calls[0]!.ops.some(o => o.method === 'neq' && o.args[0] === 'status' && o.args[1] === 'cancelled')).toBe(true)
    expect(db.filtered('hazardous_waste_shipments', 'facility_id', SITE)).toBe(false)
    expect(db.calls[0]!.ops.some(o => o.method === 'eq' && o.args[0] === 'facility_id')).toBe(false)
  })

  it('includes cancelled manifests with include_cancelled=true, or when asked for that status', async () => {
    const db = fakeSupabase({ hazardous_waste_shipments: [withCount([], 0)] })
    allow(db.client)
    await listManifests(request('/api/hazardous-waste/manifests?include_cancelled=true'))
    await listManifests(request('/api/hazardous-waste/manifests?status=cancelled'))
    expect(db.calls.some(c => c.ops.some(o => o.method === 'neq'))).toBe(false)
    expect(eqValue(db.calls[1], 'status')).toBe('cancelled')
  })

  it('filters by a known status and refuses an unknown one, before asking the database', async () => {
    const db = fakeSupabase({ hazardous_waste_shipments: [withCount([], 0)] })
    allow(db.client)
    await listManifests(request('/api/hazardous-waste/manifests?status=shipped'))
    expect(eqValue(db.calls[0], 'status')).toBe('shipped')

    const calls = db.calls.length
    const res = await listManifests(request('/api/hazardous-waste/manifests?status=lost'))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors[0].field).toBe('status')
    expect(db.calls.length).toBe(calls)
  })

  describe('paging', () => {
    const page = async (query: string, total: number, returned = 10) => {
      const rows = Array.from({ length: returned }, (_, i) => manifestRow({ id: `f0000000-0000-4000-8000-00000000010${i}` }))
      const db = fakeSupabase({ hazardous_waste_shipments: [withCount(rows, total)], hazardous_waste_shipment_containers: [{ data: [] }] })
      allow(db.client)
      const body = await (await listManifests(request(`/api/hazardous-waste/manifests${query}`))).json()
      return { db, body }
    }

    it('asks for the range it was given, and says where the next page starts', async () => {
      const { db, body } = await page('?limit=10&offset=20', 35)
      expect(op(db.calls[0], 'range')).toEqual([20, 29])
      expect(body.nextOffset).toBe(30)
    })

    it('says there is no next page at the end', async () => {
      const { body } = await page('?limit=10&offset=20', 30)
      expect(body.nextOffset).toBeNull()
    })

    it('gives 50 by default and at most 100', async () => {
      expect(op((await page('', 500)).db.calls[0], 'range')).toEqual([0, 49])
      expect(op((await page('?limit=100', 500)).db.calls[0], 'range')).toEqual([0, 99])
    })
  })

  it.each(['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'offset=-1', 'offset=100001', 'offset=x'])('refuses %s', async query => {
    const db = fakeSupabase()
    allow(db.client)
    const res = await listManifests(request(`/api/hazardous-waste/manifests?${query}`))
    expect(res.status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })

  it('does not fetch containers when there are no manifests', async () => {
    const db = fakeSupabase({ hazardous_waste_shipments: [withCount([], 0)] })
    allow(db.client)
    const body = await (await listManifests(request('/api/hazardous-waste/manifests'))).json()
    expect(body).toEqual({ manifests: [], total: 0, nextOffset: null })
    expect(db.calls.map(c => c.table)).toEqual(['hazardous_waste_shipments'])
  })

  it('answers a database error with the sanitizer\'s 500, never the error itself', async () => {
    const db = fakeSupabase({ hazardous_waste_shipments: [dbError('42P01', 'relation "hazardous_waste_shipments" does not exist')] })
    allow(db.client)
    const res = await listManifests(request('/api/hazardous-waste/manifests'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('relation')
    expect(hoisted.sanitized).toHaveLength(1)
  })
})

describe('POST /api/hazardous-waste/manifests', () => {
  const validBody = (over: Record<string, unknown> = {}) => ({ container_ids: [CONTAINER_1, CONTAINER_2], generator_category: 'lqg', ...over })

  const created = () => fakeSupabase({
    'rpc:hw_create_shipment': [{ data: MANIFEST }],
    hazardous_waste_shipments: [{ data: manifestRow() }],
    hazardous_waste_shipment_containers: [{ data: [link(CONTAINER_1, 'Drum A'), link(CONTAINER_2, 'Drum B')] }],
  })

  it('passes a gate refusal straight through, and never touches the database', async () => {
    gateMock.mockResolvedValue({ ok: false, status: 401, message: 'Invalid session' })
    const res = await createManifest(request('/api/hazardous-waste/manifests', 'POST', validBody()))
    expect(res.status).toBe(401)
  })

  it('refuses a body that is not a JSON object', async () => {
    const db = created()
    allow(db.client)
    for (const body of ['not json', '[1]', 'null']) {
      const res = await createManifest(new Request('https://example.com/api/hazardous-waste/manifests', { method: 'POST', body }))
      expect(res.status, body).toBe(400)
    }
    expect(db.calls).toHaveLength(0)
  })

  it('creates the draft through hw_create_shipment and answers 201 with the manifest it can read back', async () => {
    const db = created()
    allow(db.client)

    const res = await createManifest(request('/api/hazardous-waste/manifests', 'POST', validBody({
      manifest_tracking_number: ' 123456789elc ', generator_epa_id: 'cal000123456', jurisdiction: 'state:CA',
      waste_codes: ['d001', 'D001', '134'], electronic: true, transporter_name: ' Haul Co ', notes: '',
    })))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(db.arg('rpc:hw_create_shipment', 'rpc')).toEqual({
      p_container_ids: [CONTAINER_1, CONTAINER_2],
      p_fields: {
        manifest_tracking_number: '123456789ELC', jurisdiction: 'state:CA', generator_category: 'lqg', generator_epa_id: 'CAL000123456',
        transporter_epa_id: null, tsdf_epa_id: null, transporter_name: 'Haul Co', tsdf_name: null, waste_codes: ['D001', '134'],
        dot_description: null, electronic: true, notes: null,
      },
    })
    expect(db.filtered('hazardous_waste_shipments', 'id', MANIFEST)).toBe(true)
    expect(db.filtered('hazardous_waste_shipments', 'tenant_id', TENANT)).toBe(true)
    expect(body.manifest).toMatchObject({ id: MANIFEST, status: 'draft', can_modify: true })
    expect(body.manifest.containers.map((c: { label: string }) => c.label)).toEqual(['Drum A', 'Drum B'])
  })

  it('defaults a federal paper manifest and sends no field the person did not give', async () => {
    const db = created()
    allow(db.client)
    await createManifest(request('/api/hazardous-waste/manifests', 'POST', validBody()))
    expect((db.arg('rpc:hw_create_shipment', 'rpc') as { p_fields: Record<string, unknown> }).p_fields)
      .toMatchObject({ jurisdiction: 'federal', electronic: false, waste_codes: [], manifest_tracking_number: null })
  })

  it('does not pass on a field it does not know: no status, account or owner from the body', async () => {
    const db = created()
    allow(db.client)
    await createManifest(request('/api/hazardous-waste/manifests', 'POST', validBody({ status: 'completed', tenant_id: 'x', created_by: 'y', shipped_on: '2026-01-01' })))
    const fields = (db.arg('rpc:hw_create_shipment', 'rpc') as { p_fields: Record<string, unknown> }).p_fields
    expect(Object.keys(fields).sort()).toEqual([
      'dot_description', 'electronic', 'generator_category', 'generator_epa_id', 'jurisdiction', 'manifest_tracking_number', 'notes',
      'transporter_epa_id', 'transporter_name', 'tsdf_epa_id', 'tsdf_name', 'waste_codes',
    ])
  })

  it.each([
    ['no generator category', { generator_category: undefined }, 'generator_category'],
    ['an unknown generator category', { generator_category: 'huge' }, 'generator_category'],
    ['no containers', { container_ids: [] }, 'container_ids'],
    ['container ids that are not a list', { container_ids: 'abc' }, 'container_ids'],
    ['a container id that is not text', { container_ids: [1] }, 'container_ids'],
    ['a container id that is not a UUID', { container_ids: ['abc'] }, 'container_ids'],
    ['a bad tracking number', { manifest_tracking_number: '12345' }, 'manifest_tracking_number'],
    ['a bad EPA ID', { tsdf_epa_id: 'nope' }, 'tsdf_epa_id'],
    ['an unknown jurisdiction', { jurisdiction: 'texas' }, 'jurisdiction'],
    ['a waste code that is not one', { waste_codes: ['ZZ9'] }, 'waste_codes'],
    ['waste codes that are not a list', { waste_codes: 'D001' }, 'waste_codes'],
    ['electronic as text', { electronic: 'yes' }, 'electronic'],
    ['a name that is not text', { tsdf_name: 5 }, 'tsdf_name'],
    ['notes that are too long', { notes: 'x'.repeat(2001) }, 'notes'],
  ])('refuses %s with a field error, and asks the database nothing', async (_name, over, field) => {
    const db = created()
    allow(db.client)
    const res = await createManifest(request('/api/hazardous-waste/manifests', 'POST', validBody(over)))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.fieldErrors.map((e: { field: string }) => e.field)).toContain(field)
    expect(db.calls).toHaveLength(0)
  })

  it('reports every problem at once', async () => {
    allow(created().client)
    const res = await createManifest(request('/api/hazardous-waste/manifests', 'POST', { container_ids: [], tsdf_epa_id: 'x' }))
    const body = await res.json()
    expect(body.fieldErrors.map((e: { field: string }) => e.field).sort()).toEqual(['container_ids', 'generator_category', 'tsdf_epa_id'])
  })

  describe('what the database refuses', () => {
    const post = async (answer: Result) => {
      const db = fakeSupabase({ 'rpc:hw_create_shipment': [answer] })
      allow(db.client)
      return createManifest(request('/api/hazardous-waste/manifests', 'POST', validBody()))
    }

    it('says "not found" for a container that is not there or not the caller\'s, which are the same answer', async () => {
      const res = await post(dbError('P0002', 'container not found'))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Not found' })
    })

    it('passes on the message the database wrote for a person, as a 409', async () => {
      const message = 'Only closed containers can go on a manifest. Not ready: Drum 7 (open).'
      const res = await post(dbError('23514', message, 'hw_manifest'))
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: message })
    })

    it('does not pass on a constraint\'s own text: that goes to the sanitizer', async () => {
      const res = await post(dbError('23514', 'new row for relation "hazardous_waste_shipments" violates check constraint "hw_shipments_x"'))
      expect(res.status).toBe(500)
      expect(JSON.stringify(await res.json())).not.toContain('constraint')
      expect(hoisted.sanitized).toHaveLength(1)
    })

    it('says "duplicate tracking number" for a number already in use, without the database\'s words', async () => {
      const res = await post(dbError('23505', 'duplicate key value violates unique constraint "hw_shipments_tenant_tracking_key"'))
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'Duplicate tracking number' })
    })

    it('says a container is already on a manifest when it is the container that collides', async () => {
      const res = await post(dbError('23505', 'duplicate key value violates unique constraint "uq_hw_shipment_containers_on_manifest"'))
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'A container is already on another manifest' })
    })

    it('answers 403 for a privilege error', async () => {
      const res = await post(dbError('42501', 'new row violates row-level security policy for table "hazardous_waste_shipments"'))
      expect(res.status).toBe(403)
      expect(JSON.stringify(await res.json())).not.toContain('policy')
    })

    it('hands anything else to the sanitizer', async () => {
      const res = await post(dbError('XX000', 'internal error with a schema name hazardous_waste_shipments'))
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'internal' })
      expect(hoisted.sanitized).toHaveLength(1)
    })
  })
})

describe('GET /api/hazardous-waste/manifests/[id]', () => {
  it('refuses an id that is not a UUID before the gate', async () => {
    const res = await getManifest(request('/api/hazardous-waste/manifests/nope'), ctx('nope'))
    expect(res.status).toBe(400)
    expect(gateMock).not.toHaveBeenCalled()
  })

  it('answers 404 for a manifest the caller cannot see', async () => {
    const db = fakeSupabase({ hazardous_waste_shipments: [{ data: null }] })
    allow(db.client)
    expect((await getManifest(request('/x'), ctx(MANIFEST))).status).toBe(404)
  })

  it('returns the manifest scoped to the account and the site, with retention and the clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-10T10:00:00Z'))
    const db = fakeSupabase({
      hazardous_waste_shipments: [{ data: manifestRow({ status: 'shipped', shipped_on: '2028-02-29' }) }],
      hazardous_waste_shipment_containers: [{ data: [link(CONTAINER_1, 'Drum A')] }],
    })
    allow(db.client, { role: 'member', userId: OTHER_USER })

    const body = await (await getManifest(request('/x'), ctx(MANIFEST))).json()

    expect(eqValue(db.calls[0], 'id')).toBe(MANIFEST)
    expect(db.filtered('hazardous_waste_shipments', 'tenant_id', TENANT)).toBe(true)
    expect(db.filtered('hazardous_waste_shipments', 'facility_id', SITE)).toBe(true)
    expect(body.manifest.retention_end).toBe('2031-03-01')
    expect(body.manifest.clock.stage).toBe('on_track')
  })

  it('says who may change it: its creator and any admin, not another member', async () => {
    const answer = (role: Role, userId: string) => {
      const db = fakeSupabase({ hazardous_waste_shipments: [{ data: manifestRow({ created_by: USER }) }] })
      allow(db.client, { role, userId })
      return getManifest(request('/x'), ctx(MANIFEST)).then(res => res.json()).then(body => body.manifest.can_modify)
    }
    expect(await answer('member', USER)).toBe(true)
    expect(await answer('member', OTHER_USER)).toBe(false)
    expect(await answer('viewer', OTHER_USER)).toBe(false)
    expect(await answer('admin', OTHER_USER)).toBe(true)
    expect(await answer('owner', OTHER_USER)).toBe(true)
    expect(await answer('superadmin', OTHER_USER)).toBe(true)
  })
})

describe('PATCH /api/hazardous-waste/manifests/[id]', () => {
  const patch = (body: unknown) => patchManifest(request('/x', 'PATCH', body), ctx(MANIFEST))
  const edited = (over: Record<string, unknown> = {}) => fakeSupabase({
    hazardous_waste_shipments: [{ data: manifestRow(over) }],
    hazardous_waste_shipment_containers: [{ data: [] }],
  })

  it('refuses an id that is not a UUID', async () => {
    expect((await patchManifest(request('/x', 'PATCH', {}), ctx('nope'))).status).toBe(400)
  })

  it('updates only the fields it was sent, normalised, scoped to the account and the site', async () => {
    const db = edited()
    allow(db.client)

    const res = await patch({ transporter_name: ' Haul Co ', tsdf_epa_id: 'azd000000002', waste_codes: ['d002'], manifest_tracking_number: '123456789elc' })

    expect(res.status).toBe(200)
    expect(db.arg('hazardous_waste_shipments', 'update')).toEqual({
      transporter_name: 'Haul Co', tsdf_epa_id: 'AZD000000002', waste_codes: ['D002'], manifest_tracking_number: '123456789ELC',
    })
    const update = db.calls.find(c => c.ops.some(o => o.method === 'update'))
    expect(eqValue(update, 'id')).toBe(MANIFEST)
    expect(eqValue(update, 'tenant_id')).toBe(TENANT)
    expect(eqValue(update, 'facility_id')).toBe(SITE)
  })

  it('clears a field sent as blank or null', async () => {
    const db = edited()
    allow(db.client)
    await patch({ notes: '   ', tsdf_name: null, manifest_tracking_number: '' })
    expect(db.arg('hazardous_waste_shipments', 'update')).toEqual({ notes: null, tsdf_name: null, manifest_tracking_number: null })
  })

  it.each(['status', 'shipped_on', 'completed_on', 'exception_reported_on'])('refuses to change %s here, pointing at the transition', async field => {
    const db = edited()
    allow(db.client)
    const res = await patch({ [field]: 'shipped', notes: 'ok' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.fieldErrors[0]).toMatchObject({ field })
    expect(body.fieldErrors[0].message).toMatch(/transition|Ship/i)
    expect(db.calls).toHaveLength(0)
  })

  it('refuses an empty change, a bad value, and a field of the wrong type', async () => {
    const db = edited()
    allow(db.client)
    expect((await patch({})).status).toBe(400)
    expect((await patch({ unknown_field: 1 })).status).toBe(400)
    expect((await patch({ tsdf_epa_id: 'x' })).status).toBe(400)
    expect((await patch({ electronic: 'yes' })).status).toBe(400)
    expect((await patch({ jurisdiction: 'texas' })).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })

  it('answers 404 when nothing matched', async () => {
    const db = fakeSupabase({ hazardous_waste_shipments: [{ data: null }] })
    allow(db.client)
    expect((await patch({ notes: 'x' })).status).toBe(404)
  })

  it('passes on the database\'s refusal to edit a manifest that has shipped, as a 409', async () => {
    const message = 'This manifest is shipped and can no longer be edited. Cancel it and start a new one if it was wrong.'
    const db = fakeSupabase({ hazardous_waste_shipments: [dbError('23514', message, 'hw_manifest')] })
    allow(db.client)
    const res = await patch({ notes: 'x' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: message })
  })

  it('says "duplicate tracking number" when the number is another manifest\'s', async () => {
    const db = fakeSupabase({ hazardous_waste_shipments: [dbError('23505', 'duplicate key value violates unique constraint "hw_shipments_tenant_tracking_key"')] })
    allow(db.client)
    const res = await patch({ manifest_tracking_number: '123456789ELC' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Duplicate tracking number' })
  })
})

describe('POST /api/hazardous-waste/manifests/[id]/transition', () => {
  const move = (body: unknown, id = MANIFEST) => transitionManifest(request('/x', 'POST', body), ctx(id))
  const shippedRow = (over: Record<string, unknown> = {}) => manifestRow({ status: 'shipped', shipped_on: '2026-03-01', ...over })
  const script = (rpc: Result = { data: null }, rows: unknown[] = [manifestRow(), shippedRow()]) => fakeSupabase({
    'rpc:hw_transition_shipment': [rpc],
    hazardous_waste_shipments: rows.map(row => ({ data: row })),
    hazardous_waste_shipment_containers: [{ data: [link(CONTAINER_1, 'Drum A'), link(CONTAINER_2, 'Drum B')] }],
  })

  it('refuses an id that is not a UUID, and an unauthenticated caller', async () => {
    expect((await move({ action: 'cancel' }, 'nope')).status).toBe(400)
    gateMock.mockResolvedValue({ ok: false, status: 401, message: 'Missing bearer token' })
    expect((await move({ action: 'cancel' })).status).toBe(401)
  })

  it.each([
    ['an unknown action', { action: 'complete', on: '2026-03-20' }, 'action'],
    ['no action', {}, 'action'],
    ['ship with no date', { action: 'ship' }, 'on'],
    ['receive with a date that is not a day', { action: 'receive', on: '2026-02-30' }, 'on'],
    ['file_exception in another date format', { action: 'file_exception', on: '03/20/2026' }, 'on'],
    ['an over-long note', { action: 'ship', on: '2026-03-01', note: 'x'.repeat(501) }, 'note'],
  ])('refuses %s with a field error, and moves nothing', async (_name, body, field) => {
    const db = script()
    allow(db.client)
    const res = await move(body)
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors.map((e: { field: string }) => e.field)).toContain(field)
    expect(db.calls).toHaveLength(0)
  })

  it('moves the manifest through hw_transition_shipment and answers with it as it now stands', async () => {
    const db = script()
    allow(db.client)

    const res = await move({ action: 'ship', on: '2026-03-01', note: ' Driver signed ' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(db.arg('rpc:hw_transition_shipment', 'rpc')).toEqual({ p_id: MANIFEST, p_action: 'ship', p_on: '2026-03-01', p_note: 'Driver signed' })
    expect(body.manifest.status).toBe('shipped')
    expect(db.filtered('hazardous_waste_shipments', 'tenant_id', TENANT)).toBe(true)
  })

  it('sends no date for a cancel', async () => {
    const db = script()
    allow(db.client)
    await move({ action: 'cancel' })
    expect(db.arg('rpc:hw_transition_shipment', 'rpc')).toEqual({ p_id: MANIFEST, p_action: 'cancel', p_on: null, p_note: null })
  })

  it('answers 404, and moves nothing, for a manifest the caller cannot see', async () => {
    const db = script(undefined, [null])
    allow(db.client)
    expect((await move({ action: 'cancel' })).status).toBe(404)
    expect(db.calls.some(c => c.table.startsWith('rpc:'))).toBe(false)
  })

  it('answers 403, and moves nothing, for a member who did not draft it', async () => {
    const db = script(undefined, [manifestRow({ created_by: USER })])
    allow(db.client, { role: 'member', userId: OTHER_USER })
    const res = await move({ action: 'cancel' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/drafted|admin/)
    expect(db.calls.some(c => c.table.startsWith('rpc:'))).toBe(false)
  })

  it('lets an admin move a manifest someone else drafted', async () => {
    const db = script(undefined, [manifestRow({ created_by: USER }), manifestRow({ status: 'cancelled' })])
    allow(db.client, { role: 'admin', userId: OTHER_USER })
    expect((await move({ action: 'cancel' })).status).toBe(200)
  })

  it('passes on the database\'s refusal, written for a person, as a 409', async () => {
    const message = 'The ship date cannot be in the future.'
    const db = script(dbError('23514', message, 'hw_manifest'))
    allow(db.client)
    const res = await move({ action: 'ship', on: '2099-01-01' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: message })
  })

  it('answers 404 if the database says it is not there after all, and hides anything else it says', async () => {
    const gone = script(dbError('P0002', 'manifest not found'))
    allow(gone.client)
    expect((await move({ action: 'cancel' })).status).toBe(404)

    const broken = script(dbError('XX000', 'boom in hw_transition_shipment line 40'))
    allow(broken.client)
    const res = await move({ action: 'cancel' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('hw_transition_shipment')
  })
})

describe('GET /api/hazardous-waste/manifests/shippable-containers', () => {
  const closedContainer = (id: string, label: string, over: Record<string, unknown> = {}) => ({
    id, label, area_location: 'Dock 2', volume_quantity: 55, volume_unit: 'gallons', accumulation_started_at: '2026-02-01T00:00:00Z',
    facility_id: SITE, stream: { id: 's1', name: 'Spent solvent', waste_codes: ['D001', 'F003'] }, ...over,
  })

  it('passes a gate refusal straight through', async () => {
    gateMock.mockResolvedValue({ ok: false, status: 403, message: 'Not a member of this tenant' })
    expect((await shippableContainers(request('/x'))).status).toBe(403)
  })

  it('asks for closed, un-archived containers in the account and at the active site', async () => {
    const db = fakeSupabase({ hazardous_waste_containers: [withCount([closedContainer(CONTAINER_1, 'Drum A')], 1)] })
    allow(db.client)

    const body = await (await shippableContainers(request('/x'))).json()

    const call = db.calls[0]!
    expect(eqValue(call, 'tenant_id')).toBe(TENANT)
    expect(eqValue(call, 'status')).toBe('closed')
    expect(eqValue(call, 'facility_id')).toBe(SITE)
    expect(op(call, 'is')).toEqual(['archived_at', null])
    expect(body.total).toBe(1)
    expect(body.containers[0]).toMatchObject({ id: CONTAINER_1, label: 'Drum A', stream: { name: 'Spent solvent', waste_codes: ['D001', 'F003'] } })
  })

  it('does not filter by site in the roll-up view, and reads a stream the database returns as a one-element list', async () => {
    const db = fakeSupabase({ hazardous_waste_containers: [withCount([closedContainer(CONTAINER_1, 'Drum A', { stream: [{ id: 's1', name: 'Solvent', waste_codes: [] }] })], 1)] })
    allow(db.client, { facilityId: null })
    const body = await (await shippableContainers(request('/x'))).json()
    expect(db.calls[0]!.ops.some(o => o.method === 'eq' && o.args[0] === 'facility_id')).toBe(false)
    expect(body.containers[0].stream.name).toBe('Solvent')
  })

  it('hides a database error behind the sanitizer', async () => {
    const db = fakeSupabase({ hazardous_waste_containers: [dbError('42703', 'column hazardous_waste_containers.nope does not exist')] })
    allow(db.client)
    const res = await shippableContainers(request('/x'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('column')
  })
})
