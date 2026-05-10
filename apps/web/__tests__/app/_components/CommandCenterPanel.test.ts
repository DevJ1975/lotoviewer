import { describe, expect, it } from 'vitest'
import {
  deriveCommandCenterItems,
  type CommandCenterTone,
} from '@/app/_components/CommandCenterPanel'
import type { HomeMetrics } from '@soteria/core/homeMetrics'

function metrics(partial: Partial<HomeMetrics> = {}): HomeMetrics {
  return {
    activePermits:        [],
    activePermitCount:    0,
    expiredPermitCount:   0,
    peopleInSpaces:       0,
    totalEquipment:       0,
    photoCompletionPct:   0,
    recentActivity:       [],
    expiringSoonPermits:  [],
    pendingStalePermits:  [],
    hotWorkExpiringSoon:  [],
    hotWorkInPostWatch:   [],
    ...partial,
  }
}

describe('deriveCommandCenterItems', () => {
  it('returns an all-clear item when no signals need attention', () => {
    const items = deriveCommandCenterItems(metrics())

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id:   'all-clear',
      tone: 'ok' satisfies CommandCenterTone,
    })
  })

  it('prioritizes expired permits before warning and attention signals', () => {
    const items = deriveCommandCenterItems(metrics({
      expiredPermitCount: 2,
      expiringSoonPermits: [{ id: 'p1', serial: 'CSP-1', spaceId: 'CS-1', minutes: 30 }],
      hotWorkInPostWatch: [{ id: 'h1', serial: 'HWP-1', workLocation: 'Bay 4', kind: 'post_watch', minutes: 20 }],
    }))

    expect(items.map(i => i.id)).toEqual([
      'expired-confined-space-permits',
      'confined-space-expiring',
      'fire-watch-active',
    ])
    expect(items[0].tone).toBe('critical')
  })

  it('surfaces low LOTO photo coverage only when equipment exists', () => {
    expect(deriveCommandCenterItems(metrics({
      totalEquipment: 0,
      photoCompletionPct: 40,
    })).map(i => i.id)).not.toContain('loto-photo-coverage')

    const items = deriveCommandCenterItems(metrics({
      totalEquipment: 10,
      photoCompletionPct: 68,
    }))

    expect(items).toContainEqual(expect.objectContaining({
      id:    'loto-photo-coverage',
      tone:  'warning',
      value: '68%',
    }))
  })

  it('shows active confined-space entries as an attention signal', () => {
    const items = deriveCommandCenterItems(metrics({
      activePermitCount: 3,
      peopleInSpaces: 5,
    }))

    expect(items).toEqual([
      expect.objectContaining({
        id:     'active-confined-space-permits',
        tone:   'attention',
        value:  '3',
        detail: '5 entrants currently in spaces.',
      }),
    ])
  })
})
