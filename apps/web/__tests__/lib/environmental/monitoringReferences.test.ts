import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fakeSupabase, type Call, type Result } from '../../api/environmental/_fakeSupabase'
import { OUTFALL_AT_SITE, offSiteMonitoringReferences, PERMIT_AT_SITE } from '@/lib/environmental/monitoringReferences'

const TENANT = '11111111-1111-1111-1111-111111111111'
const SITE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OTHER_SITE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const OUTFALL = 'f0000000-0000-0000-0000-0000000000a1'
const PERMIT = 'f0000000-0000-0000-0000-000000000001'

const eqValue = (call: Call, column: string) => call.ops.find(o => o.method === 'eq' && o.args[0] === column)?.args[1]

/** A row that lives at `site`: found only by a query that filters on that site. */
const rowAt = (site: string, row: object) => (call: Call): Result => {
  const filtered = eqValue(call, 'facility_id')
  return { data: filtered === undefined || filtered === site ? row : null }
}

const check = (db: ReturnType<typeof fakeSupabase>, site: { outfallId: string | null; permitId?: string | null }) =>
  offSiteMonitoringReferences(db.client as unknown as SupabaseClient, TENANT, { facilityId: SITE, ...site })

describe('offSiteMonitoringReferences', () => {
  it('needs no lookup when it references nothing', async () => {
    const db = fakeSupabase()
    expect(await check(db, { outfallId: null })).toEqual([])
    expect(await check(db, { outfallId: null, permitId: null })).toEqual([])
    expect(db.calls).toEqual([])
  })

  it('accepts an outfall and a permit at the site, looking each up on that site inside the tenant', async () => {
    const db = fakeSupabase({ stormwater_outfalls: rowAt(SITE, { id: OUTFALL }), environmental_permits: rowAt(SITE, { id: PERMIT }) })
    expect(await check(db, { outfallId: OUTFALL, permitId: PERMIT })).toEqual([])
    for (const table of ['stormwater_outfalls', 'environmental_permits']) {
      expect(db.filtered(table, 'tenant_id', TENANT), table).toBe(true)
      expect(db.filtered(table, 'facility_id', SITE), table).toBe(true)
    }
    expect(db.filtered('stormwater_outfalls', 'id', OUTFALL)).toBe(true)
    expect(db.filtered('environmental_permits', 'id', PERMIT)).toBe(true)
  })

  it('refuses an outfall that belongs to another site', async () => {
    const db = fakeSupabase({ stormwater_outfalls: rowAt(OTHER_SITE, { id: OUTFALL }) })
    expect(await check(db, { outfallId: OUTFALL })).toEqual([OUTFALL_AT_SITE])
  })

  it('refuses a permit that belongs to another site, retired or not', async () => {
    const db = fakeSupabase({ environmental_permits: rowAt(OTHER_SITE, { id: PERMIT, retired_at: '2026-03-01T00:00:00Z' }) })
    expect(await check(db, { outfallId: null, permitId: PERMIT })).toEqual([PERMIT_AT_SITE])
  })

  it('accepts a retired permit at the site: the vault retires permits, it never deletes them', async () => {
    const db = fakeSupabase({ environmental_permits: rowAt(SITE, { id: PERMIT, retired_at: '2026-03-01T00:00:00Z' }) })
    expect(await check(db, { outfallId: null, permitId: PERMIT })).toEqual([])
    const [call] = db.calls
    expect(call!.ops.some(o => o.args[0] === 'retired_at')).toBe(false)
  })

  it('refuses a reference to a row that does not exist at all', async () => {
    const db = fakeSupabase({ stormwater_outfalls: [{ data: null }], environmental_permits: [{ data: null }] })
    expect(await check(db, { outfallId: OUTFALL, permitId: PERMIT })).toEqual([OUTFALL_AT_SITE, PERMIT_AT_SITE])
  })

  it('throws, rather than judge, when a lookup fails', async () => {
    const db = fakeSupabase({ stormwater_outfalls: [{ error: { message: 'relation exploded' } }] })
    await expect(check(db, { outfallId: OUTFALL })).rejects.toThrow('relation exploded')
  })
})
