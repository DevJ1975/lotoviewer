import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribe,
} from '@/lib/email/unsubscribe'

const ORIG = process.env.EMAIL_UNSUBSCRIBE_SECRET
const SECRET = 'unit-test-secret'

beforeEach(() => { process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET })
afterEach(() => { process.env.EMAIL_UNSUBSCRIBE_SECRET = ORIG })

describe('unsubscribe token', () => {
  it('round-trips email + category', () => {
    const token = signUnsubscribeToken('Person@Example.com', 'weekly_digest')!
    expect(token).toContain('.')
    const payload = verifyUnsubscribeToken(token)
    expect(payload).toEqual({ email: 'person@example.com', category: 'weekly_digest' })
  })

  it('lower-cases the email before signing', () => {
    const a = signUnsubscribeToken('USER@x.io', 'weekly_digest')
    const b = signUnsubscribeToken('user@x.io', 'weekly_digest')
    expect(a).toBe(b)
  })

  it('rejects a tampered payload', () => {
    const token = signUnsubscribeToken('a@b.com', 'weekly_digest')!
    const [, sig] = token.split('.')
    const forgedBody = Buffer.from(JSON.stringify({ email: 'attacker@evil.com', category: 'weekly_digest' }), 'utf8').toString('base64url')
    expect(verifyUnsubscribeToken(`${forgedBody}.${sig}`)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    const token = signUnsubscribeToken('a@b.com', 'weekly_digest', 'other-secret')!
    expect(verifyUnsubscribeToken(token)).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyUnsubscribeToken('')).toBeNull()
    expect(verifyUnsubscribeToken('no-dot')).toBeNull()
    expect(verifyUnsubscribeToken('.onlysig')).toBeNull()
    expect(verifyUnsubscribeToken('body.')).toBeNull()
  })

  it('returns null when no secret is configured', () => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET
    const prevInternal = process.env.INTERNAL_PUSH_SECRET
    const prevCron = process.env.CRON_SECRET
    delete process.env.INTERNAL_PUSH_SECRET
    delete process.env.CRON_SECRET
    try {
      expect(signUnsubscribeToken('a@b.com', 'weekly_digest')).toBeNull()
      expect(buildUnsubscribe('https://app.test', 'a@b.com', 'weekly_digest')).toBeNull()
    } finally {
      process.env.INTERNAL_PUSH_SECRET = prevInternal
      process.env.CRON_SECRET = prevCron
    }
  })
})

describe('buildUnsubscribe', () => {
  it('builds a URL + List-Unsubscribe headers', () => {
    const link = buildUnsubscribe('https://app.test/', 'a@b.com', 'weekly_digest')!
    expect(link.url).toMatch(/^https:\/\/app\.test\/api\/email\/unsubscribe\?token=/)
    expect(link.headers['List-Unsubscribe']).toBe(`<${link.url}>`)
    expect(link.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('produces a token the endpoint can verify', () => {
    const link = buildUnsubscribe('https://app.test', 'a@b.com', 'weekly_digest')!
    const token = new URL(link.url).searchParams.get('token')!
    expect(verifyUnsubscribeToken(token)).toEqual({ email: 'a@b.com', category: 'weekly_digest' })
  })
})
