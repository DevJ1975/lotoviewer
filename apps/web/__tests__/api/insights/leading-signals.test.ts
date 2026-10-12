import { describe, it, expect, beforeEach, vi } from 'vitest'
// The AI harness mocks the tenant gate (member + admin) + Sentry — all the
// pre-DB guard path of this route touches.
import { gateOk, gateRejects, requireTenantMemberMock } from '../ai/_helpers'

// Every query on a table resolves to that table's rows (empty by default),
// oldest first, so a `.order().limit(1)` go-live lookup sees the first row.
// The tables asked for are recorded.
const queriedTables: string[] = []
let tableRows: Record<string, unknown[]> = {}
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      queriedTables.push(table)
      const chain: Record<string, unknown> = {}
      for (const step of ['select', 'eq', 'gte', 'in', 'order', 'limit']) chain[step] = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: tableRows[table] ?? [], error: null })
      return chain
    },
  }),
}))

async function importRoute() {
  return import('@/app/api/insights/leading-signals/route')
}

describe('leading-signals route — guards', () => {
  beforeEach(() => {
    requireTenantMemberMock.mockReset()
    gateOk()
  })

  it('rejects an unauthorized (non-admin) caller with the gate status', async () => {
    gateRejects(403, 'Admins only')
    const { GET } = await importRoute()
    const res = await GET(new Request('http://t/api/insights/leading-signals') as never)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/Admins only/)
  })
})

describe('leading-signals route — indicators', () => {
  beforeEach(() => {
    requireTenantMemberMock.mockReset()
    gateOk()
    queriedTables.length = 0
    tableRows = {}
  })

  it('never treats CAPAs opened as a leading indicator', async () => {
    // Corrective actions are opened because of incidents, so that series is a
    // consequence of the outcome, not a precursor (scorecard review §9).
    const { GET } = await importRoute()
    const res = await GET(new Request('http://t/api/insights/leading-signals') as never)
    expect(res.status).toBe(200)
    expect(queriedTables).not.toContain('incident_actions')
    const body = await res.json()
    expect(body.signals.map((s: { key: string }) => s.key)).not.toContain('capa_opened')
  })
})

describe('leading-signals route — observed history', () => {
  beforeEach(() => {
    requireTenantMemberMock.mockReset()
    gateOk()
    tableRows = {}
  })

  /** An ISO date `monthsAgo` calendar months before this one, mid-month. */
  const monthsAgo = (n: number) => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 10)).toISOString()
  }

  it('tests only the months since the incidents module went live', async () => {
    // Live for 8 months. Zero-filling the 10 months before would hand both
    // near-miss reporting and recordables a shared "nothing, then something"
    // step, and a fake 14+ months of history.
    const nearMiss    = [5, 2, 6, 3, 7, 1, 4, 6] // oldest → newest, months 7..0 ago
    const recordables = [1, 3, 0, 2, 1, 3, 2, 0]
    const incidents: { id: string; incident_type: string; occurred_at: string; reported_at: string }[] = []
    const classifications: { incident_id: string; meets_recording_criteria: boolean }[] = []
    nearMiss.forEach((count, i) => {
      const when = monthsAgo(7 - i)
      for (let k = 0; k < count; k++) {
        incidents.push({ id: `nm-${i}-${k}`, incident_type: 'near_miss', occurred_at: when, reported_at: when })
      }
      for (let k = 0; k < recordables[i]!; k++) {
        const id = `rec-${i}-${k}`
        incidents.push({ id, incident_type: 'injury_illness', occurred_at: when, reported_at: when })
        classifications.push({ incident_id: id, meets_recording_criteria: true })
      }
    })
    tableRows = { incidents, incident_classifications: classifications }

    const { GET } = await importRoute()
    const res = await GET(new Request('http://t/api/insights/leading-signals') as never)
    expect(res.status).toBe(200)
    const { signals } = await res.json()
    const nearMissSignal = signals.find((s: { key: string }) => s.key === 'near_miss_reporting')
    expect(nearMissSignal).toBeDefined()
    expect(nearMissSignal.nMonths).toBeLessThanOrEqual(7) // 8 live months, lead ≥ 1
    expect(nearMissSignal.reliable).toBe(false)           // under 12 real months
  })
})
