'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABEL,
  type IncidentType,
} from '@soteria/core/incident'

// /report/[token] — Public anonymous incident-reporting form.
//
// No auth, no app chrome, no tenant switcher. The worker scans the
// QR code on a posted sign and lands here. We confirm the token
// resolves to a known location, then accept a minimal report:
// type + when + description + (optional) immediate action. Severity
// is omitted from the public form by design — the safety team
// triages on receipt.
//
// Mirrors the LOTO client review portal in posture: branded card,
// minimal chrome, anti-retaliation framing in the copy.

interface VerifyResponse {
  label:        string
  tenant_name:  string | null
}

function isoLocalNow() {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

export default function AnonymousReportPage() {
  const { token } = useParams<{ token: string }>()
  const [verify, setVerify] = useState<VerifyResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [incidentType, setIncidentType] = useState<IncidentType | ''>('')
  const [occurredAt,   setOccurredAt]   = useState(isoLocalNow())
  const [description,  setDescription]  = useState('')
  const [immediate,    setImmediate]    = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted,  setSubmitted]  = useState<{ report_number: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!token) return
    void (async () => {
      try {
        const res = await fetch(`/api/anonymous-report/verify/${token}`)
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setLoadError(body.error ?? `HTTP ${res.status}`)
          return
        }
        setVerify(body as VerifyResponse)
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [token])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!incidentType) { setSubmitError('Please pick an incident type.'); return }
    if (!description.trim()) { setSubmitError('Please describe what happened.'); return }
    setSubmitting(true); setSubmitError(null)
    try {
      const res = await fetch('/api/anonymous-report', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          token,
          incident_type:           incidentType,
          occurred_at:             new Date(occurredAt).toISOString(),
          description:             description.trim(),
          immediate_action_taken:  immediate.trim() || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setSubmitted({ report_number: body.report_number })
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-10 px-4">
      <div className="max-w-xl mx-auto">
        <header className="text-center mb-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Soteria FIELD
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
            Anonymous incident report
          </h1>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            No login. We don&apos;t collect your name.
          </p>
        </header>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-6">
          {loadError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-sm text-rose-800 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{loadError}</span>
            </div>
          )}

          {!loadError && !verify && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}

          {verify && submitted && (
            <div className="flex flex-col items-center text-center py-6">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <h2 className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">Thank you</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Your report <span className="font-mono">{submitted.report_number}</span> has been recorded
                {verify.tenant_name && <> at <strong>{verify.tenant_name}</strong></>}.
              </p>
              <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                The safety team will review it. You can close this page.
              </p>
            </div>
          )}

          {verify && !submitted && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-sm">
                <p className="text-slate-700 dark:text-slate-200">
                  Reporting from: <strong>{verify.label}</strong>
                  {verify.tenant_name && <> · {verify.tenant_name}</>}
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Anonymous reports are protected from retaliation under OSHA 1904.35(b)(1)(iv).
                </p>
              </div>

              <Field label="What kind of event?" required>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {INCIDENT_TYPES.map(t => (
                    <label
                      key={t}
                      className={
                        'flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ' +
                        (incidentType === t
                          ? 'border-brand-navy bg-brand-navy/5 dark:bg-brand-navy/20'
                          : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600')
                      }
                    >
                      <input
                        type="radio"
                        name="incident_type"
                        value={t}
                        checked={incidentType === t}
                        onChange={() => setIncidentType(t)}
                        className="mt-1"
                      />
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {INCIDENT_TYPE_LABEL[t]}
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="When did it happen?" required>
                <input
                  type="datetime-local"
                  value={occurredAt}
                  onChange={e => setOccurredAt(e.target.value)}
                  max={isoLocalNow()}
                  required
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>

              <Field label="What happened?" required>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={5}
                  required
                  placeholder="Describe in your own words. Specifics are most useful — what, where, who was nearby, what almost went wrong."
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>

              <Field label="Anything done in the moment?" hint="optional">
                <textarea
                  value={immediate}
                  onChange={e => setImmediate(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </Field>

              {submitError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-sm text-rose-800 dark:text-rose-200">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit anonymously'}
              </button>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
                Your report is sent to the safety team without your name. You may submit additional details by reloading this page.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label, hint, required, children,
}: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}{required && <span className="text-rose-500"> *</span>}
        {hint && <span className="ml-2 text-[11px] font-normal text-slate-400">{hint}</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
