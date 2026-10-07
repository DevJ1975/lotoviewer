import { describe, it, expect, vi, beforeEach } from 'vitest'

// The general inspections screen lists safety inspections. Environmental checklists
// (domain = 'environmental') have their own screens and would otherwise appear here
// as ordinary inspections.

const gateMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({ requireTenantModuleMember: (...a: unknown[]) => gateMock(...a) }))
vi.mock('@/lib/security/sanitizeError', () => ({ sanitizeError: () => Response.json({ error: 'internal' }, { status: 500 }) }))

import { GET } from '@/app/api/inspections/route'

type Row = Record<string, unknown>
function clientWith(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const query: Record<string, unknown> = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            const rows = (tables[table] ?? []).filter(row => filters.every(([c, v]) => row[c] === v))
            return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
          }
          return (...args: unknown[]) => { if (prop === 'eq') filters.push([args[0] as string, args[1]]); return query }
        },
      })
      return query
    },
  }
}

beforeEach(() => gateMock.mockReset())

describe('GET /api/inspections', () => {
  it('lists safety inspections and leaves environmental checklists to their own screens', async () => {
    gateMock.mockResolvedValue({
      ok: true, tenantId: 't1',
      authedClient: clientWith({
        inspections: [
          { id: 'a', title: 'Forklift walk', domain: 'safety' },
          { id: 'b', title: 'Outfall 001 visual', domain: 'environmental' },
        ],
        inspection_templates: [],
      }),
    })
    const res = await GET(new Request('https://example.com/api/inspections'))
    const body = await res.json()
    expect(body.inspections.map((i: { id: string }) => i.id)).toEqual(['a'])
  })
})
