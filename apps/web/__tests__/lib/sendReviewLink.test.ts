import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mirror the sendInvite test's mock pattern: hoist a spy, mock the
// Resend class so `new Resend(apiKey).emails.send` lands on the spy.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock }
  },
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { sendReviewLinkEmail } from '@/lib/email/sendReviewLink'

const ORIG_ENV = process.env

describe('sendReviewLinkEmail', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    sendMock.mockReset()
    process.env.RESEND_API_KEY = 'test-key'
    sendMock.mockResolvedValue({ data: { id: 'msg-rev-1' }, error: null })
  })
  afterEach(() => { process.env = ORIG_ENV })

  function baseArgs(over: Partial<Parameters<typeof sendReviewLinkEmail>[0]> = {}) {
    return {
      to:            'alice@client.com',
      reviewerName:  'Alice',
      tenantName:    'Snak King',
      department:    'Mechanical',
      placardCount:  12,
      reviewUrl:     'https://soteriafield.app/review/0123456789abcdef0123456789abcdef',
      expiresAt:     '2026-06-04T00:00:00.000Z',
      ...over,
    }
  }

  it('skips send + returns providerId null when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY
    const r = await sendReviewLinkEmail(baseArgs())
    expect(r).toEqual({ sent: false, providerId: null })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('returns the resend message id on a clean send', async () => {
    const r = await sendReviewLinkEmail(baseArgs())
    expect(r).toEqual({ sent: true, providerId: 'msg-rev-1' })
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toBe('alice@client.com')
    expect(call.subject).toBe('Please review LOTO placards for Mechanical — Snak King')
    // Both text + HTML must contain the review URL + the placard count.
    expect(call.text).toContain('12 LOTO placards')
    expect(call.text).toContain('https://soteriafield.app/review/0123456789abcdef0123456789abcdef')
    expect(call.html).toContain('Snak King')
    expect(call.html).toContain('Mechanical')
  })

  it('passes replyTo through to Resend so the reviewer can reply to the admin', async () => {
    await sendReviewLinkEmail(baseArgs({ replyTo: 'admin@snakking.com' }))
    const call = sendMock.mock.calls[0][0]
    expect(call.replyTo).toBe('admin@snakking.com')
  })

  it('renders the admin message in a quoted block when present', async () => {
    await sendReviewLinkEmail(baseArgs({ adminMessage: 'Look at the new fryers.' }))
    const call = sendMock.mock.calls[0][0]
    expect(call.text).toContain('> Look at the new fryers.')
    expect(call.html).toContain('Look at the new fryers.')
  })

  it('singularizes "placard" when count is 1', async () => {
    await sendReviewLinkEmail(baseArgs({ placardCount: 1 }))
    expect(sendMock.mock.calls[0][0].text).toContain('1 LOTO placard ')
  })

  it('falls back to the email local-part when reviewerName is empty', async () => {
    await sendReviewLinkEmail(baseArgs({ reviewerName: '', to: 'jane.doe@client.com' }))
    expect(sendMock.mock.calls[0][0].text).toMatch(/^Hi jane\.doe,/)
  })

  it('returns sent:false when Resend rejects (does not throw)', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'rate limited' } })
    const r = await sendReviewLinkEmail(baseArgs())
    expect(r).toEqual({ sent: false, providerId: null })
  })

  it('returns sent:false when network throws (does not propagate)', async () => {
    sendMock.mockRejectedValue(new Error('network down'))
    const r = await sendReviewLinkEmail(baseArgs())
    expect(r).toEqual({ sent: false, providerId: null })
  })
})
