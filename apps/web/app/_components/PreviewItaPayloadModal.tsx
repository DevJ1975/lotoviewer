'use client'

import { useEffect, useState } from 'react'
import { Loader2, X, Copy, Check, AlertTriangle } from 'lucide-react'

// PreviewItaPayloadModal — calls the submit-to-ita route with
// `dry_run: true` and renders the JSON payload + computed coverage
// tier. No regulatory data leaves the app — the dry-run path
// short-circuits before any outbound HTTP to OSHA.
//
// Use case: an admin wants to verify the payload shape against
// OSHA's current ITA developer docs before flipping the env-side
// endpoint on. Letting them inspect the JSON without committing
// the submission removes a class of "did we get the schema right?"
// surprises.

interface Props {
  year:               number
  establishmentId:    string
  authedHeaders:      () => Promise<Record<string, string>>
  onClose:            () => void
}

interface DryRunResponse {
  dry_run:  true
  coverage: 'summary_only' | 'summary_and_cases' | 'not_required'
  payload:  unknown
}

export default function PreviewItaPayloadModal({ year, establishmentId, authedHeaders, onClose }: Props) {
  const [data,    setData]    = useState<DryRunResponse | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied,  setCopied]  = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const headers = await authedHeaders()
        const res = await fetch('/api/osha/300a/submit-to-ita', {
          method: 'POST', headers,
          body: JSON.stringify({ year, establishment_id: establishmentId, dry_run: true }),
        })
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(body.error ?? `HTTP ${res.status}`)
          return
        }
        setData(body as DryRunResponse)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [year, establishmentId, authedHeaders])

  // Esc-to-close.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function copyToClipboard() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(data.payload, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to clipboard')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-950 shadow-xl ring-1 ring-slate-200 dark:ring-slate-800"
        onClick={ev => ev.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Preview OSHA ITA submission
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Dry run — nothing is sent to OSHA. This is exactly what would be submitted for {year}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-5 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Coverage tier:</span>
                <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-mono">
                  {data.coverage}
                </span>
                <span className="text-slate-400 dark:text-slate-500">
                  {data.coverage === 'summary_only' && '— 300A only'}
                  {data.coverage === 'summary_and_cases' && '— 300A + 300/301 case rows (Appendix B)'}
                  {data.coverage === 'not_required' && '— establishment may not be required to submit at this size/industry'}
                </span>
              </div>
              <pre className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-3 text-[11px] overflow-auto text-slate-800 dark:text-slate-200">
                {JSON.stringify(data.payload, null, 2)}
              </pre>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 px-5 py-3">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Verify the field shape against OSHA&apos;s current ITA developer docs before going live.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copyToClipboard()}
              disabled={!data}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90"
            >
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
