import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET  /api/chat/channels   List channels + DMs the caller is a member
//                            of in the active tenant. Result includes
//                            member counts, DM-peer profile, unread
//                            count (vs the caller's last_read_message_id).
// POST /api/chat/channels   Create a channel. Body: { kind, name?, slug?,
//                            description?, member_user_ids? }
//                            - kind='channel' requires admin/owner and a
//                              non-empty name; the creator is auto-added
//                              as admin alongside any member_user_ids.
//                            - kind='dm' requires exactly 1 peer in
//                              member_user_ids; uses the find-or-create
//                              endpoint instead.
//
// DM creation is delegated to /api/chat/dms — it has find-or-create
// semantics so the UI can call it idempotently.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ChannelRow {
  id: string
  tenant_id: string
  kind: 'channel' | 'dm'
  name: string | null
  slug: string | null
  description: string | null
  created_by: string
  archived_at: string | null
  created_at: string
  last_activity_at: string
}

interface MemberRow {
  channel_id: string
  user_id: string
  role: 'member' | 'admin'
  last_read_message_id: string | null
  muted_at: string | null
  joined_at: string
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()

    // 1. The caller's memberships in this tenant.
    const { data: myMems, error: memErr } = await admin
      .from('chat_channel_members')
      .select('channel_id, user_id, role, last_read_message_id, muted_at, joined_at')
      .eq('user_id', gate.userId)
      .eq('tenant_id', gate.tenantId)
    if (memErr) throw new Error(memErr.message)
    const memRows = (myMems ?? []) as MemberRow[]

    if (memRows.length === 0) {
      return NextResponse.json({ channels: [] })
    }

    const channelIds = memRows.map(m => m.channel_id)

    // 2. The channel rows. Order by last_activity_at desc so the most
    // recently active channel/DM floats to the top of the sidebar.
    const { data: chRows, error: chErr } = await admin
      .from('chat_channels')
      .select('*')
      .in('id', channelIds)
      .eq('tenant_id', gate.tenantId)
      .is('archived_at', null)
      .order('last_activity_at', { ascending: false })
    if (chErr) throw new Error(chErr.message)
    const channels = (chRows ?? []) as ChannelRow[]

    // 3. All members across these channels — needed to render DM peer
    // names and channel member counts. RLS-scoped, but we still
    // .eq('tenant_id') as belt-and-suspenders.
    const { data: allMembers } = await admin
      .from('chat_channel_members')
      .select('channel_id, user_id, role')
      .in('channel_id', channelIds)
      .eq('tenant_id', gate.tenantId)
    const membersByChannel = new Map<string, Array<{ user_id: string; role: string }>>()
    for (const m of (allMembers ?? []) as Array<{ channel_id: string; user_id: string; role: string }>) {
      const list = membersByChannel.get(m.channel_id) ?? []
      list.push({ user_id: m.user_id, role: m.role })
      membersByChannel.set(m.channel_id, list)
    }

    // 4. Profiles for any DM peer + (optional) member preview.
    const peerIds = new Set<string>()
    for (const ch of channels) {
      if (ch.kind !== 'dm') continue
      const list = membersByChannel.get(ch.id) ?? []
      for (const m of list) if (m.user_id !== gate.userId) peerIds.add(m.user_id)
    }
    const profileById = new Map<string, { email: string | null; full_name: string | null; avatar_url: string | null }>()
    if (peerIds.size > 0) {
      const { data: peers } = await admin
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .in('id', Array.from(peerIds))
      for (const p of (peers ?? []) as Array<{ id: string; email: string | null; full_name: string | null; avatar_url: string | null }>) {
        profileById.set(p.id, { email: p.email, full_name: p.full_name, avatar_url: p.avatar_url })
      }
    }

    // 5. Unread counts. For each channel, count messages whose id is
    // greater than the caller's last_read_message_id. We use created_at
    // (timestamps are monotonic per channel in practice) instead of
    // a sequence number because it's cheaper.
    const memByChannel = new Map<string, MemberRow>()
    for (const m of memRows) memByChannel.set(m.channel_id, m)
    const unreadByChannel = new Map<string, number>()
    await Promise.all(channels.map(async ch => {
      const me = memByChannel.get(ch.id)
      let q = admin
        .from('chat_messages')
        .select('id, created_at', { count: 'exact', head: true })
        .eq('channel_id', ch.id)
        .eq('tenant_id', gate.tenantId)
        .is('deleted_at', null)
        .neq('author_user_id', gate.userId)
      if (me?.last_read_message_id) {
        // Resolve the last-read message's created_at and count newer.
        const { data: lastRead } = await admin
          .from('chat_messages')
          .select('created_at')
          .eq('id', me.last_read_message_id)
          .maybeSingle()
        if (lastRead?.created_at) q = q.gt('created_at', lastRead.created_at)
      }
      const { count } = await q
      unreadByChannel.set(ch.id, count ?? 0)
    }))

    const out = channels.map(ch => {
      const memList   = membersByChannel.get(ch.id) ?? []
      const me        = memByChannel.get(ch.id)
      let dmPeer: { user_id: string; email: string | null; full_name: string | null; avatar_url: string | null } | null = null
      if (ch.kind === 'dm') {
        const peer = memList.find(m => m.user_id !== gate.userId)
        if (peer) {
          const p = profileById.get(peer.user_id)
          dmPeer = {
            user_id:    peer.user_id,
            email:      p?.email ?? null,
            full_name:  p?.full_name ?? null,
            avatar_url: p?.avatar_url ?? null,
          }
        }
      }
      return {
        id:               ch.id,
        kind:             ch.kind,
        name:             ch.name,
        slug:             ch.slug,
        description:      ch.description,
        created_at:       ch.created_at,
        last_activity_at: ch.last_activity_at,
        member_count:     memList.length,
        my_role:          me?.role ?? 'member',
        muted:            !!me?.muted_at,
        unread_count:     unreadByChannel.get(ch.id) ?? 0,
        dm_peer:          dmPeer,
      }
    })

    return NextResponse.json({ channels: out })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-channels/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: {
    kind?: 'channel' | 'dm'
    name?: string
    slug?: string
    description?: string
    member_user_ids?: string[]
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.kind !== 'channel') {
    return NextResponse.json({
      error: 'Use POST /api/chat/dms to create or open a DM.',
    }, { status: 400 })
  }
  const isPriv = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
  if (!isPriv) {
    return NextResponse.json({ error: 'Only tenant admin/owner can create channels.' }, { status: 403 })
  }
  const name = (body.name ?? '').trim()
  if (name.length < 1 || name.length > 80) {
    return NextResponse.json({ error: 'Channel name is required (1-80 chars).' }, { status: 400 })
  }
  if (body.slug && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(body.slug)) {
    return NextResponse.json({ error: 'slug must be lowercase a-z 0-9 -' }, { status: 400 })
  }
  const memberIds = (body.member_user_ids ?? []).filter(s => UUID_RE.test(s))

  try {
    const admin = supabaseAdmin()

    // Validate each prospective member belongs to the tenant before
    // adding them — otherwise a malicious caller could attach a user
    // from a different tenant.
    if (memberIds.length > 0) {
      const { data: validMems } = await admin
        .from('tenant_memberships')
        .select('user_id')
        .eq('tenant_id', gate.tenantId)
        .in('user_id', memberIds)
      const valid = new Set((validMems ?? []).map(r => (r as { user_id: string }).user_id))
      for (const uid of memberIds) {
        if (!valid.has(uid)) {
          return NextResponse.json({ error: `User ${uid} is not a member of this tenant.` }, { status: 400 })
        }
      }
    }

    const { data: created, error: chErr } = await admin
      .from('chat_channels')
      .insert({
        tenant_id:   gate.tenantId,
        kind:        'channel',
        name,
        slug:        body.slug ?? null,
        description: (body.description ?? '').trim() || null,
        created_by:  gate.userId,
      })
      .select('*')
      .single()
    if (chErr) {
      Sentry.captureException(chErr, { tags: { route: 'chat-channels/POST', stage: 'insert' } })
      return NextResponse.json({ error: chErr.message }, { status: 500 })
    }
    const channel = (created as unknown) as ChannelRow

    // Creator becomes channel admin; explicit members are added as
    // 'member'. Dedupe so a creator-also-in-member_user_ids doesn't
    // collide with the PK.
    const memberRows: Array<{
      channel_id: string; user_id: string; tenant_id: string; role: 'member' | 'admin'
    }> = [{
      channel_id: channel.id,
      user_id:    gate.userId,
      tenant_id:  gate.tenantId,
      role:       'admin',
    }]
    for (const uid of memberIds) {
      if (uid === gate.userId) continue
      memberRows.push({
        channel_id: channel.id,
        user_id:    uid,
        tenant_id:  gate.tenantId,
        role:       'member',
      })
    }
    const { error: memErr } = await admin
      .from('chat_channel_members')
      .insert(memberRows)
    if (memErr) {
      Sentry.captureException(memErr, { tags: { route: 'chat-channels/POST', stage: 'members' } })
      return NextResponse.json({ error: memErr.message }, { status: 500 })
    }

    return NextResponse.json({ channel }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-channels/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
