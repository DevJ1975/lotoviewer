'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, ShieldCheck, Zap, Wrench, FlaskConical, Flame, Gauge, Activity, ExternalLink } from 'lucide-react'
import { supabase, readActiveTenant } from '@/lib/supabase'

// Renders the structured hazard report returned by /api/assistant/hazards.
// Used in three places:
//   1. /scan page after a successful scan
//   2. AssistantDock (sheet)
//   3. /equipment/[id] "Hazards (AI)" tab
//
// Owns the fetch so each host only has to pass the equipment_id +
// (optional) handler-on-load callback.

interface HazardItem {
  category:    string
  description: string
  severity:    'low' | 'medium' | 'high' | 'critical'
  controls:    string[]
  citations:   string[]
}

interface Citation {
  title:      string
  section:    string | null
  source_url: string | null
}

interface Source {
  title:        string
  source_type:  string
  jurisdiction: string | null
  source_url:   string | null
  similarity:   number
}

export interface Report {
  summary:             string
  hazards:             HazardItem[]
  energy_sources:      string[]
  isolation_steps:     string[]
  required_ppe:        string[]
  regulatory_refs:     Citation[]
  company_policy_refs: Citation[]
  warnings:            string[]
}

interface ApiResponse {
  equipment: { id: string; equipment_id: string; description: string | null; department: string | null }
  report:    Report
  sources:   Source[]
}

interface Props {
  equipmentId: string
  onLoaded?:   (r: ApiResponse) => void
}

const SEVERITY_CLASS: Record<HazardItem['severity'], string> = {
  low:      'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  medium:   'bg-amber-100   text-amber-800   dark:bg-amber-900/40   dark:text-amber-200',
  high:     'bg-orange-100  text-orange-800  dark:bg-orange-900/40  dark:text-orange-200',
  critical: 'bg-rose-100    text-rose-800    dark:bg-rose-900/40    dark:text-rose-200',
}

function CategoryIcon({ category }: { category: string }) {
  const c = category.toLowerCase()
  if (c.includes('electric')) return <Zap className="h-4 w-4 text-amber-500" />
  if (c.includes('mechanical')) return <Wrench className="h-4 w-4 text-slate-500" />
  if (c.includes('chemical')) return <FlaskConical className="h-4 w-4 text-purple-500" />
  if (c.includes('thermal') || c.includes('fire')) return <Flame className="h-4 w-4 text-orange-500" />
  if (c.includes('pressure')) return <Gauge className="h-4 w-4 text-sky-500" />
  return <Activity className="h-4 w-4 text-slate-500" />
}

export default function HazardReportView({ equipmentId, onLoaded }: Props) {
  const [data,    setData]    = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!equipmentId) return
    let cancelled = false
    void (async () => {
      setLoading(true); setError(null)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const access = session?.access_token
        const tenantId = readActiveTenant()
        if (!access)  throw new Error('Sign in expired.')
        if (!tenantId) throw new Error('No active tenant.')

        const res = await fetch('/api/assistant/hazards', {
          method:  'POST',
          headers: {
            'content-type':    'application/json',
            'authorization':   `Bearer ${access}`,
            'x-active-tenant': tenantId,
          },
          body: JSON.stringify({ equipment_id: equipmentId }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error ?? `Server returned ${res.status}`)
        if (!cancelled) {
          setData(j as ApiResponse)
          onLoaded?.(j as ApiResponse)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  // onLoaded intentionally omitted — running the effect on identity changes
  // would re-fire the request when the parent re-renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Generating hazard report — this can take 10–20 seconds…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 p-3 text-sm text-rose-700 dark:text-rose-300">
        {error}
      </div>
    )
  }
  if (!data) return null

  const { equipment, report, sources } = data

  return (
    <div className="space-y-4 text-sm text-slate-800 dark:text-slate-200">
      <header className="border-b border-slate-200 dark:border-slate-800 pb-3">
        <h2 className="text-base font-semibold">{equipment.equipment_id}</h2>
        {equipment.description && <p className="text-xs text-slate-500">{equipment.description}</p>}
        {equipment.department && <p className="text-xs text-slate-500">Department: {equipment.department}</p>}
      </header>

      <p className="leading-relaxed">{report.summary}</p>

      {/* Warnings (always show — these are hard limits the model is told to include) */}
      {report.warnings?.length > 0 && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-3">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Warnings
          </p>
          <ul className="space-y-1 text-xs text-amber-900 dark:text-amber-100 list-disc pl-5">
            {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <section>
        <h3 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Hazards</h3>
        <ul className="space-y-2">
          {report.hazards?.map((h, i) => (
            <li key={i} className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex items-center gap-2 mb-1">
                <CategoryIcon category={h.category} />
                <span className="text-xs font-semibold capitalize">{h.category}</span>
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${SEVERITY_CLASS[h.severity] ?? SEVERITY_CLASS.medium}`}>
                  {h.severity}
                </span>
              </div>
              <p className="mb-1.5">{h.description}</p>
              {h.controls?.length > 0 && (
                <ul className="text-xs text-slate-600 dark:text-slate-300 list-disc pl-5 space-y-0.5">
                  {h.controls.map((c, j) => <li key={j}>{c}</li>)}
                </ul>
              )}
              {h.citations?.length > 0 && (
                <p className="mt-1.5 text-[10px] text-slate-400">
                  {h.citations.join('  ·  ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {report.energy_sources?.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Energy sources</h3>
          <ul className="text-xs list-disc pl-5 space-y-0.5">
            {report.energy_sources.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </section>
      )}

      {report.isolation_steps?.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Isolation steps</h3>
          <ol className="text-xs list-decimal pl-5 space-y-0.5">
            {report.isolation_steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </section>
      )}

      {report.required_ppe?.length > 0 && (
        <section className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 p-3">
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5 mb-1">
            <ShieldCheck className="h-3.5 w-3.5" /> Required PPE
          </p>
          <ul className="text-xs text-emerald-900 dark:text-emerald-100 list-disc pl-5 space-y-0.5">
            {report.required_ppe.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </section>
      )}

      {sources.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Sources</h3>
          <ul className="space-y-0.5">
            {sources.map((s, i) => (
              <li key={i} className="text-[11px] text-slate-600 dark:text-slate-300">
                {s.source_url ? (
                  <a href={s.source_url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5">
                    {s.title} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span>{s.title}</span>
                )}
                {s.jurisdiction && <span className="text-slate-400"> · {s.jurisdiction}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[11px] text-slate-400 text-center pt-2 border-t border-slate-100 dark:border-slate-800">
        Soteria is a drafting + reference tool. A qualified person must verify isolation and authorize the work.
      </p>
    </div>
  )
}
