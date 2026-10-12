import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fakeSupabase, type Call, type Result } from '../../api/environmental/_fakeSupabase'
import { fetchMonitoringSummary, MAX_LIMITS, MAX_SUMMARY_RESULTS } from '@/lib/environmental/monitoringFetch'

const TENANT = '11111111-1111-1111-1111-111111111111'
const SITE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OUTFALL = 'f0000000-0000-0000-0000-0000000000a1'
const NOW = Date.parse('2026-03-15T12:00:00Z')

const limitRow = (over: Record<string, unknown> = {}) => ({
  id: 'l-1', tenant_id: TENANT, facility_id: SITE, outfall_id: null, permit_id: null, parameter: 'TSS', unit: 'mg/L', limit_kind: 'instantaneous_max',
  value: 100, basis: 'benchmark', citation: null, verify: null, source: 'tenant', library_key: null, effective_from: null, effective_to: null, ...over,
})
const resultRow = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', tenant_id: TENANT, facility_id: SITE, outfall_id: OUTFALL, parameter: 'TSS', unit: 'mg/L', value: 250, below_detection: false,
  sampled_at: '2026-02-03T10:00:00+00:00', event_label: null, lab: null, evidence_id: null, note: null, sampled_by: null, ...over,
})
const siteRow = { id: SITE, name: 'Plant 1', state: 'CA', settings: null }
const profileRow = { facility_id: SITE, stormwater_coverage: 'general_permit', stormwater_general_permit: 'ca_igp' }

const tables = (over: Record<string, Result[] | ((call: Call) => Result)> = {}) => ({
  facilities: [{ data: siteRow }],
  environmental_site_profiles: [{ data: profileRow }],
  monitoring_limits: [{ data: [limitRow()] }],
  monitoring_results: [{ data: [resultRow()] }],
  ...over,
})

const run = (db: ReturnType<typeof fakeSupabase>, nowMs = NOW) =>
  fetchMonitoringSummary(db.client as unknown as SupabaseClient, { tenantId: TENANT, facilityId: SITE }, nowMs)

describe('fetchMonitoringSummary', () => {
  it('summarizes the site\'s limits and the reporting year\'s results', async () => {
    const view = await run(fakeSupabase(tables()))
    expect(view?.summary.reportingYear.label).toBe('2025-26')
    expect(view?.summary.totals).toEqual({ limit: 0, action: 1, internal: 0 })
    expect(view?.summary.rows).toHaveLength(1)
    expect(view?.truncated).toBe(false)
  })

  it('takes the July-to-June year from a California IGP site, and the calendar year from one that names no permit', async () => {
    const ca = await run(fakeSupabase(tables()))
    expect(ca?.reportingYearBasis.startMonth).toBe(7)
    expect(ca?.reportingYearBasis.verify).toMatch(/Confirm/)

    const other = await run(fakeSupabase(tables({ environmental_site_profiles: [{ data: null }] })))
    expect(other?.reportingYearBasis.startMonth).toBe(1)
    expect(other?.summary.reportingYear.label).toBe('2026')
  })

  it('reads limits and results for this tenant and this site only', async () => {
    const db = fakeSupabase(tables())
    await run(db)
    for (const table of ['monitoring_limits', 'monitoring_results']) {
      expect(db.filtered(table, 'tenant_id', TENANT), table).toBe(true)
      expect(db.filtered(table, 'facility_id', SITE), table).toBe(true)
    }
  })

  it('asks only for the reporting year\'s results, a UTC day at each end, newest first', async () => {
    const db = fakeSupabase(tables())
    await run(db)
    const [call] = db.used('monitoring_results', 'select')
    const op = (method: string) => call!.ops.filter(o => o.method === method).map(o => o.args)
    expect(op('gte')).toEqual([['sampled_at', '2025-07-01T00:00:00.000Z']])
    expect(op('lt')).toEqual([['sampled_at', '2026-07-01T00:00:00.000Z']])
    expect(op('order')[0]).toEqual(['sampled_at', { ascending: false }])
  })

  it('asks for a bounded number of rows, one more than it keeps, so it can tell when it was cut short', async () => {
    const db = fakeSupabase(tables())
    await run(db)
    const limitOf = (table: string) => db.used(table, 'select')[0]!.ops.find(o => o.method === 'limit')?.args[0]
    expect(limitOf('monitoring_results')).toBe(MAX_SUMMARY_RESULTS + 1)
    expect(limitOf('monitoring_limits')).toBe(MAX_LIMITS + 1)
  })

  it('says so, and keeps the newest results, when the year held more than it reads', async () => {
    const many = Array.from({ length: MAX_SUMMARY_RESULTS + 1 }, (_, i) => resultRow({ id: `r-${i}`, value: 10 }))
    const view = await run(fakeSupabase(tables({ monitoring_results: [{ data: many }] })))
    expect(view?.truncated).toBe(true)
    expect(view?.summary.rows[0]?.sampleCount).toBe(MAX_SUMMARY_RESULTS)
  })

  it('says so when there are more limits than it reads', async () => {
    const many = Array.from({ length: MAX_LIMITS + 1 }, (_, i) => limitRow({ id: `l-${i}` }))
    const view = await run(fakeSupabase(tables({ monitoring_limits: [{ data: many }] })))
    expect(view?.truncated).toBe(true)
  })

  it('is null for a site that is not there', async () => {
    expect(await run(fakeSupabase(tables({ facilities: [{ data: null }] })))).toBeNull()
  })

  it('reads the clock from nowMs alone: the same data a year on is a different reporting year', async () => {
    const later = await run(fakeSupabase(tables()), Date.parse('2026-08-01T00:00:00Z'))
    expect(later?.summary.reportingYear.label).toBe('2026-27')
  })

  it('throws, rather than summarize partial data, when a read fails', async () => {
    await expect(run(fakeSupabase(tables({ monitoring_limits: [{ error: { message: 'relation exploded' } }] })))).rejects.toThrow('relation exploded')
    await expect(run(fakeSupabase(tables({ monitoring_results: [{ error: { message: 'relation exploded' } }] })))).rejects.toThrow('relation exploded')
  })
})
