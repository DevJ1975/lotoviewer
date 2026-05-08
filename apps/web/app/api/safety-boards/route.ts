import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET  /api/safety-boards   List active boards in the tenant + a
//                            cheap thread-count per board for the
//                            board picker.
// POST /api/safety-boards   Create a board. Tenant admin/owner only.
//                            Body: { name, slug, description? }

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/

function autoSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'board'
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: boards, error } = await admin
      .from('safety_boards')
      .select('id, tenant_id, name, slug, description, created_by, archived_at, created_at')
      .eq('tenant_id', gate.tenantId)
      .is('archived_at', null)
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    type B = { id: string; tenant_id: string; name: string; slug: string; description: string | null; created_by: string; archived_at: string | null; created_at: string }
    const list = (boards ?? []) as B[]

    if (list.length === 0) return NextResponse.json({ boards: [] })

    const ids = list.map(b => b.id)
    const counts = new Map<string, number>()
    await Promise.all(ids.map(async bid => {
      const { count } = await admin
        .from('safety_board_threads')
        .select('id', { count: 'exact', head: true })
        .eq('board_id', bid)
        .eq('tenant_id', gate.tenantId)
        .is('deleted_at', null)
      counts.set(bid, count ?? 0)
    }))

    return NextResponse.json({
      boards: list.map(b => ({ ...b, thread_count: counts.get(b.id) ?? 0 })),
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-boards/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const isPriv = gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
  if (!isPriv) {
    return NextResponse.json({ error: 'Only tenant admin/owner can create boards.' }, { status: 403 })
  }

  let body: { name?: string; slug?: string; description?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = (body.name ?? '').trim()
  if (name.length < 1 || name.length > 80) {
    return NextResponse.json({ error: 'name is required (1-80 chars)' }, { status: 400 })
  }
  const slug = (body.slug ?? autoSlug(name)).toLowerCase()
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'slug must be lowercase a-z 0-9 -' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('safety_boards')
      .insert({
        tenant_id:   gate.tenantId,
        name,
        slug,
        description: (body.description ?? '').trim() || null,
        created_by:  gate.userId,
      })
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'safety-boards/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ board: data }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-boards/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
