'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react'

// /witness/[token] — Public witness-statement form. No login.
// Reads /api/witness/[token] (GET) for verification + report-number
// preview, then POSTs the statement back. Server enforces token
// single-use + expiry.
//
// Mirrors the LOTO client review portal (token-based public page) in
// posture: no app chrome, plain branded card, audit fields surfaced
// to set expectations ("you'll sign with your typed name").

interface VerifyResponse {
  report_number: string
  occurred_at:   string
  tenant_name:   string | null
  expires_at:    string
}

export default function WitnessTokenPage() {
  const { token } = useParams<{ token: string }>()
  const [verify, setVerify] = useState<VerifyResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [statement,  setStatement]  = useState('')
  const [signedName, setSignedName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!token) return
    void (async () => {
      try {
        const res = await fetch(`/api/witness/${token}`)
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
    if (!statement.trim() || !signedName.trim()) {
      setSubmitError('Please complete both fields.')
      return
    }
    setSubmitting(true); setSubmitError(null)
    try {
      const res = await fetch(`/api/witness/${token}`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ statement_text: statement, signed_name: signedName }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setSubmitted(true)
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
            Witness statement
          </h1>
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
                Your statement for <span className="font-mono">{verify.report_number}</span> has been recorded.
              </p>
            </div>
          )}

          {verify && !submitted && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-sm">
                <p className="text-slate-700 dark:text-slate-200">
                  You&apos;re submitting a statement about incident{' '}
                  <span className="font-mono">{verify.report_number}</span>
                  {verify.tenant_name && <> for <strong>{verify.tenant_name}</strong></>}.
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Occurred {new Date(verify.occurred_at).toLocaleString()}
                </p>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  What did you see? <span className="text-rose-500">*</span>
                </span>
                <textarea
                  value={statement}
                  onChange={e => setStatement(e.target.value)}
                  placeholder="In your own words, describe what you witnessed."
                  rows={8}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Sign with your name <span className="text-rose-500">*</span>
                </span>
                <input
                  type="text"
                  value={signedName}
                  onChange={e => setSignedName(e.target.value)}
                  placeholder="Type your full name"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
                <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Your typed name + the time you submit this form is recorded as your electronic signature.
                </span>
              </label>

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
                {submitting ? 'Submitting…' : 'Submit statement'}
              </button>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
                This link is single-use{verify.expires_at && <> and expires {new Date(verify.expires_at).toLocaleString()}</>}.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
