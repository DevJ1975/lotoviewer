import { describe, expect, it } from 'vitest'
import {
  deriveCommandCenterItems,
  highestCommandCenterTone,
  type CommandCenterTone,
} from '@/app/_components/CommandCenterPanel'
import type { HomeMetrics } from '@soteria/core/homeMetrics'

function metrics(partial: Partial<HomeMetrics> = {}): HomeMetrics {
  return {
    commandCenterSafetyAlerts: [],
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
      suggestedAction: 'Review scorecard trends or continue routine field checks.',
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
    expect(items[0].suggestedAction).toBe('Confirm entrants are out, then cancel or close each permit.')
  })

  it('surfaces submitted incident safety alerts before derived program signals', () => {
    const items = deriveCommandCenterItems(metrics({
      commandCenterSafetyAlerts: [{
        id:              'alert-1',
        tenant_id:       'tenant-1',
        incident_id:     'incident-1',
        report_number:   'INC-2026-0001',
        title:           'Injury / illness submitted',
        summary:         'Packaging: employee received first aid',
        severity_tone:   'warning',
        priority:        60,
        status:          'new',
        source:          'incident_submitted',
        created_at:      '2026-05-10T10:00:00.000Z',
        acknowledged_at: null,
        resolved_at:     null,
      }],
      expiredPermitCount: 1,
    }))

    expect(items[0]).toMatchObject({
      id:     'safety-alert-alert-1',
      tone:   'warning',
      label:  'Injury / illness submitted',
      value:  'INC-2026-0001',
      suggestedAction: 'Acknowledge and assign the incident follow-up.',
      href:   '/incidents/incident-1',
    })
    expect(items[1].id).toBe('expired-confined-space-permits')
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

describe('highestCommandCenterTone', () => {
  it('uses the most severe tone even when a lower-severity item appears first', () => {
    const items = deriveCommandCenterItems(metrics({
      commandCenterSafetyAlerts: [{
        id:              'alert-1',
        tenant_id:       'tenant-1',
        incident_id:     'incident-1',
        report_number:   'INC-2026-0001',
        title:           'Injury / illness submitted',
        summary:         'Packaging: employee received first aid',
        severity_tone:   'warning',
        priority:        60,
        status:          'acknowledged',
        source:          'incident_submitted',
        created_at:      '2026-05-10T10:00:00.000Z',
        acknowledged_at: '2026-05-10T10:05:00.000Z',
        resolved_at:     null,
      }],
      expiredPermitCount: 1,
    }))

    expect(items.map(i => i.tone)).toEqual(['warning', 'critical'])
    expect(highestCommandCenterTone(items)).toBe('critical')
  })
})
