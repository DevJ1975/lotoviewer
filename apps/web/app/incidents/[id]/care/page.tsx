'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, AlertTriangle, Loader2, Plus, ShieldAlert } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  CARE_CASE_STATUSES,
  CARE_CASE_STATUS_LABEL,
  DRUG_TEST_STATUSES,
  DRUG_TEST_LABEL,
  CARE_VISIT_TYPES,
  type IncidentCareCaseRow,
  type IncidentCareVisitRow,
  type CareCaseStatus,
  type CareVisitType,
  type DrugTestStatus,
} from '@soteria/core/incidentCare'

// /incidents/[id]/care — Care management for the injured person.
//
// PII-adjacent surface: the API route gates reads + writes to admin /
// investigator / case manager, returning 403 to plain members. So the
// page renders an explanatory empty-state if the member can't see
// the case, rather than a frozen loading spinner.
//
// Phase 3 ships the case-detail editor + a visit log. The full RTW
// PDF generator + state-specific drug-test compliance arrive in
// Phase 6.

export default function CarePage() {
  const { id } = useParams<{ id: string }>()
  const { tenant } = useTenant()

  const [caseRow, setCaseRow] = useState<IncidentCareCaseRow | null>(null)
  const [visits,  setVisits]  = useState<IncidentCareVisitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [busy,    setBusy]    = useState(false)

  // Patch state — diff against the loaded row to send only changed fields.
  const [draft, setDraft] = useState<Partial<IncidentCareCaseRow>>({})

  // Visit form state.
  const [vType,  setVType]  = useState<CareVisitType>('clinic')
  const [vWhen,  setVWhen]  = useState<string>('')
  const [vNotes, setVNotes] = useState<string>('')

  // Restriction line input.
  const [newRestriction, setNewRestriction] = useState('')

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res = await fetch(`/api/incidents/${id}/care`, { headers })
      const body = await res.json()
      if (res.status === 403) { setForbidden(true); return }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setCaseRow(body.case as IncidentCareCaseRow | null)
      setVisits((body.visits as IncidentCareVisitRow[]) ?? [])
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

  async function createCase() {
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/care`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({}),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setCaseRow(body.case as IncidentCareCaseRow)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft() {
    if (!caseRow || Object.keys(draft).length === 0) return
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/care`, {
        method:  'PATCH',
        headers,
        body:    JSON.stringify(draft),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setCaseRow(body.case as IncidentCareCaseRow)
      setDraft({})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function addVisit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/care/visits`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          visit_type: vType,
          visit_at:   vWhen ? new Date(vWhen).toISOString() : undefined,
          notes:      vNotes.trim() || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setVisits(prev => [body.visit as IncidentCareVisitRow, ...prev])
      setVNotes(''); setVWhen('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function field<K extends keyof IncidentCareCaseRow>(k: K): IncidentCareCaseRow[K] | undefined {
    if (k in draft) return draft[k] as IncidentCareCaseRow[K]
    return caseRow?.[k]
  }
  function setField<K extends keyof IncidentCareCaseRow>(k: K, v: IncidentCareCaseRow[K]) {
    setDraft(prev => ({ ...prev, [k]: v }))
  }

  function addRestriction() {
    if (!newRestriction.trim()) return
    const current = (field('restrictions') as string[] | undefined) ?? []
    setField('restrictions', [...current, newRestriction.trim()])
    setNewRestriction('')
  }
  function removeRestriction(idx: number) {
    const current = (field('restrictions') as string[] | undefined) ?? []
    setField('restrictions', current.filter((_, i) => i !== idx))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-3">
        <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 text-center">
          <ShieldAlert className="h-8 w-8 text-amber-500 mx-auto" />
          <h1 className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-100">Restricted</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Care management contains medical detail. Access is limited to tenant admins, the assigned investigator, and the designated case manager.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to incident
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Care management</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Treating physician, restrictions, return-to-work, and post-incident drug-test tracking.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!caseRow && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            No care case has been opened for this incident.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createCase()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Open case
          </button>
        </div>
      )}

      {caseRow && (
        <>
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Case status" value={CARE_CASE_STATUS_LABEL[(field('case_status') as CareCaseStatus | undefined) ?? caseRow.case_status]} />
            <Stat label="Days away"    value={String((field('days_away_from_work') as number | undefined) ?? caseRow.days_away_from_work)} />
            <Stat label="Days restricted" value={String((field('days_restricted') as number | undefined) ?? caseRow.days_restricted)} />
            <Stat label="Days lost"    value={String((field('days_lost') as number | undefined) ?? caseRow.days_lost)} />
          </section>

          <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status &amp; counters</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Case status">
                <select
                  value={(field('case_status') as CareCaseStatus | undefined) ?? caseRow.case_status}
                  onChange={e => setField('case_status', e.target.value as CareCaseStatus)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                >
                  {CARE_CASE_STATUSES.map(s => (
                    <option key={s} value={s}>{CARE_CASE_STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Return to work">
                <input
                  type="datetime-local"
                  value={toLocalInput((field('return_to_work_at') as string | null | undefined) ?? caseRow.return_to_work_at)}
                  onChange={e => setField('return_to_work_at', e.target.value ? new Date(e.target.value).toISOString() : null)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Days away from work">
                <input type="number" min="0" step="1"
                  value={(field('days_away_from_work') as number | undefined) ?? caseRow.days_away_from_work}
                  onChange={e => setField('days_away_from_work', Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Days restricted">
                <input type="number" min="0" step="1"
                  value={(field('days_restricted') as number | undefined) ?? caseRow.days_restricted}
                  onChange={e => setField('days_restricted', Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Days lost (LTIR)">
                <input type="number" min="0" step="1"
                  value={(field('days_lost') as number | undefined) ?? caseRow.days_lost}
                  onChange={e => setField('days_lost', Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Next follow-up">
                <input
                  type="datetime-local"
                  value={toLocalInput((field('next_followup_at') as string | null | undefined) ?? caseRow.next_followup_at)}
                  onChange={e => setField('next_followup_at', e.target.value ? new Date(e.target.value).toISOString() : null)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Medical detail</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Treating physician">
                <input type="text"
                  value={(field('treating_physician') as string | null | undefined) ?? caseRow.treating_physician ?? ''}
                  onChange={e => setField('treating_physician', e.target.value || null)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Clinic / facility">
                <input type="text"
                  value={(field('clinic_name') as string | null | undefined) ?? caseRow.clinic_name ?? ''}
                  onChange={e => setField('clinic_name', e.target.value || null)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>
            </div>
            <Field label="Diagnosis">
              <textarea
                value={(field('diagnosis') as string | null | undefined) ?? caseRow.diagnosis ?? ''}
                onChange={e => setField('diagnosis', e.target.value || null)}
                rows={2}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </Field>
          </section>

          <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Restrictions</h2>
            <ul className="space-y-1.5">
              {(((field('restrictions') as string[] | undefined) ?? caseRow.restrictions) || []).map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
                  <span className="flex-1 text-slate-700 dark:text-slate-200">{r}</span>
                  <button
                    type="button"
                    onClick={() => removeRestriction(i)}
                    className="text-[10px] text-rose-500 hover:underline"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                type="text"
                value={newRestriction}
                onChange={e => setNewRestriction(e.target.value)}
                placeholder="e.g. No lifting > 20 lb"
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={addRestriction}
                disabled={!newRestriction.trim()}
                className="rounded-lg bg-brand-navy text-white px-3 py-2 text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Post-incident drug test</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Result">
                <select
                  value={(field('drug_test_status') as DrugTestStatus | null | undefined) ?? caseRow.drug_test_status ?? ''}
                  onChange={e => setField('drug_test_status', (e.target.value || null) as DrugTestStatus | null)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {DRUG_TEST_STATUSES.map(s => (
                    <option key={s} value={s}>{DRUG_TEST_LABEL[s]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Tested at">
                <input
                  type="datetime-local"
                  value={toLocalInput((field('drug_test_at') as string | null | undefined) ?? caseRow.drug_test_at)}
                  onChange={e => setField('drug_test_at', e.target.value ? new Date(e.target.value).toISOString() : null)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Notes">
                <input
                  type="text"
                  value={(field('drug_test_notes') as string | null | undefined) ?? caseRow.drug_test_notes ?? ''}
                  onChange={e => setField('drug_test_notes', e.target.value || null)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </section>

          <div className="flex items-center justify-end">
            <button
              type="button"
              disabled={busy || Object.keys(draft).length === 0}
              onClick={() => void saveDraft()}
              className="rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>

          <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Visit log</h2>
            <ul className="space-y-1.5">
              {visits.length === 0 ? (
                <li className="text-sm text-slate-500 dark:text-slate-400">No visits logged yet.</li>
              ) : visits.map(v => (
                <li key={v.id} className="text-sm">
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mr-2">
                    {new Date(v.visit_at).toLocaleString()}
                  </span>
                  <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-300 mr-2">
                    {v.visit_type}
                  </span>
                  {v.notes && <span className="text-slate-700 dark:text-slate-200">{v.notes}</span>}
                </li>
              ))}
            </ul>

            <form onSubmit={addVisit} className="grid grid-cols-1 sm:grid-cols-[120px_180px_1fr_auto] gap-2 items-end">
              <Field label="Type">
                <select
                  value={vType}
                  onChange={e => setVType(e.target.value as CareVisitType)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1.5 text-xs"
                >
                  {CARE_VISIT_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="When">
                <input
                  type="datetime-local"
                  value={vWhen}
                  onChange={e => setVWhen(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1.5 text-xs"
                />
              </Field>
              <Field label="Notes">
                <input
                  type="text"
                  value={vNotes}
                  onChange={e => setVNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1.5 text-xs"
                />
              </Field>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
              >
                Log visit
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">{value}</p>
    </div>
  )
}

// Convert an ISO timestamp to the "YYYY-MM-DDTHH:mm" shape the
// <input type="datetime-local"> control expects (in local time).
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}
