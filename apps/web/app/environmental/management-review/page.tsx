'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ScrollText, Loader2, Trash2, Pencil } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import {
  isValidReviewPeriod,
  reviewHasOutputs,
  REVIEW_STATUSES,
  MANAGEMENT_REVIEW_INPUTS,
  MANAGEMENT_REVIEW_OUTPUTS,
  type ReviewStatus,
} from '@soteria/core/managementReview'

// /environmental/management-review — ISO 14001:2015 §9.3.
// A review is one record (inputs summary + conclusions + decisions).
// Action items are nonconformities with source_type = management_review.

interface ReviewRow {
  id:             string
  title:          string
  review_date:    string
  period_start:   string | null
  period_end:     string | null
  attendees:      string | null
  inputs_summary: string | null
  conclusions:    string | null
  decisions:      string | null
  status:         ReviewStatus
}

const STATUS_BADGE: Record<ReviewStatus, string> = {
  scheduled:   'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
  completed:   'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  cancelled:   'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

const EMPTY = {
  title: '', reviewDate: '', periodStart: '', periodEnd: '', attendees: '',
  inputsSummary: '', conclusions: '', decisions: '', status: 'scheduled' as ReviewStatus,
}

export default function ManagementReviewPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [rows, setRows]           = useState<ReviewRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [showForm, setShowForm]   = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [f, setF]                 = useState(EMPTY)

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF(prev => ({ ...prev, [k]: v }))

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const { data, error } = await supabase
        .from('management_reviews')
        .select('id, title, review_date, period_start, period_end, attendees, inputs_summary, conclusions, decisions, status')
        .eq('tenant_id', tenantId)
        .order('review_date', { ascending: false })
        .limit(1000)
      if (error) throw new Error(formatSupabaseError(error, 'load reviews'))
      setRows((data ?? []) as ReviewRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load management reviews.')
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void load()
  }, [authLoading, profile, load])

  function startNew() {
    setEditingId(null); setF(EMPTY); setShowForm(true)
  }
  function startEdit(r: ReviewRow) {
    setEditingId(r.id)
    setF({
      title: r.title,
      reviewDate: r.review_date ?? '',
      periodStart: r.period_start ?? '',
      periodEnd: r.period_end ?? '',
      attendees: r.attendees ?? '',
      inputsSummary: r.inputs_summary ?? '',
      conclusions: r.conclusions ?? '',
      decisions: r.decisions ?? '',
      status: r.status,
    })
    setShowForm(true)
  }

  async function save() {
    if (!tenantId || !f.title.trim()) return
    if (!isValidReviewPeriod(f.periodStart || null, f.periodEnd || null)) {
      setLoadError('Period end must be on or after period start.')
      return
    }
    setSaving(true); setLoadError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const payload = {
        tenant_id:      tenantId,
        title:          f.title.trim(),
        review_date:    f.reviewDate || undefined,
        period_start:   f.periodStart || null,
        period_end:     f.periodEnd || null,
        attendees:      f.attendees.trim() || null,
        inputs_summary: f.inputsSummary.trim() || null,
        conclusions:    f.conclusions.trim() || null,
        decisions:      f.decisions.trim() || null,
        status:         f.status,
        updated_by:     user?.id ?? null,
      }
      const { error } = editingId
        ? await supabase.from('management_reviews').update(payload).eq('id', editingId).eq('tenant_id', tenantId)
        : await supabase.from('management_reviews').insert({ ...payload, created_by: user?.id ?? null })
      if (error) throw new Error(formatSupabaseError(error, 'save review'))
      setShowForm(false); setEditingId(null); setF(EMPTY)
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not save the review.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!tenantId) return
    if (!confirm('Delete this management review?')) return
    setSaving(true); setLoadError(null)
    try {
      const { error } = await supabase.from('management_reviews').delete().eq('id', id).eq('tenant_id', tenantId)
      if (error) throw new Error(formatSupabaseError(error, 'delete review'))
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not delete the review.')
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }
  if (!profile?.is_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">
        Admins only.
      </div>
    )
  }

  const ta = 'mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm'

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/environmental" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-brand-navy" />
          Management review
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          ISO 14001:2015 §9.3. Action items become nonconformities tagged <span className="font-mono">management_review</span>.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={() => (showForm ? setShowForm(false) : startNew())}
          className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold hover:bg-brand-navy/90">
          {showForm ? 'Cancel' : 'New review'}
        </button>
      </div>

      {showForm && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Title</span>
              <input type="text" value={f.title} onChange={e => set('title', e.target.value)}
                placeholder="e.g. H1 2026 EMS Management Review" className={ta} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Review date</span>
              <input type="date" value={f.reviewDate} onChange={e => set('reviewDate', e.target.value)} className={ta} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Status</span>
              <select value={f.status} onChange={e => set('status', e.target.value as ReviewStatus)} className={ta}>
                {REVIEW_STATUSES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Period start</span>
              <input type="date" value={f.periodStart} onChange={e => set('periodStart', e.target.value)} className={ta} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Period end</span>
              <input type="date" value={f.periodEnd} onChange={e => set('periodEnd', e.target.value)} className={ta} />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Attendees</span>
              <input type="text" value={f.attendees} onChange={e => set('attendees', e.target.value)}
                placeholder="Top management + EMS lead" className={ta} />
            </label>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Inputs reviewed (§9.3.2)</span>
                <textarea value={f.inputsSummary} onChange={e => set('inputsSummary', e.target.value)} rows={6} className={ta} />
              </label>
              <ul className="mt-2 text-[11px] text-slate-400 dark:text-slate-500 list-disc pl-4 space-y-0.5">
                {MANAGEMENT_REVIEW_INPUTS.map(i => <li key={i}>{i}</li>)}
              </ul>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Conclusions (§9.3.3)</span>
                <textarea value={f.conclusions} onChange={e => set('conclusions', e.target.value)} rows={3} className={ta}
                  placeholder="Continuing suitability, adequacy & effectiveness of the EMS" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Decisions</span>
                <textarea value={f.decisions} onChange={e => set('decisions', e.target.value)} rows={3} className={ta}
                  placeholder="Improvements, EMS changes, resource needs" />
              </label>
              <ul className="text-[11px] text-slate-400 dark:text-slate-500 list-disc pl-4 space-y-0.5">
                {MANAGEMENT_REVIEW_OUTPUTS.map(o => <li key={o}>{o}</li>)}
              </ul>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={() => void save()} disabled={saving || !f.title.trim()}
              className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90">
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create review'}
            </button>
          </div>
        </section>
      )}

      <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        {rows === null ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400 italic">
            No management reviews yet — schedule the first one above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Review</th>
                <th className="text-left px-4 py-2 w-40">Period</th>
                <th className="text-left px-4 py-2 w-28">Status</th>
                <th className="text-left px-4 py-2 w-24">Outputs</th>
                <th className="px-4 py-2 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 align-top">
                  <td className="px-4 py-2 text-slate-900 dark:text-slate-100">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-[11px] text-slate-400">{new Date(r.review_date).toLocaleDateString()}</div>
                  </td>
                  <td className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {r.period_start || r.period_end
                      ? `${r.period_start ? new Date(r.period_start).toLocaleDateString() : '…'} – ${r.period_end ? new Date(r.period_end).toLocaleDateString() : '…'}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_BADGE[r.status]}`}>
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[11px]">
                    {reviewHasOutputs(r)
                      ? <span className="text-emerald-600 dark:text-emerald-300">recorded</span>
                      : <span className="text-slate-400">pending</span>}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button type="button" onClick={() => startEdit(r)} disabled={saving}
                      className="text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md p-1" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => void remove(r.id)} disabled={saving}
                      className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md p-1 ml-1" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
