'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, ArrowRight, Info, Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// Exploratory lead/lag panel. Shows which leading indicators historically
// precede recordables for THIS tenant, at what lag, and how strongly —
// computed deterministically server-side from monthly series (laggedCorrelation).
// Presented explicitly as correlation, not causation.

interface LeadingSignal {
  key: string
  label: string
  bestLag: number
  r: number
  nMonths: number
  direction: 'predicts_more' | 'predicts_fewer' | 'none'
  reliable: boolean
}

export default function LeadingSignalPanel({ tenantId }: { tenantId: string }) {
  const [signals, setSignals] = useState<LeadingSignal[] | null>(null)
  const [recordableMonths, setRecordableMonths] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenantId }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch('/api/insights/leading-signals', { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setSignals(body.signals as LeadingSignal[])
      setRecordableMonths(body.recordableMonths ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { if (tenantId) void load() }, [tenantId, load])

  if (loading) {
    return <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
  }
  if (error) {
    return <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-500">Couldn&apos;t load leading signals: {error}</div>
  }

  const reliable = (signals ?? []).filter(s => s.reliable && s.direction !== 'none')
  const insufficient = recordableMonths < 6 || (signals ?? []).length === 0

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <header className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-brand-navy" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Leading indicator signals</h3>
      </header>

      {insufficient ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Not enough incident history yet to detect lead/lag relationships. This panel needs several months of both recordables and leading-indicator activity.
        </p>
      ) : reliable.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No leading indicator shows a reliable lead/lag relationship with recordables in the available history. That is common — and better than a spurious one.
        </p>
      ) : (
        <ul className="space-y-2">
          {reliable.map(s => (
            <li key={s.key} className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
              {s.direction === 'predicts_more'
                ? <TrendingUp className="h-4 w-4 mt-0.5 shrink-0 text-rose-500" />
                : <TrendingDown className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 dark:text-slate-200">
                  <strong>{s.label}</strong>
                  <ArrowRight className="inline h-3 w-3 mx-1 text-slate-400" />
                  {s.direction === 'predicts_more' ? 'precedes MORE recordables' : 'precedes FEWER recordables'}
                  {s.bestLag > 0 ? ` ~${s.bestLag} mo later` : ' (same month)'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  r&nbsp;{s.r >= 0 ? '+' : ''}{s.r.toFixed(2)} · {s.nMonths} months of overlap
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        Exploratory — this is correlation over monthly counts, not proof of cause. Use it to decide what to watch, then confirm on the ground.
      </p>
    </div>
  )
}
