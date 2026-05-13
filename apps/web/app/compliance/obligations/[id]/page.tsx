'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Loader2, Trash2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { complianceFetch } from '../../_lib/api'
import { StatusPill } from '../../_components/StatusPill'
import {
  CATEGORY_LABEL,
  FREQUENCY_LABEL,
  type ObligationCategory,
  type ObligationFrequency,
  type ObligationStatus,
} from '@soteria/core/compliance'

interface ObligationRow {
  id:                 string
  legal_register_id:  string | null
  title:              string
  description:        string | null
  category:           ObligationCategory
  frequency:          ObligationFrequency
  frequency_days:     number | null
  next_due_date:      string
  lead_days:          number
  last_completed_at:  string | null
  snoozed_until:      string | null
  not_applicable:     boolean
  responsible_party:  string | null
  evidence_required:  boolean
  notes:              string | null
  status:             ObligationStatus
}

interface CompletionRow {
  id:           string
  completed_at: string
  completed_by: string | null
  notes:        string | null
  evidence_url: string | null
}

export default function ObligationDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { tenant } = useTenant()
  const id = params?.id ?? ''

  const [row, setRow] = useState<ObligationRow | null>(null)
  const [completions, setCompletions] = useState<CompletionRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [evidence, setEvidence] = useState('')
  const [completionNotes, setCompletionNotes] = useState('')

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    setLoading(true); setError(null)
    try {
      const body = await complianceFetch<{ obligation: ObligationRow; completions: CompletionRow[] }>(
        tenant.id, `/api/compliance/obligations/${id}`,
      )
      setRow(body.obligation)
      setCompletions(body.completions)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant?.id, id])

  useEffect(() => { void load() }, [load])

  async function complete() {
    if (!tenant?.id || !row) return
    if (row.evidence_required && !evidence.trim()) {
      setError('This obligation requires an evidence URL.')
      return
    }
    setCompleting(true); setError(null)
    try {
      await complianceFetch(tenant.id, `/api/compliance/obligations/${id}/complete`, {
        method: 'POST',
        body:   JSON.stringify({
          evidence_url: evidence.trim() || null,
          notes:        completionNotes.trim() || null,
        }),
      })
      setEvidence(''); setCompletionNotes('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCompleting(false)
    }
  }

  async function patch(update: Partial<ObligationRow>) {
    if (!tenant?.id) return
    setError(null)
    try {
      await complianceFetch(tenant.id, `/api/compliance/obligations/${id}`, {
        method: 'PATCH', body: JSON.stringify(update),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function deleteRow() {
    if (!tenant?.id) return
    if (!confirm('Delete this obligation? The completion log will be removed too.')) return
    try {
      await complianceFetch(tenant.id, `/api/compliance/obligations/${id}`, { method: 'DELETE' })
      router.push('/compliance')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading && !row) {
    return <main className="max-w-3xl mx-auto px-4 py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></main>
  }
  if (!row) {
    return <main className="max-w-3xl mx-auto px-4 py-16 text-sm text-slate-500">{error ?? 'Not found.'}</main>
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/compliance" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400">
        <ArrowLeft className="h-3 w-3" /> Compliance calendar
      </Link>

      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{row.title}</h1>
            <StatusPill status={row.status} />
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {CATEGORY_LABEL[row.category]} · {FREQUENCY_LABEL[row.frequency]}
            {row.responsible_party && ` · ${row.responsible_party}`}
          </p>
          {row.legal_register_id && (
            <Link href={`/compliance/registry/${row.legal_register_id}`} className="text-xs font-semibold text-purple-700 dark:text-purple-300 underline mt-1 inline-block">
              View linked citation →
            </Link>
          )}
        </div>
        <button
          onClick={deleteRow}
          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
        >
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Next due"          value={row.next_due_date} />
        <Stat label="Last completed"    value={row.last_completed_at ? row.last_completed_at.slice(0, 10) : '—'} />
        <Stat label="Lead days"         value={String(row.lead_days)} />
      </section>

      {row.description && (
        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 mb-2">Description</h2>
          <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{row.description}</p>
        </section>
      )}

      {!row.not_applicable && (
        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 space-y-3">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">Mark complete</h2>
          {row.evidence_required && (
            <input
              type="url"
              value={evidence}
              onChange={e => setEvidence(e.target.value)}
              placeholder="Evidence URL (required)"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          )}
          <textarea
            value={completionNotes}
            onChange={e => setCompletionNotes(e.target.value)}
            placeholder="Optional notes…"
            rows={2}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
          <button
            onClick={complete}
            disabled={completing}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Mark complete
          </button>
        </section>
      )}

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 space-y-3">
        <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">Status controls</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => patch({ not_applicable: !row.not_applicable })}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {row.not_applicable ? 'Mark applicable' : 'Mark not applicable'}
          </button>
          {!row.not_applicable && (
            <>
              <label className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
                Snooze until
                <input
                  type="date"
                  value={row.snoozed_until ?? ''}
                  onChange={e => patch({ snoozed_until: e.target.value || null })}
                  className="px-2 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </label>
              <label className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
                Reschedule
                <input
                  type="date"
                  value={row.next_due_date}
                  onChange={e => e.target.value && patch({ next_due_date: e.target.value })}
                  className="px-2 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </label>
            </>
          )}
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5">
        <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 mb-2">
          Completion history ({completions.length})
        </h2>
        {completions.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No completions yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {completions.map(c => (
              <li key={c.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{c.completed_at.slice(0, 16).replace('T', ' ')} UTC</div>
                  {c.notes && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{c.notes}</div>}
                </div>
                {c.evidence_url && (
                  <a href={c.evidence_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-navy underline shrink-0">
                    Evidence
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 px-3 py-2 text-sm">{error}</div>
      )}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 px-4 py-3">
      <div className="text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-base font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{value}</div>
    </div>
  )
}
