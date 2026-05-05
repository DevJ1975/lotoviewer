import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireSuperadmin } from '@/lib/auth/superadmin'

// GET /api/support/tickets — superadmin-only list of support tickets.
//
// Query params:
//   status=open       (default) tickets with resolved_at IS NULL
//   status=resolved   tickets with resolved_at IS NOT NULL
//   status=all        every ticket
//   limit=50          row cap (max 200)
//
// Returns rows joined with tenants(name) so the client doesn't have to
// chase the FK separately. RLS already restricts reads to superadmins,
// but we re-verify with requireSuperadmin so an attacker who gets a
// service-role token still hits the env-allowlist gate.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url     = new URL(req.url)
  const status  = (url.searchParams.get('status') ?? 'open').toLowerCase()
  const limitIn = Number(url.searchParams.get('limit') ?? '50')
  const limit   = Number.isFinite(limitIn) ? Math.max(1, Math.min(200, Math.trunc(limitIn))) : 50

  const admin = supabaseAdmin()
  let q = admin
    .from('support_tickets')
    .select('id, conversation_id, user_id, tenant_id, user_email, user_name, subject, summary, reason, emailed_ok, resolved_at, created_at, tenants(name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (status === 'open')     q = q.is('resolved_at', null)
  if (status === 'resolved') q = q.not('resolved_at', 'is', null)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  // Flatten the embedded tenant join so the client doesn't have to
  // unwrap the array shape Supabase emits.
  type Row = {
    id: string
    conversation_id: string
    user_id: string
    tenant_id: string | null
    user_email: string | null
    user_name: string | null
    subject: string
    summary: string
    reason: string
    emailed_ok: boolean | null
    resolved_at: string | null
    created_at: string
    tenants: { name: string | null } | { name: string | null }[] | null
  }
  const rows = ((data ?? []) as unknown as Row[]).map(r => ({
    id:              r.id,
    conversation_id: r.conversation_id,
    user_id:         r.user_id,
    tenant_id:       r.tenant_id,
    tenant_name:     Array.isArray(r.tenants) ? r.tenants[0]?.name ?? null : r.tenants?.name ?? null,
    user_email:      r.user_email,
    user_name:       r.user_name,
    subject:         r.subject,
    summary:         r.summary,
    reason:          r.reason,
    emailed_ok:      r.emailed_ok,
    resolved_at:     r.resolved_at,
    created_at:      r.created_at,
  }))
  return NextResponse.json({ tickets: rows, count: rows.length })
}
