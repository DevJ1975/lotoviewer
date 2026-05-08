import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import {
  chemicalTrainingCoverage,
  summarizeTrainingGaps,
  type WorkerTrainingRecord,
} from '@soteria/core/chemicals'

// GET /api/chemicals/products/[id]/training-coverage?workers=Alice,Bob
//
// Cross-references this chemical's training requirements with the
// loto_training_records table for a given worker roster. Returns one
// coverage row per (worker × required role) plus a summary.
//
// `workers` query param: comma-separated names. When omitted, returns
// just the requirements list with no coverage rows (so the chemical
// detail page can render the "configure roles" empty state cheaply).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const url     = new URL(req.url)
  const workersRaw = url.searchParams.get('workers') ?? ''
  const workers = workersRaw
    .split(',')
    .map(w => w.trim())
    .filter(w => w.length > 0)
    .slice(0, 200)   // cap per-request roster size

  try {
    const { data: requirements, error: rErr } = await gate.authedClient
      .from('chemical_training_requirements')
      .select('id, product_id, role, notes')
      .eq('tenant_id', gate.tenantId)
      .eq('product_id', id)
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })

    if (!requirements || requirements.length === 0 || workers.length === 0) {
      return NextResponse.json({
        requirements: requirements ?? [],
        coverage:     [],
        summary:      { total_gaps: 0, affected_workers: 0 },
      })
    }

    // Pull every training record for the named workers, narrowed to
    // the roles this chemical asks for.
    const roles = Array.from(new Set(requirements.map(r => r.role)))
    const { data: records, error: tErr } = await gate.authedClient
      .from('loto_training_records')
      .select('worker_name, role, completed_at, expires_at')
      .in('role', roles)
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

    // Filter records to the requested roster (case-insensitive).
    const wantedNames = new Set(workers.map(w => w.trim().toLowerCase()))
    const relevant = (records ?? []).filter(r =>
      r.worker_name && wantedNames.has(r.worker_name.trim().toLowerCase()),
    ) as WorkerTrainingRecord[]

    const coverage = chemicalTrainingCoverage(workers, requirements, relevant)
    const summary  = summarizeTrainingGaps(coverage)

    return NextResponse.json({ requirements, coverage, summary })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
