// The older admin route that completes any obligation. It must keep a deadline
// anchored to a period end (the environmental library's) on period ends instead of
// letting month arithmetic drift it (31 March + 3 months overflows to 1 July).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const gateMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({ requireTenantAdmin: (...a: unknown[]) => gateMock(...a) }))
vi.mock('@/lib/security/sanitizeError', () => ({ sanitizeError: () => Response.json({ error: 'internal' }, { status: 500 }) }))

import { POST } from '@/app/api/compliance/obligations/[id]/complete/route'

const ID = 'c0000000-0000-0000-0000-000000000001'

function client(obligation: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = []
  const authedClient = {
    from(table: string) {
      if (table === 'compliance_calendar_events') return { insert: () => Promise.resolve({ error: null }) }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: obligation, error: null }) }) }),
        update: (u: Record<string, unknown>) => { updates.push(u); return { eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: ID, ...u }, error: null }) }) }) } },
      }
    },
  }
  return { authedClient, updates }
}

const complete = () => POST(new Request('https://example.com/x', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: ID }) })

beforeEach(() => gateMock.mockReset())

describe('POST /api/compliance/obligations/[id]/complete', () => {
  it('moves a period-end quarterly deadline from 31 March to 30 June, not 1 July', async () => {
    const db = client({ id: ID, cadence: 'quarterly', cadence_days: null, next_due_at: '2026-03-31', status: 'open', due_anchor: 'period_end' })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', userId: 'u1', authedClient: db.authedClient })
    expect((await complete()).status).toBe(200)
    expect(db.updates[0]).toMatchObject({ next_due_at: '2026-06-30', status: 'open' })
  })

  it('leaves a fixed-anchor deadline on the calendar arithmetic it always used', async () => {
    const db = client({ id: ID, cadence: 'quarterly', cadence_days: null, next_due_at: '2026-03-31', status: 'open', due_anchor: 'fixed' })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', userId: 'u1', authedClient: db.authedClient })
    await complete()
    expect(db.updates[0]).toMatchObject({ next_due_at: '2026-07-01' })
  })

  it('treats an obligation with no anchor recorded as fixed', async () => {
    const db = client({ id: ID, cadence: 'annual', cadence_days: null, next_due_at: '2026-06-15', status: 'open' })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', userId: 'u1', authedClient: db.authedClient })
    await complete()
    expect(db.updates[0]).toMatchObject({ next_due_at: '2027-06-15' })
  })
})
