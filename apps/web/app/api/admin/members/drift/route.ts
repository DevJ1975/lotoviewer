import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { validateJsonBody } from '@/lib/security/validateBody'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// `tenantId` is optional / nullable: `null` (or omitted, or '') means
// "reconcile all tenants" — by design, see POST handler comment.
const ReconcileBodySchema = z.object({
  tenantId: z.union([
    z.string().uuid(),
    z.literal('').transform(() => null),
    z.null(),
  ]).nullable().optional(),
})

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

  const parsed = await validateJsonBody(req, ReconcileBodySchema)
  if (!parsed.ok) return parsed.response
  // null = "reconcile all tenants" (operator omitted the field). A
  // non-UUID value is a 400 from the schema, not a silent all-tenants
  // run — the Postgres cast error that would otherwise surface is
  // noisier than necessary.
  const tenantId: string | null = parsed.data.tenantId ?? null

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
