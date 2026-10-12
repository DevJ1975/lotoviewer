import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Records every filter applied to the query builder so we can assert the
// handler scoped its read to the caller's tenant. The builder is a single
// thenable object: every method returns `this`, and awaiting it resolves to
// the preset result — which models the supabase-js chain
// (.from().select().eq().order().limit() and Promise.all of two chains).
interface Recorder { tables: string[]; eq: Array<[string, unknown]>; selected: Record<string, string> }
type Result = { data: unknown; error: { message: string } | null }

let recorder: Recorder
let nextResult: Result
// A table named here answers with its own result instead of nextResult.
let tableResults: Record<string, Result>

function makeBuilder(table: string) {
  const b: Record<string, unknown> = {}
  const ret = () => b
  for (const m of ['order', 'limit', 'ilike', 'like', 'in', 'lt', 'lte', 'gt', 'gte', 'not', 'is', 'maybeSingle']) {
    b[m] = ret
  }
  b.select = (columns: string) => { recorder.selected[table] = columns; return b }
  b.eq = (col: string, val: unknown) => { recorder.eq.push([col, val]); return b }
  b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(tableResults[table] ?? nextResult).then(onF, onR)
  return b
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => { recorder.tables.push(table); return makeBuilder(table) },
  }),
}))

import { runTool, getToolDefinitions, ASSISTANT_TOOLS } from '@/lib/ai/tools'

const CTX = { tenantId: 'tenant-A', userId: 'user-1', role: 'member' as const, conversationId: 'conv-1' }

beforeEach(() => {
  recorder = { tables: [], eq: [], selected: {} }
  nextResult = { data: [], error: null }
  tableResults = {}
})

afterEach(() => vi.useRealTimers())

describe('assistant tool registry', () => {
  it('exposes a definition for every registered tool', () => {
    const defs = getToolDefinitions()
    expect(defs.length).toBe(Object.keys(ASSISTANT_TOOLS).length)
    for (const d of defs) expect(typeof d.name).toBe('string')
  })

  it('returns an error for an unknown tool', async () => {
    const out = JSON.parse(await runTool('does_not_exist', {}, CTX))
    expect(out.ok).toBe(false)
  })
})

describe('tenant scoping (read tools filter by the caller tenant)', () => {
  const readTools = ['list_risks', 'list_jhas', 'bbs_summary', 'training_expiring', 'recent_inspections', 'compliance_obligations_due', 'near_misses_recent', 'environmental_guidance', 'environmental_compliance_status']

  for (const name of readTools) {
    it(`${name} filters by tenant_id = ctx.tenantId`, async () => {
      const out = JSON.parse(await runTool(name, {}, CTX))
      expect(out.ok).toBe(true)
      expect(recorder.eq).toContainEqual(['tenant_id', 'tenant-A'])
      // never leaks another tenant
      expect(recorder.eq.some(([c, v]) => c === 'tenant_id' && v !== 'tenant-A')).toBe(false)
    })
  }

  it('active_permits scopes both permit tables to the tenant', async () => {
    const out = JSON.parse(await runTool('active_permits', {}, CTX))
    expect(out.ok).toBe(true)
    expect(recorder.tables).toEqual(expect.arrayContaining(['loto_confined_space_permits', 'loto_hot_work_permits']))
    expect(recorder.eq.filter(([c]) => c === 'tenant_id').every(([, v]) => v === 'tenant-A')).toBe(true)
  })

  it('surfaces a DB error instead of throwing', async () => {
    nextResult = { data: null, error: { message: 'boom' } }
    const out = JSON.parse(await runTool('list_risks', {}, CTX))
    expect(out.ok).toBe(false)
    expect(out.error).toBe('boom')
  })
})

describe('environmental assistant tools', () => {
  it('compliance_obligations_due reads the live compliance calendar, not the legacy table nothing writes to', async () => {
    await runTool('compliance_obligations_due', {}, CTX)
    expect(recorder.tables).toContain('compliance_calendar_obligations')
    expect(recorder.tables).not.toContain('compliance_obligations')
    expect(recorder.eq).toContainEqual(['status', 'open'])
  })

  it('compliance_obligations_due says which site each deadline is for and never exposes the owner\'s id', async () => {
    nextResult = { data: [
      { title: 'Quarterly inspection', category: 'environmental', program: 'stormwater', regulatory_ref: 'IGP', cadence: 'quarterly', next_due_at: '2020-01-01', facility_id: null, owner_user_id: 'user-secret' },
    ], error: null }
    const out = JSON.parse(await runTool('compliance_obligations_due', {}, CTX))
    expect(out.data[0]).toMatchObject({ title: 'Quarterly inspection', site: 'All sites', overdue: true, assigned: true })
    expect(JSON.stringify(out)).not.toContain('user-secret')
  })

  it('environmental_guidance gives guidance with the draft disclaimer, and asks for a state when the account spans several', async () => {
    nextResult = { data: [{ state: 'CA' }, { state: 'TX' }], error: null }
    const out = JSON.parse(await runTool('environmental_guidance', { program: 'stormwater', topic: 'outfall inspection' }, CTX))
    expect(out.ok).toBe(true)
    expect(out.data.disclaimer).toMatch(/not yet reviewed/)
    expect(out.data.siteStates).toEqual(['CA', 'TX'])
    expect(out.data.stateUsed).toBeNull()
    expect(out.data.jurisdiction.chain).toEqual(['federal'])
  })

  it('environmental_guidance uses the account\'s state when there is only one, and an explicit state over it', async () => {
    nextResult = { data: [{ state: 'ca' }, { state: 'CA' }], error: null }
    const single = JSON.parse(await runTool('environmental_guidance', { program: 'stormwater' }, CTX))
    expect(single.data.stateUsed).toBe('CA')
    expect(single.data.jurisdiction.chain).toEqual(['federal', 'CA'])
    const explicit = JSON.parse(await runTool('environmental_guidance', { program: 'stormwater', state: 'Texas' }, CTX))
    expect(explicit.data.stateUsed).toBe('TX')
  })

  it('environmental_compliance_status reads only environmental calendar rows and environmental findings', async () => {
    const out = JSON.parse(await runTool('environmental_compliance_status', {}, CTX))
    expect(out.ok).toBe(true)
    expect(recorder.tables).toEqual(expect.arrayContaining(['facilities', 'compliance_calendar_obligations', 'environmental_permits', 'legal_register', 'nonconformities']))
    expect(recorder.eq).toContainEqual(['category', 'environmental'])
    expect(out.data.note).toMatch(/draft/)
  })

  it('environmental_compliance_status reads the permit vault\'s renewal columns', async () => {
    await runTool('environmental_compliance_status', {}, CTX)
    const columns = recorder.selected.environmental_permits!.split(',').map(c => c.trim())
    expect(columns).toEqual(expect.arrayContaining(['facility_id', 'retired_at', 'expires_on', 'renewal_application_due_on', 'renewal_submitted_on']))
    for (const retired of ['status', 'expiration_date', 'renewal_lead_days']) expect(columns).not.toContain(retired)
  })

  describe('environmental_compliance_status, permits', () => {
    const permit = (over: Record<string, unknown>) => ({
      facility_id: 'site-1', retired_at: null, expires_on: null, renewal_application_due_on: null, renewal_submitted_on: null, ...over,
    })

    async function standingOfHouston(permits: unknown[]) {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
      tableResults = {
        facilities: { data: [{ id: 'site-1', name: 'Houston', state: 'TX' }, { id: 'site-2', name: 'Anaheim', state: 'CA' }], error: null },
        environmental_permits: { data: permits, error: null },
      }
      const out = JSON.parse(await runTool('environmental_compliance_status', {}, CTX))
      return out.data.sites.find((s: { site: string }) => s.site === 'Houston')
    }

    it('counts renewals due soon and renewal deadlines missed under those names, with no expired count', async () => {
      const houston = await standingOfHouston([
        permit({ expires_on: '2026-09-01' }),
        permit({ expires_on: '2026-12-01' }),
      ])
      expect(houston).toMatchObject({ permitsRenewalSoon: 1, permitsRenewalMissed: 1 })
      expect(houston).not.toHaveProperty('permitsExpired')
      expect(houston).not.toHaveProperty('permitsExpiring')
    })

    it('leaves out a retired permit, one whose renewal is already in, and another site\'s permit', async () => {
      const houston = await standingOfHouston([
        permit({ expires_on: '2026-09-01', retired_at: '2026-09-02T00:00:00Z' }),
        permit({ expires_on: '2026-09-01', renewal_submitted_on: '2026-08-01' }),
        permit({ expires_on: '2026-09-01', facility_id: 'site-2' }),
      ])
      expect(houston).toMatchObject({ permitsRenewalSoon: 0, permitsRenewalMissed: 0 })
    })

    it('reports a failed permit read instead of showing zero renewals', async () => {
      tableResults = { environmental_permits: { data: null, error: { message: 'permission denied for table environmental_permits' } } }
      const out = JSON.parse(await runTool('environmental_compliance_status', {}, CTX))
      expect(out.ok).toBe(false)
      expect(out.error).toBe('permission denied for table environmental_permits')
    })

    it('describes the two renewal figures so the model words them as renewals, not expiries', () => {
      const description = getToolDefinitions().find(d => d.name === 'environmental_compliance_status')!.description
      expect(description).toMatch(/permitsRenewalSoon/)
      expect(description).toMatch(/permitsRenewalMissed/)
      expect(description).toMatch(/renewal deadline missed/)
    })
  })
})

describe('navigate_to', () => {
  it('resolves a module name to its href', async () => {
    const out = JSON.parse(await runTool('navigate_to', { query: 'confined spaces' }, CTX))
    expect(out.ok).toBe(true)
    expect(out.data.href).toBe('/confined-spaces')
  })

  it('matches on keywords in the description', async () => {
    const out = JSON.parse(await runTool('navigate_to', { query: 'risk register' }, CTX))
    expect(out.ok).toBe(true)
    expect(typeof out.data.href).toBe('string')
  })

  it('returns null data for an unmatchable query', async () => {
    const out = JSON.parse(await runTool('navigate_to', { query: 'zzzqqq-nonsense' }, CTX))
    expect(out.ok).toBe(true)
    expect(out.data).toBeNull()
  })

  it('requires a query', async () => {
    const out = JSON.parse(await runTool('navigate_to', {}, CTX))
    expect(out.ok).toBe(false)
  })
})
