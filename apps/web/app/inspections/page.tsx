'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'

interface InspectionRow {
  id: string; title: string; status: string; result: string | null
  score: number | null; max_score: number | null; started_at: string; submitted_at: string | null
}
interface TemplateRow { id: string; name: string; category: string }

async function authedHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'content-type': 'application/json',
    'x-active-tenant': tenantId,
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

export default function InspectionsPage() {
  const { tenantId } = useTenant()
  const router = useRouter()
  const [inspections, setInspections] = useState<InspectionRow[]>([])
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [picked, setPicked] = useState('')
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/inspections', { headers: await authedHeaders(tenantId) })
      if (!res.ok) throw new Error(`Failed to load (${res.status})`)
      const json = await res.json()
      setInspections(json.inspections ?? [])
      setTemplates(json.templates ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inspections')
    } finally { setLoading(false) }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  async function start() {
    if (!tenantId || !picked) return
    setStarting(true); setError(null)
    try {
      const res = await fetch('/api/inspections', {
        method: 'POST', headers: await authedHeaders(tenantId), body: JSON.stringify({ template_id: picked }),
      })
      if (!res.ok) throw new Error(`Could not start (${res.status})`)
      const { id } = await res.json()
      router.push(`/inspections/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start inspection')
      setStarting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
        <ClipboardList className="h-5 w-5" /> Inspections
      </h1>

      {error && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">{error}</p>}

      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-4 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Start an inspection</span>
          <select value={picked} onChange={e => setPicked(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm">
            <option value="">Choose a template…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <button onClick={start} disabled={!picked || starting}
          className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {starting ? 'Starting…' : 'Start'}
        </button>
      </div>

      {loading ? (
        <div className="mt-6 space-y-2">{[0, 1].map(i => <div key={i} className="h-14 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
      ) : inspections.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">No inspections yet. Start one above.</p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
          {inspections.map(ins => (
            <li key={ins.id}>
              <Link href={`/inspections/${ins.id}`} className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/40">
                <div>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{ins.title}</span>
                  <span className="ml-2 text-xs text-slate-500">{new Date(ins.started_at).toLocaleDateString()}</span>
                </div>
                <StatusBadge status={ins.status} result={ins.result} score={ins.score} maxScore={ins.max_score} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusBadge({ status, result, score, maxScore }: {
  status: string; result: string | null; score: number | null; maxScore: number | null
}) {
  if (status !== 'submitted') {
    return <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">In progress</span>
  }
  const pct = maxScore && maxScore > 0 ? Math.round(((score ?? 0) / maxScore) * 100) : 100
  const fail = result === 'fail'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${fail
      ? 'border border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300'
      : 'border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>
      {fail ? 'Fail' : 'Pass'} · {pct}%
    </span>
  )
}
