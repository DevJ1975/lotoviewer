import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/safety-boards/by-entity?type=incident&id=<uuid>
//
// Reverse-lookup: returns all (live, non-deleted) board threads
// linked to the given entity. Used by entity detail pages (incident,
// equipment, near-miss, etc.) to render a "related discussions"
// panel.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LINK_TYPES = [
  'incident', 'near_miss', 'equipment', 'hot_work_permit',
  'confined_space', 'incident_action', 'jha', 'toolbox_talk',
] as const

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const type = url.searchParams.get('type') ?? ''
  const id   = url.searchParams.get('id') ?? ''
  if (!(LINK_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: `type must be one of ${LINK_TYPES.join(', ')}` }, { status: 400 })
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('safety_board_threads')
      .select('id, board_id, kind, title, pinned, locked, last_reply_at, created_at, author_user_id')
      .eq('linked_entity_type', type)
      .eq('linked_entity_id', id)
      .eq('tenant_id', gate.tenantId)
      .is('deleted_at', null)
      .order('pinned', { ascending: false })
      .order('last_reply_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)
    return NextResponse.json({ threads: data ?? [] })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-by-entity/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
