'use client'

import { useState } from 'react'
import { EVALUATION_RESULTS, type EvaluationResult } from '@soteria/core/complianceEvaluation'
import {
  EmsApiError,
  completeEvaluation,
  downloadEvidence,
  uploadEvidence,
  type EvaluationRow,
  type EvidenceRow,
  type FieldError,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor } from '../../_components/formStyles'

// The open evaluation of an obligation (clause 9.1.2): the evidence filed so
// far, a way to attach more (or supersede a wrong file, never delete it), and
// the result. Compliant and noncompliant need current evidence; not
// applicable needs notes; noncompliant opens a nonconformity. The database
// enforces each of these; this panel says them up front.

const RESULT_LABEL: Record<EvaluationResult, string> = {
  compliant: 'Compliant', noncompliant: 'Noncompliant', not_applicable: 'Not applicable', undetermined: 'Undetermined',
}
const GAP_SENTENCE: Record<string, string> = {
  evidence_required: 'Attach at least one current evidence file first.',
  notes_required:    'Say in the notes why the obligation does not apply.',
  result_required:   'Choose a result.',
}
const KINDS = [
  { value: 'document', label: 'Document' }, { value: 'photo', label: 'Photo' },
  { value: 'sample_result', label: 'Sample result' }, { value: 'signature', label: 'Signature' },
] as const

export function EvidenceList({ tenantId, evidence }: { tenantId: string; evidence: readonly EvidenceRow[] }) {
  const [error, setError] = useState<string | null>(null)
  if (evidence.length === 0) return <p className="text-xs italic text-slate-500">No evidence filed.</p>
  return (
    <div className="space-y-1">
      <ul className="space-y-1 text-xs">
        {evidence.map(item => (
          <li key={item.id} className={item.superseded_by ? 'text-slate-400 line-through' : undefined}>
            <button type="button" className="text-left font-medium text-brand-navy hover:underline dark:text-brand-yellow"
              onClick={async () => {
                setError(null)
                try { await downloadEvidence(tenantId, item) }
                catch (err) { setError(err instanceof Error ? err.message : 'Could not download the file.') }
              }}>
              {item.file_name}
            </button>
            <span className="text-slate-400"> · {item.kind.replace('_', ' ')} · {item.uploaded_at.slice(0, 10)}</span>
            {item.superseded_reason && <span className="no-underline"> · replaced: {item.superseded_reason}</span>}
          </li>
        ))}
      </ul>
      {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
    </div>
  )
}

export function EvaluationPanel({ tenantId, evaluation, evidence, canAct, onChanged }: {
  tenantId: string; evaluation: EvaluationRow; evidence: readonly EvidenceRow[]; canAct: boolean; onChanged: () => void
}) {
  const current = evidence.filter(e => !e.superseded_by)
  return (
    <section className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
      <h4 className="text-xs font-semibold text-sky-900 dark:text-sky-100">
        Open evaluation · due {evaluation.scheduled_for}
      </h4>
      <EvidenceList tenantId={tenantId} evidence={evidence} />
      {canAct ? (
        <>
          <UploadForm tenantId={tenantId} evaluationId={evaluation.id} current={current} onUploaded={onChanged} />
          <CompleteForm tenantId={tenantId} evaluationId={evaluation.id} onCompleted={onChanged} />
        </>
      ) : (
        <p className="text-xs text-slate-500">Only an admin or the assigned evaluator can record this evaluation.</p>
      )}
    </section>
  )
}

function UploadForm({ tenantId, evaluationId, current, onUploaded }: {
  tenantId: string; evaluationId: string; current: readonly EvidenceRow[]; onUploaded: () => void
}) {
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('document')
  const [file, setFile] = useState<File | null>(null)
  const [replaces, setReplaces] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await uploadEvidence(tenantId, {
        evaluationId, kind, file, supersedes: replaces ? { id: replaces, reason } : undefined,
      })
      setFile(null)
      setReplaces('')
      setReason('')
      onUploaded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach the file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <div className="flex flex-wrap items-end gap-2">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Evidence</span>
          <select className={INPUT} value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <input type="file" aria-label="Evidence file" accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
        {current.length > 0 && (
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Replaces (optional)</span>
            <select className={INPUT} value={replaces} onChange={e => setReplaces(e.target.value)}>
              <option value="">Nothing: add it</option>
              {current.map(item => <option key={item.id} value={item.id}>{item.file_name}</option>)}
            </select>
          </label>
        )}
      </div>
      {replaces && (
        <input className={INPUT} aria-label="Why the earlier file is replaced" value={reason}
          onChange={e => setReason(e.target.value)} placeholder="Why the earlier file is replaced" />
      )}
      <p className="text-[11px] text-slate-500">PDF, JPEG, PNG or WebP, up to 25 MB. Files are never deleted; a wrong one is replaced, with a reason.</p>
      {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
      <button type="submit" className={BUTTON_SECONDARY} disabled={busy || !file || (replaces !== '' && reason.trim() === '')}>
        {busy ? 'Attaching…' : 'Attach'}
      </button>
    </form>
  )
}

function CompleteForm({ tenantId, evaluationId, onCompleted }: {
  tenantId: string; evaluationId: string; onCompleted: () => void
}) {
  const [result, setResult] = useState<EvaluationResult | ''>('')
  const [notes, setNotes] = useState('')
  const [findingTitle, setFindingTitle] = useState('')
  const [classification, setClassification] = useState<'observation' | 'minor' | 'major'>('minor')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!result) return
    setBusy(true)
    setError(null)
    setFieldErrors([])
    try {
      await completeEvaluation(tenantId, evaluationId, {
        result,
        notes: notes || null,
        nonconformity: result === 'noncompliant' ? { title: findingTitle, classification } : undefined,
      })
      onCompleted()
    } catch (err) {
      if (err instanceof EmsApiError && Array.isArray(err.details.gaps)) {
        setError((err.details.gaps as string[]).map(gap => GAP_SENTENCE[gap] ?? gap).join(' '))
      } else {
        setError(err instanceof Error ? err.message : 'Could not record the result.')
      }
      if (err instanceof EmsApiError) setFieldErrors(err.fieldErrors)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-sky-200 pt-3 dark:border-sky-900" noValidate>
      <fieldset>
        <legend className={LABEL_TEXT}>Result</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {EVALUATION_RESULTS.map(option => (
            <label key={option} className="inline-flex items-center gap-1 text-xs">
              <input type="radio" name={`result-${evaluationId}`} value={option} checked={result === option}
                onChange={() => setResult(option)} />
              {RESULT_LABEL[option]}
            </label>
          ))}
        </div>
      </fieldset>
      {result === 'noncompliant' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className={`${LABEL} sm:col-span-2`}>
            <span className={LABEL_TEXT}>Nonconformity to open</span>
            <input className={INPUT} value={findingTitle} onChange={e => setFindingTitle(e.target.value)}
              placeholder="e.g. Q2 discharge report filed late" />
            {errorFor(fieldErrors, 'nonconformity.title') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'nonconformity.title')}</p>}
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Classification</span>
            <select className={INPUT} value={classification} onChange={e => setClassification(e.target.value as typeof classification)}>
              <option value="observation">Observation</option>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
            </select>
          </label>
        </div>
      )}
      <label className={LABEL}>
        <span className={LABEL_TEXT}>Notes{result === 'not_applicable' ? ' (say why it does not apply)' : ' (optional)'}</span>
        <textarea className={INPUT} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
      </label>
      {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
      <button type="submit" className={BUTTON_PRIMARY} disabled={busy || !result}>
        {busy ? 'Recording…' : 'Record result'}
      </button>
    </form>
  )
}
