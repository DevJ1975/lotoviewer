import { describe, it, expect } from 'vitest'
import {
  resolveMemberAccessState,
  type MemberAccessInput,
} from '@soteria/core/memberAccessState'

const NOW = new Date('2026-08-26T17:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function daysFromNow(n: number): string {
  return new Date(NOW.getTime() + n * DAY).toISOString()
}

function input(overrides: Partial<MemberAccessInput> = {}): MemberAccessInput {
  return {
    hasLogin:           true,
    mustChangePassword: false,
    inviteExpiresAt:    null,
    inviteCancelledAt:  null,
    ...overrides,
  }
}

describe('resolveMemberAccessState', () => {
  it('reports a roster-only member as having no login', () => {
    expect(resolveMemberAccessState(input({ hasLogin: false }), NOW)).toBe('no_login')
  })

  it('reports someone holding their own password as active', () => {
    expect(resolveMemberAccessState(input(), NOW)).toBe('active')
  })

  it('ignores a stale invite once the member has set their own password', () => {
    const state = resolveMemberAccessState(
      input({ mustChangePassword: false, inviteExpiresAt: daysFromNow(-30) }),
      NOW,
    )
    expect(state).toBe('active')
  })

  it('reports a forced reset with a live link as setup pending', () => {
    const state = resolveMemberAccessState(
      input({ mustChangePassword: true, inviteExpiresAt: daysFromNow(14) }),
      NOW,
    )
    expect(state).toBe('setup_pending')
  })

  // The case this module exists for: an access reset rotated the password,
  // the invite email went unanswered, and the link died two weeks later.
  // The roster used to render this identically to a healthy account.
  it('reports a forced reset whose link expired unused as locked out', () => {
    const state = resolveMemberAccessState(
      input({ mustChangePassword: true, inviteExpiresAt: daysFromNow(-14) }),
      NOW,
    )
    expect(state).toBe('locked_out')
  })

  it('treats an invite expiring exactly now as already dead', () => {
    const state = resolveMemberAccessState(
      input({ mustChangePassword: true, inviteExpiresAt: NOW.toISOString() }),
      NOW,
    )
    expect(state).toBe('locked_out')
  })

  it('reports a forced reset with no link at all as locked out', () => {
    const state = resolveMemberAccessState(
      input({ mustChangePassword: true, inviteExpiresAt: null }),
      NOW,
    )
    expect(state).toBe('locked_out')
  })

  it('reports a cancelled invite as locked out even while its link looks live', () => {
    const state = resolveMemberAccessState(
      input({
        mustChangePassword: true,
        inviteExpiresAt:    daysFromNow(7),
        inviteCancelledAt:  daysFromNow(-1),
      }),
      NOW,
    )
    expect(state).toBe('locked_out')
  })

  it('reports an unparseable expiry as locked out rather than guessing', () => {
    const state = resolveMemberAccessState(
      input({ mustChangePassword: true, inviteExpiresAt: 'not-a-date' }),
      NOW,
    )
    expect(state).toBe('locked_out')
  })
})
