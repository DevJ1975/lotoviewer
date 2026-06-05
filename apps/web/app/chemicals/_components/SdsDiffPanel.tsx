'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, GitCompare, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { SdsFieldDiff } from '@soteria/core/sdsDiff'

// Revision diff panel for the SDS review queue. Fetches the structured
// delta between the SDS revision under review and the previously-approved
// revision, then renders it as a compact, colour-coded change list:
//   added   → green   (a new hazard / control to confirm)
//   removed → red     (a hazard / control that dropped off)
//   changed → amber   ("before → after", e.g. a tightened PEL)
//
// The diff is deterministic and computed server-side from stored parse
// JSON — this component only presents it.

interface DiffResponse {
  diff:        SdsFieldDiff[]
  summary:     string
  hasPrevious: boolean
}

interface Props {
  productId: string
  sdsId:     string
  tenantId:  string | null
}

export function SdsDiffPanel({ productId, sdsId, tenantId }: Props) {
  const [data,  setData]  = useState<DiffResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)

    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenantId }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      try {
        const res  = await fetch(
          `/api/chemicals/products/${productId}/sds/${sdsId}/diff`,
          { headers },
        )
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(body.error ?? `HTTP ${res.status}`)
          return
        }
        setData(body as DiffResponse)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [productId, sdsId, tenantId])

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <header className="flex items-center gap-2">
        <GitCompare className="w-4 h-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Revision changes vs. last approved SDS
        </h2>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Computing diff…
        </div>
      )}

      {!loading && error && (
        <div className="text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}

      {!loading && !error && data && !data.hasPrevious && (
        <p className="text-sm text-slate-500 italic">
          First revision — nothing to compare.
        </p>
      )}

      {!loading && !error && data && data.hasPrevious && data.diff.length === 0 && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          No regulatory-critical changes from the previous revision.
        </p>
      )}

      {!loading && !error && data && data.hasPrevious && data.diff.length > 0 && (
        <>
          {data.summary && (
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {data.summary}
            </p>
          )}
          <ul className="space-y-1.5">
            {data.diff.map((d, i) => (
              <DiffRow key={`${d.field}-${i}`} diff={d} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

const KIND_STYLE: Record<SdsFieldDiff['kind'], { chip: string; label: string }> = {
  added:   { chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300', label: 'Added' },
  removed: { chip: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',             label: 'Removed' },
  changed: { chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',          label: 'Changed' },
}

function DiffRow({ diff }: { diff: SdsFieldDiff }) {
  const style = KIND_STYLE[diff.kind]
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded ${style.chip}`}>
        {style.label}
      </span>
      <span className="font-medium text-slate-700 dark:text-slate-300">{diff.label}</span>
      <span className="text-slate-600 dark:text-slate-400 inline-flex items-center gap-1">
        {diff.kind === 'changed' ? (
          <>
            <span className="line-through opacity-70">{diff.before}</span>
            <ArrowRight className="w-3 h-3" />
            <span className="font-medium">{diff.after}</span>
          </>
        ) : diff.kind === 'added' ? (
          <span className="font-medium">{diff.after}</span>
        ) : (
          <span className="line-through opacity-70">{diff.before}</span>
        )}
      </span>
    </li>
  )
}
