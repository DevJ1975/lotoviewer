import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST   /api/safety-boards/reactions   Body: { target_type, target_id, emoji }
// DELETE /api/safety-boards/reactions?target_type=&target_id=&emoji=
//
// Single endpoint covering both threads and replies via target_type.
// Reactions are tenant-scoped automatically by the RLS policy.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMOJI_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️☝✌✋✊❤]{1,8}$/u
const TARGET_TYPES = new Set(['thread', 'reply'])

async function exists(
  admin: ReturnType<typeof supabaseAdmin>,
  targetType: string, targetId: string, tenantId: string,
): Promise<boolean> {
  if (targetType === 'thread') {
    const { data } = await admin.from('safety_board_threads')
      .select('id, deleted_at').eq('id', targetId).eq('tenant_id', tenantId).maybeSingle()
    const r = data as { id: string; deleted_at: string | null } | null
    return !!r && !r.deleted_at
  }
  const { data } = await admin.from('safety_board_replies')
    .select('id, deleted_at').eq('id', targetId).eq('tenant_id', tenantId).maybeSingle()
  const r = data as { id: string; deleted_at: string | null } | null
  return !!r && !r.deleted_at
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { target_type?: string; target_id?: string; emoji?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const targetType = (body.target_type ?? '').trim()
  const targetId   = (body.target_id ?? '').trim()
  const emoji      = (body.emoji ?? '').trim()
  if (!TARGET_TYPES.has(targetType)) return NextResponse.json({ error: 'target_type must be thread|reply' }, { status: 400 })
  if (!UUID_RE.test(targetId))       return NextResponse.json({ error: 'target_id must be uuid' }, { status: 400 })
  if (!emoji || emoji.length > 32 || !EMOJI_RE.test(emoji)) {
    return NextResponse.json({ error: 'emoji must be 1-8 emoji characters' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    if (!await exists(admin, targetType, targetId, gate.tenantId)) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 })
    }
    const { error } = await admin
      .from('safety_board_reactions')
      .upsert({
        tenant_id:   gate.tenantId,
        target_type: targetType,
        target_id:   targetId,
        user_id:     gate.userId,
        emoji,
      }, { onConflict: 'target_type,target_id,user_id,emoji', ignoreDuplicates: true })
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-reactions/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-reactions/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const targetType = (url.searchParams.get('target_type') ?? '').trim()
  const targetId   = (url.searchParams.get('target_id') ?? '').trim()
  const emoji      = (url.searchParams.get('emoji') ?? '').trim()
  if (!TARGET_TYPES.has(targetType)) return NextResponse.json({ error: 'target_type must be thread|reply' }, { status: 400 })
  if (!UUID_RE.test(targetId))       return NextResponse.json({ error: 'target_id must be uuid' }, { status: 400 })
  if (!emoji)                        return NextResponse.json({ error: 'emoji query param required' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { error } = await admin
      .from('safety_board_reactions')
      .delete()
      .eq('target_type', targetType)
      .eq('target_id',   targetId)
      .eq('user_id',     gate.userId)
      .eq('emoji',       emoji)
      .eq('tenant_id',   gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-reactions/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-reactions/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
