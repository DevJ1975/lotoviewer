// The public invite-acceptance flow: /api/invites/{validate,accept,refresh}.
// The URL token is the credential (no session), so the contract under
// test is lifecycle classification, the consume-after-password ordering,
// and that refresh never rotates passwords or leaks details for unknown
// tokens.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  authAdminMock, mockState, resetMocks, sendInviteEmailMock, jsonRequest,
} from '../superadmin/_helpers'
import { hashInviteToken } from '@/lib/invites/tokens'
import { POST as validate } from '@/app/api/invites/validate/route'
import { POST as accept }   from '@/app/api/invites/accept/route'
import { POST as refresh }  from '@/app/api/invites/refresh/route'

const RAW = 'raw-invite-token'

function tokenRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id:            'TOK-1',
    user_id:       'U1',
    tenant_id:     'T1',
    email:         'jane@x.com',
    expires_at:    new Date(Date.now() + 60_000).toISOString(),
    used_at:       null,
    superseded_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  resetMocks()
  // The routes rate-limit per IP; clear the in-memory buckets so each
  // test starts fresh (they all share the 'unknown' test IP).
  globalThis.__soteriaMemoryRateLimits = undefined
})

describe('POST /api/invites/validate', () => {
  it('returns valid + prefill details for a live token', async () => {
    mockState.queue('invite_tokens',      { data: tokenRow(), error: null })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: null } } })
    mockState.queue('profiles', { data: { full_name: 'Jane' }, error: null })
    mockState.queue('tenants',  { data: { name: 'Snak King' }, error: null })

    const r = await validate(jsonRequest('POST', { token: RAW }))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({
      status: 'valid', email: 'jane@x.com', fullName: 'Jane', tenantName: 'Snak King',
    })
  })

  it('classifies expired tokens without leaking who they belong to', async () => {
    mockState.queue('invite_tokens', {
      data: tokenRow({ expires_at: new Date(Date.now() - 1000).toISOString() }),
      error: null,
    })
    const r = await validate(jsonRequest('POST', { token: RAW }))
    const body = await r.json()
    expect(body.status).toBe('expired')
    expect(body.email).toBeUndefined()
  })

  it('reports cancelled when the membership was soft-cancelled', async () => {
    mockState.queue('invite_tokens',      { data: tokenRow(), error: null })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: '2026-06-01T00:00:00Z' }, error: null })
    const r = await validate(jsonRequest('POST', { token: RAW }))
    expect((await r.json()).status).toBe('cancelled')
  })

  it('reports already_active when the user has signed in before', async () => {
    mockState.queue('invite_tokens',      { data: tokenRow(), error: null })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: '2026-06-01T00:00:00Z' } } })
    const r = await validate(jsonRequest('POST', { token: RAW }))
    expect((await r.json()).status).toBe('already_active')
  })
})

describe('POST /api/invites/accept', () => {
  it('claims the token, sets the chosen password, clears must_change_password', async () => {
    mockState.queue('invite_tokens',      { data: tokenRow(), error: null })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: null } } })
    mockState.queue('invite_tokens', { data: [{ id: 'TOK-1' }], error: null })    // atomic claim (consume-first)
    authAdminMock.updateUserById.mockResolvedValue({ data: { user: { id: 'U1' } }, error: null })
    mockState.queue('profiles',      { data: null, error: null })                 // profile update

    const r = await accept(jsonRequest('POST', { token: RAW, fullName: 'Jane D', password: 'hunter22!' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, email: 'jane@x.com' })

    expect(authAdminMock.updateUserById).toHaveBeenCalledWith('U1', { password: 'hunter22!' })
    expect(mockState.updates.find(u => u.table === 'profiles')?.payload).toMatchObject({
      full_name: 'Jane D', must_change_password: false,
    })
    // The token was claimed exactly once.
    expect(mockState.updates.filter(u => u.table === 'invite_tokens')).toHaveLength(1)
  })

  it('refuses to rotate the password of an already-active account (takeover guard)', async () => {
    mockState.queue('invite_tokens',      { data: tokenRow(), error: null })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: '2026-06-01T00:00:00Z' } } })

    const r = await accept(jsonRequest('POST', { token: RAW, fullName: 'Jane', password: 'hunter22!' }))
    expect(r.status).toBe(400)
    expect((await r.json()).status).toBe('already_active')
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
    expect(mockState.updates.filter(u => u.table === 'invite_tokens')).toHaveLength(0)
  })

  it('loses the atomic claim to a concurrent accept and never writes a second password', async () => {
    mockState.queue('invite_tokens',      { data: tokenRow(), error: null })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: null } } })
    mockState.queue('invite_tokens', { data: [], error: null })   // claim returns 0 rows → already consumed

    const r = await accept(jsonRequest('POST', { token: RAW, fullName: 'Jane', password: 'hunter22!' }))
    expect(r.status).toBe(400)
    expect((await r.json()).status).toBe('used')
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('rejects weak passwords before touching anything', async () => {
    const r = await accept(jsonRequest('POST', { token: RAW, fullName: 'Jane', password: 'short' }))
    expect(r.status).toBe(400)
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('rejects a used token with its status', async () => {
    mockState.queue('invite_tokens', { data: tokenRow({ used_at: '2026-06-01T00:00:00Z' }), error: null })
    const r = await accept(jsonRequest('POST', { token: RAW, fullName: 'Jane', password: 'hunter22!' }))
    expect(r.status).toBe(400)
    expect((await r.json()).status).toBe('used')
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })
})

describe('POST /api/invites/refresh', () => {
  it('mints a fresh link for an expired token and re-emails the same address', async () => {
    mockState.queue('invite_tokens', {
      data: tokenRow({ expires_at: new Date(Date.now() - 1000).toISOString() }),
      error: null,
    })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: null } } })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    mockState.queue('invite_tokens', { data: null, error: null })  // supersede
    mockState.queue('invite_tokens', { data: null, error: null })  // insert
    mockState.queue('profiles', { data: { full_name: 'Jane' }, error: null })
    mockState.queue('tenants',  { data: { name: 'Snak King' }, error: null })

    const r = await refresh(jsonRequest('POST', { token: RAW }))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, emailSent: true })

    // A new hashed token was stored, and the OLD token is not what was
    // emailed (fresh link every refresh).
    const insert = mockState.inserts.find(i => i.table === 'invite_tokens')?.payload as Record<string, unknown>
    expect(insert.token_hash).not.toBe(hashInviteToken(RAW))
    const emailArgs = sendInviteEmailMock.mock.calls[0]![0] as Record<string, unknown>
    expect(emailArgs.to).toBe('jane@x.com')
    expect(String(emailArgs.inviteUrl)).toContain('/accept-invite?token=')
    // Refresh must never rotate the temp password.
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('burns the presented token so it cannot be replayed to spam email', async () => {
    mockState.queue('invite_tokens', {
      data: tokenRow({ expires_at: new Date(Date.now() - 1000).toISOString() }),
      error: null,
    })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: null } } })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    // supersede + insert (issue), then the presented-token consume.
    mockState.queue('invite_tokens', { data: null, error: null })
    mockState.queue('invite_tokens', { data: null, error: null })
    mockState.queue('invite_tokens', { data: [{ id: 'TOK-1' }], error: null })  // consume claim
    mockState.queue('profiles', { data: { full_name: 'Jane' }, error: null })
    mockState.queue('tenants',  { data: { name: 'Snak King' }, error: null })

    const r = await refresh(jsonRequest('POST', { token: RAW }))
    expect(r.status).toBe(200)
    // The presented row was consumed (used_at stamped) — one refresh only.
    const tokenUpdates = mockState.updates.filter(u => u.table === 'invite_tokens')
    expect(tokenUpdates.some(u => 'used_at' in (u.payload as object))).toBe(true)
  })

  it('rejects a token already burned by a prior refresh', async () => {
    mockState.queue('invite_tokens', { data: tokenRow({ used_at: '2026-06-01T00:00:00Z' }), error: null })
    const r = await refresh(jsonRequest('POST', { token: RAW }))
    expect((await r.json()).status).toBe('already_active')
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('404s an unknown token with no detail', async () => {
    mockState.queue('invite_tokens', { data: null, error: null })
    const r = await refresh(jsonRequest('POST', { token: 'nope' }))
    expect(r.status).toBe(404)
  })

  it('answers already_active (no email) once the user has signed in', async () => {
    mockState.queue('invite_tokens', { data: tokenRow(), error: null })
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: '2026-06-01T00:00:00Z' } } })
    const r = await refresh(jsonRequest('POST', { token: RAW }))
    expect((await r.json()).status).toBe('already_active')
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('rate-limits aggressively (it sends email)', async () => {
    let lastStatus = 0
    for (let i = 0; i < 6; i++) {
      mockState.queue('invite_tokens', { data: null, error: null })
      const r = await refresh(jsonRequest('POST', { token: 'nope' }))
      lastStatus = r.status
    }
    expect(lastStatus).toBe(429)
  })
})
