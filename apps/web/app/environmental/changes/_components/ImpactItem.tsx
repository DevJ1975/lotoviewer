'use client'

import { useState } from 'react'
import { TRANSFER_STEP_LABELS, type TransferStep } from '@soteria/core/managementOfChange'
import { resolveImpact, type EvidenceRow, type ImpactRow } from '@/lib/environmental/client'
import { EvidenceList, EvidenceUpload } from '../../_components/EvidenceUpload'
import { BUTTON_PRIMARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT } from '../../_components/formStyles'

// One thing a change obliges: a step of a permit's transfer, or an update to
// the scope, the policy, an aspect or an obligation. It is resolved with a
// note and, for the transfer steps, a file that shows it was done. The database
// refuses a resolution that does not meet its rule; what it would refuse is
// shown here first, in the same words, and a refusal that still comes back (the
// record changed on another screen) is shown as the database said it.

export function ImpactItem({ tenantId, changeId, impact, evidence, canResolve, open, onChanged }: {
  tenantId: string; changeId: string; impact: ImpactRow; evidence: readonly EvidenceRow[]
  canResolve: boolean; open: boolean; onChanged: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolved = impact.resolved_at !== null
  // Only a permit's transfer has named steps; any other impact is just what it asks.
  const stepLabel = impact.step === null ? null : TRANSFER_STEP_LABELS[impact.step as TransferStep] ?? impact.step

  async function resolve() {
    setBusy(true)
    setError(null)
    try { await resolveImpact(tenantId, changeId, impact.id, note.trim() || null); setNote(''); onChanged() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not resolve it.') }
    finally { setBusy(false) }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start gap-2">
        <span aria-hidden className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${resolved ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
        <div className="min-w-0 flex-1">
          {stepLabel && <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{stepLabel}</p>}
          <p className={stepLabel ? 'text-xs text-slate-600 dark:text-slate-300' : 'text-sm text-slate-900 dark:text-slate-100'}>
            {impact.action_required}
            <span className="sr-only">{resolved ? ' (resolved)' : ' (not yet resolved)'}</span>
          </p>
          {resolved && (
            <p className="text-xs text-emerald-800 dark:text-emerald-200">
              Resolved {impact.resolved_at?.slice(0, 10)}{impact.resolution_note ? `: ${impact.resolution_note}` : ''}
            </p>
          )}
        </div>
      </div>
      {(evidence.length > 0 || (!resolved && open)) && (
        <div className="ml-4 space-y-2">
          <EvidenceList tenantId={tenantId} evidence={evidence} />
          {canResolve && open && !resolved && (
            <EvidenceUpload tenantId={tenantId} subjectType="ms_change_impact" subjectId={impact.id}
              current={evidence.filter(e => !e.superseded_by)} onUploaded={onChanged} />
          )}
        </div>
      )}
      {canResolve && open && !resolved && (
        <div className="ml-4 space-y-2">
          {impact.blockers.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-amber-800 dark:text-amber-200">
              {impact.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
            </ul>
          )}
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Note{impact.needs_note ? ' (required)' : ' (optional)'}</span>
            <input className={INPUT} value={note} onChange={e => setNote(e.target.value)} />
          </label>
          {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
          <button type="button" className={BUTTON_PRIMARY}
            disabled={busy || impact.blockers.length > 0 || (impact.needs_note && note.trim() === '')}
            onClick={() => void resolve()}>
            {busy ? 'Resolving…' : 'Resolve'}
          </button>
        </div>
      )}
    </li>
  )
}
