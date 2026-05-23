'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import type { InspectionItemType, ResponseResult } from '@soteria/core/inspectionScoring'

interface Item {
  id: string; section: string; item_type: InspectionItemType; prompt: string
  required: boolean; weight: number; fail_creates_action: boolean
}
interface Inspection { id: string; title: string; status: string; result: string | null; score: number | null; max_score: number | null }
interface Draft { result?: ResponseResult; value?: string; note?: string }

async function authedHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'content-type': 'application/json',
    'x-active-tenant': tenantId,
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

export default function RunInspectionPage() {
  const { tenantId } = useTenant()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id

  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId || !id) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/inspections/${id}`, { headers: await authedHeaders(tenantId) })
      if (!res.ok) throw new Error(`Failed to load (${res.status})`)
      const json = await res.json()
      setInspection(json.inspection)
      setItems(json.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inspection')
    } finally { setLoading(false) }
  }, [tenantId, id])

  useEffect(() => { load() }, [load])

  function setDraft(itemId: string, patch: Draft) {
    setDrafts(prev => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }))
  }

  async function submit() {
    if (!tenantId) return
    setSubmitting(true); setError(null)
    try {
      const responses = items.map(it => {
        const d = drafts[it.id] ?? {}
        return {
          item_id: it.id,
          result: d.result ?? null,
          value: it.item_type === 'numeric' && d.value !== undefined && d.value !== '' ? Number(d.value) : (d.value ?? null),
          note: d.note ?? null,
        }
      })
      const res = await fetch(`/api/inspections/${id}/submit`, {
        method: 'POST', headers: await authedHeaders(tenantId), body: JSON.stringify({ responses }),
      })
      if (!res.ok) throw new Error(`Submit failed (${res.status})`)
      await load() // reflect submitted state + score
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit')
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-6"><div className="h-40 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" /></div>
  if (!inspection) return <div className="max-w-2xl mx-auto px-4 py-6 text-sm text-slate-500">Inspection not found.</div>

  const submitted = inspection.status === 'submitted'
  const pct = inspection.max_score && inspection.max_score > 0 ? Math.round(((inspection.score ?? 0) / inspection.max_score) * 100) : 100

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <button onClick={() => router.push('/inspections')} className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">← Inspections</button>
      <h1 className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">{inspection.title}</h1>

      {error && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">{error}</p>}

      {submitted && (
        <div className={`mt-4 rounded-lg px-3 py-2 text-sm font-semibold ${inspection.result === 'fail'
          ? 'border border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-200'
          : 'border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200'}`}>
          {inspection.result === 'fail' ? 'Failed' : 'Passed'} · {pct}% ({inspection.score ?? 0}/{inspection.max_score ?? 0})
        </div>
      )}

      <ul className="mt-6 space-y-4">
        {items.map(it => (
          <li key={it.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <p className="font-medium text-slate-900 dark:text-slate-100">
              {it.prompt} {it.required && <span className="text-rose-500">*</span>}
            </p>
            <p className="text-xs text-slate-400">{it.section}</p>
            <div className="mt-2">
              {(it.item_type === 'pass_fail_na' || it.item_type === 'multiple_choice') && (
                <div className="flex gap-2">
                  {(['pass', 'fail', 'na'] as ResponseResult[]).map(r => (
                    <button key={r} disabled={submitted} onClick={() => setDraft(it.id, { result: r })}
                      className={`rounded-md border px-3 py-1.5 text-xs font-semibold capitalize disabled:opacity-60 ${drafts[it.id]?.result === r
                        ? r === 'fail' ? 'border-rose-400 bg-rose-50 text-rose-700' : r === 'pass' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-400 bg-slate-100 text-slate-700'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                      {r === 'na' ? 'N/A' : r}
                    </button>
                  ))}
                </div>
              )}
              {it.item_type === 'numeric' && (
                <input type="number" disabled={submitted} value={drafts[it.id]?.value ?? ''} onChange={e => setDraft(it.id, { value: e.target.value })}
                  className="w-32 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
              )}
              {(it.item_type === 'text' || it.item_type === 'photo' || it.item_type === 'signature') && (
                <textarea disabled={submitted} value={drafts[it.id]?.value ?? ''} onChange={e => setDraft(it.id, { value: e.target.value })}
                  placeholder={it.item_type === 'text' ? 'Notes' : `${it.item_type} reference / note`}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" rows={2} />
              )}
            </div>
          </li>
        ))}
      </ul>

      {!submitted && (
        <button onClick={submit} disabled={submitting}
          className="mt-6 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Submitting…' : 'Submit inspection'}
        </button>
      )}
    </div>
  )
}
