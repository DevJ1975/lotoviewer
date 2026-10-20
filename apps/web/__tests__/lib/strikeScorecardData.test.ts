import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadMicrolearningSummary } from '@/lib/strike/scorecardData'

// The loader runs on the service-role client, so RLS is not there to catch a
// missing filter: every tenant-owned query must name the tenant itself, and a
// big tenant must not be cut off at the API's 1000-row page.

const TENANT = 't1'
const TENANT_TABLES = [
  'strike_completions', 'strike_attempts', 'strike_block_events', 'members',
  'tenant_memberships', 'strike_assignments', 'permit_training_overrides',
]

interface Query { table: string; filters: unknown[][]; range?: [number, number] }

function fakeAdmin(opts: { modules?: Record<string, boolean> | null; completions?: number; pageCap?: number; rangeErrorPastEnd?: boolean } = {}) {
  const queries: Query[] = []
  const completionRows = Array.from({ length: opts.completions ?? 0 }, (_, i) => ({
    id: `c${i}`, module_id: 'loto', module_version_id: 'loto-en', member_id: `m${i}`, user_id: null,
    completed_at: '2026-11-05T10:00:00Z', expires_at: null, mode: 'blocks_and_quiz',
  }))
  const admin = {
    from(table: string) {
      const q: Query = { table, filters: [] }
      queries.push(q)
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'order']) chain[m] = () => chain
      for (const m of ['eq', 'in', 'not', 'gte']) chain[m] = (...args: unknown[]) => { q.filters.push([m, ...args]); return chain }
      chain.maybeSingle = async () => ({ data: opts.modules === null ? null : { modules: opts.modules ?? { strike: true } }, error: null })
      chain.range = async (from: number, to: number) => {
        q.range = [from, to]
        if (opts.rangeErrorPastEnd && table === 'strike_completions' && from >= completionRows.length) {
          return { data: null, error: { message: 'Requested range not satisfiable', code: 'PGRST103' } }
        }
        const rows = table === 'strike_completions' ? completionRows.slice(from, Math.min(to + 1, from + (opts.pageCap ?? Infinity)))
          : from > 0 ? []
          : table === 'strike_modules' ? [{ id: 'loto', title: 'LOTO 101' }]
          : table === 'strike_module_versions' ? [{ id: 'loto-en', module_id: 'loto', locale: 'en', version_number: 1, supersedes_completions: false }]
          : []
        return { data: rows, error: null }
      }
      return chain
    },
  }
  return { admin: admin as unknown as SupabaseClient, queries }
}

const now = new Date('2026-11-10T12:00:00Z')

describe('loadMicrolearningSummary', () => {
  it('filters every tenant-owned query to the tenant asked for', async () => {
    const { admin, queries } = fakeAdmin({ completions: 3 })
    await loadMicrolearningSummary(admin, TENANT, 30, now)
    for (const table of TENANT_TABLES) {
      const q = queries.find(x => x.table === table)
      expect(q, table).toBeDefined()
      expect(q!.filters, table).toContainEqual(['eq', 'tenant_id', TENANT])
    }
  })

  it('reads past the 1000-row page so a large tenant is fully counted', async () => {
    const { admin, queries } = fakeAdmin({ completions: 2500 })
    const summary = await loadMicrolearningSummary(admin, TENANT, 30, now)
    expect(summary?.completions).toBe(2500)
    expect(queries.filter(q => q.table === 'strike_completions').map(q => q.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]])
  })

  // The API may cap a page below what was asked for; a short page is not the end.
  it('keeps reading when the API returns fewer rows than a full page', async () => {
    const { admin } = fakeAdmin({ completions: 1200, pageCap: 500 })
    expect((await loadMicrolearningSummary(admin, TENANT, 30, now))?.completions).toBe(1200)
  })

  it('treats a page past the last row as the end, not an error', async () => {
    const { admin } = fakeAdmin({ completions: 1000, rangeErrorPastEnd: true })
    expect((await loadMicrolearningSummary(admin, TENANT, 30, now))?.completions).toBe(1000)
  })

  it('counts only quiz attempts toward pass rates and scores', async () => {
    const { admin, queries } = fakeAdmin()
    await loadMicrolearningSummary(admin, TENANT, 30, now)
    expect(queries.find(q => q.table === 'strike_attempts')!.filters).toContainEqual(['eq', 'delivery', 'standard'])
  })

  it('returns nothing when STRIKE is turned off, so the section hides', async () => {
    const { admin, queries } = fakeAdmin({ modules: { strike: false } })
    expect(await loadMicrolearningSummary(admin, TENANT, 30, now)).toBeNull()
    expect(queries.map(q => q.table)).toEqual(['tenants'])
  })
})
