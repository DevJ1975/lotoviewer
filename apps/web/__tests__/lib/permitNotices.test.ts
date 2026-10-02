// Who hears about each permit notice (Phase 2 plan D8, D9), worked out without any I/O.

import { describe, it, expect } from 'vitest'
import { addCalendarDays } from '@soteria/core/managementSystem'
import {
  planPermitNotices, renewalRecipients,
  type ConditionForNotice, type PermitForNotice, type TenantPeople,
} from '@/lib/environmental/permitNotices'

const TODAY = '2026-10-02'
const inDays = (days: number) => addCalendarDays(TODAY, days)
const OWNER = 'owner', ADMIN_1 = 'admin-1', ADMIN_2 = 'admin-2', HOLDER = 'holder', STRANGER = 'stranger'
const TENANT = 'tenant-a'

const people = (over: Partial<TenantPeople> = {}): TenantPeople => ({
  activeMembers: new Set([OWNER, HOLDER]), admins: [ADMIN_1, ADMIN_2], obligationsHolder: HOLDER, ...over,
})

const permit = (over: Partial<PermitForNotice> = {}): PermitForNotice => ({
  id: 'p1', tenant_id: TENANT, title: 'Wastewater permit', agency: 'City of Northfield', permit_number: 'DEMO-1',
  expires_on: inDays(29), renewal_application_due_on: null, renewal_submitted_on: null, business_critical: false,
  owner_user_id: OWNER, ...over,
})
const condition = (over: Partial<ConditionForNotice> = {}): ConditionForNotice => ({
  id: 'c1', tenant_id: TENANT, permit_id: 'p1', title: 'Quarterly report', next_due_at: inDays(5), owner_user_id: OWNER, ...over,
})

const plan = (over: Partial<Parameters<typeof planPermitNotices>[0]> = {}) => planPermitNotices({
  today: TODAY, baseUrl: 'https://app.test', permits: [permit()], conditions: [], people: new Map([[TENANT, people()]]),
  alreadySent: new Set(), ...over,
})

describe('renewalRecipients', () => {
  it('is the owner while a current member', () => {
    expect(renewalRecipients({ escalate: false }, permit(), people())).toEqual([OWNER])
  })

  it('is every owner and admin when the permit has no owner, or the owner has left', () => {
    expect(renewalRecipients({ escalate: false }, permit({ owner_user_id: null }), people())).toEqual([ADMIN_1, ADMIN_2])
    expect(renewalRecipients({ escalate: false }, permit({ owner_user_id: STRANGER }), people())).toEqual([ADMIN_1, ADMIN_2])
  })

  it('adds the Compliance obligations holder for a business-critical permit, and only then', () => {
    expect(renewalRecipients({ escalate: false }, permit({ business_critical: true }), people())).toEqual([OWNER, HOLDER])
    expect(renewalRecipients({ escalate: false }, permit({ business_critical: false }), people())).toEqual([OWNER])
    expect(renewalRecipients({ escalate: false }, permit({ business_critical: true }), people({ obligationsHolder: null }))).toEqual([OWNER])
  })

  it('adds every owner and admin when escalated, without naming anyone twice', () => {
    expect(renewalRecipients({ escalate: true }, permit({ business_critical: true }), people())).toEqual([OWNER, HOLDER, ADMIN_1, ADMIN_2])
    expect(renewalRecipients({ escalate: true }, permit({ owner_user_id: ADMIN_1, business_critical: true }),
      people({ activeMembers: new Set([ADMIN_1]) }))).toEqual([ADMIN_1, HOLDER, ADMIN_2])
  })

  it('is empty when nobody can be told', () => {
    expect(renewalRecipients({ escalate: false }, permit({ owner_user_id: null }), people({ admins: [] }))).toEqual([])
  })
})

describe('planPermitNotices', () => {
  it('plans a renewal notice with the line the email prints', () => {
    const [notice] = plan()
    expect(notice).toMatchObject({
      tenantId: TENANT, subjectType: 'environmental_permit', subjectId: 'p1', noticeKey: `renewal:30:${inDays(29)}`, recipients: [OWNER],
      renewal: {
        permitTitle: 'Wastewater permit', agency: 'City of Northfield', permitNumber: 'DEMO-1', deadline: inDays(29),
        isApplicationDate: false, tier: 30, daysLeft: 29, businessCritical: false, url: 'https://app.test/environmental/permits/p1',
      },
    })
  })

  it('knows when the deadline is the application date rather than the expiry', () => {
    const [notice] = plan({ permits: [permit({ expires_on: inDays(200), renewal_application_due_on: inDays(85) })] })
    expect(notice.renewal).toMatchObject({ isApplicationDate: true, deadline: inDays(85), tier: 90 })
  })

  it('plans a condition reminder to the condition\'s owner, linking to its permit', () => {
    const [notice] = plan({ permits: [permit({ expires_on: inDays(400) })], conditions: [condition()] })
    expect(notice).toMatchObject({
      subjectType: 'compliance_obligation', subjectId: 'c1', noticeKey: `condition:due_soon:${inDays(5)}`, recipients: [OWNER],
      condition: { conditionTitle: 'Quarterly report', permitTitle: 'Wastewater permit', stage: 'due_soon', url: 'https://app.test/environmental/permits/p1' },
    })
  })

  it('sends a condition with no owner, or whose owner has left, to the admins', () => {
    const notices = plan({ conditions: [condition({ owner_user_id: null }), condition({ id: 'c2', owner_user_id: STRANGER })] })
      .filter(notice => notice.condition)
    expect(notices.map(n => n.recipients)).toEqual([[ADMIN_1, ADMIN_2], [ADMIN_1, ADMIN_2]])
  })

  it('skips what was already sent', () => {
    expect(plan({ alreadySent: new Set([`p1/renewal:30:${inDays(29)}`]) })).toEqual([])
  })

  it('plans a notice with no recipients for a tenant it knows nobody in, so the job can release it', () => {
    const [notice] = plan({ people: new Map() })
    expect(notice.recipients).toEqual([])
  })

  it('sends no reminder for a condition whose permit is not active, so retiring a permit silences its conditions too', () => {
    expect(plan({ permits: [], conditions: [condition({ permit_id: 'retired-or-gone' })] })).toEqual([])
  })
})
