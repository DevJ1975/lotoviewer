// The compliance-evaluation email puts tenant-entered text (obligation
// titles, the organization's name) into HTML, so it must escape it, and it
// must carry the one-click unsubscribe the 'reminders' category promises.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const logEmailSendMock = vi.fn()
vi.mock('@/lib/email/instrument', () => ({ logEmailSend: (...a: unknown[]) => logEmailSendMock(...a) }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { renderHtml, renderText, sendComplianceEvaluationDue } from '@/lib/email/sendComplianceEvaluationDue'

const args = {
  to: 'permit.owner@example.test',
  recipientName: 'Permit Owner',
  tenantName: 'Northfield <Forge> & Finish',
  evaluations: [
    { obligationTitle: '<img src=x onerror=alert(1)> DMRs', scheduledFor: '2026-10-17', url: 'https://app.test/environmental/obligations/o1?a=1&b="2"' },
  ],
  unsubscribeUrl: 'https://app.test/api/email/unsubscribe?token=t',
}

const ORIG_ENV = process.env
beforeEach(() => { logEmailSendMock.mockReset(); process.env = { ...ORIG_ENV } })
afterEach(() => { process.env = ORIG_ENV })

describe('sendComplianceEvaluationDue', () => {
  it('escapes tenant-entered text in the HTML', () => {
    const html = renderHtml(args)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; DMRs')
    expect(html).toContain('Northfield &lt;Forge&gt; &amp; Finish')
    expect(html).toContain('href="https://app.test/environmental/obligations/o1?a=1&amp;b=&quot;2&quot;"')
  })

  it('lists each evaluation with its due date and link, and the unsubscribe link, in the text part', () => {
    const text = renderText(args)
    expect(text).toContain('Due 2026-10-17 · https://app.test/environmental/obligations/o1')
    expect(text).toContain('Unsubscribe from these reminder emails: https://app.test/api/email/unsubscribe?token=t')
    expect(text).toMatch(/^Hi Permit Owner,/)
  })

  it('leaves the unsubscribe footer out when there is no link', () => {
    expect(renderText({ ...args, unsubscribeUrl: null })).not.toContain('Unsubscribe')
  })

  it('skips the send, and records why, when Resend is not configured', async () => {
    delete process.env.RESEND_API_KEY
    expect(await sendComplianceEvaluationDue(args)).toEqual({ sent: false, providerId: null })
    expect(logEmailSendMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'compliance-evaluation-due', status: 'skipped',
    }))
  })
})
