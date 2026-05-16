'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock3, Loader2, Plus, ShieldCheck, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  CAPA_HIERARCHY_LEVELS,
  CAPA_HIERARCHY_LABEL,
  canVerify,
  classifyCapa,
  type CapaHierarchyLevel,
  type CapaRow,
  type ClassifiedCapaStatus,
} from '@soteria/core/incidentCapa'

// ISO 45001 10.2 verification-of-effectiveness loop. One section per
// CAPA on an incident: add, edit, mark complete (any tenant member),
// mark verified-effective (must be a DIFFERENT user from the
// completer — DB trigger + UI gate enforced together).

const STATUS_PILL: Record<ClassifiedCapaStatus, string> = {
  open:                  'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  overdue:               'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  awaiting_verification: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  verified:              'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  cancelled:             'bg-slate-100 text-slate-500 dark:bg-slate-900/40 dark:text-slate-400',
}

const STATUS_LABEL: Record<ClassifiedCapaStatus, string> = {
  open:                  'Open',
  overdue:               'Overdue',
  awaiting_verification: 'Awaiting verification',
  verified:              'Verified effective',
  cancelled:             'Cancelled',
}

interface Props {
  incidentId: string
}

export default function CapaPanel({ incidentId }: Props) {
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const userId = profile?.id ?? null
  const canEdit = !!profile?.is_admin || !!profile?.is_superadmin

  const [rows,  setRows]  = useState<CapaRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy,  setBusy]  = useState(false)
  const [showForm, setShowForm] = useState(false)

  // New CAPA form state.
  const [draftDescription,    setDraftDescription]    = useState('')
  const [draftHierarchy,      setDraftHierarchy]      = useState<CapaHierarchyLevel>('engineering')
  const [draftAssignedTo,     setDraftAssignedTo]     = useState('')
  const [draftDueAt,          setDraftDueAt]          = useState('')

  const load = useCallback(async () => {
    if (!tenant?.id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/incidents/${incidentId}/capas`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setRows(body.capas as CapaRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load CAPAs.')
    }
  }, [tenant?.id, incidentId])

  useEffect(() => { void load() }, [load])

  async function authedHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (tenant?.id) h['x-active-tenant'] = tenant.id
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    return h
  }

  async function submitNew() {
    if (!draftDescription.trim()) {
      setError('Description is required.')
      return
    }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/capas`, {
        method: 'POST',
        headers: await authedHeaders(),
        body: JSON.stringify({
          description:         draftDescription.trim(),
          hierarchy_level:     draftHierarchy,
          assigned_to_user_id: draftAssignedTo || undefined,
          due_at:              draftDueAt ? new Date(draftDueAt).toISOString() : undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setDraftDescription(''); setDraftAssignedTo(''); setDraftDueAt('')
      setShowForm(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function applyAction(capaId: string, payload: Record<string, unknown>) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/capas/${capaId}`, {
        method: 'PATCH',
        headers: await authedHeaders(),
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update.')
    } finally {
      setBusy(false)
    }
  }

  if (rows === null) {
    return (
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading CAPAs…
        </div>
      </section>
    )
  }

  const now = new Date()
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          ISO 45001 CAPAs ({rows.length})
        </h2>
        <button
          type="button"
          onClick={() => setShowForm(s => !s)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-navy hover:underline"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? 'Cancel' : 'New CAPA'}
        </button>
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {error}
        </div>
      )}

      {showForm && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2 bg-slate-50 dark:bg-slate-900/40">
          <textarea
            value={draftDescription}
            onChange={e => setDraftDescription(e.target.value)}
            rows={2}
            placeholder="Describe the corrective action and the nonconformity it addresses"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Hierarchy</span>
              <select
                value={draftHierarchy}
                onChange={e => setDraftHierarchy(e.target.value as CapaHierarchyLevel)}
                className="mt-0.5 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
              >
                {CAPA_HIERARCHY_LEVELS.map(h => (
                  <option key={h} value={h}>{CAPA_HIERARCHY_LABEL[h]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Assignee user-id (optional)</span>
              <input
                type="text"
                value={draftAssignedTo}
                onChange={e => setDraftAssignedTo(e.target.value)}
                placeholder="uuid"
                className="mt-0.5 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs font-mono"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Due</span>
              <input
                type="datetime-local"
                value={draftDueAt}
                onChange={e => setDraftDueAt(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void submitNew()}
              disabled={!draftDescription.trim() || busy}
              className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">No CAPAs yet — add one to start the loop.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(row => {
            const status = classifyCapa(row, now)
            const verifyAllowed = canVerify(row, userId)
            return (
              <li key={row.id} className="py-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${STATUS_PILL[status]}`}>
                    {STATUS_LABEL[status]}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {CAPA_HIERARCHY_LABEL[row.hierarchy_level as CapaHierarchyLevel]}
                  </span>
                  {row.due_at && (
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto tabular-nums">
                      due {new Date(row.due_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{row.description}</p>
                {row.verification_notes && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                    Verification notes: {row.verification_notes}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {row.status === 'open' && canEdit && (
                    <button
                      type="button"
                      onClick={() => void applyAction(row.id, { action: 'mark_in_progress' })}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Clock3 className="h-3 w-3" />
                      Start
                    </button>
                  )}
                  {(row.status === 'open' || row.status === 'in_progress') && canEdit && (
                    <button
                      type="button"
                      onClick={() => void applyAction(row.id, { action: 'mark_completed' })}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Mark complete
                    </button>
                  )}
                  {row.status === 'completed' && (
                    <button
                      type="button"
                      onClick={() => {
                        const notes = window.prompt('Verification notes (optional)') ?? ''
                        void applyAction(row.id, { action: 'mark_verified', notes })
                      }}
                      disabled={busy || !verifyAllowed}
                      title={verifyAllowed
                        ? 'Confirm the underlying nonconformity has been eliminated'
                        : 'You completed this CAPA — a different user must verify effectiveness'}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 px-2 py-1 text-emerald-900 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      Verify effective
                    </button>
                  )}
                  {row.status !== 'verified' && row.status !== 'cancelled' && canEdit && (
                    <button
                      type="button"
                      onClick={() => void applyAction(row.id, { action: 'cancel' })}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md text-slate-500 hover:text-rose-700 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
                  {row.completed_at && (
                    <span className="ml-auto text-[10px] text-slate-400 tabular-nums">
                      completed {new Date(row.completed_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
