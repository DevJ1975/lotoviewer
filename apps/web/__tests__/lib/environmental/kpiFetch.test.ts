import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// fetchEnvironmentalKpis reads five tables through the browser client and hands
// the rows to the pure KPI summary. The stand-in answers each table with the
// rows a test staged and remembers which columns were asked of it.

type Result = { data: unknown; error: { message: string } | null }

let answers: Record<string, Result>
let selected: Record<string, string>

function query(table: string) {
  const chain: Record<string, unknown> = {}
  chain.select = (columns: string) => { selected[table] = columns; return chain }
  chain.eq = () => chain
  chain.like = () => chain
  chain.then = (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(answers[table] ?? { data: [], error: null }).then(onFulfilled, onRejected)
  return chain
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => query(table) } }))

import { fetchEnvironmentalKpis } from '@/lib/environmental/kpiFetch'

const permit = (over: Record<string, unknown> = {}) => ({
  retired_at: null, expires_on: null, renewal_application_due_on: null, renewal_submitted_on: null, ...over,
})
const stage = (permits: unknown[]) => { answers.environmental_permits = { data: permits, error: null } }

beforeEach(() => {
  answers = {}
  selected = {}
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('fetchEnvironmentalKpis, permits', () => {
  it('asks the permit vault for the columns its renewal countdown reads, and for none of the retired ones', async () => {
    await fetchEnvironmentalKpis()
    const columns = selected.environmental_permits!.split(',').map(c => c.trim())
    expect(columns).toEqual(expect.arrayContaining(['retired_at', 'expires_on', 'renewal_application_due_on', 'renewal_submitted_on']))
    for (const retired of ['status', 'expiration_date', 'renewal_lead_days']) expect(columns).not.toContain(retired)
  })

  it('counts a renewal due within 90 days apart from a renewal deadline already missed', async () => {
    stage([permit({ expires_on: '2026-12-01' }), permit({ expires_on: '2026-09-01' }), permit({ expires_on: '2030-01-01' })])
    const { kpis } = await fetchEnvironmentalKpis()
    expect(kpis).toMatchObject({ permitsRenewalSoon: 1, permitsRenewalMissed: 1 })
  })

  it('counts a missed renewal application date before the permit itself has expired', async () => {
    stage([permit({ expires_on: '2027-03-01', renewal_application_due_on: '2026-09-15' })])
    const { kpis } = await fetchEnvironmentalKpis()
    expect(kpis).toMatchObject({ permitsRenewalSoon: 0, permitsRenewalMissed: 1 })
  })

  it('ignores a retired permit and one whose renewal is already in', async () => {
    stage([
      permit({ expires_on: '2026-09-01', retired_at: '2026-09-02T00:00:00Z' }),
      permit({ expires_on: '2026-09-01', renewal_submitted_on: '2026-08-01' }),
    ])
    const { kpis } = await fetchEnvironmentalKpis()
    expect(kpis).toMatchObject({ permitsRenewalSoon: 0, permitsRenewalMissed: 0 })
  })

  it('counts an account that has only a permit register as set up', async () => {
    expect((await fetchEnvironmentalKpis()).hasData).toBe(false)
    stage([permit({ expires_on: '2030-01-01' })])
    expect((await fetchEnvironmentalKpis()).hasData).toBe(true)
  })

  it('fails the whole read when the permits cannot be read, rather than showing zero renewals', async () => {
    answers.environmental_permits = { data: null, error: { message: 'permission denied for table environmental_permits' } }
    await expect(fetchEnvironmentalKpis()).rejects.toThrow('permission denied for table environmental_permits')
  })
})
