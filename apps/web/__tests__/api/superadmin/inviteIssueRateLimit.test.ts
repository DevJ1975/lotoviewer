// Invite creation sends a Resend email and creates an auth.users row on every
// call, and none of the four minting endpoints was throttled. These cover the
// shared brake and confirm it is actually wired ahead of the work.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  gateOk, mockState, resetMocks, sendInviteEmailMock, jsonRequest, ctxFor,
} from './_helpers'
import { inviteIssueRateLimit } from '@/lib/rateLimit/inviteIssue'
import { POST as inviteMember } from '@/app/api/superadmin/tenants/[number]/members/route'

const LIMIT = 30

beforeEach(() => {
  resetMocks()
  gateOk()
  // The limiter lives on globalThis, so buckets leak between tests unless
  // each one starts clean.
  delete (globalThis as { __soteriaMemoryRateLimits?: unknown }).__soteriaMemoryRateLimits
})

describe('inviteIssueRateLimit', () => {
  it('passes callers under the limit', () => {
    for (let i = 0; i < LIMIT; i++) {
      expect(inviteIssueRateLimit('actor-under')).toBeNull()
    }
  })

  it('returns a 429 with retry-after once the limit is spent', async () => {
    for (let i = 0; i < LIMIT; i++) inviteIssueRateLimit('actor-over')

    const res = inviteIssueRateLimit('actor-over')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
    expect(res!.headers.get('retry-after')).toBeTruthy()
    await expect(res!.json()).resolves.toMatchObject({
      error: expect.stringContaining('Too many invites'),
    })
  })

  it('buckets per actor, so one admin cannot throttle another', () => {
    for (let i = 0; i < LIMIT; i++) inviteIssueRateLimit('actor-noisy')

    expect(inviteIssueRateLimit('actor-noisy')).not.toBeNull()
    expect(inviteIssueRateLimit('actor-quiet')).toBeNull()
  })
})

describe('superadmin member invite — throttle wiring', () => {
  it('rejects past the limit without sending another invite email', async () => {
    // Spend the acting superadmin's bucket. gateOk() resolves userId 'super-1',
    // which is the key the route throttles on.
    for (let i = 0; i < LIMIT; i++) inviteIssueRateLimit('super-1')

    mockState.queue('tenants', {
      data: { id: 'T1', tenant_number: '0001', name: 'Snak King' },
      error: null,
    })

    const res = await inviteMember(
      jsonRequest('POST', { email: 'blocked@example.com', role: 'member' }),
      ctxFor({ number: '0001' }),
    )

    expect(res.status).toBe(429)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })
})
