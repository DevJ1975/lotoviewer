'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, AlertTriangle, Loader2, CheckCircle2, Play } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  RCA_METHODS,
  RCA_METHOD_LABEL,
  RCA_METHOD_HELP,
  type IncidentInvestigationRow,
  type RcaMethod,
} from '@soteria/core/rcaSchemas'

// /incidents/[id]/investigate — investigation dossier.
//
// Phase 2 surface: scope, sequence-of-events, narrative findings,
// signoff. The RCA tab (separate page) handles the method-specific
// detail trees.
//
// Lifecycle:
//   1. Admin clicks "Begin investigation" → POST creates the
//      investigation row, flips incident.status → investigating.
//   2. Team members + admins edit the narrative fields.
//   3. Admin types signoff name → PATCH stamps signoff_at +
//      pushes incident → pending_review.

const NARRATIVE_FIELDS: Array<{
  key:    keyof Pick<IncidentInvestigationRow,
            'scope_summary' | 'sequence_of_events' |
            'immediate_causes' | 'underlying_causes' |
            'root_causes' | 'lessons_learned'>
  label:  string
  hint?:  string
  rows:   number
}> = [
  { key: 'scope_summary',      label: 'Scope',
    hint: 'In / out of scope for this investigation',        rows: 2 },
  { key: 'sequence_of_events', label: 'Sequence of events',
    hint: 'Timeline of what happened, in order',             rows: 5 },
  { key: 'immediate_causes',   label: 'Immediate causes',
    hint: 'The proximate triggers',                          rows: 3 },
  { key: 'underlying_causes',  label: 'Underlying causes',
    hint: 'Conditions that allowed the immediate causes',    rows: 3 },
  { key: 'root_causes',        label: 'Root causes',
    hint: 'Final answer of the RCA — copy from the RCA tab', rows: 3 },
  { key: 'lessons_learned',    label: 'Lessons learned',
    hint: 'What to publish to the rest of the org',          rows: 3 },
]

export default function InvestigatePage() {
  const { id } = useParams<{ id: string }>()
  const { tenant } = useTenant()

  const [investigation, setInvestigation] = useState<IncidentInvestigationRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [draft,   setDraft]   = useState<Partial<IncidentInvestigationRow>>({})
  const [signName, setSignName] = useState('')

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/incidents/${id}/investigation`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setInvestigation(body.investigation as IncidentInvestigationRow | null)
      setDraft({})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant, id])

  useEffect(() => { void load() }, [load])

  async function authedHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = {
      'content-type':    'application/json',
      'x-active-tenant': tenant!.id,
    }
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    return h
  }

  async function begin(method: RcaMethod) {
    if (!tenant?.id || !id) return
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/investigation`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ rca_method: method }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setInvestigation(body.investigation as IncidentInvestigationRow)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft() {
    if (!tenant?.id || !id || Object.keys(draft).length === 0) return
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/investigation`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(draft),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setInvestigation(body.investigation as IncidentInvestigationRow)
      setDraft({})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function complete() {
    if (!tenant?.id || !id) return
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/investigation`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          ...draft,
          completed_at:        new Date().toISOString(),
          signoff_typed_name:  signName.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setInvestigation(body.investigation as IncidentInvestigationRow)
      setDraft({})
      setSignName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function fieldValue(key: typeof NARRATIVE_FIELDS[number]['key']): string {
    if (key in draft) return (draft[key] as string | null | undefined) ?? ''
    return (investigation?.[key] as string | null | undefined) ?? ''
  }

  function setField(key: typeof NARRATIVE_FIELDS[number]['key'], value: string) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to incident
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Investigation</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Scope, timeline, and findings for this incident. The RCA tree lives on the{' '}
          <Link href={`/incidents/${id}/rca`} className="text-brand-navy hover:underline">RCA tab</Link>.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!investigation && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-5">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Begin investigation</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Pick the RCA method you&apos;ll use. You can change it later from the RCA tab.
          </p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {RCA_METHODS.filter(m => m !== 'none_yet').map(m => (
              <button
                key={m}
                type="button"
                disabled={busy}
                onClick={() => begin(m)}
                className="text-left rounded-lg border border-slate-300 dark:border-slate-700 hover:border-brand-navy px-3 py-2 transition-colors disabled:opacity-50"
              >
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{RCA_METHOD_LABEL[m]}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{RCA_METHOD_HELP[m]}</p>
              </button>
            ))}
          </div>
          <div className="mt-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => begin('none_yet')}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              Start without picking a method
            </button>
          </div>
        </section>
      )}

      {investigation && (
        <>
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Method"     value={RCA_METHOD_LABEL[investigation.rca_method]} />
            <Stat label="Began"      value={investigation.began_at ? new Date(investigation.began_at).toLocaleString() : '—'} />
            <Stat label="Target"     value={investigation.target_close_at ? new Date(investigation.target_close_at).toLocaleString() : '—'} />
            <Stat label="Completed"  value={investigation.completed_at ? new Date(investigation.completed_at).toLocaleString() : '—'} />
          </section>

          <section className="space-y-4">
            {NARRATIVE_FIELDS.map(f => (
              <label key={f.key} className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {f.label}
                  {f.hint && <span className="ml-2 text-[11px] font-normal text-slate-400">{f.hint}</span>}
                </span>
                <textarea
                  value={fieldValue(f.key)}
                  onChange={e => setField(f.key, e.target.value)}
                  rows={f.rows}
                  disabled={!!investigation.completed_at || busy}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm disabled:opacity-50"
                />
              </label>
            ))}
          </section>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={busy || Object.keys(draft).length === 0 || !!investigation.completed_at}
              onClick={() => void saveDraft()}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save draft'}
            </button>
          </div>

          {!investigation.completed_at && (
            <section className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 p-4">
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Sign off</h2>
              <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
                Type your name to mark the investigation complete. Requires the RCA tab to have at least one node + an identified root.
              </p>
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={signName}
                  onChange={e => setSignName(e.target.value)}
                  placeholder="Your full name"
                  className="flex-1 rounded-lg border border-amber-300 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !signName.trim()}
                  onClick={() => void complete()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 text-white px-4 py-2 text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Complete investigation
                </button>
              </div>
            </section>
          )}

          {investigation.completed_at && (
            <section className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
              <p className="text-sm text-emerald-800 dark:text-emerald-200">
                Completed {new Date(investigation.completed_at).toLocaleString()}
                {investigation.signoff_typed_name && <> · signed by {investigation.signoff_typed_name}</>}.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-slate-800 dark:text-slate-200">{value}</p>
    </div>
  )
}
