// Pure decision logic for "can this member actually get into the app right
// now?". No I/O, no DOM, no Node — safe to share between the web admin UI
// and any future caller.
//
// The members roster used to answer this with a single boolean: a member
// either had a login row or did not. That reads "Login active" for someone
// whose password was rotated by an access reset weeks ago and whose invite
// link has since expired unused — the one state an admin most needs to see,
// rendered as the one state that says nothing is wrong.

export type MemberAccessState =
  /** Roster-only member; no app account was ever created. */
  | 'no_login'
  /** Holds credentials of their own — nothing is pending. */
  | 'active'
  /** Owes a password change and holds a live link to make it with. */
  | 'setup_pending'
  /** Owes a password change with no usable link left. Cannot get in. */
  | 'locked_out'

export interface MemberAccessInput {
  /** members.profile_id is set — an auth account exists. */
  hasLogin: boolean
  /** profiles.must_change_password — set by every invite and access reset. */
  mustChangePassword: boolean
  /**
   * expires_at of the newest invite token that is still unused and has not
   * been superseded, or null when no such token exists.
   */
  inviteExpiresAt: string | Date | null | undefined
  /** tenant_memberships.invite_cancelled_at — the cron gave up on them. */
  inviteCancelledAt: string | Date | null | undefined
}

function toMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Classify a member's access. Order matters: each branch below is the
 * reason the later ones cannot apply.
 *
 * A member with no live link who still owes a password change is reported
 * as locked out even though an admin could, in principle, have handed them
 * a temporary password in person. Over-reporting here costs one admin
 * glance; under-reporting is what left the state invisible in the first
 * place.
 */
export function resolveMemberAccessState(
  input: MemberAccessInput,
  now: Date = new Date(),
): MemberAccessState {
  if (!input.hasLogin) return 'no_login'

  // They set their own password, so no invite is outstanding to chase.
  if (!input.mustChangePassword) return 'active'

  if (toMs(input.inviteCancelledAt) != null) return 'locked_out'

  const expiresMs = toMs(input.inviteExpiresAt)
  if (expiresMs == null) return 'locked_out'
  if (expiresMs <= now.getTime()) return 'locked_out'

  return 'setup_pending'
}
