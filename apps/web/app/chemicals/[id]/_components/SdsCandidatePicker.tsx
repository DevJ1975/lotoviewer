'use client'

import { Download, ExternalLink, Loader2, X } from 'lucide-react'
import { type SdsCandidate } from '@/lib/ai/discoverSds'

// Renders the SDS candidates that /discover proposed and lets a human confirm
// one to fetch. Dumb/presentational — the page owns the fetch + reload. The
// human-confirmation step is the guardrail: it's what lets the fetch route
// relax the host allowlist, and it keeps a wrong-product match from silently
// becoming the chemical's SDS.

interface Props {
  candidates: SdsCandidate[]
  busyUrl:    string | null
  onConfirm:  (url: string) => void
  onDismiss:  () => void
}

const CONFIDENCE_CLS: Record<SdsCandidate['confidence'], string> = {
  high:   'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  low:    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

export default function SdsCandidatePicker({ candidates, busyUrl, onConfirm, onDismiss }: Props) {
  return (
    <div className="mb-3 rounded border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
          SDS candidates found online
        </h3>
        <button onClick={onDismiss} aria-label="Dismiss" className="rounded p-1 text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-800">
          <X className="w-4 h-4" />
        </button>
      </div>

      {candidates.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No candidates found. Try uploading the SDS PDF directly, or refine the product name/manufacturer.
        </p>
      ) : (
        <ul className="space-y-2">
          {candidates.map(c => (
            <li key={c.url} className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{c.title || c.productName || 'SDS document'}</span>
                <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded ${CONFIDENCE_CLS[c.confidence]}`}>
                  {c.confidence} match
                </span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-3">
                {c.manufacturer && <span>{c.manufacturer}</span>}
                {c.revisionDate && <span>· rev {c.revisionDate}</span>}
              </div>
              {c.reasonsItMatches && (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{c.reasonsItMatches}</p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1 break-all">
                  {c.url} <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
                <button
                  onClick={() => onConfirm(c.url)}
                  disabled={busyUrl !== null}
                  className="ml-auto inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {busyUrl === c.url ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {busyUrl === c.url ? 'Fetching…' : 'Confirm & fetch'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        A fetched SDS is saved as a new revision and must be parsed and approved before its data is used. It is a copy — the manufacturer&apos;s original remains the official document of record.
      </p>
    </div>
  )
}
