import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { discoverLeadingSignals, type LeadingSignalSeries } from '@soteria/core/leadingIndicatorSignals'

// GET /api/insights/leading-signals
//
// The exploratory lead/lag engine: for each leading indicator, find the lag (in
// months) at which its monthly series best correlates with the recordable
// series — "when near-miss reporting drops, recordables rise ~2 months later."
// Admin-gated. All computation is deterministic; there is no LLM here.
//
// Honest by construction: it returns r + the overlap n and flags `reliable`
// only with enough history; the UI must present it as correlation, not cause.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MONTHS = 18

// Oldest → newest 'YYYY-MM' keys covering the trailing `months`.
function monthlyAxis(months: number): string[] {
  const now = new Date()
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    keys.push(d.toISOString().slice(0, 7))
  }
  return keys
}

function bucket(isoDates: (string | null | undefined)[], axis: string[]): number[] {
  const idx = new Map(axis.map((k, i) => [k, i]))
  const out = new Array(axis.length).fill(0)
  for (const iso of isoDates) {
    if (!iso) continue
    const k = iso.slice(0, 7)
    const i = idx.get(k)
    if (i !== undefined) out[i]++
  }
  return out
}

async function safeDates(
  q: PromiseLike<{ data: unknown[] | null; error: unknown }>,
  field: string,
): Promise<string[]> {
  try {
    const r = await q
    if (r.error) return []
    return ((r.data ?? []) as Record<string, unknown>[]).map(row => row[field] as string)
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const axis = monthlyAxis(MONTHS)
    const sinceIso = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - (MONTHS - 1), 1)).toISOString()

    // Incidents + classifications drive the lagging (recordable) series and the
    // near-miss leading series — always available.
    const [incRes, classRes, inspDates, bbsUnsafeDates, capaDates] = await Promise.all([
      admin.from('incidents').select('id, incident_type, occurred_at').eq('tenant_id', gate.tenantId).gte('occurred_at', sinceIso),
      admin.from('incident_classifications').select('incident_id, meets_recording_criteria').eq('tenant_id', gate.tenantId),
      safeDates(admin.from('inspections').select('created_at').eq('tenant_id', gate.tenantId).eq('result', 'fail').gte('created_at', sinceIso), 'created_at'),
      safeDates(admin.from('bbs_observations').select('observed_at').eq('tenant_id', gate.tenantId).in('kind', ['unsafe_act', 'unsafe_condition']).gte('observed_at', sinceIso), 'observed_at'),
      safeDates(admin.from('incident_actions').select('created_at').eq('tenant_id', gate.tenantId).gte('created_at', sinceIso), 'created_at'),
    ])
    if (incRes.error) throw new Error(incRes.error.message)

    const recordableIds = new Set(
      ((classRes.data ?? []) as { incident_id: string; meets_recording_criteria: boolean }[])
        .filter(c => c.meets_recording_criteria === true).map(c => c.incident_id),
    )
    const incidents = (incRes.data ?? []) as { id: string; incident_type: string; occurred_at: string }[]

    const recordablesMonthly = bucket(incidents.filter(i => recordableIds.has(i.id)).map(i => i.occurred_at), axis)
    const nearMissMonthly = bucket(incidents.filter(i => i.incident_type === 'near_miss').map(i => i.occurred_at), axis)

    const series: LeadingSignalSeries[] = [
      { key: 'near_miss_reporting', label: 'Near-miss reporting', monthly: nearMissMonthly },
      { key: 'inspection_failures', label: 'Failing inspections', monthly: bucket(inspDates, axis) },
      { key: 'bbs_at_risk', label: 'BBS at-risk observations', monthly: bucket(bbsUnsafeDates, axis) },
      { key: 'capa_opened', label: 'CAPAs opened', monthly: bucket(capaDates, axis) },
    ].filter(s => s.monthly.some(v => v > 0)) // drop indicators with no activity

    const signals = discoverLeadingSignals(series, recordablesMonthly, { maxLag: 4, minMonths: 12 })

    return NextResponse.json({
      months: axis.length,
      recordableMonths: recordablesMonthly.filter(v => v > 0).length,
      signals,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'insights/leading-signals' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
