// Exhaustive authorization matrices for the two server-side auth gates.
//
// Both gates stand in front of routes that then query with the RLS-bypassing
// service-role client, so for those routes the gate IS the access control.
// That makes the interesting question not "does the happy path work" but
// "is there ANY combination of session, membership and tenant state that
// reaches ok:true when it should not". These matrices enumerate the full
// cross-product of the state each gate branches on and assert that.
//
// Companion to authEdgeCases.matrix.test.ts, which covers the pure functions.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getUserMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (t: string) => getUserMock(t) } }),
}))

interface Result { data?: unknown; error?: unknown }
const queues = new Map<string, Result[]>()
function queue(table: string, r: Result) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table)!.push(r)
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const next = (): Promise<Result> =>
        Promise.resolve(queues.get(table)?.shift() ?? { data: null, error: null })
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        maybeSingle: next,
        then: (f: (v: Result) => unknown) => next().then(f),
      }
      return chain
    },
  }),
}))

import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { requireSuperadmin } from '@/lib/auth/superadmin'

const TENANT = '00000000-0000-0000-0000-0000000000aa'
const USER   = 'user-1'
const EMAIL  = 'user@example.com'

let EXECUTED_CASES = 0
const countCase = () => { EXECUTED_CASES += 1 }

function cross<T extends readonly unknown[][]>(...lists: T): unknown[][] {
  return lists.reduce<unknown[][]>(
    (acc, list) => acc.flatMap(row => list.map(v => [...row, v])),
    [[]],
  )
}

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  queues.clear()
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: USER, email: EMAIL } }, error: null })
  process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://project.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPERADMIN_EMAILS             = ''
})
afterEach(() => { process.env = { ...ORIG_ENV } })

// ───────────────────────────────────────────────────────────────────────────
// 1. Tenant gate — authorization matrix.
// ───────────────────────────────────────────────────────────────────────────

const SUPERADMIN_MODES = ['notFlagged', 'flaggedAndAllowlisted', 'flaggedNotAllowlisted'] as const
const MEMBERSHIP_MODES = ['none', 'lookupError', 'owner', 'admin', 'member', 'viewer'] as const
const CANCELLED_MODES  = [false, true] as const
const DISABLED_MODES   = [false, true] as const
const REQUIRED_ROLES   = ['member', 'admin'] as const

function gateRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://x/api/thing', {
    method: 'GET',
    headers: { authorization: 'Bearer tok', 'x-active-tenant': TENANT, ...headers },
  })
}

describe('tenantGate — authorization matrix', () => {
  it('reaches ok:true only for a live, un-revoked membership of an enabled tenant', async () => {
    const violations: string[] = []

    for (const [superMode, membership, cancelled, disabled, required] of cross(
      SUPERADMIN_MODES, MEMBERSHIP_MODES, CANCELLED_MODES, DISABLED_MODES, REQUIRED_ROLES,
    ) as Array<[typeof SUPERADMIN_MODES[number], typeof MEMBERSHIP_MODES[number], boolean, boolean, typeof REQUIRED_ROLES[number]]>) {
      countCase()
      queues.clear()

      const isSuperadmin = superMode === 'flaggedAndAllowlisted'
      process.env.SUPERADMIN_EMAILS = superMode === 'flaggedAndAllowlisted' ? EMAIL : 'someone-else@example.com'
      queue('profiles', { data: { is_superadmin: superMode !== 'notFlagged' }, error: null })

      if (membership === 'none') {
        queue('tenant_memberships', { data: null, error: null })
      } else if (membership === 'lookupError') {
        queue('tenant_memberships', { data: null, error: { message: 'connection reset' } })
      } else {
        queue('tenant_memberships', {
          data: {
            role: membership,
            invite_cancelled_at: cancelled ? '2026-01-01T00:00:00Z' : null,
            tenants: { disabled_at: disabled ? '2026-01-01T00:00:00Z' : null },
          },
          error: null,
        })
      }

      const gate = required === 'admin'
        ? await requireTenantAdmin(gateRequest())
        : await requireTenantMember(gateRequest())

      const id = `super=${superMode} membership=${membership} cancelled=${cancelled} disabled=${disabled} require=${required}`

      // The documented superadmin shortcut: both signals present, and it
      // bypasses the membership lookup entirely.
      if (isSuperadmin) {
        if (!gate.ok) violations.push(`${id}: superadmin denied (${gate.status} ${gate.message})`)
        else if (gate.role !== 'superadmin') violations.push(`${id}: superadmin got role ${gate.role}`)
        continue
      }

      // Everyone else: each of these states must deny, and the status has to
      // distinguish "you may not" from "we could not tell".
      const mustDeny =
        membership === 'none' || membership === 'lookupError' || cancelled || disabled ||
        (required === 'admin' && !['owner', 'admin'].includes(membership))

      if (mustDeny && gate.ok) {
        violations.push(`${id}: GRANTED — reached ok:true as role ${gate.role}`)
        continue
      }
      if (!mustDeny && !gate.ok) {
        violations.push(`${id}: denied a legitimate member (${gate.status} ${gate.message})`)
        continue
      }
      if (!gate.ok) {
        // A transient lookup fault must be a retryable 500, never a 403 that
        // reads to the caller as a permanent denial.
        const expectedStatus = membership === 'lookupError' ? 500 : 403
        if (gate.status !== expectedStatus) {
          violations.push(`${id}: status ${gate.status}, expected ${expectedStatus}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('never leaks an authenticated client for a revoked or disabled membership', async () => {
    const violations: string[] = []
    for (const [cancelled, disabled, role] of cross(
      [false, true], [false, true], ['owner', 'admin', 'member', 'viewer'],
    ) as Array<[boolean, boolean, string]>) {
      countCase()
      queues.clear()
      queue('profiles', { data: { is_superadmin: false }, error: null })
      queue('tenant_memberships', {
        data: {
          role,
          invite_cancelled_at: cancelled ? '2026-01-01T00:00:00Z' : null,
          tenants: { disabled_at: disabled ? '2026-01-01T00:00:00Z' : null },
        },
        error: null,
      })

      const gate = await requireTenantMember(gateRequest())
      // authedClient is the RLS-scoped handle a route would query with, so it
      // must not exist at all on a denial.
      if ((cancelled || disabled) && 'authedClient' in gate) {
        violations.push(`cancelled=${cancelled} disabled=${disabled} role=${role}: handed back an authedClient`)
      }
    }
    expect(violations).toEqual([])
  })

  it('accepts the PostgREST embedded tenant row as either an object or a single-element array', async () => {
    // PostgREST returns an embedded to-one either way depending on how it
    // infers the relationship; a gate that understood only one shape would
    // stop seeing disabled_at the day the inference flipped.
    for (const [shape, disabled] of cross(['object', 'array'], [false, true]) as Array<[string, boolean]>) {
      countCase()
      queues.clear()
      const tenants = shape === 'array'
        ? [{ disabled_at: disabled ? '2026-01-01T00:00:00Z' : null }]
        : { disabled_at: disabled ? '2026-01-01T00:00:00Z' : null }
      queue('profiles', { data: { is_superadmin: false }, error: null })
      queue('tenant_memberships', { data: { role: 'admin', invite_cancelled_at: null, tenants }, error: null })

      const gate = await requireTenantMember(gateRequest())
      expect(gate.ok, `${shape} shape, disabled=${disabled}`).toBe(!disabled)
    }
  })
})

describe('tenantGate — session and header matrix', () => {
  const AUTH_HEADERS: Array<[string, string | null]> = [
    ['absent', null], ['valid', 'Bearer tok'], ['lowercaseScheme', 'bearer tok'],
    ['schemeOnly', 'Bearer'], ['schemeNoSpace', 'Bearertok'], ['wrongScheme', 'Basic abc'],
    ['empty', ''], ['emptyToken', 'Bearer '],
  ]
  const SESSIONS: Array<[string, unknown]> = [
    ['ok',        { data: { user: { id: USER, email: EMAIL } }, error: null }],
    ['error',     { data: { user: null }, error: { message: 'jwt expired' } }],
    ['nullUser',  { data: { user: null }, error: null }],
  ]
  const TENANT_HEADERS: Array<[string, string | null]> = [
    ['valid', TENANT], ['absent', null], ['malformed', 'not-a-uuid'],
    ['uppercase', TENANT.toUpperCase()], ['padded', `  ${TENANT}  `], ['empty', ''],
  ]

  it('rejects every unusable session or tenant header before touching the database', async () => {
    const violations: string[] = []

    for (const [[authLabel, authValue], [sessionLabel, sessionResult], [tenantLabel, tenantValue]] of cross(
      AUTH_HEADERS, SESSIONS, TENANT_HEADERS,
    ) as Array<[[string, string | null], [string, unknown], [string, string | null]]>) {
      countCase()
      queues.clear()
      getUserMock.mockResolvedValue(sessionResult)
      process.env.SUPERADMIN_EMAILS = ''
      queue('profiles', { data: { is_superadmin: false }, error: null })
      queue('tenant_memberships', {
        data: { role: 'admin', invite_cancelled_at: null, tenants: { disabled_at: null } },
        error: null,
      })

      const headers: Record<string, string> = {}
      if (authValue   !== null) headers.authorization     = authValue
      if (tenantValue !== null) headers['x-active-tenant'] = tenantValue
      const req = new Request('https://x/api/thing', { method: 'GET', headers })

      const gate = await requireTenantMember(req)
      const id = `auth=${authLabel} session=${sessionLabel} tenant=${tenantLabel}`

      // A bearer token that is absent or malformed is a 401 — checked before
      // anything else, so the session result cannot matter. Read the header
      // back off the Request rather than trusting the literal above: the
      // Headers constructor strips surrounding whitespace, so 'Bearer ' is
      // delivered to the gate as 'Bearer'.
      const deliveredAuth = req.headers.get('authorization')
      const badAuth = deliveredAuth === null || !deliveredAuth.startsWith('Bearer ')
      const badSession = sessionLabel !== 'ok'
      const badTenant = tenantLabel === 'absent' || tenantLabel === 'malformed' || tenantLabel === 'empty'

      if (badAuth || badSession) {
        if (gate.ok) { violations.push(`${id}: GRANTED on an unusable session`); continue }
        if (gate.status !== 401) violations.push(`${id}: status ${gate.status}, expected 401`)
        continue
      }
      if (badTenant) {
        if (gate.ok) { violations.push(`${id}: GRANTED with an unusable tenant header`); continue }
        if (gate.status !== 400) violations.push(`${id}: status ${gate.status}, expected 400`)
        continue
      }
      // An empty token string still reaches getUser, which is what rejects it.
      if (!gate.ok) violations.push(`${id}: denied a valid request (${gate.status} ${gate.message})`)
      else if (gate.tenantId !== TENANT.toLowerCase() && gate.tenantId !== TENANT.toUpperCase() && gate.tenantId !== TENANT) {
        violations.push(`${id}: tenantId came back as ${gate.tenantId}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('treats a malformed x-active-facility as the roll-up view rather than a rejection', async () => {
    for (const [label, value] of [
      ['absent', null], ['valid', '00000000-0000-0000-0000-0000000000bb'],
      ['malformed', 'nope'], ['empty', ''], ['padded', '  00000000-0000-0000-0000-0000000000bb  '],
    ] as Array<[string, string | null]>) {
      countCase()
      queues.clear()
      queue('profiles', { data: { is_superadmin: false }, error: null })
      queue('tenant_memberships', {
        data: { role: 'admin', invite_cancelled_at: null, tenants: { disabled_at: null } },
        error: null,
      })
      const headers: Record<string, string> = {}
      if (value !== null) headers['x-active-facility'] = value
      const gate = await requireTenantMember(gateRequest(headers))

      expect(gate.ok, label).toBe(true)
      if (gate.ok) {
        const expected = label === 'valid' || label === 'padded' ? '00000000-0000-0000-0000-0000000000bb' : null
        expect(gate.facilityId, label).toBe(expected)
      }
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2. Superadmin gate — the two-signal matrix.
//
// Both signals must hold: the env allowlist AND the DB flag. The point is that
// compromising either one alone is not enough.
// ───────────────────────────────────────────────────────────────────────────

describe('requireSuperadmin — allowlist × DB-flag matrix', () => {
  const AUTH_HEADERS: Array<[string, string | null]> = [
    ['absent', null], ['valid', 'Bearer tok'], ['lowercaseScheme', 'bearer tok'],
    ['schemeOnly', 'Bearer'], ['wrongScheme', 'Basic abc'], ['empty', ''],
  ]
  const SESSIONS: Array<[string, unknown, boolean]> = [
    ['ok',       { data: { user: { id: USER, email: EMAIL } }, error: null }, true],
    ['noEmail',  { data: { user: { id: USER } }, error: null }, false],
    ['error',    { data: { user: null }, error: { message: 'jwt expired' } }, false],
    ['nullUser', { data: { user: null }, error: null }, false],
  ]
  // The allowlist is a comma-separated env var, compared case-insensitively.
  const ALLOWLISTS: Array<[string, string, boolean]> = [
    ['empty',            '', false],
    ['other',            'other@example.com', false],
    ['exact',            EMAIL, true],
    ['differentCase',    EMAIL.toUpperCase(), true],
    ['paddedInList',     ` other@example.com , ${EMAIL} `, true],
    ['supersetDomain',   `${EMAIL}.evil.com`, false],
    ['substringOfEntry', 'prefix-user@example.com', false],
    ['commasOnly',       ',,,', false],
  ]
  const DB_FLAGS: Array<[string, unknown]> = [
    ['true', { is_superadmin: true }],
    ['false', { is_superadmin: false }],
    ['nullRow', null],
    ['missingColumn', {}],
  ]

  it('grants only when the allowlist and the DB flag BOTH hold', async () => {
    const violations: string[] = []

    for (const [[authLabel, authValue], [sessionLabel, sessionResult, sessionUsable], [listLabel, list, listAllows], [flagLabel, flagRow]] of cross(
      AUTH_HEADERS, SESSIONS as unknown as unknown[], ALLOWLISTS as unknown as unknown[], DB_FLAGS as unknown as unknown[],
    ) as Array<[[string, string | null], [string, unknown, boolean], [string, string, boolean], [string, unknown]]>) {
      countCase()
      queues.clear()
      getUserMock.mockResolvedValue(sessionResult)
      process.env.SUPERADMIN_EMAILS = list
      queue('profiles', { data: flagRow, error: null })

      const gate = await requireSuperadmin(authValue)
      const id = `auth=${authLabel} session=${sessionLabel} list=${listLabel} flag=${flagLabel}`

      const validAuth = authValue !== null && authValue.startsWith('Bearer ')
      const flagAllows = flagLabel === 'true'
      const shouldGrant = validAuth && sessionUsable && listAllows && flagAllows

      if (gate.ok !== shouldGrant) {
        violations.push(shouldGrant
          ? `${id}: denied a legitimate superadmin (${gate.ok ? '' : gate.status})`
          : `${id}: GRANTED superadmin`)
        continue
      }
      if (!gate.ok) {
        const expected = !validAuth || !sessionUsable ? 401 : 403
        if (gate.status !== expected) violations.push(`${id}: status ${gate.status}, expected ${expected}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('fails closed when Supabase env is unset', async () => {
    for (const [url, anon] of cross(['', 'https://p.supabase.co'], ['', 'anon']) as Array<[string, string]>) {
      countCase()
      queues.clear()
      process.env.NEXT_PUBLIC_SUPABASE_URL      = url
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon
      process.env.SUPERADMIN_EMAILS             = EMAIL
      queue('profiles', { data: { is_superadmin: true }, error: null })

      const gate = await requireSuperadmin('Bearer tok')
      if (!url || !anon) {
        expect(gate.ok, `url=${!!url} anon=${!!anon}`).toBe(false)
        if (!gate.ok) expect(gate.status).toBe(500)
      } else {
        expect(gate.ok).toBe(true)
      }
    }
  })
})

describe('gate-matrix census', () => {
  it('executed the full matrix', () => {
    console.log(`\n  ▸ gate-matrix auth edge cases executed: ${EXECUTED_CASES.toLocaleString()}\n`)
    expect(EXECUTED_CASES).toBeGreaterThanOrEqual(750)
  })
})
