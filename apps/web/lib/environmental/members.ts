import { supabaseAdmin } from '@/lib/supabaseAdmin'

/**
 * Whether `userId` belongs to the tenant. A record's owner is only a reference to a
 * profile, which any account holder has, so without this check an admin could
 * assign work to someone from another company. It is one targeted lookup with the
 * service client, the same read the route gate itself makes.
 */
export async function isActiveMember(tenantId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().from('tenant_memberships')
    .select('user_id, invite_cancelled_at').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return !!data && !data.invite_cancelled_at
}

export const OWNER_NOT_MEMBER = 'owner_user_id must be a member of this account.'
