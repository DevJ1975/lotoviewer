// The permits email puts tenant-entered text (permit and condition titles, agencies, the
// organization's name) into HTML, so it must escape it; it must carry the one-click
// unsubscribe the 'reminders' category promises; and it must say plainly what a deadline is
// the deadline for, and never that a permit "expires" when only its renewal application is due.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const logEmailSendMock = vi.fn()
vi.mock('@/lib/email/instrument', () => ({ logEmailSend: (...a: unknown[]) => logEmailSendMock(...a) }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import {
  conditionWording, renderHtml, renderText, renewalWording, sendPermitsDue, subjectFor,
  type PermitsDueArgs, type RenewalLine,
} from '@/lib/email/sendPermitsDue'

const renewal = (over: Partial<RenewalLine> = {}): RenewalLine => ({
  permitTitle: 'Wastewater discharge permit', agency: 'City of Northfield', permitNumber: 'DEMO-IWD-0001',
  deadline: '2026-10-31', isApplicationDate: true, tier: 30, daysLeft: 29, businessCritical: true,
  url: 'https://app.test/environmental/permits/p1', ...over,
})

const args: PermitsDueArgs = {
  to: 'permit.owner@example.test',
  recipientName: 'Permit Owner',
  tenantName: 'Northfield <Forge> & Finish',
  renewals: [renewal({ permitTitle: '<img src=x onerror=alert(1)> permit', url: 'https://app.test/p?a=1&b="2"' })],
  conditions: [{ conditionTitle: 'Quarterly <b>report</b>', permitTitle: 'Wastewater discharge permit', dueOn: '2026-10-10', stage: 'due_soon', url: 'https://app.test/environmental/permits/p1' }],
  unsubscribeUrl: 'https://app.test/api/email/unsubscribe?token=t',
}

const ORIG_ENV = process.env
beforeEach(() => { logEmailSendMock.mockReset(); process.env = { ...ORIG_ENV } })
afterEach(() => { process.env = ORIG_ENV })

describe('wording', () => {
  it('says the permit expires when the deadline is its expiry, and that the application is due when it is that', () => {
    expect(renewalWording(renewal({ isApplicationDate: false }))).toBe('The permit expires in 29 days (2026-10-31).')
    expect(renewalWording(renewal({ isApplicationDate: true }))).toBe('The renewal application is due in 29 days (2026-10-31).')
  })

  it('says today, and one day, correctly', () => {
    expect(renewalWording(renewal({ daysLeft: 0 }))).toBe('The renewal application is due today.')
    expect(renewalWording(renewal({ daysLeft: 1 }))).toBe('The renewal application is due in 1 day (2026-10-31).')
  })

  it('says how long ago a deadline passed, and sends the reader to the agency rather than guess the permit\'s status', () => {
    expect(renewalWording(renewal({ tier: 'passed', daysLeft: -4, isApplicationDate: false })))
      .toBe('The permit expires on 2026-10-31, 4 days ago. Confirm its status with the agency.')
    expect(renewalWording(renewal({ tier: 'passed', daysLeft: -1 }))).toContain('1 day ago')
  })

  it('words a condition due soon and one overdue', () => {
    expect(conditionWording({ conditionTitle: 'x', permitTitle: 'y', dueOn: '2026-10-10', stage: 'due_soon', url: '' })).toBe('Due 2026-10-10.')
    expect(conditionWording({ conditionTitle: 'x', permitTitle: 'y', dueOn: '2026-09-30', stage: 'overdue', url: '' })).toBe('Was due 2026-09-30.')
  })

  it('counts what needs attention in the subject, in the singular and the plural', () => {
    expect(subjectFor(args)).toBe('1 permit renewal and 1 permit condition need attention — Northfield <Forge> & Finish')
    expect(subjectFor({ ...args, conditions: [], renewals: [renewal(), renewal()] })).toMatch(/^2 permit renewals need attention/)
    expect(subjectFor({ ...args, renewals: [] })).toMatch(/^1 permit condition needs attention/)
    expect(subjectFor({ ...args, conditions: [], renewals: [renewal()] })).toMatch(/^1 permit renewal needs attention/)
  })
})

describe('rendering', () => {
  it('escapes tenant-entered text in the HTML', () => {
    const html = renderHtml(args)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>report</b>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; permit')
    expect(html).toContain('Northfield &lt;Forge&gt; &amp; Finish')
    expect(html).toContain('href="https://app.test/p?a=1&amp;b=&quot;2&quot;"')
  })

  it('lists renewals and conditions in their own sections, and leaves out a section with nothing in it', () => {
    const html = renderHtml(args)
    expect(html).toContain('>Renewals<')
    expect(html).toContain('>Conditions<')
    expect(renderHtml({ ...args, conditions: [] })).not.toContain('>Conditions<')
    expect(renderText({ ...args, renewals: [] })).not.toContain('Renewals')
  })

  it('marks a business-critical permit, and gives the number, in both parts', () => {
    expect(renderText(args)).toContain('(DEMO-IWD-0001) — City of Northfield [business-critical]')
    expect(renderHtml(args)).toContain('DEMO-IWD-0001 · business-critical')
  })

  it('carries the wording, the links and the one-click unsubscribe in the text part', () => {
    const text = renderText(args)
    expect(text).toMatch(/^Hi Permit Owner,/)
    expect(text).toContain('The renewal application is due in 29 days (2026-10-31). https://app.test/p?a=1&b="2"')
    expect(text).toContain('Quarterly <b>report</b> — Wastewater discharge permit\n    Due 2026-10-10.')
    expect(text).toContain('Unsubscribe from these reminder emails: https://app.test/api/email/unsubscribe?token=t')
  })

  it('leaves the unsubscribe footer out when there is no link, and falls back to the address for a name', () => {
    expect(renderText({ ...args, unsubscribeUrl: null })).not.toContain('Unsubscribe')
    expect(renderText({ ...args, recipientName: ' ' })).toMatch(/^Hi permit\.owner,/)
  })

  it('colours a passed deadline differently from one coming up', () => {
    const passed = renderHtml({ ...args, renewals: [renewal({ tier: 'passed', daysLeft: -2 })] })
    const upcoming = renderHtml({ ...args, renewals: [renewal({ tier: 90, daysLeft: 80 })] })
    expect(passed).toContain('border-left:4px solid #b91c1c')
    expect(upcoming).not.toContain('border-left:4px solid #b91c1c')
  })
})

describe('sendPermitsDue', () => {
  it('skips the send, and records why, when Resend is not configured', async () => {
    delete process.env.RESEND_API_KEY
    expect(await sendPermitsDue(args)).toEqual({ sent: false, providerId: null })
    expect(logEmailSendMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'permits-due', status: 'skipped' }))
  })
})
