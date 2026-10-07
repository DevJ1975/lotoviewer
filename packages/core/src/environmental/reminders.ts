// Who is reminded about which environmental deadline, and when.
//
// Pure planning over rows the cron has already fetched. A deadline is reminded
// about once its reminder window opens (lead_days before it falls due) and again
// every week while it stays open, overdue ones included: a deadline that has
// passed is more urgent, not less. The weekly throttle is the stored
// last_reminded_on, so a cron that runs daily, or twice by accident, never
// emails the same person about the same deadline twice in a week.

import { daysUntilDue } from '../complianceCalendar'

export const REMINDER_INTERVAL_DAYS = 7

export interface ReminderObligation {
  id:               string
  tenant_id:        string
  facility_id:      string | null
  title:            string
  regulatory_ref:   string | null
  status:           string
  next_due_at:      string
  lead_days:        number
  last_reminded_on: string | null
  owner_user_id:    string | null
}

export function reminderDue(o: Pick<ReminderObligation, 'status' | 'next_due_at' | 'lead_days' | 'last_reminded_on'>, now: Date): boolean {
  if (o.status !== 'open') return false
  if (daysUntilDue(o.next_due_at, now) > o.lead_days) return false
  if (o.last_reminded_on === null) return true
  return daysUntilDue(o.last_reminded_on, now) <= -REMINDER_INTERVAL_DAYS
}

export interface ReminderItem {
  obligationId:  string
  facilityId:    string | null
  title:         string
  regulatoryRef: string | null
  dueOn:         string
  /** Negative = overdue by that many days. */
  days:          number
  overdue:       boolean
}

export interface ReminderDigest {
  tenantId: string
  userId:   string
  items:    ReminderItem[]
}

export interface TenantPeople {
  /** Everyone who may be told about this tenant's deadlines: owners, admins and members. */
  memberIds: ReadonlySet<string>
  /** Owners and admins: who hears about a deadline nobody owns. */
  adminIds:  readonly string[]
}

/**
 * One digest per (tenant, person). A deadline goes to its owner when the owner is
 * still a member of the tenant; otherwise (nobody assigned, or the owner has left)
 * to the tenant's admins, so a deadline is never silently orphaned.
 */
export function planReminders(
  obligations: readonly ReminderObligation[],
  people: ReadonlyMap<string, TenantPeople>,
  now: Date,
): ReminderDigest[] {
  const digests = new Map<string, ReminderDigest>()
  for (const o of obligations) {
    if (!reminderDue(o, now)) continue
    const tenant = people.get(o.tenant_id)
    if (!tenant) continue
    const recipients = o.owner_user_id && tenant.memberIds.has(o.owner_user_id) ? [o.owner_user_id] : tenant.adminIds
    const days = daysUntilDue(o.next_due_at, now)
    const item: ReminderItem = {
      obligationId: o.id, facilityId: o.facility_id, title: o.title, regulatoryRef: o.regulatory_ref,
      dueOn: o.next_due_at, days, overdue: days < 0,
    }
    for (const userId of recipients) {
      const key = `${o.tenant_id}:${userId}`
      const digest = digests.get(key) ?? { tenantId: o.tenant_id, userId, items: [] }
      digest.items.push(item)
      digests.set(key, digest)
    }
  }
  // Most urgent first within a digest; stable order across digests.
  return [...digests.values()]
    .map(d => ({ ...d, items: [...d.items].sort((a, b) => a.days - b.days || a.title.localeCompare(b.title)) }))
    .sort((a, b) => a.tenantId.localeCompare(b.tenantId) || a.userId.localeCompare(b.userId))
}

/** Deadlines to stamp as reminded once a digest containing them has actually been sent. */
export const obligationIdsOf = (digests: readonly ReminderDigest[]): string[] =>
  [...new Set(digests.flatMap(d => d.items.map(i => i.obligationId)))]
