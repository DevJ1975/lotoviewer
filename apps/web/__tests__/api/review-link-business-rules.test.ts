import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as createReviewLinks } from '@/app/api/admin/review-links/route'
import { POST as publicReviewAction } from '@/app/api/review/[token]/route'

const {
  authGetUser,
  captured,
  emailSend,
  queues,
  resetMockState,
  storageBucket,
  tableProxy,
} = vi.hoisted(() => {
  type ChainResult = {
    data?: unknown
    error?: { message: string; code?: string } | null
    count?: number
  }

  const queues = new Map<string, ChainResult[]>()
  const captured = {
    inserts: [] as Array<{ table: string; payload: unknown }>,
    updates: [] as Array<{ table: string; payload: unknown }>,
    deletes: [] as Array<{ table: string }>,
    filters: [] as Array<{ table: string; method: string; args: unknown[] }>,
    rpcCalls: [] as Array<{ name: string; args?: unknown }>,
  }

  const storageBucket = {
    upload: vi.fn(),
    getPublicUrl: vi.fn(),
    remove: vi.fn(),
  }
  const authGetUser = vi.fn()
  const emailSend = vi.fn()

  function next(table: string): ChainResult {
    return queues.get(table)?.shift() ?? { data: null, error: null }
  }

  function tableProxy(table: string) {
    const chain: Record<string, unknown> = {
      select: (...args: unknown[]) => {
        captured.filters.push({ table, method: 'select', args })
        return chain
      },
      eq: (...args: unknown[]) => {
        captured.filters.push({ table, method: 'eq', args })
        return chain
      },
      is: (...args: unknown[]) => {
        captured.filters.push({ table, method: 'is', args })
        return chain
      },
      in: (...args: unknown[]) => {
        captured.filters.push({ table, method: 'in', args })
        return chain
      },
      order: (...args: unknown[]) => {
        captured.filters.push({ table, method: 'order', args })
        return chain
      },
      maybeSingle: () => Promise.resolve(next(table)),
      single: () => Promise.resolve(next(table)),
      insert: (payload: unknown) => {
        captured.inserts.push({ table, payload })
        return chain
      },
      update: (payload: unknown) => {
        captured.updates.push({ table, payload })
        return chain
      },
      delete: () => {
        captured.deletes.push({ table })
        return chain
      },
      then: (onFulfilled: (value: ChainResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(next(table)).then(onFulfilled, onRejected),
    }
    return chain
  }

  function resetMockState() {
    queues.clear()
    captured.inserts.length = 0
    captured.updates.length = 0
    captured.deletes.length = 0
    captured.filters.length = 0
    captured.rpcCalls.length = 0
    storageBucket.upload.mockReset()
    storageBucket.getPublicUrl.mockReset()
    storageBucket.remove.mockReset()
    authGetUser.mockReset()
    emailSend.mockReset()
  }

  return {
    authGetUser,
    captured,
    emailSend,
    queues,
    resetMockState,
    storageBucket,
    tableProxy,
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: authGetUser,
    },
  }),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => tableProxy(table),
    rpc: (name: string, args?: unknown) => {
      captured.rpcCalls.push({ name, args })
      return Promise.resolve(queues.get(`rpc:${name}`)?.shift() ?? { data: null, error: null })
    },
    storage: {
      from: () => storageBucket,
    },
  }),
}))

vi.mock('@/lib/email/sendReviewLink', () => ({
  sendReviewLinkEmail: emailSend,
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

const VALID_TOKEN = '0123456789abcdef0123456789abcdef'
const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const LINK_ID = '22222222-2222-2222-2222-222222222222'

function queue(table: string, ...results: Array<{ data?: unknown; error?: { message: string; code?: string } | null }>) {
  queues.set(table, [...(queues.get(table) ?? []), ...results])
}

function ctx(token = VALID_TOKEN) {
  return { params: Promise.resolve({ token }) }
}

function jsonRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/review', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      'x-active-tenant': TENANT_ID,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('LOTO review-link business rules', () => {
  beforeEach(() => {
    resetMockState()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPERADMIN_EMAILS = 'admin@example.com'
    authGetUser.mockResolvedValue({
      data: { user: { id: 'admin-user', email: 'admin@example.com' } },
      error: null,
    })
  })

  it('snapshots every ready equipment row when an admin creates a review link', async () => {
    queue('profiles', { data: { is_superadmin: true }, error: null })
    queue('tenants', { data: { name: 'Acme Foods' }, error: null })
    queue('loto_equipment', {
      data: [
        { equipment_id: 'EQ-001', description: 'Mixer', department: 'Packaging', photo_status: 'complete', placard_url: 'https://cdn/eq-001.pdf' },
        { equipment_id: 'EQ-002', description: 'Conveyor', department: 'Packaging', photo_status: 'complete', placard_url: 'https://cdn/eq-002.pdf' },
      ],
      error: null,
    })
    queue('loto_review_links', {
      data: [{
        id: LINK_ID,
        token: VALID_TOKEN,
        expires_at: '2026-06-01T00:00:00.000Z',
        department: 'Packaging',
        reviewer_name: 'Client Reviewer',
        reviewer_email: 'client@example.com',
        admin_message: null,
        email_channel: 'manual',
        created_at: '2026-05-13T00:00:00.000Z',
      }],
      error: null,
    })
    queue('loto_review_link_equipment', { data: null, error: null })

    const response = await createReviewLinks(jsonRequest({
      department: 'Packaging',
      reviewers: [{ name: 'Client Reviewer', email: 'client@example.com' }],
      skip_email: true,
    }, { origin: 'https://app.example.com' }))

    expect(response.status).toBe(201)
    const snapshotInsert = captured.inserts.find(call => call.table === 'loto_review_link_equipment')
    expect(snapshotInsert?.payload).toEqual([
      {
        review_link_id: LINK_ID,
        tenant_id: TENANT_ID,
        equipment_id: 'EQ-001',
        equipment_description: 'Mixer',
        department: 'Packaging',
        sort_order: 0,
      },
      {
        review_link_id: LINK_ID,
        tenant_id: TENANT_ID,
        equipment_id: 'EQ-002',
        equipment_description: 'Conveyor',
        department: 'Packaging',
        sort_order: 1,
      },
    ])
  })

  it('creates a review link even when equipment photos or placards are incomplete', async () => {
    queue('profiles', { data: { is_superadmin: true }, error: null })
    queue('tenants', { data: { name: 'Acme Foods' }, error: null })
    queue('loto_equipment', {
      data: [
        { equipment_id: 'EQ-001', description: 'Mixer', department: 'Packaging', photo_status: 'partial', placard_url: null },
      ],
      error: null,
    })
    queue('loto_review_links', {
      data: [{
        id: LINK_ID,
        token: VALID_TOKEN,
        expires_at: '2026-06-01T00:00:00.000Z',
        department: 'Packaging',
        reviewer_name: 'Client Reviewer',
        reviewer_email: 'client@example.com',
        admin_message: null,
        email_channel: 'manual',
        created_at: '2026-05-13T00:00:00.000Z',
      }],
      error: null,
    })
    queue('loto_review_link_equipment', { data: null, error: null })

    const response = await createReviewLinks(jsonRequest({
      department: 'Packaging',
      reviewers: [{ name: 'Client Reviewer', email: 'client@example.com' }],
      skip_email: true,
    }))

    expect(response.status).toBe(201)
    expect(captured.inserts.some(call => call.table === 'loto_review_links')).toBe(true)
    const snapshotInsert = captured.inserts.find(call => call.table === 'loto_review_link_equipment')
    expect(snapshotInsert?.payload).toEqual([
      {
        review_link_id: LINK_ID,
        tenant_id: TENANT_ID,
        equipment_id: 'EQ-001',
        equipment_description: 'Mixer',
        department: 'Packaging',
        sort_order: 0,
      },
    ])
  })

  it('saves public placard notes through the serialized review RPC', async () => {
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        tenant_id: TENANT_ID,
        department: 'Packaging',
        expires_at: '2099-01-01T00:00:00.000Z',
        revoked_at: null,
        first_viewed_at: null,
        signed_off_at: null,
      },
      error: null,
    })
    queue('rpc:upsert_loto_placard_review', { data: null, error: null })

    const response = await publicReviewAction(jsonRequest({
      action: 'submit-note',
      equipment_id: 'EQ-001',
      status: 'approved',
      notes: 'Looks correct.',
    }), ctx())

    expect(response.status).toBe(200)
    expect(captured.rpcCalls).toContainEqual({
      name: 'upsert_loto_placard_review',
      args: {
        p_review_link_id: LINK_ID,
        p_equipment_id: 'EQ-001',
        p_status: 'approved',
        p_notes: 'Looks correct.',
      },
    })
  })

  it('cleans up an uploaded replacement photo when the database RPC rejects it', async () => {
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        tenant_id: TENANT_ID,
        department: 'Packaging',
        expires_at: '2099-01-01T00:00:00.000Z',
        revoked_at: null,
        first_viewed_at: null,
        signed_off_at: null,
      },
      error: null,
    })
    queue('rpc:apply_loto_review_photo_replacement', {
      data: null,
      error: { message: 'equipment not in this review batch' },
    })
    storageBucket.upload.mockResolvedValue({ error: null })
    storageBucket.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/photo.jpg' } })
    storageBucket.remove.mockResolvedValue({ data: [], error: null })

    const form = new FormData()
    form.set('action', 'replace-photo')
    form.set('equipment_id', 'EQ-404')
    form.set('slot', 'EQUIP')
    form.set('reviewer_name', 'Floor supervisor')
    form.set('photo', new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], 'photo.jpg', { type: 'image/jpeg' }))

    const response = await publicReviewAction(new Request('http://localhost/api/review', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10', 'user-agent': 'vitest' },
      body: form,
    }), ctx())

    expect(response.status).toBe(400)
    expect(storageBucket.remove).toHaveBeenCalledTimes(1)
    expect(captured.rpcCalls[0]).toMatchObject({
      name: 'apply_loto_review_photo_replacement',
      args: {
        p_review_link_id: LINK_ID,
        p_equipment_id: 'EQ-404',
        p_slot: 'EQUIP',
        p_new_photo_url: 'https://cdn.example.com/photo.jpg',
        p_ip: '203.0.113.10',
        p_user_agent: 'vitest',
      },
    })
  })

  // ─── mark-for-review (Phase: supervisor review flow) ─────────────────────

  it('mark-for-review flags the equipment after confirming tenant match', async () => {
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        tenant_id: TENANT_ID,
        department: null,
        is_public: true,
        expires_at: '2099-01-01T00:00:00.000Z',
        revoked_at: null,
        first_viewed_at: '2026-05-19T00:00:00.000Z',
        signed_off_at: null,
      },
      error: null,
    })
    // Equipment tenant-match lookup
    queue('loto_equipment', { data: { equipment_id: 'EQ-101' }, error: null })
    // Update result (the chain ends with no .select() so a single null return is fine)
    queue('loto_equipment', { data: null, error: null })

    const response = await publicReviewAction(jsonRequest({
      action:        'mark-for-review',
      equipment_id:  'EQ-101',
      reviewer_name: 'Sam Supervisor',
    }), ctx())

    expect(response.status).toBe(200)
    const updates = captured.updates.filter(u => u.table === 'loto_equipment')
    expect(updates.length).toBeGreaterThan(0)
    expect(updates[0]?.payload).toMatchObject({
      flagged_for_review_by:   'Sam Supervisor',
      flagged_for_review_via:  'public-link',
    })
    expect((updates[0]?.payload as Record<string, unknown>)?.flagged_for_review_at).toBeTruthy()
  })

  it('mark-for-review 404s when the equipment is not in the link tenant', async () => {
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        tenant_id: TENANT_ID,
        department: null,
        is_public: true,
        expires_at: '2099-01-01T00:00:00.000Z',
        revoked_at: null,
        first_viewed_at: '2026-05-19T00:00:00.000Z',
        signed_off_at: null,
      },
      error: null,
    })
    queue('loto_equipment', { data: null, error: null })

    const response = await publicReviewAction(jsonRequest({
      action:        'mark-for-review',
      equipment_id:  'EQ-OTHER-TENANT',
      reviewer_name: 'Sam Supervisor',
    }), ctx())

    expect(response.status).toBe(404)
    // No update should fire when the tenant-match check fails.
    const updates = captured.updates.filter(u => u.table === 'loto_equipment')
    expect(updates.length).toBe(0)
  })

  it('mark-for-review requires reviewer_name', async () => {
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        tenant_id: TENANT_ID,
        department: null,
        is_public: true,
        expires_at: '2099-01-01T00:00:00.000Z',
        revoked_at: null,
        first_viewed_at: '2026-05-19T00:00:00.000Z',
        signed_off_at: null,
      },
      error: null,
    })

    const response = await publicReviewAction(jsonRequest({
      action:        'mark-for-review',
      equipment_id:  'EQ-101',
    }), ctx())

    expect(response.status).toBe(400)
  })

  // ─── Public link mint (is_public: true) ──────────────────────────────────

  it('public mint creates a new tenant-wide link when none active', async () => {
    queue('profiles', { data: { is_superadmin: true }, error: null })
    // get-or-create check: no existing public link
    queue('loto_review_links', { data: null, error: null })
    // insert returning the new row
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        token: VALID_TOKEN,
        expires_at: '2099-01-01T00:00:00.000Z',
        extension_count: 0,
        last_extended_at: null,
        created_at: '2026-05-19T00:00:00.000Z',
      },
      error: null,
    })

    const response = await createReviewLinks(new Request('http://localhost/api/admin/review-links', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        'x-active-tenant': TENANT_ID,
      },
      body: JSON.stringify({ is_public: true }),
    }))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.created).toBe(true)
    expect(body.link.token).toBe(VALID_TOKEN)
    expect(body.link.review_url).toContain(`/review/${VALID_TOKEN}`)
  })

  it('public mint returns the existing link when one is already active', async () => {
    queue('profiles', { data: { is_superadmin: true }, error: null })
    queue('loto_review_links', {
      data: {
        id: LINK_ID,
        token: VALID_TOKEN,
        expires_at: '2099-01-01T00:00:00.000Z',
        extension_count: 0,
        last_extended_at: null,
        created_at: '2026-05-19T00:00:00.000Z',
      },
      error: null,
    })

    const response = await createReviewLinks(new Request('http://localhost/api/admin/review-links', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        'x-active-tenant': TENANT_ID,
      },
      body: JSON.stringify({ is_public: true }),
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.created).toBe(false)
    expect(body.link.id).toBe(LINK_ID)
  })
})
