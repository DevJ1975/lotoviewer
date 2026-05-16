'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, ClipboardCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'

interface Review {
  id:                  string
  review_year:         number
  reviewed_at:         string
  signed:              boolean
  signed_name:         string | null
  signed_at:           string | null
  deviations:          string | null
  corrective_actions:  string | null
  next_due_at:         string
}

async function tenantHeaders(tenantId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const h = new Headers()
  if (session?.access_token) h.set('Authorization', `Bearer ${session.access_token}`)
  h.set('x-active-tenant', tenantId)
  h.set('Content-Type', 'application/json')
  return h
}

export default function AnnualReviewPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [history, setHistory] = useState<Review[]>([])
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [deviations, setDeviations] = useState('')
  const [actions, setActions] = useState('')
  const [signedName, setSignedName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    const { data, error } = await supabase
      .from('prop65_annual_reviews')
      .select('id, review_year, reviewed_at, signed, signed_name, signed_at, deviations, corrective_actions, next_due_at')
      .eq('tenant_id', tenantId)
      .order('review_year', { ascending: false })
    if (error) { setError(error.message); return }
    setHistory((data ?? []) as Review[])
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  async function submit(e: React.FormEvent, withSignature: boolean) {
    e.preventDefault()
    if (!tenantId) return
    setBusy(true)
    setError(null)
    try {
      const h = await tenantHeaders(tenantId)
      const res = await fetch('/api/prop65/annual-reviews', {
        method: 'POST', headers: h,
        body: JSON.stringify({
          review_year:        year,
          deviations:         deviations || null,
          corrective_actions: actions || null,
          signed:             withSignature,
          signed_name:        signedName.trim() || undefined,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Submit failed')
      await load()
      if (withSignature) { setDeviations(''); setActions(''); setSignedName('') }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  if (!profile?.is_admin) return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/prop65" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to Prop 65
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-brand-navy" /> Annual program review
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Cal. Health & Safety Code §25249.5 — one signed artifact per calendar year.</p>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>}

      <form className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3" onSubmit={e => submit(e, false)}>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">New / draft review</h2>
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">Review year
          <input type="number" min="2000" max="2100" value={year} onChange={e => setYear(Number(e.target.value))} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">Deviations
          <textarea value={deviations} onChange={e => setDeviations(e.target.value)} rows={3} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">Corrective actions
          <textarea value={actions} onChange={e => setActions(e.target.value)} rows={3} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">Signer's printed name (required to sign)
          <input value={signedName} onChange={e => setSignedName(e.target.value)} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm" />
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded border border-slate-300 dark:border-slate-700 text-sm px-3 py-1.5 disabled:opacity-50">Save draft</button>
          <button type="button" disabled={busy || !signedName.trim()} onClick={e => submit(e as unknown as React.FormEvent, true)} className="rounded bg-brand-navy text-white text-sm px-3 py-1.5 disabled:opacity-50">Sign &amp; save</button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Review history</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No reviews yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.map(r => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">{r.review_year}</span>
                  {r.signed ? <span className="text-[11px] text-emerald-700 dark:text-emerald-300">signed by {r.signed_name} on {r.signed_at?.slice(0, 10)}</span>
                            : <span className="text-[11px] text-amber-700 dark:text-amber-300">unsigned draft</span>}
                </div>
                {r.deviations && <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">Deviations: {r.deviations}</p>}
                {r.corrective_actions && <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Actions: {r.corrective_actions}</p>}
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Next due: {r.next_due_at.slice(0, 10)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
