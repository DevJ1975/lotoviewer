import { NextResponse, after } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { runProvenanceSweep, type RunProvenanceScope } from '@/lib/loto/audit/provenanceSweep'

// /api/admin/loto/audit/provenance
//   POST — start a PROVENANCE sweep. Body: { department?, only_active? }.
//
// Stages NON-MUTATING `ehs_finding` rows for isolation photos that are shared
// across machines or hold an equipment image, and for energy steps carrying
// unimplemented template text. No vision, no Anthropic spend, no live writes —
// every finding is a `pending` change a human approves through the SAME audit
// review link + apply flow as the vision audit (where ehs_finding applies as a
// no-op, which is correct: the finding is the record; the fix is field re-capture).
//
// Owner/admin only.

export const runtime     = 'nodejs'
export const maxDuration = 300

interface PostBody {
  department?:  unknown
  only_active?: unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody = {}
  try { body = await req.json() } catch { /* empty body = full active sweep */ }

  const scope: RunProvenanceScope = {
    department:  typeof body.department === 'string' && body.department.trim() ? body.department.trim() : undefined,
    only_active: body.only_active === false ? false : true,
  }

  const admin = supabaseAdmin()
  const { data: run, error } = await admin
    .from('loto_audit_runs')
    .insert({ tenant_id: gate.tenantId, status: 'running', scope: { ...scope, mode: 'provenance' }, created_by: gate.userId })
    .select('id')
    .single()
  if (error || !run) {
    Sentry.captureException(error, { tags: { route: 'admin/loto/audit/provenance/POST' } })
    return NextResponse.json({ error: error?.message ?? 'Failed to create run' }, { status: 500 })
  }

  // after() runs the sweep after the 202 is sent while keeping the function alive
  // (a bare promise is frozen on return on Vercel). The sweep writes only to the
  // audit staging tables and sets the run to 'awaiting_review' on completion.
  after(() => runProvenanceSweep({ tenantId: gate.tenantId, runId: run.id, scope })
    .catch(err => Sentry.captureException(err, { tags: { route: 'admin/loto/audit/provenance/POST', stage: 'sweep' }, extra: { runId: run.id } })))

  return NextResponse.json({ run_id: run.id, status: 'running', mode: 'provenance' }, { status: 202 })
}
