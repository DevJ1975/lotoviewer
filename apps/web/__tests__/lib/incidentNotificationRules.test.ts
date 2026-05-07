import { describe, it, expect } from 'vitest'
import {
  matchRules,
  buildRecipientList,
  buildDispatchPlan,
  type IncidentNotificationRule,
  type IncidentRuleMember,
} from '@soteria/core/incidentNotificationRules'

const baseRule: IncidentNotificationRule = {
  id:                       'rule-1',
  tenant_id:                't-1',
  name:                     'test rule',
  enabled:                  true,
  match_incident_type:      null,
  match_severity_actual:    null,
  match_severity_potential: null,
  match_recordable:         null,
  notify_roles:             null,
  notify_user_ids:          null,
  notify_emails:            null,
  channels:                 ['email'],
  escalation_minutes:       null,
}

const baseIncident = {
  incident_type:      'injury_illness' as const,
  severity_actual:    'medical' as const,
  severity_potential: null,
}

describe('matchRules', () => {
  it('matches a wide-open enabled rule', () => {
    expect(matchRules(baseIncident, [baseRule], false)).toHaveLength(1)
  })

  it('skips disabled rules', () => {
    expect(matchRules(baseIncident, [{ ...baseRule, enabled: false }], false))
      .toHaveLength(0)
  })

  it('filters by incident_type', () => {
    const r = { ...baseRule, match_incident_type: ['near_miss' as const] }
    expect(matchRules(baseIncident, [r], false)).toHaveLength(0)
    expect(matchRules({ ...baseIncident, incident_type: 'near_miss' }, [r], false))
      .toHaveLength(1)
  })

  it('filters by severity_actual', () => {
    const r = { ...baseRule, match_severity_actual: ['lost_time' as const, 'fatality' as const] }
    expect(matchRules(baseIncident, [r], false)).toHaveLength(0)
    expect(matchRules({ ...baseIncident, severity_actual: 'fatality' }, [r], false))
      .toHaveLength(1)
  })

  it('filters by recordable=true', () => {
    const r = { ...baseRule, match_recordable: true }
    expect(matchRules(baseIncident, [r], false)).toHaveLength(0)
    expect(matchRules(baseIncident, [r], true)).toHaveLength(1)
  })

  it('filters by recordable=false (non-recordable only)', () => {
    const r = { ...baseRule, match_recordable: false }
    expect(matchRules(baseIncident, [r], false)).toHaveLength(1)
    expect(matchRules(baseIncident, [r], true)).toHaveLength(0)
  })

  it('requires a non-null severity_potential to match a potential filter', () => {
    const r = { ...baseRule, match_severity_potential: ['high' as const] }
    expect(matchRules(baseIncident, [r], false)).toHaveLength(0)
    expect(matchRules({ ...baseIncident, severity_potential: 'high' }, [r], false))
      .toHaveLength(1)
  })

  it('ANDs all filters together', () => {
    const r = {
      ...baseRule,
      match_incident_type:   ['injury_illness' as const],
      match_severity_actual: ['lost_time' as const],
    }
    // matches type but not severity
    expect(matchRules(baseIncident, [r], false)).toHaveLength(0)
    expect(matchRules({ ...baseIncident, severity_actual: 'lost_time' }, [r], false))
      .toHaveLength(1)
  })
})

describe('buildRecipientList', () => {
  const memberships: IncidentRuleMember[] = [
    { user_id: 'u-owner',  email: 'owner@x.com',  role: 'owner' },
    { user_id: 'u-admin1', email: 'admin1@x.com', role: 'admin' },
    { user_id: 'u-admin2', email: 'admin2@x.com', role: 'admin' },
    { user_id: 'u-member', email: 'member@x.com', role: 'member' },
  ]

  it('expands roles to user-ids + emails', () => {
    const r = { ...baseRule, notify_roles: ['admin' as const], channels: ['email' as const] }
    const out = buildRecipientList(r, memberships)
    expect(out).toHaveLength(2)
    expect(out.map(o => o.email).sort()).toEqual(['admin1@x.com', 'admin2@x.com'])
  })

  it('fans recipients across channels', () => {
    const r = { ...baseRule, notify_roles: ['admin' as const], channels: ['email' as const, 'push' as const] }
    const out = buildRecipientList(r, memberships)
    // 2 admins × 2 channels = 4
    expect(out).toHaveLength(4)
  })

  it('dedupes when role + explicit user_id overlap', () => {
    const r = {
      ...baseRule,
      notify_roles:    ['admin' as const],
      notify_user_ids: ['u-admin1'],
      channels:        ['email' as const],
    }
    const out = buildRecipientList(r, memberships)
    expect(out).toHaveLength(2)
  })

  it('routes raw emails through the email channel only', () => {
    const r = {
      ...baseRule,
      notify_emails: ['external@vendor.com'],
      channels:      ['email' as const, 'push' as const],
    }
    const out = buildRecipientList(r, memberships)
    expect(out).toHaveLength(1)
    expect(out[0]!.channel).toBe('email')
    expect(out[0]!.email).toBe('external@vendor.com')
  })

  it('skips empty/whitespace email strings', () => {
    const r = {
      ...baseRule,
      notify_emails: ['', '   ', 'real@x.com'],
      channels:      ['email' as const],
    }
    const out = buildRecipientList(r, memberships)
    expect(out).toHaveLength(1)
    expect(out[0]!.email).toBe('real@x.com')
  })

  it('handles user_ids with no membership row gracefully', () => {
    const r = {
      ...baseRule,
      notify_user_ids: ['u-stranger'],
      channels:        ['email' as const],
    }
    const out = buildRecipientList(r, memberships)
    expect(out).toHaveLength(1)
    expect(out[0]!.user_id).toBe('u-stranger')
    expect(out[0]!.email).toBeNull()
  })
})

describe('buildDispatchPlan', () => {
  const memberships: IncidentRuleMember[] = [
    { user_id: 'u-owner', email: 'owner@x.com', role: 'owner' },
    { user_id: 'u-admin', email: 'admin@x.com', role: 'admin' },
  ]

  it('dedupes recipients across two matching rules', () => {
    const ruleA: IncidentNotificationRule = {
      ...baseRule,
      id:           'a',
      notify_roles: ['owner', 'admin'],
      channels:     ['email'],
    }
    const ruleB: IncidentNotificationRule = {
      ...baseRule,
      id:           'b',
      notify_roles: ['admin'],
      channels:     ['email'],
    }
    const plan = buildDispatchPlan(baseIncident, [ruleA, ruleB], memberships, false)
    // 2 distinct emails, no duplicates even though admin is in both rules
    const emails = plan.map(p => p.recipient.email).sort()
    expect(emails).toEqual(['admin@x.com', 'owner@x.com'])
  })

  it('returns nothing when no rule matches', () => {
    const ruleA: IncidentNotificationRule = {
      ...baseRule,
      match_incident_type: ['near_miss'],
      notify_roles:        ['owner'],
    }
    expect(buildDispatchPlan(baseIncident, [ruleA], memberships, false))
      .toHaveLength(0)
  })

  it('attributes each recipient to a rule_id', () => {
    const rule: IncidentNotificationRule = {
      ...baseRule,
      id:           'rule-x',
      notify_roles: ['owner'],
      channels:     ['email'],
    }
    const plan = buildDispatchPlan(baseIncident, [rule], memberships, false)
    expect(plan[0]?.rule_id).toBe('rule-x')
  })
})
