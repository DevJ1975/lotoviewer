import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// LMS delivery: the URL and credential rules an admin's endpoint must pass,
// how an LRS answer is classified (retry vs stop), and that one tick sends
// each tenant's due statements to that tenant's LRS only.

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns', () => {
  const promises = { lookup }
  return { promises, default: { promises } }
})

import {
  MAX_TRIES,
  flushStrikeXapiOutbox,
  lrsEndpointProblem,
  postStatements,
  retryDelayMs,
  statementsUrl,
  testLrsConnection,
} from '@/lib/strike/lrs'

const PUBLIC = [{ address: '93.184.216.34', family: 4 }]
const creds = { endpoint: 'https://lrs.example.com/xapi/', auth_username: 'key', auth_password: 'secret' }

beforeEach(() => {
  lookup.mockReset()
  lookup.mockResolvedValue(PUBLIC)
})

function respond(status: number, body = '') {
  return vi.fn<typeof fetch>(async () => new Response(body || null, { status }))
}

describe('statementsUrl', () => {
  it('appends the statements resource to the xAPI base, with or without a trailing slash', () => {
    expect(statementsUrl('https://lrs.example.com/xapi/').href).toBe('https://lrs.example.com/xapi/statements')
    expect(statementsUrl('https://lrs.example.com/data/xAPI').href).toBe('https://lrs.example.com/data/xAPI/statements')
  })

  it('accepts the statements URL pasted as-is', () => {
    expect(statementsUrl('https://lrs.example.com/xapi/statements').href).toBe('https://lrs.example.com/xapi/statements')
  })
})

describe('retryDelayMs', () => {
  it('doubles per try and caps at one day', () => {
    expect(retryDelayMs(1)).toBe(2 * 60_000)
    expect(retryDelayMs(3)).toBe(8 * 60_000)
    expect(retryDelayMs(20)).toBe(24 * 60 * 60_000)
  })
})

describe('lrsEndpointProblem', () => {
  it('accepts a public https endpoint', async () => {
    expect(await lrsEndpointProblem('https://lrs.example.com/xapi/')).toBeNull()
  })

  it('refuses plain http, credentials in the URL, and garbage', async () => {
    expect(await lrsEndpointProblem('http://lrs.example.com/xapi/')).toMatch(/https/)
    expect(await lrsEndpointProblem('https://key:secret@lrs.example.com/xapi/')).toMatch(/own fields/)
    expect(await lrsEndpointProblem('lrs.example.com')).toMatch(/full endpoint URL/)
  })

  it('refuses a host that resolves into a private network (SSRF)', async () => {
    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    expect(await lrsEndpointProblem('https://metadata.attacker.example/xapi/')).toMatch(/public address/)
  })
})

describe('postStatements', () => {
  it('posts a JSON array with xAPI version and Basic auth headers, never following redirects', async () => {
    const fetchImpl = respond(200, '["id-1"]')
    expect(await postStatements(creds, [{ id: 'id-1' }], fetchImpl)).toEqual({ ok: true, status: 200 })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe('https://lrs.example.com/xapi/statements')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('manual')
    expect(init?.body).toBe('[{"id":"id-1"}]')
    const headers = init?.headers as Record<string, string>
    expect(headers['x-experience-api-version']).toBe('1.0.3')
    expect(headers.authorization).toBe(`Basic ${Buffer.from('key:secret').toString('base64')}`)
  })

  it('retries server errors and rate limits but not a refusal', async () => {
    expect(await postStatements(creds, [], respond(503))).toMatchObject({ ok: false, retry: true })
    expect(await postStatements(creds, [], respond(429))).toMatchObject({ ok: false, retry: true })
    expect(await postStatements(creds, [], respond(400, 'bad statement'))).toEqual({ ok: false, retry: false, error: 'The LRS answered 400: bad statement', status: 400 })
  })

  it('retries a network failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('ECONNRESET') })
    expect(await postStatements(creds, [], fetchImpl)).toEqual({ ok: false, retry: true, error: 'ECONNRESET' })
  })

  // A resolver outage is not a verdict on the endpoint: retrying it is how
  // the statements still arrive once DNS is back.
  it('retries when the host cannot be looked up at all, without sending', async () => {
    lookup.mockRejectedValue(Object.assign(new Error('queryA EAI_AGAIN lrs.example.com'), { code: 'EAI_AGAIN' }))
    const fetchImpl = respond(200)
    expect(await postStatements(creds, [{ id: 'id-1' }], fetchImpl)).toMatchObject({ ok: false, retry: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never sends when the host has started resolving privately since it was saved', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    const fetchImpl = respond(200)
    expect(await postStatements(creds, [], fetchImpl)).toMatchObject({ ok: false, retry: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('testLrsConnection', () => {
  it('treats a write-only key (403 on read) as connected', async () => {
    expect(await testLrsConnection(creds, respond(403))).toEqual({ ok: true, message: expect.stringContaining('write-only') })
  })

  it('reports rejected credentials plainly', async () => {
    expect(await testLrsConnection(creds, respond(401))).toEqual({ ok: false, message: 'The LRS rejected the key or secret.' })
  })
})

// ── flush ────────────────────────────────────────────────────────────────

interface Call { table: string; op: string; payload?: unknown; filters: [string, unknown][] }

function fakeAdmin(results: Record<string, unknown[]>) {
  const calls: Call[] = []
  const admin = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (payload: unknown) => { call.op = 'update'; call.payload = payload; return chain },
        delete: () => { call.op = 'delete'; return chain },
        then: (resolve: (v: unknown) => unknown) => {
          calls.push(call)
          const data = call.op === 'select' ? (results[table]?.shift() ?? []) : null
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      for (const m of ['eq', 'in', 'is', 'lt', 'lte', 'order', 'limit']) {
        chain[m] = (...args: unknown[]) => { call.filters.push([m, args]); return chain }
      }
      return chain
    },
  }
  return { admin: admin as unknown as SupabaseClient, calls }
}

describe('flushStrikeXapiOutbox', () => {
  const now = new Date('2026-10-20T12:00:00Z')

  const endpointFor = (tenant: string) => ({ tenant_id: tenant, endpoint: `https://${tenant.toLowerCase()}.example.com/xapi/`, auth_username: tenant, auth_password: 'x' })
  const row = (id: string, tenant: string, tries = 0) => ({ id, tenant_id: tenant, statement: { id }, tries })

  it("sends each tenant's statements to its own LRS, marks sent rows, and backs off failures", async () => {
    const { admin, calls } = fakeAdmin({
      strike_lrs_endpoints: [[endpointFor('A'), endpointFor('B')]],
      strike_xapi_statements: [[row('a1', 'A')], [row('b1', 'B', 2)]],
    })
    const fetchImpl = vi.fn<typeof fetch>(async url => new Response(null, { status: String(url).includes('a.example.com') ? 200 : 503 }))

    expect(await flushStrikeXapiOutbox(admin, now, fetchImpl)).toEqual({ tenants: 2, sent: 1, failed: 1 })

    expect(calls.find(c => c.table === 'strike_lrs_endpoints')?.filters).toContainEqual(['eq', ['enabled', true]])
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).host)).toEqual(['a.example.com', 'b.example.com'])
    const updates = calls.filter(c => c.op === 'update' && c.table === 'strike_xapi_statements')
    expect(updates[0]).toMatchObject({ payload: { sent_at: now.toISOString(), last_error: null }, filters: [['in', ['id', ['a1']]]] })
    expect(updates[1]).toMatchObject({
      payload: { tries: 3, last_error: 'The LRS answered 503', next_try_at: new Date(now.getTime() + retryDelayMs(3)).toISOString() },
      filters: [['in', ['id', ['b1']]]],
    })
    expect(calls.some(c => c.op === 'delete' && c.table === 'strike_xapi_statements')).toBe(true)
  })

  // A tenant whose endpoint is off can pile up rows that never send. A
  // shared "oldest 1000 due" scan then returned only those rows, every tick.
  it("scans each enabled tenant's own rows, so one stuck tenant can't starve the rest", async () => {
    const { admin, calls } = fakeAdmin({
      strike_lrs_endpoints: [[endpointFor('A')]],
      strike_xapi_statements: [[row('a1', 'A')]],
    })
    expect(await flushStrikeXapiOutbox(admin, now, respond(200))).toEqual({ tenants: 1, sent: 1, failed: 0 })
    const scan = calls.find(c => c.table === 'strike_xapi_statements' && c.op === 'select')
    expect(scan?.filters).toContainEqual(['eq', ['tenant_id', 'A']])
  })

  it('stops retrying a batch the LRS refuses outright', async () => {
    const { admin, calls } = fakeAdmin({
      strike_lrs_endpoints: [[endpointFor('A')]],
      strike_xapi_statements: [[row('a1', 'A')]],
    })
    await flushStrikeXapiOutbox(admin, now, respond(401))
    const update = calls.find(c => c.op === 'update' && c.table === 'strike_xapi_statements')
    expect(update?.payload).toMatchObject({ tries: MAX_TRIES })
  })

  it('isolates the one statement an LRS rejects and still delivers the others', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`a${i}`, 'A'))
    const { admin, calls } = fakeAdmin({ strike_lrs_endpoints: [[endpointFor('A')]], strike_xapi_statements: [rows] })
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const ids = (JSON.parse(String(init?.body)) as { id: string }[]).map(s => s.id)
      return new Response(null, { status: ids.includes('a5') ? 400 : 200 })
    })

    expect(await flushStrikeXapiOutbox(admin, now, fetchImpl)).toEqual({ tenants: 1, sent: 7, failed: 1 })
    const updates = calls.filter(c => c.op === 'update' && c.table === 'strike_xapi_statements')
    const sent = updates.filter(u => (u.payload as { sent_at?: string }).sent_at).flatMap(u => (u.filters[0][1] as unknown[])[1] as string[])
    expect(sent.sort()).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a6', 'a7'])
    const failed = updates.find(u => (u.payload as { tries?: number }).tries === MAX_TRIES)
    expect(failed?.filters).toEqual([['in', ['id', ['a5']]]])
  })
})
