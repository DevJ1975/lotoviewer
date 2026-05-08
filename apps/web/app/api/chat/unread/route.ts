import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/chat/unread
// Cheap summary for the header badge: returns total unread chat
// messages across all the caller's non-muted channels in the active
// tenant.

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: mems } = await admin
      .from('chat_channel_members')
      .select('channel_id, last_read_message_id, muted_at')
      .eq('user_id', gate.userId)
      .eq('tenant_id', gate.tenantId)

    const memRows = ((mems ?? []) as Array<{ channel_id: string; last_read_message_id: string | null; muted_at: string | null }>)
      .filter(m => !m.muted_at)
    if (memRows.length === 0) {
      return NextResponse.json({ unread: 0 })
    }

    let total = 0
    await Promise.all(memRows.map(async m => {
      let q = admin
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('channel_id', m.channel_id)
        .eq('tenant_id', gate.tenantId)
        .is('deleted_at', null)
        .neq('author_user_id', gate.userId)
      if (m.last_read_message_id) {
        const { data: lastRead } = await admin
          .from('chat_messages')
          .select('created_at')
          .eq('id', m.last_read_message_id)
          .maybeSingle()
        if (lastRead?.created_at) q = q.gt('created_at', lastRead.created_at)
      }
      const { count } = await q
      total += count ?? 0
    }))

    return NextResponse.json({ unread: total })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-unread/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
