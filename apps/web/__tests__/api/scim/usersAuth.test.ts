// SCIM is a machine-to-machine surface: the bearer token is the whole identity,
// and every query runs through supabaseAdmin(), which bypasses RLS. So the
// route's own checks ARE the access control — the same drift tenantGate warns
// about, applied to a credential that outlives any session.

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Result { data?: unknown; error?: unknown; count?: number }
const queues = new Map<string, Result[]>()
function queue(table: string, r: Result) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table)!.push(r)
}
/** Records the PostgREST filters a query actually applied. */
const applied: Array<{ table: string; method: string; arg: unknown }> = []

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const next = (): Promise<Result> =>
        Promise.resolve(queues.get(table)?.shift() ?? { data: null, error: null, count: 0 })
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     (col: string, val: unknown) => { applied.push({ table, method: 'eq', arg: `${col}=${String(val)}` }); return chain },
        or:     (expr: string) => { applied.push({ table, method: 'or', arg: expr }); return chain },
        order:  () => chain,
        range:  next,
        update: () => chain,
        insert: () => chain,
        maybeSingle: next,
        then: (f: (v: Result) => unknown) => next().then(f),
      }
      return chain
    },
  }),
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { GET } from '@/app/api/scim/v2/Users/route'
import { sha256HexString } from '@soteria/core/scim'

const TENANT = '00000000-0000-0000-0000-0000000000aa'
const TOKEN  = 'scim-token-value'

function scimRequest(url = 'https://x/api/scim/v2/Users', token: string | null = TOKEN) {
  const headers: Record<string, string> = {}
  if (token !== null) headers.authorization = `Bearer ${token}`
  return new Request(url, { headers }) as never
}

/** Queue the token lookup the route performs first. */
async function seedToken(opts: { revoked?: boolean; tenantDisabled?: boolean } = {}) {
  queue('scim_tokens', {
    data: {
      id: 'TOK-1',
      tenant_id: TENANT,
      revoked_at: opts.revoked ? '2026-01-01T00:00:00Z' : null,
      tenants: { disabled_at: opts.tenantDisabled ? '2026-01-01T00:00:00Z' : null },
    },
    error: null,
  })
  // token_hash is what the route looks the row up by.
  await sha256HexString(TOKEN)
}

beforeEach(() => { queues.clear(); applied.length = 0 })

describe('SCIM token authentication', () => {
  it('rejects a missing or malformed bearer token', async () => {
    for (const token of [null, '', '   ']) {
      const res = await GET(scimRequest('https://x/api/scim/v2/Users', token))
      expect(res.status, `token=${JSON.stringify(token)}`).toBe(401)
    }
  })

  it('rejects a revoked token', async () => {
    await seedToken({ revoked: true })
    const res = await GET(scimRequest())
    expect(res.status).toBe(401)
  })

  it('rejects a token whose tenant has been disabled', async () => {
    // Disabling is the offboarding lever: it removes the tenant from
    // current_user_tenant_ids() so RLS hides their data. SCIM never touches
    // RLS, and disabling deliberately retains the token rows for audit — so
    // without this check a suspended customer keeps full roster access.
    await seedToken({ tenantDisabled: true })
    const res = await GET(scimRequest())
    expect(res.status).toBe(401)
    // And nothing was read from the roster.
    expect(applied.some(a => a.table === 'loto_workers')).toBe(false)
  })

  it('serves a live token, scoped to its own tenant', async () => {
    await seedToken()
    queue('loto_workers', { data: [], error: null, count: 0 })
    const res = await GET(scimRequest())
    expect(res.status).toBe(200)
    // Every roster query must be pinned to the token's tenant.
    expect(applied.some(a => a.table === 'loto_workers' && a.arg === `tenant_id=${TENANT}`)).toBe(true)
  })
})

describe('SCIM userName filter', () => {
  it('never interpolates PostgREST metacharacters into the filter expression', async () => {
    // `.or()` appends its argument to the `or=` parameter verbatim, so a value
    // carrying filter grammar became an extra predicate over columns this
    // endpoint never projects — a blind oracle over free-text notes. Tenant
    // isolation held, but an email has no business containing a comma.
    const hostile = [
      'zz,notes.ilike.*settlement*',
      'a)or(employee_id.gt.',
      'x,active.is.true',
      'a"b',
      "a'b",
      'a\\b',
    ]
    for (const value of hostile) {
      queues.clear(); applied.length = 0
      await seedToken()
      queue('loto_workers', { data: [], error: null, count: 0 })

      const res = await GET(scimRequest(
        `https://x/api/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${value}"`)}`,
      ))
      expect(res.status, value).toBe(200)
      // Empty page, and crucially no `or=` carrying the hostile value.
      expect(await res.json(), value).toMatchObject({ totalResults: 0, Resources: [] })
      expect(applied.some(a => a.method === 'or'), `or() reached with ${value}`).toBe(false)
    }
  })

  it('still matches an ordinary address on email or employee id', async () => {
    await seedToken()
    queue('loto_workers', { data: [], error: null, count: 0 })
    await GET(scimRequest('https://x/api/scim/v2/Users?filter=' + encodeURIComponent('userName eq "jane@snakking.com"')))
    const or = applied.find(a => a.method === 'or')
    expect(or?.arg).toBe('email.eq.jane@snakking.com,employee_id.eq.jane@snakking.com')
  })

  it('routes externalId through an equality filter, never through or()', async () => {
    await seedToken()
    queue('loto_workers', { data: [], error: null, count: 0 })
    await GET(scimRequest('https://x/api/scim/v2/Users?filter=' + encodeURIComponent('externalId eq "a,b)c"')))
    expect(applied.some(a => a.method === 'or')).toBe(false)
    expect(applied.some(a => a.arg === 'scim_external_id=a,b)c')).toBe(true)
  })
})
