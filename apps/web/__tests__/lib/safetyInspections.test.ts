import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { failedSafetyInspections } from '@/lib/insights/safetyInspections'

type Row = Record<string, unknown>

// Applies .eq() filters to in-memory rows, so the test fails if the domain filter is missing.
function adminWith(rows: Row[]): SupabaseClient {
  const from = () => {
    const filters: Array<[string, unknown]> = []
    const query: Record<string, unknown> = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const matching = rows.filter(row => filters.every(([column, value]) => row[column] === value))
          return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: matching, error: null }).then(resolve)
        }
        return (...args: unknown[]) => { if (prop === 'eq') filters.push([args[0] as string, args[1]]); return query }
      },
    })
    return query
  }
  return { from } as unknown as SupabaseClient
}

const row = (domain: string, result: string, tenant = 't1'): Row => ({ tenant_id: tenant, domain, result, created_at: '2026-09-01T00:00:00Z' })

describe('failedSafetyInspections', () => {
  it('returns failed safety inspections for the tenant only, not environmental ones or passes', async () => {
    const { data } = await failedSafetyInspections(adminWith([
      row('safety', 'fail'), row('safety', 'pass'), row('environmental', 'fail'), row('safety', 'fail', 'other-tenant'),
    ]), 't1', '2026-01-01T00:00:00Z')
    expect(data).toHaveLength(1)
  })
})
