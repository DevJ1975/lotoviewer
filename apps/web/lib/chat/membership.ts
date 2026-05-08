import type { SupabaseClient } from '@supabase/supabase-js'

// Channel-membership gate used by every chat route. The tenantGate
// already proved the caller is in the right tenant; this layer adds
// the "member of THIS channel" check.
//
// Returns the member row when the caller is a member, null otherwise.
// Superadmin path is left to the route handler — we don't auto-grant
// channel access via superadmin so admins of one tenant don't read
// another tenant's DMs.

export interface ChatMember {
  channel_id:           string
  user_id:              string
  tenant_id:            string
  role:                 'member' | 'admin'
  last_read_message_id: string | null
  muted_at:             string | null
  joined_at:            string
}

export async function loadChannelMembership(
  admin: SupabaseClient,
  channelId: string,
  userId: string,
  tenantId: string,
): Promise<ChatMember | null> {
  const { data } = await admin
    .from('chat_channel_members')
    .select('channel_id, user_id, tenant_id, role, last_read_message_id, muted_at, joined_at')
    .eq('channel_id', channelId)
    .eq('user_id',    userId)
    .eq('tenant_id',  tenantId)
    .maybeSingle()
  return (data as ChatMember | null) ?? null
}
