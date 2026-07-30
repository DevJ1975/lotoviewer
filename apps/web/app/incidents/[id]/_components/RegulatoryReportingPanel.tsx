'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertOctagon, CheckCircle2, Clock, Loader2, Plus, Siren, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  SEVERE_INJURY_TRIGGERS,
  SEVERE_INJURY_TRIGGER_LABEL,
  REPORT_METHODS,
  REPORT_METHOD_LABEL,
  REPORTING_BASIS_LABEL,
  REPORTING_JURISDICTION_LABEL,
  evaluateSevereInjuryReport,
  reportingWindowHours,
  type SevereInjuryTrigger,
  type ReportMethod,
  type ReportingJurisdiction,
  type SevereInjuryReportStatus,
} from '@soteria/core/oshaSevereInjuryReport'

// Severe-injury reporting tracker. Surfaces a live countdown to the
// reporting deadline per flagged trigger, and records the filing (method +
// case number) so there's proof the obligation was met.
//
// The window depends on jurisdiction — federal 1904.39 splits 8h (fatality)
// / 24h (the rest), while Cal/OSHA requires 8h for all four. Each saved row
// carries the jurisdiction it was created under, and the countdown uses THAT
// rather than re-deriving it, so re-pointing a facility later never silently
// moves a deadline someone was already held to.

interface ReportRow {
  id:               string
  trigger_type:     SevereInjuryTrigger
  basis_at:         string
  reported_at:      string | null
  report_method:    ReportMethod | null
  osha_case_number: string | null
  notes:            string | null
  reporting_jurisdiction: ReportingJurisdiction | null
}

interface Props {
  incidentId:   string
  /** Default basis time for a new trigger = when the employer learned. */
  defaultBasisAt: string
}

const STATUS_STYLE: Record<SevereInjuryReportStatus, { pill: string; card: string }> = {
  pending:   { pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',  card: 'border-amber-200 dark:border-amber-900/60' },
  due_soon:  { pill: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200', card: 'border-orange-300 dark:border-orange-800' },
  overdue:   { pill: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',      card: 'border-rose-300 dark:border-rose-800' },
  reported:  { pill: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200', card: 'border-emerald-200 dark:border-emerald-900/60' },
}

function toLocalInput(iso: string): string {
  // datetime-local wants 'YYYY-MM-DDTHH:mm' in local time.
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16)
}

function humanizeHours(hours: number): string {
  const abs = Math.abs(hours)
  const h = Math.floor(abs)
  const m = Math.round((abs - h) * 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export default function RegulatoryReportingPanel({ incidentId, defaultBasisAt }: Props) {
  const { tenant } = useTenant()
  const [rows, setRows]   = useState<ReportRow[] | null>(null)
  // Jurisdiction a NEW trigger would be filed under, resolved server-side
  // from the incident's facility. Saved rows carry their own.
  const [jurisdiction, setJurisdiction] = useState<ReportingJurisdiction>('federal')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy]   = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // New-trigger draft.
  const [draftTrigger, setDraftTrigger] = useState<SevereInjuryTrigger>('in_patient_hospitalization')
  const [draftBasis, setDraftBasis]     = useState(() => toLocalInput(defaultBasisAt))

  // Tick once a minute so the countdown stays live without a refresh.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const buildHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-active-tenant': tenant?.id ?? '',
    }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    try {
      const res = await fetch(`/api/incidents/${incidentId}/severe-injury-report`, { headers: await buildHeaders() })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setRows(body.reports as ReportRow[])
      if (body.jurisdiction) setJurisdiction(body.jurisdiction as ReportingJurisdiction)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reporting status.')
    }
  }, [tenant, incidentId, buildHeaders])

  useEffect(() => { void load() }, [load])

  async function upsert(payload: Record<string, unknown>) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/severe-injury-report`, {
        method: 'POST', headers: await buildHeaders(), body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function addTrigger() {
    const basisMs = Date.parse(draftBasis)
    if (Number.isNaN(basisMs)) { setError('Enter a valid date/time the employer learned of the event.'); return }
    await upsert({ trigger_type: draftTrigger, basis_at: new Date(basisMs).toISOString() })
    setShowAdd(false)
  }

  async function recordFiling(row: ReportRow) {
    const method = window.prompt(
      `Record the OSHA report for "${SEVERE_INJURY_TRIGGER_LABEL[row.trigger_type]}".\n\nHow was it filed? Type one of:\n${REPORT_METHODS.map(m => `  ${m} — ${REPORT_METHOD_LABEL[m]}`).join('\n')}`,
      'osha_phone',
    )
    if (method === null) return
    if (!(REPORT_METHODS as readonly string[]).includes(method)) { setError(`Unknown method: ${method}`); return }
    const caseNumber = window.prompt('OSHA case / confirmation number (optional):', row.osha_case_number ?? '') ?? ''
    await upsert({
      trigger_type: row.trigger_type,
      basis_at:     row.basis_at,
      reported_at:  new Date().toISOString(),
      report_method: method,
      osha_case_number: caseNumber.trim() || null,
    })
  }

  async function removeTrigger(trigger: SevereInjuryTrigger) {
    if (!window.confirm('Remove this reportable trigger? Use this only if it was added in error.')) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/severe-injury-report?trigger=${trigger}`, {
        method: 'DELETE', headers: await buildHeaders(),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove.')
    } finally {
      setBusy(false)
    }
  }

  if (rows === null) {
    return (
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading reporting status…
        </div>
      </section>
    )
  }

  const tracked = new Set(rows.map(r => r.trigger_type))
  const available = SEVERE_INJURY_TRIGGERS.filter(t => !tracked.has(t))

  // Rows written before migration 252 were backfilled to 'federal'; a null
  // here means the same thing, so don't substitute the tenant's current
  // jurisdiction — that would retroactively shorten an old deadline.
  const rowJurisdiction = (r: ReportRow): ReportingJurisdiction => r.reporting_jurisdiction ?? 'federal'

  // Lift the whole card's border when any trigger is unreported and late.
  const anyUrgent = rows.some(r => {
    if (r.reported_at) return false
    const s = evaluateSevereInjuryReport({
      trigger: r.trigger_type, jurisdiction: rowJurisdiction(r),
      basisMs: Date.parse(r.basis_at), reportedAtMs: null, nowMs,
    })
    return s.status === 'overdue' || s.status === 'due_soon'
  })

  return (
    <section className={`rounded-xl border p-4 space-y-3 ${anyUrgent ? 'border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20' : 'border-slate-200 dark:border-slate-800'}`}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <Siren className={`h-4 w-4 ${anyUrgent ? 'text-rose-600' : 'text-slate-400'}`} />
          {jurisdiction === 'CA' ? 'Cal/OSHA §342 reporting' : 'OSHA 1904.39 reporting'} ({rows.length})
        </h2>
        {available.length > 0 && (
          <button type="button" onClick={() => setShowAdd(s => !s)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-navy hover:underline dark:text-brand-yellow">
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showAdd ? 'Cancel' : 'Flag reportable event'}
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      {showAdd && available.length > 0 && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2 bg-slate-50 dark:bg-slate-900/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Reportable event</span>
              <select value={draftTrigger} onChange={e => setDraftTrigger(e.target.value as SevereInjuryTrigger)}
                className="mt-0.5 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs">
                {available.map(t => (
                  <option key={t} value={t}>{SEVERE_INJURY_TRIGGER_LABEL[t]} · {reportingWindowHours(t, jurisdiction)}h</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">{REPORTING_BASIS_LABEL[jurisdiction]}</span>
              <input type="datetime-local" value={draftBasis} onChange={e => setDraftBasis(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs" />
            </label>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            Filing under {REPORTING_JURISDICTION_LABEL[jurisdiction]}
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={() => void addTrigger()} disabled={busy}
              className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90 dark:bg-brand-yellow dark:text-slate-950">
              {busy ? 'Saving…' : 'Start the clock'}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No reportable event flagged. A work-related fatality, in-patient hospitalization, amputation, or loss of an eye must be reported —
          {jurisdiction === 'CA'
            ? ' within 8 hours for all four, under Cal/OSHA.'
            : ' within 8 hours for a fatality and 24 hours for the other three, under federal OSHA.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map(row => {
            const state = evaluateSevereInjuryReport({
              trigger: row.trigger_type, jurisdiction: rowJurisdiction(row),
              basisMs: Date.parse(row.basis_at),
              reportedAtMs: row.reported_at ? Date.parse(row.reported_at) : null, nowMs,
            })
            const style = STATUS_STYLE[state.status]
            return (
              <li key={row.id} className={`rounded-lg border p-3 space-y-1.5 ${style.card}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{SEVERE_INJURY_TRIGGER_LABEL[row.trigger_type]}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.pill}`}>
                    {state.status === 'reported' ? 'Reported' : state.status === 'overdue' ? 'Overdue' : state.status === 'due_soon' ? 'Due soon' : 'Open'}
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                    deadline {new Date(state.deadlineMs).toLocaleString()}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-xs">
                  {state.status === 'reported' ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-slate-600 dark:text-slate-300">
                        Reported {row.reported_at ? new Date(row.reported_at).toLocaleString() : ''}
                        {row.report_method ? ` · ${REPORT_METHOD_LABEL[row.report_method]}` : ''}
                        {row.osha_case_number ? ` · case ${row.osha_case_number}` : ''}
                      </span>
                    </>
                  ) : state.status === 'overdue' ? (
                    <>
                      <AlertOctagon className="h-3.5 w-3.5 text-rose-600" />
                      <span className="font-semibold text-rose-700 dark:text-rose-300">
                        Overdue by {humanizeHours(state.hoursRemaining ?? 0)} — report to OSHA now
                      </span>
                    </>
                  ) : (
                    <>
                      <Clock className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-slate-600 dark:text-slate-300">
                        {humanizeHours(state.hoursRemaining ?? 0)} left to report
                      </span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] pt-0.5">
                  {state.status !== 'reported' && (
                    <button type="button" onClick={() => void recordFiling(row)} disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-50">
                      <CheckCircle2 className="h-3 w-3" /> Record OSHA filing
                    </button>
                  )}
                  {state.status === 'reported' && (
                    <button type="button" onClick={() => void recordFiling(row)} disabled={busy}
                      className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-50">
                      Edit filing
                    </button>
                  )}
                  <button type="button" onClick={() => void removeTrigger(row.trigger_type)} disabled={busy}
                    className="ml-auto text-slate-400 hover:text-rose-600 disabled:opacity-50">Remove</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
