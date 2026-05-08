'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'

// /report/status — public report-status lookup.
//
// Reporter typed (or scribbled) a report number + 6-character PIN
// during submission; this page recomputes the PIN hash server-side
// and returns just the public-safe status fields. Never returns
// description, names, or attachments — see migration 082 for the
// rationale.

interface StatusResponse {
  status:        string
  submitted_at:  string
  public_note:   string | null
}

export default function ReportStatusPage() {
  const [reportNumber, setReportNumber] = useState('')
  const [pin,          setPin]          = useState('')
  const [busy,         setBusy]         = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [result,       setResult]       = useState<StatusResponse | null>(null)

  async function lookup(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/anonymous-report/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ report_number: reportNumber.trim(), pin: pin.trim() }),
      })
      const body = await res.json() as StatusResponse & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setResult(body as StatusResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-10 px-4">
      <div className="max-w-md mx-auto">
        <header className="text-center mb-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            SoteriaField
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
            Check report status
          </h1>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            We never reveal who filed the report.
          </p>
        </header>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-6">
          <form onSubmit={lookup} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Report number</span>
              <input
                type="text"
                value={reportNumber}
                onChange={e => setReportNumber(e.target.value.toUpperCase())}
                placeholder="e.g. INC-001234"
                required
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Tracking code</span>
              <input
                type="text"
                value={pin}
                onChange={e => setPin(e.target.value.toUpperCase())}
                placeholder="6 characters"
                maxLength={6}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-base font-mono tracking-widest text-center"
              />
            </label>
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-sm text-rose-800 dark:text-rose-200">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Look up status'}
            </button>
          </form>

          {result && (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900 p-4 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="font-semibold text-emerald-900 dark:text-emerald-100 capitalize">{result.status.replaceAll('_', ' ')}</span>
              </div>
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                Submitted {new Date(result.submitted_at).toLocaleDateString()}
              </p>
              {result.public_note && (
                <p className="mt-3 text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{result.public_note}</p>
              )}
              {!result.public_note && (
                <p className="mt-3 text-[11px] italic text-slate-500 dark:text-slate-400">
                  No update from the safety team yet. Check back later.
                </p>
              )}
            </div>
          )}

          <p className="mt-6 text-[11px] text-center text-slate-500 dark:text-slate-400">
            Don&rsquo;t have a tracking code? <Link href="/" className="underline-offset-2 hover:underline">File a new report</Link> instead.
          </p>
        </div>
      </div>
    </div>
  )
}
