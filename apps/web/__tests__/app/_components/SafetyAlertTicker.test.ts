import { describe, expect, it } from 'vitest'
import {
  buildSafetyAlertBannerItems,
  filterUnseenSafetyAlertBannerItems,
} from '@/app/_components/SafetyAlertTicker'
import type { CommandCenterSafetyAlert } from '@soteria/core/incidentSafetyAlerts'

function alert(partial: Partial<CommandCenterSafetyAlert> = {}): CommandCenterSafetyAlert {
  return {
    id:              'alert-1',
    tenant_id:       'tenant-1',
    incident_id:     'incident-1',
    report_number:   'INC-2026-0001',
    title:           'Injury / illness submitted',
    summary:         'Packaging line: employee received medical treatment after a cut.',
    severity_tone:   'critical',
    priority:        90,
    status:          'new',
    source:          'incident_submitted',
    created_at:      '2026-05-10T10:00:00.000Z',
    acknowledged_at: null,
    resolved_at:     null,
    ...partial,
  }
}

describe('buildSafetyAlertBannerItems', () => {
  it('builds scrolling banner copy that links to the durable safety alert page', () => {
    const items = buildSafetyAlertBannerItems([alert()])

    expect(items).toEqual([{
      id:      'alert-1',
      href:    '/safety-alerts/alert-1',
      message: 'CRITICAL - INC-2026-0001 - Injury / illness submitted - Packaging line: employee received medical treatment after a cut. - Status: new',
    }])
  })

  it('normalizes underscored alert statuses for field-readable banner text', () => {
    const items = buildSafetyAlertBannerItems([alert({ status: 'in_review', severity_tone: 'warning' })])

    expect(items[0].message).toContain('WARNING')
    expect(items[0].message).toContain('Status: in review')
  })

  it('filters alerts that have already been opened by this browser', () => {
    const items = buildSafetyAlertBannerItems([
      alert({ id: 'alert-1' }),
      alert({ id: 'alert-2', report_number: 'INC-2026-0002' }),
    ])

    expect(filterUnseenSafetyAlertBannerItems(items, ['alert-1'])).toEqual([
      expect.objectContaining({ id: 'alert-2' }),
    ])
  })
})
