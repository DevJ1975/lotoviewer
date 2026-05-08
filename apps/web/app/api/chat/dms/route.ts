import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/chat/dms     Find-or-create a DM with a peer.
//                        Body: { peer_user_id }
//                        Returns the DM channel row plus the member
//                        list. Idempotent — clicking "Message Alice"
//                        five times returns the same channel.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { peer_user_id?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const peerId = body.peer_user_id
  if (!peerId || !UUID_RE.test(peerId)) {
    return NextResponse.json({ error: 'peer_user_id is required (uuid)' }, { status: 400 })
  }
  if (peerId === gate.userId) {
    return NextResponse.json({ error: 'Cannot DM yourself.' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()

    // Verify the peer is a member of the active tenant.
    const { data: peerMembership } = await admin
      .from('tenant_memberships')
      .select('user_id')
      .eq('tenant_id', gate.tenantId)
      .eq('user_id', peerId)
      .maybeSingle()
    if (!peerMembership) {
      return NextResponse.json({ error: 'Peer is not a member of this tenant.' }, { status: 403 })
    }

    // Find an existing DM by listing channels both users are members
    // of. Two-member intersection. We bound it to dm-kind so a 1:1
    // channel doesn't accidentally collide.
    const { data: myDmIds } = await admin
      .from('chat_channel_members')
      .select('channel_id, chat_channels!inner(kind, archived_at)')
      .eq('user_id', gate.userId)
      .eq('tenant_id', gate.tenantId)
    type Row = { channel_id: string; chat_channels: { kind: string; archived_at: string | null } | { kind: string; archived_at: string | null }[] | null }
    const myDmCandidates = ((myDmIds as Row[] | null) ?? [])
      .filter(r => {
        const ch = Array.isArray(r.chat_channels) ? r.chat_channels[0] : r.chat_channels
        return ch?.kind === 'dm' && !ch?.archived_at
      })
      .map(r => r.channel_id)

    if (myDmCandidates.length > 0) {
      const { data: peerInDm } = await admin
        .from('chat_channel_members')
        .select('channel_id')
        .eq('user_id', peerId)
        .eq('tenant_id', gate.tenantId)
        .in('channel_id', myDmCandidates)
      const existingId = ((peerInDm ?? [])[0] as { channel_id: string } | undefined)?.channel_id
      if (existingId) {
        const { data: ch } = await admin
          .from('chat_channels').select('*').eq('id', existingId).maybeSingle()
        return NextResponse.json({ channel: ch, created: false })
      }
    }

    // Create the DM.
    const { data: created, error: chErr } = await admin
      .from('chat_channels')
      .insert({
        tenant_id:   gate.tenantId,
        kind:        'dm',
        name:        null,
        slug:        null,
        description: null,
        created_by:  gate.userId,
      })
      .select('*')
      .single()
    if (chErr) {
      Sentry.captureException(chErr, { tags: { route: 'chat-dms/POST', stage: 'insert' } })
      return NextResponse.json({ error: chErr.message }, { status: 500 })
    }
    const channel = created as { id: string }

    const { error: memErr } = await admin
      .from('chat_channel_members')
      .insert([
        { channel_id: channel.id, user_id: gate.userId, tenant_id: gate.tenantId, role: 'member' },
        { channel_id: channel.id, user_id: peerId,      tenant_id: gate.tenantId, role: 'member' },
      ])
    if (memErr) {
      Sentry.captureException(memErr, { tags: { route: 'chat-dms/POST', stage: 'members' } })
      return NextResponse.json({ error: memErr.message }, { status: 500 })
    }

    return NextResponse.json({ channel: created, created: true }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-dms/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
