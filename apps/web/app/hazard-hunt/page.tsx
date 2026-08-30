'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Radar, ShieldAlert, ArrowUpRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { RiskBandPill } from '@/components/ui/RiskBandPill'
import type { Band } from '@soteria/core/risk'

// Hazard Hunt dashboard: the proactive-inspection cockpit. Surfaces the open
// findings queue (each escalatable into the risk register), the deterministic
// finding metrics, and the entry points to set up templates + read the guide.

interface Finding {
  id: string; finding_number: string | null; inspection_id: string
  hazard_category: string; title: string; description: string
  severity_hint: Band | null; status: string; created_at: string
}
interface CategoryCount { category: string; count: number }
interface Metrics {
  totalFindings: number; openFindings: number; resolvedFindings: number
  cadenceAdherence: number; topCategories: CategoryCount[]
  trend: { recentOpened: number; priorOpened: number; delta: number }
}

const ACTIVITY_TYPES = ['routine', 'non_routine', 'emergency'] as const
const EXPOSURE_FREQS = ['continuous', 'daily', 'weekly', 'monthly', 'rare'] as const

async function authedHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'content-type': 'application/json',
    'x-active-tenant': tenantId,
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

export default function HazardHuntPage() {
  const { tenantId } = useTenant()
  const [findings, setFindings] = useState<Finding[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true); setError(null)
    try {
      const headers = await authedHeaders(tenantId)
      const [fRes, mRes] = await Promise.all([
        fetch('/api/hazard-hunt/findings', { headers }),
        fetch('/api/hazard-hunt/analytics', { headers }),
      ])
      if (!fRes.ok) throw new Error(`Failed to load findings (${fRes.status})`)
      setFindings((await fRes.json()).findings ?? [])
      if (mRes.ok) setMetrics((await mRes.json()).metrics ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load hazard hunt data')
    } finally { setLoading(false) }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  async function seedTemplates() {
    if (!tenantId) return
    setSeeding(true); setError(null)
    try {
      const res = await fetch('/api/hazard-hunt/templates/seed', { method: 'POST', headers: await authedHeaders(tenantId) })
      if (!res.ok) throw new Error(`Could not set up templates (${res.status})`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set up templates')
    } finally { setSeeding(false) }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Radar className="h-5 w-5" /> Hazard Hunt
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Daily/weekly/monthly OSHA &amp; Cal/OSHA inspections. Findings feed the EHS score and escalate to the risk register.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={seedTemplates}
            disabled={seeding}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {seeding ? 'Setting up…' : 'Set up templates'}
          </button>
          <Link href="/inspections" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">
            Run a hunt
          </Link>
          <Link href="/wiki/hazard-hunt" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">
            Guide
          </Link>
        </div>
      </header>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</div>}

      {metrics && <MetricsBar metrics={metrics} />}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4" /> Open findings
        </h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : findings.length === 0 ? (
          <p className="text-sm text-slate-500">No open findings. Submit a hazard hunt to surface hazards.</p>
        ) : (
          <ul className="space-y-2">
            {findings.map(f => (
              <FindingCard key={f.id} finding={f} tenantId={tenantId ?? ''} onEscalated={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function MetricsBar({ metrics }: { metrics: Metrics }) {
  const tiles: { label: string; value: string }[] = [
    { label: 'Open findings', value: String(metrics.openFindings) },
    { label: 'Resolved', value: String(metrics.resolvedFindings) },
    { label: 'Cadence adherence', value: `${Math.round(metrics.cadenceAdherence * 100)}%` },
    { label: 'Trend (recent vs prior)', value: `${metrics.trend.recentOpened} vs ${metrics.trend.priorOpened}` },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(t => (
        <div key={t.label} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <div className="text-xs text-slate-500">{t.label}</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t.value}</div>
        </div>
      ))}
    </div>
  )
}

function FindingCard({ finding, tenantId, onEscalated }: { finding: Finding; tenantId: string; onEscalated: () => void }) {
  const [activityType, setActivityType] = useState<typeof ACTIVITY_TYPES[number]>('routine')
  const [exposure, setExposure] = useState<typeof EXPOSURE_FREQS[number]>('weekly')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function escalate() {
    if (!tenantId) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/hazard-hunt/findings/${finding.id}/escalate`, {
        method: 'POST',
        headers: await authedHeaders(tenantId),
        body: JSON.stringify({ activity_type: activityType, exposure_frequency: exposure }),
      })
      if (!res.ok && res.status !== 409) throw new Error(`Escalation failed (${res.status})`)
      onEscalated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Escalation failed')
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {finding.severity_hint && <RiskBandPill band={finding.severity_hint} compact />}
            <span className="text-xs uppercase tracking-wide text-slate-400">{finding.hazard_category}</span>
            {finding.finding_number && <span className="text-xs text-slate-400">{finding.finding_number}</span>}
          </div>
          <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{finding.title}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <select value={activityType} onChange={e => setActivityType(e.target.value as typeof ACTIVITY_TYPES[number])} className="rounded border border-slate-300 px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
            {ACTIVITY_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={exposure} onChange={e => setExposure(e.target.value as typeof EXPOSURE_FREQS[number])} className="rounded border border-slate-300 px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
            {EXPOSURE_FREQS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <button onClick={escalate} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50">
            <ArrowUpRight className="h-3.5 w-3.5" /> {busy ? 'Escalating…' : 'Escalate to risk'}
          </button>
        </div>
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </li>
  )
}
