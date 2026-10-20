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
    expect(await postStatements(creds, [], respond(400, 'bad statement'))).toEqual({ ok: false, retry: false, error: 'The LRS answered 400: bad statement' })
  })

  it('retries a network failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('ECONNRESET') })
    expect(await postStatements(creds, [], fetchImpl)).toEqual({ ok: false, retry: true, error: 'ECONNRESET' })
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

  it("sends each tenant's statements to its own LRS, marks sent rows, and backs off failures", async () => {
    const { admin, calls } = fakeAdmin({
      strike_xapi_statements: [[
        { id: 'a1', tenant_id: 'A', statement: { id: 'a1' }, tries: 0 },
        { id: 'b1', tenant_id: 'B', statement: { id: 'b1' }, tries: 2 },
        { id: 'c1', tenant_id: 'C', statement: { id: 'c1' }, tries: 0 },
      ]],
      strike_lrs_endpoints: [[
        { tenant_id: 'A', endpoint: 'https://a.example.com/xapi/', auth_username: 'a', auth_password: 'x', enabled: true },
        { tenant_id: 'B', endpoint: 'https://b.example.com/xapi/', auth_username: 'b', auth_password: 'y', enabled: true },
        { tenant_id: 'C', endpoint: 'https://c.example.com/xapi/', auth_username: 'c', auth_password: 'z', enabled: false },
      ]],
    })
    const fetchImpl = vi.fn<typeof fetch>(async url => new Response(null, { status: String(url).includes('a.example.com') ? 200 : 503 }))

    expect(await flushStrikeXapiOutbox(admin, now, fetchImpl)).toEqual({ tenants: 2, sent: 1, failed: 1 })

    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).host)).toEqual(['a.example.com', 'b.example.com'])
    const updates = calls.filter(c => c.op === 'update' && c.table === 'strike_xapi_statements')
    expect(updates[0]).toMatchObject({ payload: { sent_at: now.toISOString(), last_error: null }, filters: [['in', ['id', ['a1']]]] })
    expect(updates[1]).toMatchObject({
      payload: { tries: 3, last_error: 'The LRS answered 503', next_try_at: new Date(now.getTime() + retryDelayMs(3)).toISOString() },
      filters: [['in', ['id', ['b1']]]],
    })
    expect(calls.some(c => c.op === 'delete' && c.table === 'strike_xapi_statements')).toBe(true)
  })

  it('stops retrying a batch the LRS refuses outright', async () => {
    const { admin, calls } = fakeAdmin({
      strike_xapi_statements: [[{ id: 'a1', tenant_id: 'A', statement: {}, tries: 0 }]],
      strike_lrs_endpoints: [[{ tenant_id: 'A', endpoint: 'https://a.example.com/xapi/', auth_username: 'a', auth_password: 'x', enabled: true }]],
    })
    await flushStrikeXapiOutbox(admin, now, respond(401))
    const update = calls.find(c => c.op === 'update' && c.table === 'strike_xapi_statements')
    expect(update?.payload).toMatchObject({ tries: MAX_TRIES })
  })
})
