import { describe, it, expect } from 'vitest'
import { renderHtml, renderSubject, renderText, type ComplianceReminderArgs } from '@/lib/email/sendComplianceReminder'

const args = (over: Partial<ComplianceReminderArgs> = {}): ComplianceReminderArgs => ({
  to: 'pat@example.com', recipientName: 'Pat', tenantName: 'Acme Foods', calendarUrl: 'https://app.example.com/environmental/compliance/calendar',
  items: [
    { title: 'Annual report', regulatoryRef: 'IGP §XVI', site: 'Anaheim Plant', dueOn: '2026-09-30', days: -7, overdue: true },
    { title: 'Quarterly visual', regulatoryRef: null, site: 'Houston DC', dueOn: '2026-10-10', days: 3, overdue: false },
  ],
  ...over,
})

describe('compliance reminder email', () => {
  it('counts overdue and due-soon in the subject, naming the tenant', () => {
    expect(renderSubject(args())).toBe('Environmental compliance: 1 overdue, 1 due soon — Acme Foods')
    expect(renderSubject(args({ items: [args().items[0]!] }))).toBe('Environmental compliance: 1 overdue — Acme Foods')
    expect(renderSubject(args({ items: [args().items[1]!] }))).toBe('Environmental compliance: 1 due soon — Acme Foods')
  })

  it('says plainly how late or how soon each deadline is, with the site and the reference', () => {
    const text = renderText(args())
    expect(text).toContain('Annual report [IGP §XVI] — Anaheim Plant: OVERDUE by 7 days (was due 2026-09-30)')
    expect(text).toContain('Quarterly visual — Houston DC: due in 3 days (2026-10-10)')
    expect(text).toContain('https://app.example.com/environmental/compliance/calendar')
  })

  it('uses the singular for one day and says "today" on the day', () => {
    const one = renderText(args({ items: [{ title: 'A', regulatoryRef: null, site: 'S', dueOn: '2026-10-08', days: 1, overdue: false }] }))
    expect(one).toContain('due in 1 day (')
    const today = renderText(args({ items: [{ title: 'A', regulatoryRef: null, site: 'S', dueOn: '2026-10-07', days: 0, overdue: false }] }))
    expect(today).toContain('due today (2026-10-07)')
  })

  it('escapes anything a person typed before it reaches the HTML', () => {
    const html = renderHtml(args({
      tenantName: '<script>alert(1)</script>',
      items: [{ title: '"><img src=x onerror=alert(1)>', regulatoryRef: '<b>ref</b>', site: "O'Brien & Sons", dueOn: '2026-10-10', days: 3, overdue: false }],
    }))
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>ref</b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('O&#39;Brien &amp; Sons')
  })

  it('addresses the person by name, falling back to the start of their address', () => {
    expect(renderText(args())).toMatch(/^Hi Pat,/)
    expect(renderText(args({ recipientName: ' ' }))).toMatch(/^Hi pat,/)
  })

  it('adds an unsubscribe footer only when it has a link', () => {
    expect(renderText(args())).not.toMatch(/unsubscribe/i)
    expect(renderText(args({ unsubscribeUrl: 'https://app.example.com/u/abc' }))).toContain('https://app.example.com/u/abc')
  })
})
