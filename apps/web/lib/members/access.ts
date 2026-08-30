import * as Sentry from '@sentry/nextjs'
import { resolveMemberAccessState, type MemberAccessState } from '@soteria/core/memberAccessState'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Resolving "can this member sign in?" needs three facts the members roster
// view does not carry, two of them behind the service role:
//
//   profiles.must_change_password        — does the account owe a reset?
//   invite_tokens                        — RLS-on with no policies (247)
//   tenant_memberships.invite_cancelled_at — did the cron give up on them?
//
// Callers pass profile ids they have ALREADY been authorized to see by the
// RLS-filtered roster read, so the admin client here widens the columns
// available, never the set of people.

interface AccessFacts {
  mustChangePassword: boolean
  inviteExpiresAt:    string | null
  inviteCancelledAt:  string | null
}

/**
 * Map profile id → access state for one tenant's members.
 *
 * Best-effort: a lookup failure yields an empty map rather than failing the
 * members page. The badge is a diagnostic aid, and an admin who cannot load
 * the roster at all is worse off than one seeing it without access badges.
 */
export async function resolveAccessStates(
  tenantId: string,
  profileIds: string[],
  now: Date = new Date(),
): Promise<Map<string, MemberAccessState>> {
  const ids = Array.from(new Set(profileIds.filter(Boolean)))
  if (ids.length === 0) return new Map()

  const admin = supabaseAdmin()
  const facts = new Map<string, AccessFacts>(
    ids.map(id => [id, { mustChangePassword: false, inviteExpiresAt: null, inviteCancelledAt: null }]),
  )

  try {
    const [profiles, tokens, memberships] = await Promise.all([
      admin.from('profiles').select('id, must_change_password').in('id', ids),
      admin.from('invite_tokens')
        .select('user_id, expires_at')
        .in('user_id', ids)
        .is('used_at', null)
        .is('superseded_at', null)
        .order('created_at', { ascending: false }),
      admin.from('tenant_memberships')
        .select('user_id, invite_cancelled_at')
        .eq('tenant_id', tenantId)
        .in('user_id', ids),
    ])

    const firstError = profiles.error ?? tokens.error ?? memberships.error
    if (firstError) {
      Sentry.captureException(firstError, { tags: { module: 'members/access', stage: 'lookup' } })
      return new Map()
    }

    for (const row of profiles.data ?? []) {
      const f = facts.get(row.id as string)
      if (f) f.mustChangePassword = !!row.must_change_password
    }
    for (const row of tokens.data ?? []) {
      // Ordered newest-first, so the first row per user is the live one.
      const f = facts.get(row.user_id as string)
      if (f && f.inviteExpiresAt === null) f.inviteExpiresAt = row.expires_at as string
    }
    for (const row of memberships.data ?? []) {
      const f = facts.get(row.user_id as string)
      if (f) f.inviteCancelledAt = row.invite_cancelled_at as string | null
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { module: 'members/access', stage: 'lookup' } })
    return new Map()
  }

  const states = new Map<string, MemberAccessState>()
  for (const [id, f] of facts) {
    states.set(id, resolveMemberAccessState({ hasLogin: true, ...f }, now))
  }
  return states
}
