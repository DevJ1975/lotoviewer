import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_LIMITS, type DefaultLimit } from '@soteria/core/environmental/monitoringDefaults'
import { fakeSupabase, type Call, type Result } from '../../api/environmental/_fakeSupabase'

vi.mock('@/lib/security/sanitizeError', () => ({ sanitizeError: () => Response.json({ error: 'internal' }, { status: 500 }) }))

import { adoptDefaultLimits, parseAdoptRequest } from '@/lib/environmental/monitoringAdopt'
import { DatabaseError } from '@/lib/environmental/monitoringHttp'

const TENANT = '11111111-1111-1111-1111-111111111111'
const SITE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OUTFALL = 'f0000000-0000-0000-0000-0000000000a1'
const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

describe('parseAdoptRequest', () => {
  const ok = (body: unknown, active: string | null = SITE) => {
    const r = parseAdoptRequest(body, active)
    if (!r.ok) throw new Error(r.errors.join(' | '))
    return r
  }
  const errors = (body: unknown, active: string | null = SITE) => { const r = parseAdoptRequest(body, active); return r.ok ? [] : r.errors }

  it('takes the keys chosen, once each, for the active site and no particular outfall', () => {
    expect(ok({ keys: ['a', 'b', 'a'] })).toEqual({ ok: true, keys: ['a', 'b'], outfallId: null, facilityId: SITE })
  })

  it('takes an outfall, and a site named in the body over the active one, ids in lower case', () => {
    const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    expect(ok({ keys: ['a'], outfall_id: OUTFALL.toUpperCase(), facility_id: other.toUpperCase() })).toEqual({ ok: true, keys: ['a'], outfallId: OUTFALL, facilityId: other })
    expect(ok({ keys: ['a'], outfall_id: null }).outfallId).toBeNull()
    expect(ok({ keys: ['a'], outfall_id: '' }).outfallId).toBeNull()
  })

  it('wants at least one key, as strings, and not an unbounded number of them', () => {
    for (const keys of [undefined, [], 'a', [1], [''.padEnd(81, 'a')], Array.from({ length: 51 }, (_, i) => `k${i}`)]) {
      expect(errors({ keys }), JSON.stringify(keys)?.slice(0, 40)).toEqual(['keys must list between 1 and 50 default limits to adopt.'])
    }
  })

  it('needs a site, and ids that are ids', () => {
    expect(errors({ keys: ['a'] }, null)).toEqual(['facility_id is required: choose a site first.'])
    expect(errors({ keys: ['a'], facility_id: 'nope' })).toEqual(['facility_id must be an id.'])
    expect(errors({ keys: ['a'], outfall_id: 'nope' })).toEqual(['outfall_id must be an id.'])
  })

  it('reports everything wrong at once, and treats a body that is not an object as empty', () => {
    expect(errors({ outfall_id: 5, facility_id: 5 })).toHaveLength(3)
    expect(errors('x')).toEqual(['keys must list between 1 and 50 default limits to adopt.'])
    expect(errors(null)).toEqual(['keys must list between 1 and 50 default limits to adopt.'])
  })
})

describe('adoptDefaultLimits', () => {
  const chosen = DEFAULT_LIMITS.filter(d => d.generalPermit === 'ca_igp').slice(0, 3)
  const target = { tenantId: TENANT, facilityId: SITE, outfallId: null as string | null, userId: USER }
  const adopt = (db: ReturnType<typeof fakeSupabase>, over: Partial<typeof target> = {}, limits: readonly DefaultLimit[] = chosen) =>
    adoptDefaultLimits(db.client as unknown as SupabaseClient, { ...target, ...over }, limits)

  /** Reads answer with the keys already adopted; inserts answer with the row, or the failure given for a key. */
  const monitoringLimits = (existing: string[], failures: Record<string, Result> = {}) => (call: Call): Result => {
    const insert = call.ops.find(o => o.method === 'insert')?.args[0] as { library_key: string } | undefined
    if (!insert) return { data: existing.map(library_key => ({ library_key })) }
    return failures[insert.library_key] ?? { data: { id: `new-${insert.library_key}`, library_key: insert.library_key } }
  }

  it('adopts each chosen default as a library limit that keeps its citation and verify note, for the site, by the admin', async () => {
    const db = fakeSupabase({ monitoring_limits: monitoringLimits([]) })
    const result = await adopt(db)

    expect(result.created).toHaveLength(3)
    expect(result.alreadyThere).toBe(0)
    const inserted = db.used('monitoring_limits', 'insert').map(c => c.ops.find(o => o.method === 'insert')!.args[0])
    expect(inserted).toHaveLength(3)
    for (const [i, row] of inserted.entries()) {
      expect(row).toMatchObject({
        tenant_id: TENANT, facility_id: SITE, outfall_id: null, created_by: USER, source: 'library',
        library_key: chosen[i]!.libraryKey, citation: chosen[i]!.citation, verify: chosen[i]!.verify,
        parameter: chosen[i]!.parameter, value: chosen[i]!.value, basis: chosen[i]!.basis, limit_kind: chosen[i]!.kind,
      })
      expect((row as { verify: string }).verify.length).toBeGreaterThan(0)
    }
  })

  it('adds nothing for a default that is already there, and says how many were', async () => {
    const db = fakeSupabase({ monitoring_limits: monitoringLimits([chosen[0]!.libraryKey, chosen[2]!.libraryKey]) })
    const result = await adopt(db)
    expect(result.created.map(r => r.library_key)).toEqual([chosen[1]!.libraryKey])
    expect(result.alreadyThere).toBe(2)
    expect(db.used('monitoring_limits', 'insert')).toHaveLength(1)
  })

  it('adopting twice in a row adds nothing the second time', async () => {
    const db = fakeSupabase({ monitoring_limits: monitoringLimits(chosen.map(c => c.libraryKey)) })
    const result = await adopt(db)
    expect(result).toEqual({ created: [], alreadyThere: 3 })
    expect(db.used('monitoring_limits', 'insert')).toEqual([])
  })

  it('counts a default another request adopted first as already there, not as a failure', async () => {
    const lost = { error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_monitoring_limits_library"' } }
    const db = fakeSupabase({ monitoring_limits: monitoringLimits([], { [chosen[1]!.libraryKey]: lost }) })
    const result = await adopt(db)
    expect(result.created).toHaveLength(2)
    expect(result.alreadyThere).toBe(1)
  })

  it('stops at any other failure, keeps its code, and says what was adopted before it', async () => {
    const denied = { error: { code: '42501', message: 'new row violates row-level security policy' } }
    const db = fakeSupabase({ monitoring_limits: monitoringLimits([], { [chosen[1]!.libraryKey]: denied }) })
    await expect(adopt(db)).rejects.toMatchObject({ code: '42501' })
    await expect(adopt(db)).rejects.toBeInstanceOf(DatabaseError)
    expect(db.used('monitoring_limits', 'insert').length).toBe(4)   // two per attempt: the first, then the one that failed
  })

  it('throws when it cannot tell what is already adopted', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ error: { code: 'XX000', message: 'relation exploded' } }] })
    await expect(adopt(db)).rejects.toMatchObject({ code: 'XX000' })
    expect(db.used('monitoring_limits', 'insert')).toEqual([])
  })

  describe('where it looks for what is already adopted', () => {
    const readCall = (db: ReturnType<typeof fakeSupabase>) => db.calls.find(c => c.ops.some(o => o.method === 'select'))!
    const ops = (call: Call, method: string) => call.ops.filter(o => o.method === method).map(o => o.args)

    it('is the site-wide slot when no outfall is named: this tenant, this site, outfall null', async () => {
      const db = fakeSupabase({ monitoring_limits: monitoringLimits([]) })
      await adopt(db)
      expect(ops(readCall(db), 'eq')).toEqual([['tenant_id', TENANT], ['facility_id', SITE]])
      expect(ops(readCall(db), 'is')).toEqual([['outfall_id', null]])
    })

    it('is that outfall\'s slot when one is named, and the copies are for it', async () => {
      const db = fakeSupabase({ monitoring_limits: monitoringLimits([]) })
      await adopt(db, { outfallId: OUTFALL })
      expect(ops(readCall(db), 'eq')).toEqual([['tenant_id', TENANT], ['facility_id', SITE], ['outfall_id', OUTFALL]])
      expect(ops(readCall(db), 'is')).toEqual([])
      expect(db.arg('monitoring_limits', 'insert')).toMatchObject({ outfall_id: OUTFALL })
    })
  })
})
