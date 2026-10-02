'use client'

import { useState } from 'react'
import { EVALUATION_RESULTS, type EvaluationResult } from '@soteria/core/complianceEvaluation'
import {
  EmsApiError,
  completeEvaluation,
  type EvaluationRow,
  type EvidenceRow,
  type FieldError,
} from '@/lib/environmental/client'
import { EvidenceList, EvidenceUpload } from '../../_components/EvidenceUpload'
import { BUTTON_PRIMARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor } from '../../_components/formStyles'

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
export function EvaluationPanel({ tenantId, evaluation, evidence, canAct, canDownloadControlled, onChanged }: {
  tenantId: string; evaluation: EvaluationRow; evidence: readonly EvidenceRow[]; canAct: boolean
  /** Owners and admins only: the evaluator may attach an export-controlled file but not download it. */
  canDownloadControlled: boolean; onChanged: () => void
}) {
  const current = evidence.filter(e => !e.superseded_by)
  return (
    <section className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
      <h4 className="text-xs font-semibold text-sky-900 dark:text-sky-100">
        Open evaluation · due {evaluation.scheduled_for}
      </h4>
      <EvidenceList tenantId={tenantId} evidence={evidence} canDownloadControlled={canDownloadControlled} />
      {canAct ? (
        <>
          <EvidenceUpload tenantId={tenantId} subjectType="compliance_evaluation" subjectId={evaluation.id}
            current={current} onUploaded={onChanged} />
          <CompleteForm tenantId={tenantId} evaluationId={evaluation.id} onCompleted={onChanged} />
        </>
      ) : (
        <p className="text-xs text-slate-500">Only an admin or the assigned evaluator can record this evaluation.</p>
      )}
    </section>
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
