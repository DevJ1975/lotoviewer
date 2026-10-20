import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/strike/progress privacy rules: rank only to its owner, the individual
// board only to people who opted in and only listing people who opted in.

const { authGetUser, queues, tableProxy } = vi.hoisted(() => {
  type Result = { data?: unknown; error?: { message: string } | null }
  const queues = new Map<string, Result[]>()
  const authGetUser = vi.fn()
  const next = (t: string) => queues.get(t)?.shift() ?? { data: null, error: null }
  function tableProxy(table: string) {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'or', 'limit', 'order', 'upsert', 'delete']) chain[m] = () => chain
    chain.maybeSingle = async () => next(table)
    chain.single = async () => next(table)
    chain.then = (resolve: (v: Result) => unknown) => Promise.resolve(next(table)).then(resolve)
    return chain
  }
  return { authGetUser, queues, tableProxy }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: authGetUser } }) }))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tableProxy(t) }) }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))

const TENANT = '11111111-1111-1111-1111-111111111111'

function queue(table: string, data: unknown) {
  queues.set(table, [...(queues.get(table) ?? []), { data, error: null }])
}

function gateAs(memberId: string | null) {
  authGetUser.mockResolvedValue({ data: { user: { id: 'u-ana', email: 'ana@example.com' } }, error: null })
  queue('profiles', { is_superadmin: false })
  queue('tenant_memberships', { role: 'member', invite_cancelled_at: null, tenants: { disabled_at: null } })
  queue('tenants', { name: 'T', modules: { strike: true }, settings: {}, disabled_at: null })
  queue('members', memberId ? { id: memberId } : null)
}

function get() {
  return new Request('http://localhost/api/strike/progress', { headers: { authorization: 'Bearer t', 'x-active-tenant': TENANT } })
}

const roster = [
  { id: 'm-ana', display_name: 'Ana Ruiz', preferred_name: null, department: 'Sanitation' },
  { id: 'm-ben', display_name: 'Ben Ode', preferred_name: null, department: 'Sanitation' },
  { id: 'm-cy', display_name: 'Cy Lee', preferred_name: null, department: 'Sanitation' },
]
const ledger = [
  { member_id: 'm-ana', event_type: 'module_passed', points: 100, module_id: 'loto' },
  { member_id: 'm-ben', event_type: 'module_passed', points: 100, module_id: 'loto' },
  { member_id: 'm-ben', event_type: 'on_time', points: 25, module_id: 'loto' },
]

beforeEach(() => {
  queues.clear()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPERADMIN_EMAILS = ''
})

describe('GET /api/strike/progress', () => {
  it('returns XP, badges, private rank and the team board, but no individual board without opt-in', async () => {
    const { GET } = await import('@/app/api/strike/progress/route')
    gateAs('m-ana')
    queue('strike_xp_events', ledger)
    queue('strike_tenant_settings', { leaderboard_enabled: true, team_leaderboard_enabled: true })
    queue('members', roster)
    queue('strike_leaderboard_optins', [{ member_id: 'm-ben' }])
    queue('strike_modules', [{ id: 'loto' }])
    const body = await (await GET(get())).json()
    expect(body.xp).toBe(100)
    expect(body.badges.map((b: { id: string }) => b.id)).toEqual(['first_module', 'loto_ready'])
    expect(body.rank).toEqual({ rank: 2, of: 3 })
    expect(body.teams).toEqual([{ team: 'Sanitation', members: 3, xpPerMember: 75 }])
    expect(body.leaders).toBeNull()
  })

  it('lists only opted-in people, and only to someone who opted in', async () => {
    const { GET } = await import('@/app/api/strike/progress/route')
    gateAs('m-ana')
    queue('strike_xp_events', ledger)
    queue('strike_tenant_settings', { leaderboard_enabled: true, team_leaderboard_enabled: false })
    queue('members', roster)
    queue('strike_leaderboard_optins', [{ member_id: 'm-ana' }, { member_id: 'm-ben' }])
    queue('strike_modules', [])
    const body = await (await GET(get())).json()
    expect(body.leaders).toEqual([
      { name: 'Ben Ode', xp: 125, you: false },
      { name: 'Ana Ruiz', xp: 100, you: true },
    ])
    expect(body.teams).toEqual([])
  })

  it('hides the individual board entirely when the tenant turns it off', async () => {
    const { GET } = await import('@/app/api/strike/progress/route')
    gateAs('m-ana')
    queue('strike_xp_events', ledger)
    queue('strike_tenant_settings', { leaderboard_enabled: false, team_leaderboard_enabled: true })
    queue('members', roster)
    queue('strike_leaderboard_optins', [{ member_id: 'm-ana' }])
    queue('strike_modules', [])
    const body = await (await GET(get())).json()
    expect(body.leaders).toBeNull()
    expect(body.individual_board_enabled).toBe(false)
  })

  it('returns an empty state for a user who is not on the roster', async () => {
    const { GET } = await import('@/app/api/strike/progress/route')
    gateAs(null)
    expect(await (await GET(get())).json()).toEqual({ xp: 0, badges: [], rank: null, teams: [], leaders: null, opted_in: false })
  })
})
