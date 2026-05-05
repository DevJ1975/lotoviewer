import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '@/lib/supabase'
import type { DepartmentStats, LotoReview } from '@soteria/core/types'
import {
  renameDepartment,
  applyRenameToStats,
  applyRenameToReviews,
} from '@/lib/departments'

// ------------------------------ renameDepartment (mocked supabase) ------------------------------

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

function makeUpdateChain(error: { message: string } | null) {
  const chain: Record<string, unknown> = {}
  chain.update = vi.fn().mockReturnValue(chain)
  chain.eq     = vi.fn().mockResolvedValue({ error })
  return chain
}

describe('renameDepartment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('issues a single bulk update on loto_equipment with the trimmed name', async () => {
    const chain = makeUpdateChain(null)
    vi.mocked(supabase.from).mockReturnValue(chain as unknown as ReturnType<typeof supabase.from>)

    await renameDepartment('Electrical', '  Electric  ')

    expect(supabase.from).toHaveBeenCalledWith('loto_equipment')
    expect(chain.update).toHaveBeenCalledWith({ department: 'Electric' })
    expect(chain.eq).toHaveBeenCalledWith('department', 'Electrical')
  })

  it('no-ops when the new name is empty', async () => {
    await renameDepartment('Electrical', '   ')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('no-ops when the new name matches the old name after trimming', async () => {
    await renameDepartment('Electrical', '  Electrical  ')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('throws an Error with the supabase message on failure', async () => {
    const chain = makeUpdateChain({ message: 'permission denied' })
    vi.mocked(supabase.from).mockReturnValue(chain as unknown as ReturnType<typeof supabase.from>)

    await expect(renameDepartment('A', 'B')).rejects.toThrow('permission denied')
  })
})

// ------------------------------ applyRenameToStats ------------------------------

function stat(department: string, total: number, complete: number, partial = 0, missing = 0): DepartmentStats {
  return {
    department,
    total,
    complete,
    partial,
    missing,
    pct: total > 0 ? Math.round((complete / total) * 100) : 0,
  }
}

describe('applyRenameToStats', () => {
  it('returns the array unchanged when oldName equals newName', () => {
    const prev = [stat('A', 2, 1)]
    expect(applyRenameToStats(prev, 'A', 'A')).toBe(prev)
  })

  it('returns the array unchanged when newName is empty', () => {
    const prev = [stat('A', 2, 1)]
    expect(applyRenameToStats(prev, 'A', '')).toBe(prev)
  })

  it('returns the array unchanged when oldName is not in the list', () => {
    const prev = [stat('A', 2, 1)]
    expect(applyRenameToStats(prev, 'ZZZ', 'NEW')).toBe(prev)
  })

  it('renames a single entry when newName does not collide', () => {
    const prev = [stat('A', 2, 1), stat('B', 3, 3)]
    const next = applyRenameToStats(prev, 'A', 'A2')
    expect(next.map(s => s.department).sort()).toEqual(['A2', 'B'])
    const renamed = next.find(s => s.department === 'A2')!
    expect(renamed.total).toBe(2)
    expect(renamed.complete).toBe(1)
  })

  it('merges into the existing entry when newName already exists', () => {
    const prev = [
      stat('A', 4, 2, 1, 1),   // 50%
      stat('B', 6, 3, 2, 1),   // 50%
    ]
    const next = applyRenameToStats(prev, 'A', 'B')
    expect(next).toHaveLength(1)
    const merged = next[0]
    expect(merged.department).toBe('B')
    expect(merged.total).toBe(10)
    expect(merged.complete).toBe(5)
    expect(merged.partial).toBe(3)
    expect(merged.missing).toBe(2)
    expect(merged.pct).toBe(50)
  })

  it('recomputes pct after merge with rounding (1+2)/(2+3) = 60%)', () => {
    const prev = [
      stat('A', 2, 1),
      stat('B', 3, 2),
    ]
    const next = applyRenameToStats(prev, 'A', 'B')
    expect(next[0].pct).toBe(60)
  })

  it('pct is 0 when merged total is 0', () => {
    const prev = [stat('A', 0, 0), stat('B', 0, 0)]
    const next = applyRenameToStats(prev, 'A', 'B')
    expect(next[0].pct).toBe(0)
  })

  it('does not mutate the original array', () => {
    const prev = [stat('A', 2, 1), stat('B', 3, 3)]
    const snapshot = JSON.parse(JSON.stringify(prev))
    applyRenameToStats(prev, 'A', 'A2')
    expect(prev).toEqual(snapshot)
  })
})

// ------------------------------ applyRenameToReviews ------------------------------

function review(dept: string, approved = true, id = `rev-${dept}`): LotoReview {
  return {
    id,
    department:     dept,
    reviewer_name:  null,
    reviewer_email: null,
    signed_at:      null,
    approved,
    notes:          null,
    created_at:     '2026-01-01T00:00:00Z',
  }
}

describe('applyRenameToReviews', () => {
  it('returns the map unchanged when oldName equals newName', () => {
    const prev = { A: review('A') }
    expect(applyRenameToReviews(prev, 'A', 'A')).toBe(prev)
  })

  it('returns the map unchanged when newName is empty', () => {
    const prev = { A: review('A') }
    expect(applyRenameToReviews(prev, 'A', '')).toBe(prev)
  })

  it('returns the map unchanged when there is no review under oldName', () => {
    const prev = { B: review('B') }
    expect(applyRenameToReviews(prev, 'A', 'A2')).toBe(prev)
  })

  it('re-keys the review from oldName to newName', () => {
    const r = review('A')
    const next = applyRenameToReviews({ A: r }, 'A', 'A2')
    expect(next.A2).toBe(r)
    expect(next.A).toBeUndefined()
  })

  it('keeps the review already at newName and drops the one at oldName', () => {
    const rOld = review('A', true, 'old')
    const rNew = review('B', false, 'new')
    const next = applyRenameToReviews({ A: rOld, B: rNew }, 'A', 'B')
    expect(next.B).toBe(rNew)
    expect(next.A).toBeUndefined()
  })

  it('does not mutate the original map', () => {
    const prev = { A: review('A'), B: review('B') }
    const snapshot = { ...prev }
    applyRenameToReviews(prev, 'A', 'C')
    expect(prev).toEqual(snapshot)
  })
})
