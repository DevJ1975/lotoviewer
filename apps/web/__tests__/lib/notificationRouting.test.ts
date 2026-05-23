import { describe, it, expect } from 'vitest'
import {
  resolveTargetChannelIds,
  isNotificationSeverity,
  SEVERITY_RANK,
  type RoutingRule,
} from '@soteria/core/notificationRouting'

const rules: RoutingRule[] = [
  { channelId: 'sms1',   eventType: 'incident.created', minSeverity: 'critical', active: true },
  { channelId: 'teams1', eventType: 'incident.created', minSeverity: 'warning',  active: true },
  { channelId: 'email1', eventType: 'incident.created', minSeverity: 'info',     active: true },
  { channelId: 'off1',   eventType: 'incident.created', minSeverity: 'info',     active: false },
  { channelId: 'other',  eventType: 'permit.expired',   minSeverity: 'info',     active: true },
]

describe('resolveTargetChannelIds', () => {
  it('routes a critical event to every rule at or below its severity', () => {
    const got = resolveTargetChannelIds({ type: 'incident.created', severity: 'critical' }, rules)
    expect(got).toEqual(['sms1', 'teams1', 'email1'])
  })

  it('drops higher-severity-only rules for a lower-severity event', () => {
    const got = resolveTargetChannelIds({ type: 'incident.created', severity: 'warning' }, rules)
    expect(got).toEqual(['teams1', 'email1']) // sms1 needs critical
  })

  it('an info event only hits info-threshold rules', () => {
    const got = resolveTargetChannelIds({ type: 'incident.created', severity: 'info' }, rules)
    expect(got).toEqual(['email1'])
  })

  it('ignores inactive rules and non-matching event types', () => {
    const got = resolveTargetChannelIds({ type: 'permit.expired', severity: 'critical' }, rules)
    expect(got).toEqual(['other'])
  })

  it('deduplicates a channel referenced by multiple matching rules', () => {
    const dup: RoutingRule[] = [
      { channelId: 'c', eventType: 'e', minSeverity: 'info', active: true },
      { channelId: 'c', eventType: 'e', minSeverity: 'warning', active: true },
    ]
    expect(resolveTargetChannelIds({ type: 'e', severity: 'critical' }, dup)).toEqual(['c'])
  })

  it('returns empty when nothing matches', () => {
    expect(resolveTargetChannelIds({ type: 'nope', severity: 'critical' }, rules)).toEqual([])
  })
})

describe('isNotificationSeverity', () => {
  it('validates the enum', () => {
    expect(isNotificationSeverity('critical')).toBe(true)
    expect(isNotificationSeverity('high')).toBe(false)
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.info)
  })
})
