import { describe, it, expect } from 'vitest'
import { buildDeptStats } from '@/lib/utils'

const row = (dept: string, status: 'missing' | 'partial' | 'complete') => ({
  department: dept,
  photo_status: status,
})

describe('buildDeptStats', () => {
  it('returns empty array for empty input', () => {
    expect(buildDeptStats([])).toEqual([])
  })

  it('creates one dept entry for a single item', () => {
    const result = buildDeptStats([row('Electrical', 'complete')])
    expect(result).toHaveLength(1)
    expect(result[0].department).toBe('Electrical')
    expect(result[0].total).toBe(1)
    expect(result[0].complete).toBe(1)
    expect(result[0].partial).toBe(0)
    expect(result[0].missing).toBe(0)
  })

  it('pct is 100 when all items are complete', () => {
    const rows = [row('Mech', 'complete'), row('Mech', 'complete')]
    const [stat] = buildDeptStats(rows)
    expect(stat.pct).toBe(100)
  })

  it('pct is 0 when all items are missing', () => {
    const rows = [row('Mech', 'missing'), row('Mech', 'missing')]
    const [stat] = buildDeptStats(rows)
    expect(stat.pct).toBe(0)
  })

  it('pct rounds to nearest integer (e.g. 1/3 → 33)', () => {
    const rows = [row('D', 'complete'), row('D', 'missing'), row('D', 'missing')]
    const [stat] = buildDeptStats(rows)
    expect(stat.pct).toBe(33)
  })

  it('pct rounds up at 0.5 threshold (e.g. 2/3 → 67)', () => {
    const rows = [row('D', 'complete'), row('D', 'complete'), row('D', 'missing')]
    const [stat] = buildDeptStats(rows)
    expect(stat.pct).toBe(67)
  })

  it('counts partial items correctly', () => {
    const rows = [row('D', 'complete'), row('D', 'partial'), row('D', 'missing')]
    const [stat] = buildDeptStats(rows)
    expect(stat.complete).toBe(1)
    expect(stat.partial).toBe(1)
    expect(stat.missing).toBe(1)
    expect(stat.total).toBe(3)
  })

  it('creates separate entries for separate departments', () => {
    const rows = [row('Alpha', 'complete'), row('Beta', 'missing'), row('Alpha', 'missing')]
    const result = buildDeptStats(rows)
    expect(result).toHaveLength(2)
    const alpha = result.find(s => s.department === 'Alpha')!
    const beta = result.find(s => s.department === 'Beta')!
    expect(alpha.total).toBe(2)
    expect(alpha.complete).toBe(1)
    expect(beta.total).toBe(1)
    expect(beta.missing).toBe(1)
  })

  it('handles a single dept with many items', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row('Plant', i < 30 ? 'complete' : 'missing')
    )
    const [stat] = buildDeptStats(rows)
    expect(stat.total).toBe(50)
    expect(stat.complete).toBe(30)
    expect(stat.missing).toBe(20)
    expect(stat.pct).toBe(60)
  })
})
