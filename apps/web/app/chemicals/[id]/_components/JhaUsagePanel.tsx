'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardList, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// Reverse-lookup panel on the chemical detail page that answers
// "we want to ban this chemical, what JHAs would I have to update?".
// Reads /api/chemicals/products/[id]/jha-usage which de-dupes to
// distinct JHAs (not steps) and excludes superseded ones.

interface JhaUsageRow {
  jha_id:     string
  title:      string
  job_number: string | null
  status:     string
  step_count: number
  sample_step: { sequence: number; description: string }
}

const STATUS_PILL: Record<string, string> = {
  draft:      'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_review:  'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  approved:   'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  superseded: 'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-500',
}

interface Props { productId: string }

export default function JhaUsagePanel({ productId }: Props) {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<JhaUsageRow[] | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    const res = await fetch(`/api/chemicals/products/${productId}/jha-usage`, { headers })
    if (!res.ok) { setRows([]); return }
    const body = await res.json()
    setRows(body.jhas ?? [])
  }, [tenant, productId])

  useEffect(() => { void load() }, [load])

  if (rows === null) {
    return (
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading JHA usage…
        </div>
      </section>
    )
  }

  // Hide the panel entirely when there's no usage — avoids visual noise.
  if (rows.length === 0) return null

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3">
        <ClipboardList className="w-4 h-4" /> Used in {rows.length} JHA{rows.length === 1 ? '' : 's'}
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
        Banning this chemical or changing its PPE requirements would impact these Job Hazard Analyses.
      </p>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded border border-slate-200 dark:border-slate-800 overflow-hidden">
        {rows.map(r => (
          <li key={r.jha_id} className="px-3 py-2">
            <Link
              href={`/jha/${r.jha_id}`}
              className="flex flex-wrap items-center gap-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-900 -m-3 p-3"
            >
              {r.job_number && (
                <span className="font-mono text-xs text-slate-500">{r.job_number}</span>
              )}
              <span className="font-medium text-slate-900 dark:text-slate-100">{r.title}</span>
              <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded uppercase ${STATUS_PILL[r.status] ?? STATUS_PILL.draft}`}>
                {r.status}
              </span>
              <span className="ml-auto text-xs text-slate-500">
                {r.step_count} step{r.step_count === 1 ? '' : 's'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
