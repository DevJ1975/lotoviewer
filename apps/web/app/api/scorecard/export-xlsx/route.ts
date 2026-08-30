import type { SupabaseClient } from '@supabase/supabase-js'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { computeIncidentRisk } from '@/lib/incidentRiskFeatures'
import { buildScorecardWorkbook, type ScorecardWorkbookInput, type TargetSummaryRow } from '@/lib/scorecardWorkbook'
import { benchmarkForNaics } from '@soteria/core/industryBenchmark'
import {
  TARGET_METRICS, TARGET_METRIC_META, evaluateTarget, type TargetMetric,
} from '@soteria/core/ehsTargets'

// Multi-tab EHS Scorecard .xlsx. Same hybrid sourcing as the PDF route: the
// client POSTs the LOTO + incident metrics it already rendered (admin-gated) +
// the window; this route recomputes the predicted-risk score server-side (so the
// headline can't be tampered with), evaluates configured goals vs. the BLS
// benchmark, and hands everything to buildScorecardWorkbook. The .xlsx opens in
// Excel and imports cleanly into Google Sheets.

export const runtime = 'nodejs'

const SPREADSHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

// Evaluate the tenant's configured goals (current vs. target vs. industry
// benchmark) for the Targets tab. Reads are RLS-scoped via the authed client and
// admin-gated upstream; the math is the same pure core the on-screen board uses.
async function buildTargets(
  authed: SupabaseClient,
  incident: ScorecardWorkbookInput['incident'],
): Promise<TargetSummaryRow[]> {
  const inc = incident ?? {}
  const year = new Date().getUTCFullYear()

  const [targetsRes, estRes] = await Promise.all([
    authed.from('ehs_scorecard_targets').select('kind, metric, period_year, value'),
    authed.from('osha_establishments').select('naics_code').not('naics_code', 'is', null).limit(1),
  ])
  const rows = (targetsRes.data ?? []) as { kind: string; metric: string; period_year: number | null; value: number }[]
  const naics = (estRes.data?.[0]?.naics_code as string | undefined) ?? null
  const bls = benchmarkForNaics(naics)

  const currentByMetric: Record<TargetMetric, number | null> = {
    trir:               typeof inc.trir === 'number' ? inc.trir : null,
    dart:               typeof inc.dart === 'number' ? inc.dart : null,
    recordables:        typeof inc.totalRecordable === 'number' ? inc.totalRecordable : null,
    capa_on_time_pct:   typeof inc.actionClosureOnTimePct === 'number' ? inc.actionClosureOnTimePct : null,
    rca_completion_pct: typeof inc.rcaCompletionPct === 'number' ? inc.rcaCompletionPct : null,
  }
  const blsByMetric: Partial<Record<TargetMetric, number>> = { trir: bls.trir, dart: bls.dart }

  return TARGET_METRICS.map<TargetSummaryRow>(metric => {
    const meta = TARGET_METRIC_META[metric]
    const current = currentByMetric[metric]
    const target = rows.find(r => r.kind === 'target' && r.metric === metric && r.period_year === year)?.value ?? null
    const benchmark = meta.hasBenchmark
      ? (rows.find(r => r.kind === 'benchmark' && r.metric === metric)?.value ?? blsByMetric[metric] ?? null)
      : null
    const verdict = target !== null ? evaluateTarget(current, target, meta.lowerIsBetter) : null
    const status = target === null ? 'no target set'
      : current === null ? 'no data'
      : verdict!.onTrack ? 'on track' : 'off track'
    return { metric: meta.label, current, target, benchmark, onTrack: verdict?.onTrack ?? null, status }
  })
}

export async function POST(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  let body: { metrics?: ScorecardWorkbookInput['loto']; incidentMetrics?: ScorecardWorkbookInput['incident']; windowDays?: number }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }
  const windowDays = num(body.windowDays, 30)

  try {
    const { data: tenant } = await g.authedClient
      .from('tenants').select('name').eq('id', g.tenantId).maybeSingle()
    const tenantName = (tenant?.name as string | undefined) ?? 'Tenant'

    // Authoritative, deterministic risk — recomputed server-side, never trusted
    // from the client. Non-fatal: a failure just omits the risk-derived tabs.
    let risk: ScorecardWorkbookInput['risk'] = null
    try { risk = await computeIncidentRisk(supabaseAdmin(), g.tenantId) } catch { risk = null }

    const targets = await buildTargets(g.authedClient, body.incidentMetrics ?? null)

    const bytes = await buildScorecardWorkbook({
      tenantName,
      windowDays,
      loto: body.metrics ?? null,
      incident: body.incidentMetrics ?? null,
      risk,
      targets,
    })

    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': SPREADSHEET_MIME,
        'content-disposition': `attachment; filename="ehs-scorecard-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    })
  } catch (e) {
    return sanitizeError(e, 'POST /api/scorecard/export-xlsx')
  }
}
