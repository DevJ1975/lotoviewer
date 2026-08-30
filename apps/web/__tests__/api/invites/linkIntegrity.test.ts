// Regressions for two ways a working invite link used to be destroyed.
//
// 1. /api/invites/refresh burned the presented token BEFORE sending its
//    replacement. The replacement's raw token is deliberately never returned
//    to the client, so a Resend failure left nobody — invitee or admin —
//    holding a usable link, and the spent token then reported 'used', which
//    the accept-invite page renders as "your account is already set up".
//
// 2. /api/invites/accept claims the token before writing the password (a
//    deliberate concurrency guard). A failed write left it spent, producing
//    the same false "already set up" for someone who never got a password.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authAdminMock, mockState, resetMocks, sendInviteEmailMock } from '../superadmin/_helpers'

vi.mock('@/lib/rateLimit/memory', () => ({
  checkMemoryRateLimit: () => ({ ok: true, remaining: 9, resetAt: Date.now() + 60_000 }),
}))
vi.mock('@/lib/rateLimit/clientIp', () => ({ clientIp: () => '203.0.113.1' }))

import { POST as refresh } from '@/app/api/invites/refresh/route'
import { POST as accept } from '@/app/api/invites/accept/route'

const USER   = '00000000-0000-0000-0000-0000000000c1'
const TENANT = '00000000-0000-0000-0000-0000000000c2'
const TOKEN  = 'raw-token-value'

function post(body: unknown): Request {
  return new Request('https://soteriafield.app/api/invites/x', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

/** A live, unused, unexpired token row. */
function liveTokenRow() {
  return {
    id: 'tok-live', user_id: USER, tenant_id: TENANT, email: 'invitee@example.com',
    expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    used_at: null, superseded_at: null,
  }
}

/** Every invite_tokens update the route issued, in order. */
function tokenUpdates() {
  return mockState.updates.filter(u => u.table === 'invite_tokens').map(u => u.payload as Record<string, unknown>)
}

const burnedIt = () => tokenUpdates().some(p => typeof p.used_at === 'string')

describe('POST /api/invites/refresh — does not destroy the link on send failure', () => {
  beforeEach(() => {
    resetMocks()
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { id: USER, last_sign_in_at: null } }, error: null })
  })

  function queueHappyLookups() {
    mockState.queue('invite_tokens', { data: liveTokenRow(), error: null })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    mockState.queue('profiles', { data: { full_name: 'Invitee One' }, error: null })
    mockState.queue('tenants', { data: { name: 'Snak King' }, error: null })
  }

  it('keeps the presented token usable when the email fails to send', async () => {
    queueHappyLookups()
    sendInviteEmailMock.mockResolvedValue(false)

    const res  = await refresh(post({ token: TOKEN }))
    const body = await res.json()

    expect(body).toMatchObject({ ok: true, emailSent: false })
    expect(burnedIt()).toBe(false)
  })

  it('burns the presented token once the replacement actually sent', async () => {
    queueHappyLookups()
    sendInviteEmailMock.mockResolvedValue(true)

    const res  = await refresh(post({ token: TOKEN }))
    const body = await res.json()

    expect(body).toMatchObject({ ok: true, emailSent: true })
    expect(burnedIt()).toBe(true)
  })
})

describe('POST /api/invites/accept — hands the token back when the write fails', () => {
  beforeEach(() => {
    resetMocks()
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { id: USER, last_sign_in_at: null } }, error: null })
  })

  function queueAcceptLookups() {
    mockState.queue('invite_tokens', { data: liveTokenRow(), error: null })   // verifyInviteToken
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    mockState.queue('invite_tokens', { data: [{ id: 'tok-live' }], error: null }) // claim succeeds
  }

  it('releases the claim when the password write fails', async () => {
    queueAcceptLookups()
    authAdminMock.updateUserById.mockResolvedValue({ data: null, error: { message: 'auth down' } })

    await accept(post({ token: TOKEN, password: 'a-good-password', fullName: 'Invitee One' }))

    // used_at set by the claim, then explicitly nulled on the failure path.
    expect(tokenUpdates().some(p => p.used_at === null)).toBe(true)
  })

  it('leaves the token spent once the password is actually set', async () => {
    queueAcceptLookups()
    authAdminMock.updateUserById.mockResolvedValue({ data: { user: { id: USER } }, error: null })
    mockState.queue('profiles', { data: null, error: null })

    await accept(post({ token: TOKEN, password: 'a-good-password', fullName: 'Invitee One' }))

    // Releasing here would let a second submit rotate a now-working password.
    expect(tokenUpdates().some(p => p.used_at === null)).toBe(false)
  })
})
