import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/admin/members/drift?limit=&offset=
//
// Superadmin-only listing of member_drift_findings. Open findings
// (reconciled_at IS NULL) come first, ordered by detected_at desc;
// closed findings follow so an operator can verify a recent
// reconciliation without paging back.
//
// The route is under /api/admin/members/* (not /api/superadmin/*) so
// the future per-tenant admin view can reuse the same shape with a
// row-level filter — this phase ships the superadmin-only variant.

const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 200
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const limit  = clamp(parseInt(url.searchParams.get('limit')  ?? '', 10), 1, MAX_LIMIT, DEFAULT_LIMIT)
  const offset = clamp(parseInt(url.searchParams.get('offset') ?? '', 10), 0, Number.MAX_SAFE_INTEGER, 0)

  const admin = supabaseAdmin()
  const { data, error, count } = await admin
    .from('member_drift_findings')
    .select(
      'id, tenant_id, finding_type, surface, surface_row_pk, member_id, details, detected_at, reconciled_at',
      { count: 'exact' },
    )
    // PostgREST treats nulls-first as the default for descending order;
    // open findings (reconciled_at IS NULL) sort to the top by design.
    .order('reconciled_at', { ascending: false, nullsFirst: true })
    .order('detected_at',   { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return sanitizeError(error, 'admin/members/drift list')

  return NextResponse.json({
    findings: data ?? [],
    count:    count ?? null,
    limit,
    offset,
  })
}

// POST /api/admin/members/drift/reconcile
//
// Replays the backfill for one tenant and re-runs the drift audit so
// findings that are now clean get their reconciled_at stamped.
export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { tenantId?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // null = "reconcile all tenants" (operator omitted the field). A
  // non-string or malformed value is a 400, not a silent all-tenants
  // run — the Postgres cast error that would otherwise surface is
  // noisier than necessary.
  let tenantId: string | null = null
  if (body.tenantId !== undefined && body.tenantId !== null) {
    if (typeof body.tenantId !== 'string' || !UUID_RE.test(body.tenantId)) {
      return NextResponse.json({ error: 'tenantId must be a UUID or omitted' }, { status: 400 })
    }
    tenantId = body.tenantId
  }

  const admin = supabaseAdmin()
  const { data: backfillData, error: backfillErr } = await admin.rpc('reconcile_members_backfill', {
    p_tenant_id: tenantId,
  })
  if (backfillErr) return sanitizeError(backfillErr, 'admin/members/drift reconcile backfill')

  const { error: auditErr } = await admin.rpc('audit_member_drift')
  if (auditErr) return sanitizeError(auditErr, 'admin/members/drift reconcile audit')

  return NextResponse.json({ ok: true, tenantId, backfill: backfillData ?? null })
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}
