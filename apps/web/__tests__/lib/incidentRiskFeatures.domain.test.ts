import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { gatherIncidentRiskFeatures } from '@/lib/incidentRiskFeatures'

// Environmental checklists are stored as inspections (migration 301 marks them
// domain = 'environmental'). The injury-risk model counts failed inspections as a
// leading indicator, so an oil sheen at an outfall must not move it. The fake
// below applies .eq() filters to in-memory rows, so this fails if the filter is
// missing, not merely if a call is absent.

type Row = Record<string, unknown>

function adminWith(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = []
    const query: Record<string, unknown> = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const rows = (tables[table] ?? []).filter(row => filters.every(([column, value]) => row[column] === value))
          return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
        }
        return (...args: unknown[]) => {
          if (prop === 'eq') filters.push([args[0] as string, args[1]])
          return query
        }
      },
    })
    return query
  }
  return { from } as unknown as SupabaseClient
}

const inspection = (result: 'pass' | 'fail', domain: 'safety' | 'environmental'): Row => ({ result, domain, tenant_id: 't1' })

describe('gatherIncidentRiskFeatures — inspections', () => {
  it('counts safety inspections only, so environmental failures do not raise injury risk', async () => {
    const features = await gatherIncidentRiskFeatures(adminWith({
      inspections: [
        inspection('pass', 'safety'), inspection('fail', 'safety'), inspection('pass', 'safety'),
        inspection('fail', 'environmental'), inspection('fail', 'environmental'), inspection('fail', 'environmental'),
      ],
    }), 't1')
    expect(features.inspectionsTotal).toBe(3)
    expect(features.inspectionsFailed).toBe(1)
  })

  it('reports no inspections when the only ones are environmental', async () => {
    const features = await gatherIncidentRiskFeatures(adminWith({ inspections: [inspection('fail', 'environmental')] }), 't1')
    expect(features.inspectionsTotal).toBe(0)
    expect(features.inspectionsFailed).toBe(0)
  })
})
