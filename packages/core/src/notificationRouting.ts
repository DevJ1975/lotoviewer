// Pure routing logic for multi-channel notifications. No I/O.
//
// Given an event (type + severity) and a tenant's rules, decide which
// channels should receive it: rule is active, event types match, and the
// event severity is at least the rule's minimum.

export type NotificationSeverity = 'info' | 'warning' | 'critical'

export const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
}

export interface RoutingRule {
  channelId:   string
  eventType:   string
  minSeverity: NotificationSeverity
  active:      boolean
}

export interface RoutableEvent {
  type:     string
  severity: NotificationSeverity
}

/**
 * Distinct channel ids that should receive this event. A channel referenced by
 * multiple matching rules appears once (first match wins for ordering).
 */
export function resolveTargetChannelIds(event: RoutableEvent, rules: RoutingRule[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const rule of rules) {
    if (!rule.active) continue
    if (rule.eventType !== event.type) continue
    if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[rule.minSeverity]) continue
    if (seen.has(rule.channelId)) continue
    seen.add(rule.channelId)
    out.push(rule.channelId)
  }
  return out
}

export function isNotificationSeverity(v: unknown): v is NotificationSeverity {
  return v === 'info' || v === 'warning' || v === 'critical'
}
