import { NextResponse, after } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { runRegulatorPhase } from '@/lib/loto/audit/runAudit'
import type { RunAuditScope } from '@/lib/loto/audit/runAudit'

// POST /api/admin/loto/audit/[runId]/regulator — kick the Cal/OSHA regulator
// review phase for a run that has finished its audit.
//
// The phase re-reviews each audited machine (concur/dissent), drives EHS
// corrections for material dissents, and writes a program-level report — all
// STAGED for the existing human review gate; it never writes live LOTO tables.
//
// Mirrors the audit start route: owner/admin only, kicked via after() so the
// 202 returns immediately while the engine runs. The phase is resumable
// (regulator_payload presence is the per-machine marker), so a serverless
// reclaim mid-phase is safe — re-POST to continue. For the full ~500-machine run
// drive it from scripts/run-loto-regulator.mjs (no serverless window).

export const runtime     = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { runId } = await ctx.params

  const admin = supabaseAdmin()
  const { data: run } = await admin
    .from('loto_audit_runs')
    .select('id, scope')
    .eq('id', runId)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  // after() keeps the function alive to run the phase AFTER the 202 is sent (a
  // bare promise is frozen on return on Vercel — the work never runs).
  after(() => runRegulatorPhase({
    tenantId: gate.tenantId,
    runId:    run.id,
    userId:   gate.userId,
    scope:    (run.scope ?? {}) as RunAuditScope,
  }).catch(err => Sentry.captureException(err, { tags: { route: 'admin/loto/audit/regulator', stage: 'runRegulatorPhase' }, extra: { runId: run.id } })))

  return NextResponse.json({ run_id: run.id, status: 'reviewing' }, { status: 202 })
}
