'use client'

import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EvidenceUpload } from '@/components/environmental/EvidenceUpload'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { errorList, evaluateLegal, type LegalEntry, type Scope } from '@/lib/environmental/client'
import { APPLICABILITY_META, COMPLIANCE_META, evaluationBody, type EvaluationDraft } from '@/lib/environmental/legalView'
import { LEGAL_APPLICABILITY, LEGAL_COMPLIANCE } from '@soteria/core/environmental/legalRegister'
import { FieldGroup } from './FieldGroup'

// Record whether a requirement applies and whether the site is meeting it. The
// API owns the rules (a requirement that does not apply is not rated; a worrying
// rating needs a note), so a refusal is shown in its own words.

interface Props {
  scope: Scope
  entry: LegalEntry
  onClose: () => void
  onSaved: (message: string) => void
}

export function EvaluateDialog({ scope, entry, onClose, onSaved }: Props) {
  const descriptionId = useId()
  const [draft, setDraft] = useState<EvaluationDraft>({
    applicability: entry.applicability,
    complianceStatus: entry.compliance_status,
    note: entry.evaluation_note ?? '',
    evidencePath: entry.evidence_path,
  })
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const notApplicable = draft.applicability === 'not_applicable'
  const needsNote = !notApplicable && (draft.complianceStatus === 'attention' || draft.complianceStatus === 'non_compliant')

  async function save() {
    setBusy(true); setErrors([])
    try {
      await evaluateLegal(scope, entry.id, evaluationBody(draft, entry))
      onSaved(`Saved the evaluation of “${entry.title}”.`)
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-xl" aria-describedby={descriptionId}>
        <DialogHeader>
          <DialogTitle>Evaluate requirement</DialogTitle>
          <DialogDescription id={descriptionId}>{entry.title}</DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={e => { e.preventDefault(); void save() }} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Applicability">
              <select
                value={draft.applicability} disabled={busy} className={inputCls}
                onChange={e => setDraft(d => ({ ...d, applicability: e.target.value as EvaluationDraft['applicability'] }))}
              >
                {LEGAL_APPLICABILITY.map(a => <option key={a} value={a}>{APPLICABILITY_META[a].label}</option>)}
              </select>
            </Field>
            <Field label="Compliance status" hint={notApplicable ? 'A requirement that does not apply is not rated, so this stays at Not evaluated.' : undefined}>
              <select
                value={notApplicable ? 'not_evaluated' : draft.complianceStatus} disabled={busy || notApplicable} className={inputCls}
                onChange={e => setDraft(d => ({ ...d, complianceStatus: e.target.value as EvaluationDraft['complianceStatus'] }))}
              >
                {LEGAL_COMPLIANCE.map(s => <option key={s} value={s}>{COMPLIANCE_META[s].label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Note" hint={needsNote ? 'Required: say what is wrong.' : 'What you found, or what you checked.'}>
            <textarea
              value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
              rows={3} maxLength={2000} required={needsNote} disabled={busy} className={inputCls}
            />
          </Field>

          <FieldGroup label="Evidence">
            <EvidenceUpload
              tenantId={scope.tenantId} folder="legal" label="Attach evidence" disabled={busy}
              value={draft.evidencePath} onChange={path => setDraft(d => ({ ...d, evidencePath: path }))}
            />
          </FieldGroup>

          <ErrorList errors={errors} />

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={secondaryButtonCls}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButtonCls}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save evaluation
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
