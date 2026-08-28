// End-to-end scenarios for the authentication lifecycle.
//
// "End-to-end" here follows the convention set by workingAtHeights.e2e.test.ts:
// no browser is driven, but each scenario starts from a real-world event and
// walks every server layer that event touches — the actual route handlers, the
// real token primitives, and the real cadence planner — with only Supabase
// itself stubbed.
//
// Each `it()` reads as a story: "someone does X, the system must end in state
// Y". The stories chosen are the ones where getting it wrong costs an account
// takeover or a lock-out, not the ones that are easy to assert.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  authAdminMock, mockState, resetMocks, sendInviteEmailMock, jsonRequest, ctxFor,
} from '../api/superadmin/_helpers'

// reset-access is gated by the TENANT admin gate, not the superadmin one that
// _helpers stubs, so it needs its own stub. Declared here rather than in the
// shared helper because only this file drives that route.
const tenantGateMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantAdmin:  () => tenantGateMock(),
  requireTenantMember: () => tenantGateMock(),
}))

import { POST as validate }  from '@/app/api/invites/validate/route'
import { POST as accept }    from '@/app/api/invites/accept/route'
import { POST as resetAccess } from '@/app/api/admin/members/[memberId]/reset-access/route'
import { planInviteAction, type InviteReminderState } from '@soteria/core/inviteReminderPlan'

const RAW      = 'raw-invite-token-for-jane'
const TENANT_A = '00000000-0000-0000-0000-00000000000a'
const TENANT_B = '00000000-0000-0000-0000-00000000000b'
const MEMBER_ID = '00000000-0000-0000-0000-0000000000f1'

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id:            'TOK-1',
    user_id:       'U-jane',
    tenant_id:     'T1',
    email:         'jane@snakking.com',
    expires_at:    new Date(Date.now() + 60_000).toISOString(),
    used_at:       null,
    superseded_at: null,
    ...overrides,
  }
}

/** Queue the reads /api/invites/validate performs, in the order it performs them. */
function seedValidate(opts: {
  token?: Record<string, unknown>
  cancelled?: boolean
  lastSignInAt?: string | null
} = {}) {
  mockState.queue('invite_tokens',      { data: tokenRow(opts.token), error: null })
  mockState.queue('tenant_memberships', { data: { invite_cancelled_at: opts.cancelled ? '2026-06-01T00:00:00Z' : null }, error: null })
  authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: opts.lastSignInAt ?? null } } })
  mockState.queue('profiles', { data: { full_name: 'Jane Doe' }, error: null })
  mockState.queue('tenants',  { data: { name: 'Snak King' }, error: null })
}

/** Queue the reads/writes /api/invites/accept performs, in order. */
function seedAccept(opts: {
  token?: Record<string, unknown>
  cancelled?: boolean
  lastSignInAt?: string | null
  claimWins?: boolean
  passwordError?: { message: string } | null
} = {}) {
  mockState.queue('invite_tokens',      { data: tokenRow(opts.token), error: null })
  mockState.queue('tenant_memberships', { data: { invite_cancelled_at: opts.cancelled ? '2026-06-01T00:00:00Z' : null }, error: null })
  authAdminMock.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: opts.lastSignInAt ?? null } } })
  // consumeInviteToken: a won claim returns the updated row, a lost one returns [].
  mockState.queue('invite_tokens', { data: (opts.claimWins ?? true) ? [{ id: 'TOK-1' }] : [], error: null })
  authAdminMock.updateUserById.mockResolvedValue({ data: { user: { id: 'U-jane' } }, error: opts.passwordError ?? null })
  mockState.queue('profiles', { data: null, error: null })
}

beforeEach(() => {
  resetMocks()
  tenantGateMock.mockReset()
  // Both invite routes rate-limit per IP and the test requests all share one.
  globalThis.__soteriaMemoryRateLimits = undefined
})

// ─── Scenario 1: a new hire is onboarded ────────────────────────────────────
//
// The ordinary path, start to finish. If this breaks, nobody can be hired.

describe('E2E — a new hire accepts their invitation', () => {
  it('sees their own details on the invite page, then sets a password once', async () => {
    // Step 1: Jane opens the emailed link. The page pre-flights the token.
    seedValidate()
    const preflight = await validate(jsonRequest('POST', { token: RAW }))
    expect(preflight.status).toBe(200)
    expect(await preflight.json()).toMatchObject({
      status: 'valid', email: 'jane@snakking.com', fullName: 'Jane Doe', tenantName: 'Snak King',
    })

    // Step 2: Jane picks a password. The token is spent, the forced-rotation
    // flag is cleared, and she is told which address to sign in with.
    seedAccept()
    const accepted = await accept(jsonRequest('POST', {
      token: RAW, fullName: 'Jane Doe', password: 'correct horse battery',
    }))
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({ ok: true, email: 'jane@snakking.com' })

    // The password write actually happened, and the profile was flipped out of
    // first-time-setup state — otherwise she is prompted to reset forever.
    expect(authAdminMock.updateUserById).toHaveBeenCalledWith('U-jane', { password: 'correct horse battery' })
    expect(mockState.updates.some(u =>
      u.table === 'profiles' && (u.payload as { must_change_password?: boolean }).must_change_password === false,
    )).toBe(true)
  })

  it('tells her the link is spent if she clicks it a second time', async () => {
    seedAccept({ token: { used_at: '2026-08-01T00:00:00Z' } })
    const r = await accept(jsonRequest('POST', {
      token: RAW, fullName: 'Jane Doe', password: 'correct horse battery',
    }))
    expect(r.status).toBe(400)
    expect((await r.json()).status).toBe('used')
    // Critically, no password write was attempted on the replay.
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })
})

// ─── Scenario 2: the link leaks after the account is live ───────────────────
//
// The highest-stakes case. An unexpired invite token is an unauthenticated
// password-set primitive; once the account has a working password of its own,
// honouring the token would be an account takeover.

describe('E2E — a live account is protected from its own old invite link', () => {
  it('refuses to rotate the password of someone who has already signed in', async () => {
    seedAccept({ lastSignInAt: '2026-08-20T09:00:00Z' })
    const r = await accept(jsonRequest('POST', {
      token: RAW, fullName: 'Attacker', password: 'attacker-chosen-password',
    }))
    expect(r.status).toBe(400)
    expect((await r.json()).status).toBe('already_active')
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('points that person at sign-in rather than leaking the account details', async () => {
    seedValidate({ lastSignInAt: '2026-08-20T09:00:00Z' })
    const r = await validate(jsonRequest('POST', { token: RAW }))
    const body = await r.json()
    expect(body.status).toBe('already_active')
    // No email, no name, no tenant — the token holder learns nothing.
    expect(body.email).toBeUndefined()
    expect(body.fullName).toBeUndefined()
    expect(body.tenantName).toBeUndefined()
  })
})

// ─── Scenario 2b: the guards themselves fail ────────────────────────────────
//
// A guard that is skipped when its own lookup errors is worse than no guard,
// because it holds exactly while the system is healthy and lets go the moment
// it is not. Both invite guards read through Supabase, so both have to say
// "no" when they cannot say anything.

describe('E2E — the invite guards fail closed when their lookups fail', () => {
  it('refuses the accept when the account state cannot be read', async () => {
    mockState.queue('invite_tokens',      { data: tokenRow(), error: null })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    // GoTrue is down. Previously this left last_sign_in_at undefined and the
    // already-active guard silently satisfied, so a leaked token became a
    // password reset against a live account during an outage.
    authAdminMock.getUserById.mockResolvedValue({ data: null, error: { message: 'gotrue unavailable' } })

    const r = await accept(jsonRequest('POST', {
      token: RAW, fullName: 'Attacker', password: 'attacker-chosen-password',
    }))
    expect(r.status).toBeGreaterThanOrEqual(500)
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('refuses the accept when the membership state cannot be read', async () => {
    mockState.queue('invite_tokens',      { data: tokenRow(), error: null })
    mockState.queue('tenant_memberships', { data: null, error: { message: 'connection reset' } })

    const r = await accept(jsonRequest('POST', {
      token: RAW, fullName: 'Jane Doe', password: 'correct horse battery',
    }))
    expect(r.status).toBeGreaterThanOrEqual(500)
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('does not show the setup form when validate cannot read the account state', async () => {
    mockState.queue('invite_tokens',      { data: tokenRow(), error: null })
    mockState.queue('tenant_memberships', { data: { invite_cancelled_at: null }, error: null })
    authAdminMock.getUserById.mockResolvedValue({ data: null, error: { message: 'gotrue unavailable' } })

    const r = await validate(jsonRequest('POST', { token: RAW }))
    expect(r.status).toBeGreaterThanOrEqual(500)
    // Emphatically not 'valid' — that would invite someone to start a flow
    // /api/invites/accept will refuse.
    expect((await r.json()).status).not.toBe('valid')
  })
})

// ─── Scenario 3: an admin cancels the invitation ────────────────────────────

describe('E2E — a cancelled invitation cannot be redeemed', () => {
  it('refuses the accept even while the token itself is still unexpired', async () => {
    seedAccept({ cancelled: true })
    const r = await accept(jsonRequest('POST', {
      token: RAW, fullName: 'Jane Doe', password: 'correct horse battery',
    }))
    expect(r.status).toBe(400)
    expect((await r.json()).status).toBe('cancelled')
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })
})

// ─── Scenario 4: a corporate mail scanner prefetches the link ───────────────
//
// Why validate deliberately does NOT consume: security appliances follow every
// URL in inbound mail. A consume-on-read would burn the invite before the
// recipient ever saw the page.

describe('E2E — a mail scanner prefetching the link does not burn it', () => {
  it('survives repeated pre-flights and still accepts afterwards', async () => {
    for (let i = 0; i < 5; i++) {
      seedValidate()
      const r = await validate(jsonRequest('POST', { token: RAW }))
      expect((await r.json()).status, `prefetch ${i + 1}`).toBe('valid')
    }
    // Nothing consumed the token: no write touched invite_tokens.
    expect(mockState.updates.some(u => u.table === 'invite_tokens')).toBe(false)

    seedAccept()
    const accepted = await accept(jsonRequest('POST', {
      token: RAW, fullName: 'Jane Doe', password: 'correct horse battery',
    }))
    expect(accepted.status).toBe(200)
  })
})

// ─── Scenario 5: two submits race ───────────────────────────────────────────

describe('E2E — a double submit cannot set two different passwords', () => {
  it('lets the first claim win and rejects the second', async () => {
    seedAccept({ claimWins: true })
    const first = await accept(jsonRequest('POST', {
      token: RAW, fullName: 'Jane Doe', password: 'first-password-choice',
    }))
    expect(first.status).toBe(200)

    // The loser's conditional update matches zero rows.
    seedAccept({ claimWins: false })
    const second = await accept(jsonRequest('POST', {
      token: RAW, fullName: 'Jane Doe', password: 'second-password-choice',
    }))
    expect(second.status).toBe(400)
    expect((await second.json()).status).toBe('used')

    // Exactly one password was written across both attempts.
    expect(authAdminMock.updateUserById).toHaveBeenCalledTimes(1)
    expect(authAdminMock.updateUserById).toHaveBeenCalledWith('U-jane', { password: 'first-password-choice' })
  })
})

// ─── Scenario 6: the password write fails after the token was claimed ───────
//
// The claim happens BEFORE the write so a race cannot set two passwords. That
// ordering is right, but it means a transient auth outage would otherwise
// spend the invitee's only link and leave them told "already set up".

describe('E2E — a transient outage does not strand the invitee', () => {
  it('hands the token back so the link works on retry', async () => {
    seedAccept({ passwordError: { message: 'auth service unavailable' } })
    const r = await accept(jsonRequest('POST', {
      token: RAW, fullName: 'Jane Doe', password: 'correct horse battery',
    }))
    expect(r.status).toBeGreaterThanOrEqual(500)

    // The release is what makes the retry possible: used_at goes back to null.
    expect(mockState.updates.some(u =>
      u.table === 'invite_tokens' && (u.payload as { used_at?: unknown }).used_at === null,
    )).toBe(true)
  })
})

// ─── Scenario 7: input the accept form should never forward ─────────────────

describe('E2E — the accept endpoint validates before it touches auth', () => {
  it('rejects short passwords, blank names and missing tokens without a write', async () => {
    const bad = [
      { token: RAW, fullName: 'Jane', password: 'short' },        // 5 chars
      { token: RAW, fullName: 'Jane', password: '1234567' },      // 7 — one under
      { token: RAW, fullName: '',     password: 'long-enough-password' },
      { token: RAW, fullName: '   ',  password: 'long-enough-password' },
      { token: '',  fullName: 'Jane', password: 'long-enough-password' },
      { fullName: 'Jane', password: 'long-enough-password' },
      { token: 42, fullName: 'Jane', password: 'long-enough-password' },
    ]
    for (const body of bad) {
      const r = await accept(jsonRequest('POST', body))
      expect(r.status, JSON.stringify(body)).toBe(400)
    }
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()

    // Exactly at the minimum is accepted — the boundary belongs to the user.
    seedAccept()
    const ok = await accept(jsonRequest('POST', { token: RAW, fullName: 'Jane', password: '12345678' }))
    expect(ok.status).toBe(200)
  })
})

// ─── Scenario 8: one tenant's admin goes after another tenant's owner ───────
//
// reset-access rotates a password and returns it in the response body, so the
// rank check is the only thing standing between "reset a worker's login" and
// "mint myself a working credential as anyone". The password is ACCOUNT-global
// while membership is per-tenant, so the rank has to be account-global too.

function gateAsTenantA(role: 'admin' | 'owner' = 'admin') {
  tenantGateMock.mockResolvedValue({
    ok: true, userId: `U-${role}-a`, userEmail: `${role}@a.com`,
    tenantId: TENANT_A, facilityId: null, role, authedClient: {},
  })
}
const gateAsAdminOfTenantA = () => gateAsTenantA('admin')

/**
 * Queue the reads reset-access performs up to and including the rank check.
 * Memberships are given as `role@tenant` so each scenario states plainly which
 * organisation the target holds power in.
 */
function seedResetAccessUpToRank(targetMemberships: string[], targetIsSuperadmin = false) {
  mockState.queue('members', {
    data: {
      id: MEMBER_ID, tenant_id: TENANT_A, profile_id: 'U-target',
      email: 'target@a.com', legal_name: 'Target Person', display_name: 'Target',
    },
    error: null,
  })
  mockState.queue('profiles', { data: { is_superadmin: targetIsSuperadmin }, error: null })
  mockState.queue('tenant_memberships', {
    data: targetMemberships.map(spec => {
      const [role, tenant] = spec.split('@')
      return { role, tenant_id: tenant === 'B' ? TENANT_B : TENANT_A }
    }),
    error: null,
  })
}

describe('E2E — cross-tenant privilege escalation via access reset', () => {
  it('refuses when the target owns another tenant, even as a plain member here', async () => {
    gateAsAdminOfTenantA()
    // The target is a `member` of tenant A — but the OWNER of tenant B. One
    // password unlocks both.
    seedResetAccessUpToRank(['member@A', 'owner@B'])

    const r = await resetAccess(jsonRequest('POST', {}), ctxFor({ memberId: MEMBER_ID }))
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('FORBIDDEN_TARGET')
    // No credential was minted, and none leaked into the response.
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('refuses even when the caller out-ranks the target numerically', async () => {
    // The mirror image, and the one a global max(role) missed: the caller is
    // the OWNER of A (rank 3) and the target merely an ADMIN of B (rank 2), so
    // strict dominance said yes. It should not — owning A confers nothing
    // inside B, so the comparison was never meaningful, and the reset hands
    // A's owner a credential that administers B.
    gateAsTenantA('owner')
    seedResetAccessUpToRank(['member@A', 'admin@B'])

    const r = await resetAccess(jsonRequest('POST', {}), ctxFor({ memberId: MEMBER_ID }))
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('FORBIDDEN_TARGET')
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('refuses to reset a peer admin, and refuses to reset a superadmin', async () => {
    for (const roles of [['admin@A'], ['viewer@A', 'admin@A']]) {
      resetMocks(); tenantGateMock.mockReset(); gateAsAdminOfTenantA()
      seedResetAccessUpToRank(roles)
      const r = await resetAccess(jsonRequest('POST', {}), ctxFor({ memberId: MEMBER_ID }))
      expect(r.status, `peer admin via ${roles.join('+')}`).toBe(403)
    }

    resetMocks(); tenantGateMock.mockReset(); gateAsAdminOfTenantA()
    seedResetAccessUpToRank(['member@A'], true)   // Soteria staff account
    const r = await resetAccess(jsonRequest('POST', {}), ctxFor({ memberId: MEMBER_ID }))
    expect(r.status).toBe(403)
    expect(authAdminMock.updateUserById).not.toHaveBeenCalled()
  })

  it('still lets a site lead reset the forklift operator who is locked out', async () => {
    gateAsAdminOfTenantA()
    // The whole point of the route: a worker who holds only member/viewer rows
    // — including at another site — is resettable by their admin. Those rows
    // carry no power to steal.
    seedResetAccessUpToRank(['member@A', 'viewer@B', 'member@B'])
    authAdminMock.getUserById.mockResolvedValue({ data: { user: { email: 'target@a.com' } } })
    authAdminMock.updateUserById.mockResolvedValue({ data: { user: {} }, error: null })
    mockState.queue('profiles', { data: null, error: null })          // must_change_password
    mockState.queue('tenants',  { data: { id: TENANT_A, name: 'Tenant A' }, error: null })
    mockState.queue('member_status_events', { data: null, error: null })

    const r = await resetAccess(jsonRequest('POST', {}), ctxFor({ memberId: MEMBER_ID }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ memberId: MEMBER_ID, email: 'target@a.com' })
    // The copy-paste fallback is the point for a worker with no email on-site.
    expect(body.tempPassword).toBeTruthy()
    expect(authAdminMock.updateUserById).toHaveBeenCalled()
    // Credential rotation is exactly what an auditor comes looking for.
    expect(mockState.inserts.some(i => i.table === 'member_status_events')).toBe(true)
  })
})

// ─── Scenario 9: nobody accepts, over five weeks ────────────────────────────
//
// Walks the cron's decision for one membership across the whole cadence. The
// cancel at the end is an RLS-level revocation, so the timeline matters.

describe('E2E — the reminder cadence over a five-week silence', () => {
  it('sends four weekly nudges and then cancels, and not a day earlier', () => {
    const DAY = 86_400_000
    const invitedAt = new Date('2026-07-01T00:00:00Z')
    const state = (dayOffset: number, sent: number, lastReminder: number | null): InviteReminderState => ({
      invitedAt:      invitedAt.toISOString(),
      lastSignInAt:   null,
      remindersSent:  sent,
      lastReminderAt: lastReminder === null ? null : new Date(invitedAt.getTime() + lastReminder * DAY).toISOString(),
      cancelledAt:    null,
    })
    const at = (day: number) => new Date(invitedAt.getTime() + day * DAY)

    // Nothing happens in week one until the seventh day.
    for (const day of [0, 1, 3, 6]) {
      expect(planInviteAction(state(day, 0, null), at(day)).kind, `day ${day}`).toBe('none')
    }
    expect(planInviteAction(state(7, 0, null), at(7))).toEqual({ kind: 'send_reminder', reminderNumber: 1 })

    // Then one nudge a week, anchored on the previous nudge.
    expect(planInviteAction(state(14, 1, 7),  at(14))).toEqual({ kind: 'send_reminder', reminderNumber: 2 })
    expect(planInviteAction(state(21, 2, 14), at(21))).toEqual({ kind: 'send_reminder', reminderNumber: 3 })
    expect(planInviteAction(state(28, 3, 21), at(28))).toEqual({ kind: 'send_reminder', reminderNumber: 4 })

    // A full interval after the last nudge — and not before — access lapses.
    expect(planInviteAction(state(34, 4, 28), at(34)).kind).toBe('none')
    expect(planInviteAction(state(35, 4, 28), at(35))).toEqual({
      kind: 'cancel', reason: 'no_signup_after_max_reminders',
    })
  })

  it('stops the moment the invitee accepts, by either liveness signal', () => {
    const DAY = 86_400_000
    const invitedAt = new Date('2026-07-01T00:00:00Z')
    const day35 = new Date(invitedAt.getTime() + 35 * DAY)
    const base = {
      invitedAt:      invitedAt.toISOString(),
      remindersSent:  4,
      lastReminderAt: new Date(invitedAt.getTime() + 28 * DAY).toISOString(),
      cancelledAt:    null,
    }

    // Signed in since the invite — done.
    expect(planInviteAction({
      ...base, lastSignInAt: new Date(invitedAt.getTime() + 2 * DAY).toISOString(),
    }, day35).kind).toBe('none')

    // Accepted but the follow-up sign-in never landed: they hold a WORKING
    // password. Cancelling here would revoke access to an account that works.
    expect(planInviteAction({ ...base, lastSignInAt: null, passwordSet: true }, day35))
      .toEqual({ kind: 'none', reason: 'credential_already_set' })
  })
})

// ─── Scenario 10: one tenant's admin goes after another tenant's invitee ────
//
// profiles.email is globally unique (migration 003), so one address is one
// account across every tenant. Adding an address that already exists REUSES
// that account — and "exists but never signed in" is precisely the state of
// anyone holding an outstanding invite somewhere else. The raw invite link is
// a password-set credential for that account, so returning it to the caller
// turned "add a colleague" into "take over their pending account".

describe('E2E — the raw invite link never goes back to the caller for a reused account', () => {
  it('withholds it when the account already existed, and still emails the invitee', async () => {
    const { POST: addUser } = await import('@/app/api/admin/users/route')
    gateAsAdminOfTenantA()

    mockState.queue('tenants', { data: { id: TENANT_A, name: 'Tenant A' }, error: null })
    // The victim: a profiles row that exists and has never signed in.
    mockState.queue('profiles', {
      data: { id: 'U-victim', email: 'victim@other.example', full_name: 'Victim', must_change_password: true },
      error: null,
    })
    mockState.queue('tenant_memberships', { data: null, error: null })   // membership insert
    mockState.queue('members', { data: null, error: null })

    const res = await addUser(jsonRequest('POST', { email: 'victim@other.example' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.alreadyExisted).toBe(true)
    // The takeover primitive: absent.
    expect(body.inviteUrl).toBeUndefined()
    // And no temp password either — provision only mints one on the create path.
    expect(body.tempPassword).toBeUndefined()
    // The invitee is still reachable: the link went to their own address.
    expect(sendInviteEmailMock).toHaveBeenCalled()
    expect(sendInviteEmailMock.mock.calls[0][0]).toMatchObject({ to: 'victim@other.example' })
    expect(sendInviteEmailMock.mock.calls[0][0].inviteUrl).toBeTruthy()
  })
})
