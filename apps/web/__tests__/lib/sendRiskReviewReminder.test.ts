import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mirror the sendInvite/sendReviewLink test pattern: hoist a spy +
// stub the Resend SDK class with one that exposes .emails.send.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock }
  },
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { sendRiskReviewReminder } from '@/lib/email/sendRiskReviewReminder'

const ORIG_ENV = process.env

describe('sendRiskReviewReminder', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    sendMock.mockReset()
    process.env.RESEND_API_KEY = 'test-key'
    sendMock.mockResolvedValue({ data: { id: 'msg-rev-rem-1' }, error: null })
  })
  afterEach(() => { process.env = ORIG_ENV })

  function args(over: Partial<Parameters<typeof sendRiskReviewReminder>[0]> = {}) {
    return {
      to:           'alice@client.com',
      reviewerName: 'Alice',
      tenantName:   'Snak King',
      risks: [
        {
          risk_number:      'RSK-2026-0001',
          title:            'Forklift collision near loading dock',
          effective_band:   'high' as const,
          next_review_date: '2026-04-01',
          days_overdue:     45,
          detail_url:       'https://soteriafield.app/risk/abc',
        },
      ],
      ...over,
    }
  }

  it('skips send + returns providerId null when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY
    const r = await sendRiskReviewReminder(args())
    expect(r).toEqual({ sent: false, providerId: null })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('returns the resend message id on a clean send', async () => {
    const r = await sendRiskReviewReminder(args())
    expect(r).toEqual({ sent: true, providerId: 'msg-rev-rem-1' })
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toBe('alice@client.com')
    expect(call.subject).toBe('1 risk review is overdue — Snak King')
    expect(call.text).toContain('RSK-2026-0001')
    expect(call.text).toContain('Forklift collision')
    expect(call.html).toContain('Forklift collision')
  })

  it('pluralizes the subject when more than one risk is overdue', async () => {
    await sendRiskReviewReminder(args({
      risks: [
        { risk_number: 'RSK-2026-0001', title: 'A', effective_band: 'high',     next_review_date: '2026-04-01', days_overdue: 40, detail_url: 'https://x/risk/a' },
        { risk_number: 'RSK-2026-0002', title: 'B', effective_band: 'extreme',  next_review_date: '2026-03-15', days_overdue: 60, detail_url: 'https://x/risk/b' },
        { risk_number: 'RSK-2026-0003', title: 'C', effective_band: 'moderate', next_review_date: '2026-04-15', days_overdue: 30, detail_url: 'https://x/risk/c' },
      ],
    }))
    expect(sendMock.mock.calls[0][0].subject).toBe('3 risk reviews are overdue — Snak King')
  })

  it('falls back to email local-part when reviewerName is empty', async () => {
    await sendRiskReviewReminder(args({ reviewerName: '', to: 'jane.doe@client.com' }))
    expect(sendMock.mock.calls[0][0].text).toMatch(/^Hi jane\.doe,/)
  })

  it('returns sent:false when Resend rejects', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'rate limited' } })
    const r = await sendRiskReviewReminder(args())
    expect(r).toEqual({ sent: false, providerId: null })
  })

  it('returns sent:false when network throws (does not propagate)', async () => {
    sendMock.mockRejectedValue(new Error('network down'))
    const r = await sendRiskReviewReminder(args())
    expect(r).toEqual({ sent: false, providerId: null })
  })

  it('renders each risk with its band + days_overdue inline', async () => {
    await sendRiskReviewReminder(args({
      risks: [
        { risk_number: 'RSK-1', title: 'X', effective_band: 'extreme', next_review_date: '2026-01-01', days_overdue: 120, detail_url: 'https://x/risk/x' },
      ],
    }))
    const call = sendMock.mock.calls[0][0]
    expect(call.text).toContain('120 days overdue')
    expect(call.text).toContain('[EXTREME]')
    // HTML version uses the band hex via the body’s inline color
    expect(call.html).toContain('#DC2626')
  })
})
