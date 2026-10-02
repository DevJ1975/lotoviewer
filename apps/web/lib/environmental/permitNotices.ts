import {
  conditionRemindersDue,
  permitEscalation,
  renewalNoticesDue,
  type ConditionReminder,
  type RenewalNotice,
} from '@soteria/core/environmentalPermit'
import type { ConditionLine, RenewalLine } from '@/lib/email/sendPermitsDue'

// What the nightly permits job owes, and to whom (Phase 2 plan D8-D10). The rules
// for which notices are due live in packages/core/src/environmentalPermit.ts; this
// resolves each notice's recipients and the lines the digest email prints. Pure:
// the route reads the rows and sends the mail.

export interface PermitForNotice {
  id:                         string
  tenant_id:                  string
  title:                      string
  agency:                     string
  permit_number:              string | null
  expires_on:                 string | null
  renewal_application_due_on: string | null
  renewal_submitted_on:       string | null
  business_critical:          boolean
  owner_user_id:              string | null
}

export interface ConditionForNotice {
  id:            string
  tenant_id:     string
  permit_id:     string
  title:         string
  next_due_at:   string
  owner_user_id: string | null
}

/** The people a tenant's notices can reach. */
export interface TenantPeople {
  /** Current members (not a cancelled invitation) among the owners the notices name. */
  activeMembers:     ReadonlySet<string>
  /** Every owner and admin. */
  admins:            readonly string[]
  /** Whoever holds the Compliance obligations process, or null when no one does. */
  obligationsHolder: string | null
}

export interface PlannedNotice {
  tenantId:    string
  subjectType: 'environmental_permit' | 'compliance_obligation'
  subjectId:   string
  /** ms_notification_log.notice_key. */
  noticeKey:   string
  /** Who should hear: user ids, without repeats. */
  recipients:  string[]
  renewal?:    RenewalLine
  condition?:  ConditionLine
}

const unique = (ids: readonly string[]) => [...new Set(ids)]

/** The owner while still a member of the tenant; otherwise the tenant's owners and admins. */
function ownerOrAdmins(owner: string | null, people: TenantPeople): string[] {
  return owner !== null && people.activeMembers.has(owner) ? [owner] : [...people.admins]
}

/** D8: the owner or the admins; a business-critical permit also reaches the Compliance obligations holder, and every owner and admin once it is escalated. */
export function renewalRecipients(
  notice: Pick<RenewalNotice, 'escalate'>,
  permit: Pick<PermitForNotice, 'owner_user_id' | 'business_critical'>,
  people: TenantPeople,
): string[] {
  return unique([
    ...ownerOrAdmins(permit.owner_user_id, people),
    ...(permit.business_critical && people.obligationsHolder !== null ? [people.obligationsHolder] : []),
    ...(notice.escalate ? people.admins : []),
  ])
}

/** The one keyed deliverable of a renewal notice: the line the email prints. */
function renewalLine(permit: PermitForNotice, notice: RenewalNotice, today: string, baseUrl: string): RenewalLine {
  return {
    permitTitle:       permit.title,
    agency:            permit.agency,
    permitNumber:      permit.permit_number,
    deadline:          notice.deadline,
    isApplicationDate: permit.renewal_application_due_on !== null,
    tier:              notice.tier,
    daysLeft:          permitEscalation(notice.deadline, today).daysLeft,
    businessCritical:  permit.business_critical,
    url:               `${baseUrl}/environmental/permits/${permit.id}`,
  }
}

export interface PlanInput {
  today:     string
  baseUrl:   string
  permits:   readonly PermitForNotice[]
  /** Open conditions: obligations linked to a permit. */
  conditions: readonly ConditionForNotice[]
  people:    ReadonlyMap<string, TenantPeople>
  /** sentNoticeKey() values already in ms_notification_log. */
  alreadySent: ReadonlySet<string>
}

const NOBODY: TenantPeople = { activeMembers: new Set(), admins: [], obligationsHolder: null }

/** Every notice due today, each with the people who should hear it. A notice nobody can be told about is still planned: the route releases it. */
export function planPermitNotices(input: PlanInput): PlannedNotice[] {
  const { today, baseUrl, alreadySent } = input
  const peopleOf = (tenantId: string) => input.people.get(tenantId) ?? NOBODY
  const planned: PlannedNotice[] = []

  const permitsById = new Map(input.permits.map(p => [p.id, p]))
  const renewals = renewalNoticesDue(
    input.permits.map(p => ({
      id: p.id, businessCritical: p.business_critical, retiredAt: null,
      expiresOn: p.expires_on, renewalApplicationDueOn: p.renewal_application_due_on, renewalSubmittedOn: p.renewal_submitted_on,
    })),
    today, alreadySent,
  )
  for (const notice of renewals) {
    const permit = permitsById.get(notice.permitId)!
    planned.push({
      tenantId: permit.tenant_id, subjectType: 'environmental_permit', subjectId: permit.id, noticeKey: notice.noticeKey,
      recipients: renewalRecipients(notice, permit, peopleOf(permit.tenant_id)),
      renewal: renewalLine(permit, notice, today, baseUrl),
    })
  }

  const conditionsById = new Map(input.conditions.map(c => [c.id, c]))
  const reminders: ConditionReminder[] = conditionRemindersDue(
    input.conditions.map(c => ({ id: c.id, nextDueAt: c.next_due_at, active: true })), today, alreadySent,
  )
  for (const reminder of reminders) {
    const condition = conditionsById.get(reminder.obligationId)!
    const permit = permitsById.get(condition.permit_id)
    planned.push({
      tenantId: condition.tenant_id, subjectType: 'compliance_obligation', subjectId: condition.id, noticeKey: reminder.noticeKey,
      recipients: unique(ownerOrAdmins(condition.owner_user_id, peopleOf(condition.tenant_id))),
      condition: {
        conditionTitle: condition.title,
        permitTitle:    permit?.title ?? 'its permit',
        dueOn:          reminder.dueOn,
        stage:          reminder.stage,
        url:            `${baseUrl}/environmental/permits/${condition.permit_id}`,
      },
    })
  }
  return planned
}
