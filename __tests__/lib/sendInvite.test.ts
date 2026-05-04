import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mock the Resend module BEFORE importing the helper. Resend's
// constructor returns an object with `emails.send`; tests swap the
// implementation to control success/failure.
const sendMock = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}))

// Sentry is a no-op in tests; we only check the boolean return value
// since the module's side-effects (logging) aren't part of the contract.
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { sendInviteEmail, computeLoginUrl } from '@/lib/email/sendInvite'

const ORIG_ENV = process.env

describe('sendInviteEmail', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    sendMock.mockReset()
    // Default: API key set + send succeeds
    process.env.RESEND_API_KEY = 'test-key'
    sendMock.mockResolvedValue({ data: { id: 'msg-1' }, error: null })
  })

  afterEach(() => {
    process.env = ORIG_ENV
  })

  it('returns false when RESEND_API_KEY is unset and never calls Resend', async () => {
    delete process.env.RESEND_API_KEY
    const ok = await sendInviteEmail({
      to:           'jane@example.com',
      fullName:     'Jane',
      tempPassword: 'X1y2-Z3a4',
      loginUrl:     'https://soteriafield.app',
    })
    expect(ok).toBe(false)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('returns true on a clean Resend success', async () => {
    const ok = await sendInviteEmail({
      to:           'jane@example.com',
      fullName:     'Jane',
      tempPassword: 'X1y2-Z3a4',
      loginUrl:     'https://soteriafield.app',
    })
    expect(ok).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toBe('jane@example.com')
    expect(call.subject).toBe("You're invited to Soteria FIELD")
    // Plain-text body must include the login URL and the temp password.
    expect(call.text).toContain('https://soteriafield.app/login')
    expect(call.text).toContain('X1y2-Z3a4')
  })

  it('puts the tenant name in the subject when provided', async () => {
    await sendInviteEmail({
      to:           'jane@example.com',
      fullName:     'Jane',
      tempPassword: 'X1y2-Z3a4',
      loginUrl:     'https://soteriafield.app',
      tenantName:   'Acme Refining',
    })
    const subject = sendMock.mock.calls[0][0].subject as string
    expect(subject).toBe("You're invited to Acme Refining on Soteria FIELD")
  })

  it('returns false when Resend rejects the send (does not throw)', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'rate limited' } })
    const ok = await sendInviteEmail({
      to:           'jane@example.com',
      fullName:     'Jane',
      tempPassword: 'X1y2-Z3a4',
      loginUrl:     'https://soteriafield.app',
    })
    expect(ok).toBe(false)
  })

  it('returns false when the network call throws (does not propagate)', async () => {
    sendMock.mockRejectedValue(new Error('network down'))
    const ok = await sendInviteEmail({
      to:           'jane@example.com',
      fullName:     'Jane',
      tempPassword: 'X1y2-Z3a4',
      loginUrl:     'https://soteriafield.app',
    })
    expect(ok).toBe(false)
  })

  it('falls back to the email local-part as the display name when fullName is empty', async () => {
    await sendInviteEmail({
      to:           'jane.doe@example.com',
      fullName:     '',
      tempPassword: 'X1y2-Z3a4',
      loginUrl:     'https://soteriafield.app',
    })
    const text = sendMock.mock.calls[0][0].text as string
    expect(text).toMatch(/^Hi jane\.doe,/)
  })

  it('renders the existing-user notification template when tempPassword is empty', async () => {
    await sendInviteEmail({
      to:           'jane@example.com',
      fullName:     'Jane',
      tempPassword: '',
      loginUrl:     'https://soteriafield.app',
      tenantName:   'WLS Demo',
    })
    const call = sendMock.mock.calls[0][0]
    expect(call.subject).toBe("You've been added to WLS Demo on Soteria FIELD")
    // Body mentions tenant + tells them to sign in with existing account;
    // never references a one-time password.
    expect(call.text).toContain('You\'ve been added to WLS Demo')
    expect(call.text).toContain('Sign in with your existing account')
    expect(call.text).not.toContain('Password')
  })
})

describe('computeLoginUrl', () => {
  beforeEach(() => { process.env = { ...ORIG_ENV } })
  afterEach(()  => { process.env = ORIG_ENV })

  function reqWith(headers: Record<string, string> = {}, url = 'http://x/y') {
    return new Request(url, { headers })
  }

  it('prefers NEXT_PUBLIC_APP_URL over headers', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://branded.example.com'
    expect(computeLoginUrl(reqWith({ origin: 'https://other.example.com' })))
      .toBe('https://branded.example.com')
  })

  it('strips trailing slash from the env URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://branded.example.com/'
    expect(computeLoginUrl(reqWith())).toBe('https://branded.example.com')
  })

  it('uses the request origin when env is unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(computeLoginUrl(reqWith({ origin: 'https://preview.vercel.app' })))
      .toBe('https://preview.vercel.app')
  })

  it('falls back to https://<host> when only the host header is present', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(computeLoginUrl(reqWith({ host: 'soteriafield.app' })))
      .toBe('https://soteriafield.app')
  })

  it('returns the canonical placeholder when nothing is available', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(computeLoginUrl(reqWith())).toBe('https://soteriafield.app')
  })
})
