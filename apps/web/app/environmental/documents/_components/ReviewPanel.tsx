'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarPlus, CheckCircle2, ExternalLink, Loader2, ScanLine, XCircle } from 'lucide-react'
import {
  DOCUMENT_TYPE_LABELS,
  defaultAcceptedIndices,
  parseProposal,
  planObligations,
  reviewAcceptedFields,
  type ExtractionConfidence,
} from '@soteria/core/documentExtraction'
import {
  approveDocument, getDocumentUrl, rejectDocument,
  type DocumentDetail, type DocumentScope,
} from '@/lib/environmental/documentsClient'

// The decision screen for one document. The service's reading is only a
// proposal: every value is shown beside the text it came from, a scan starts
// with nothing ticked, and nothing reaches the compliance calendar until an
// admin approves.

const CONFIDENCE_BADGE: Record<ExtractionConfidence, string> = {
  high:   'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  low:    'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
}

export function ReviewPanel({ doc, scope, canDecide, onDecided }: {
  doc: DocumentDetail
  scope: DocumentScope
  canDecide: boolean
  onDecided: () => void
}) {
  const proposal = useMemo(() => parseProposal(doc), [doc])
  const [checked, setChecked] = useState<Set<number>>(() => new Set(proposal ? defaultAcceptedIndices(proposal) : []))
  const [values, setValues] = useState<string[]>(() => proposal?.fields.map(f => f.value) ?? [])
  const [createObligations, setCreateObligations] = useState(true)
  const [busy, setBusy] = useState<'approve' | 'reject' | 'open' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!proposal) {
    return <p className="text-sm text-slate-600 dark:text-slate-300">This document has no readable proposal.</p>
  }

  const accepted = [...checked].sort((a, b) => a - b).map(index => ({ index, value: values[index] ?? '' }))
  const review = reviewAcceptedFields(proposal, accepted)
  const calendarEntries = review.ok && createObligations
    ? planObligations(review.fields, { documentId: doc.id, docType: proposal.docType, fileName: doc.file_name })
    : []

  const toggle = (index: number) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(index)) next.delete(index); else next.add(index)
    return next
  })

  async function run(kind: 'approve' | 'reject', action: () => Promise<unknown>) {
    setBusy(kind); setError(null)
    try { await action(); onDecided() }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
    finally { setBusy(null) }
  }

  async function openOriginal() {
    setBusy('open'); setError(null)
    try { window.open(await getDocumentUrl(scope, doc.id), '_blank', 'noopener,noreferrer') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open the document.') }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{DOCUMENT_TYPE_LABELS[proposal.docType]}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CONFIDENCE_BADGE[proposal.docTypeConfidence]}`}>
          {proposal.docTypeConfidence} confidence it is this type
        </span>
        <button
          type="button" onClick={openOriginal} disabled={busy !== null}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {busy === 'open' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
          View original
        </button>
      </div>

      {proposal.viaOcr && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <ScanLine className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This document was read from a scan, so letters and digits can be confused (0/O, 1/I, 5/S, 8/B).
            Nothing is ticked: check each value against the original before you tick it.
          </span>
        </div>
      )}
      {proposal.notes && <p className="text-xs text-slate-500 dark:text-slate-400">{proposal.notes}</p>}

      {proposal.fields.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          No identifiers or dates were found in this document. Open the original to check it, then reject this reading.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {proposal.fields.map((field, i) => {
            const isDate = field.key.endsWith('_date')
            const id = `field-${i}`
            return (
              <li key={id} className="grid gap-2 p-3 sm:grid-cols-[auto_1fr]">
                <input
                  type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} disabled={!canDecide}
                  aria-label={`Confirm ${field.label}`} className="mt-1.5 h-4 w-4"
                />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={id} className="text-xs font-semibold text-slate-700 dark:text-slate-200">{field.label}</label>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CONFIDENCE_BADGE[field.confidence]}`}>{field.confidence}</span>
                    {field.repaired && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                        corrected from scan
                      </span>
                    )}
                  </div>
                  <input
                    id={id} type={isDate ? 'date' : 'text'} value={values[i] ?? ''} disabled={!canDecide}
                    onChange={e => setValues(prev => prev.map((v, j) => (j === i ? e.target.value : v)))}
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:max-w-sm"
                  />
                  {field.evidence && (
                    <p className="text-xs italic text-slate-500 dark:text-slate-400">“{field.evidence}”</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canDecide && calendarEntries.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
          <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Will be added to the compliance calendar:</p>
            <ul className="mt-1 list-disc pl-5">
              {calendarEntries.map(o => <li key={o.title + o.next_due_at}>{o.title}, due {o.next_due_at}</li>)}
            </ul>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}
      {canDecide && !review.ok && checked.size > 0 && (
        <p className="text-xs text-rose-700 dark:text-rose-300">{review.error}</p>
      )}

      {canDecide ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button" disabled={!review.ok || busy !== null}
            onClick={() => run('approve', () => approveDocument(scope, doc.id, { accepted, create_obligations: createObligations }))}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-brand-yellow dark:text-slate-900"
          >
            {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Approve {checked.size} {checked.size === 1 ? 'field' : 'fields'}
          </button>
          <button
            type="button" disabled={busy !== null}
            onClick={() => run('reject', () => rejectDocument(scope, doc.id))}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            Reject reading
          </button>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={createObligations} onChange={e => setCreateObligations(e.target.checked)} className="h-4 w-4" />
            Add confirmed expiry and renewal dates to the compliance calendar
          </label>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">A tenant admin approves or rejects this reading.</p>
      )}
    </div>
  )
}

/** What was decided, for a document that is no longer waiting. */
export function DecidedSummary({ doc }: { doc: DocumentDetail }) {
  if (doc.status === 'rejected') {
    return <p className="text-sm text-slate-600 dark:text-slate-300">This reading was rejected. Nothing was filed.</p>
  }
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" /> Approved
      </p>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
        {doc.reviewed_fields.map((f, i) => (
          <li key={`${f.key}-${i}`} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">{f.label}</span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{f.value}</span>
            {f.edited && <span className="text-[11px] text-amber-700 dark:text-amber-300">corrected by reviewer</span>}
          </li>
        ))}
      </ul>
      {doc.obligation_ids.length > 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {doc.obligation_ids.length} {doc.obligation_ids.length === 1 ? 'entry was' : 'entries were'} added to the{' '}
          <Link href="/admin/compliance/calendar" className="font-medium underline">compliance calendar</Link>.
        </p>
      )}
    </div>
  )
}
