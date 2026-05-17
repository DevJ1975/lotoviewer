'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { summarizeCapas, type CapaRow } from '@soteria/core/incidentCapa'

// Risk-intelligence card showing ISO 45001 10.2 CAPA flow health:
//   - CAPAs awaiting verification (completed but no separate verifier yet)
//   - Overdue CAPAs (in-progress past their due date)
//
// Each count drill-downs to the incidents list filtered on the
// underlying CAPA — slice-2 enhancement; for now the card lists the
// most-recent five rows of each category so the admin can click
// through to the parent incident immediately.

interface CapaWithIncident extends CapaRow {
  incident_id: string
}

export default function CapaWidget() {
  const { tenantId } = useTenant()
  const [rows, setRows]       = useState<CapaWithIncident[] | null>(null)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    try {
      const { data, error } = await supabase
        .from('incident_capas')
        .select('id, status, due_at, completed_at, completed_by_user_id, verified_effective_at, verified_by_user_id, incident_id')
        .eq('tenant_id', tenantId)
        .in('status', ['open', 'in_progress', 'completed'])
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(500)
      if (error) throw new Error(error.message)
      setRows((data ?? []) as CapaWithIncident[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load CAPAs.')
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  if (rows === null && !error) {
    return (
      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
      </section>
    )
  }

  const now = new Date()
  const summary = summarizeCapas(rows ?? [], now)
  const awaiting = (rows ?? [])
    .filter(r => r.status === 'completed')
    .slice(0, 5)
  const overdue = (rows ?? [])
    .filter(r => {
      if (r.status !== 'open' && r.status !== 'in_progress') return false
      if (!r.due_at) return false
      const due = Date.parse(r.due_at)
      return Number.isFinite(due) && due < now.getTime()
    })
    .slice(0, 5)

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">
            CAPA pipeline · ISO 45001 10.2
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Action items moving through completion and verification of effectiveness.
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <DrillTile
          label="Awaiting verification"
          value={summary.awaiting_verification}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="amber"
        />
        <DrillTile
          label="Overdue"
          value={summary.overdue}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="rose"
        />
      </div>

      {awaiting.length > 0 && (
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
            Recent awaiting verification
          </h3>
          <ul className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
            {awaiting.map(c => (
              <li key={c.id} className="py-1">
                <Link href={`/incidents/${c.incident_id}`} className="text-brand-navy hover:underline font-mono">
                  {c.incident_id.slice(0, 8)}…
                </Link>
                <span className="ml-2 text-slate-500 dark:text-slate-400 tabular-nums">
                  completed {c.completed_at ? new Date(c.completed_at).toLocaleDateString() : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {overdue.length > 0 && (
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
            Recent overdue
          </h3>
          <ul className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
            {overdue.map(c => (
              <li key={c.id} className="py-1">
                <Link href={`/incidents/${c.incident_id}`} className="text-brand-navy hover:underline font-mono">
                  {c.incident_id.slice(0, 8)}…
                </Link>
                <span className="ml-2 text-slate-500 dark:text-slate-400 tabular-nums">
                  due {c.due_at ? new Date(c.due_at).toLocaleDateString() : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function DrillTile({
  label, value, icon, tone,
}: {
  label: string
  value: number
  icon:  React.ReactNode
  tone:  'amber' | 'rose'
}) {
  const toneClass = tone === 'amber'
    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-amber-200/80 dark:border-amber-900/70'
    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-200/80 dark:border-rose-900/70'
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</span>
      </div>
      <p className="text-3xl font-black tabular-nums leading-none mt-2">{value}</p>
    </div>
  )
}
