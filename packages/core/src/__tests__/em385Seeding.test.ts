import { describe, it, expect } from 'vitest'
import { planRegisterSeed, type Em385CatalogEntry } from '../em385Seeding'

const CATALOG: Em385CatalogEntry[] = [
  { id: 'r1', edition: '2024', category: 'app_plan',           title: 'APP',          default_required: true },
  { id: 'r2', edition: '2024', category: 'site_specific_plan', title: 'LOTO Program', default_required: true },
  { id: 'r3', edition: '2024', category: 'site_specific_plan', title: 'Diving Plan',  default_required: false },
  { id: 'r4', edition: '2014', category: 'app_plan',           title: 'APP (2014)',   default_required: true },
]

describe('planRegisterSeed', () => {
  it('seeds only default_required rows for the matching edition', () => {
    const seed = planRegisterSeed(CATALOG, { projectId: 'p1', tenantId: 't1', edition: '2024' })
    expect(seed.map(s => s.requirement_id).sort()).toEqual(['r1', 'r2'])
    expect(seed.every(s => s.status === 'not_started')).toBe(true)
    expect(seed.every(s => s.project_id === 'p1' && s.tenant_id === 't1')).toBe(true)
  })

  it('carries title and category from the catalog row', () => {
    const seed = planRegisterSeed(CATALOG, { projectId: 'p1', tenantId: 't1', edition: '2024' })
    const app = seed.find(s => s.requirement_id === 'r1')
    expect(app).toMatchObject({ title: 'APP', category: 'app_plan' })
  })

  it('isolates editions — a 2014 project never gets 2024 rows', () => {
    const seed = planRegisterSeed(CATALOG, { projectId: 'p2', tenantId: 't1', edition: '2014' })
    expect(seed.map(s => s.requirement_id)).toEqual(['r4'])
  })

  it('returns nothing for an empty catalog', () => {
    expect(planRegisterSeed([], { projectId: 'p1', tenantId: 't1', edition: '2024' })).toEqual([])
  })

  it('is pure — re-seeding the same inputs yields an equal plan', () => {
    const args = { projectId: 'p1', tenantId: 't1', edition: '2024' as const }
    expect(planRegisterSeed(CATALOG, args)).toEqual(planRegisterSeed(CATALOG, args))
  })

  it('passes duplicate requirement ids straight through (the DB unique index dedupes on re-seed)', () => {
    const dupes: Em385CatalogEntry[] = [
      { id: 'r1', edition: '2024', category: 'app_plan', title: 'APP', default_required: true },
      { id: 'r1', edition: '2024', category: 'app_plan', title: 'APP', default_required: true },
    ]
    expect(planRegisterSeed(dupes, { projectId: 'p1', tenantId: 't1', edition: '2024' })
      .map(s => s.requirement_id)).toEqual(['r1', 'r1'])
  })
})
