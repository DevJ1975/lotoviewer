import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SiteRequired } from '@/components/environmental/context'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { createDeadline, errorList, type Scope } from '@/lib/environmental/client'
import { CADENCE_LABELS, wholeNumberOrNull } from '@/lib/environmental/calendarView'
import { DEADLINE_CADENCES } from '@soteria/core/environmental/deadlines'
import type { ObligationCadence } from '@soteria/core/complianceCalendar'
import { commonBody, DeadlineFields, emptyDraft, type DeadlineDraft } from './DeadlineFields'
import type { ViewContext } from './shared'

// A deadline the library does not know about: a consent-decree report, a
// landlord's annual inspection. It belongs to the site that is open, or to every
// site; from the all-sites roll-up the person has to say which.

interface NewDraft extends DeadlineDraft {
  cadence:     ObligationCadence
  cadenceDays: string
  periodEnd:   boolean
  everySite:   boolean
}

const emptyNewDraft: NewDraft = { ...emptyDraft, cadence: 'annual', cadenceDays: '', periodEnd: false, everySite: false }

const checkboxLabel = 'flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200'

interface Props {
  scope:   Scope
  ctx:     ViewContext
  onClose: () => void
  onSaved: (message: string) => void
}

export function AddDeadlineDialog({ scope, ctx, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(emptyNewDraft)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const update = (patch: Partial<NewDraft>) => setDraft(d => ({ ...d, ...patch }))

  // Without a site the API would file this under every site; the person must choose that deliberately.
  const needsSite = scope.facilityId === null && !draft.everySite

  const save = async () => {
    setBusy(true); setErrors([])
    try {
      const { obligation } = await createDeadline(scope, {
        ...commonBody(draft),
        cadence:      draft.cadence,
        cadence_days: draft.cadence === 'custom_days' ? wholeNumberOrNull(draft.cadenceDays) : null,
        due_anchor:   draft.periodEnd ? 'period_end' : 'fixed',
        facility_id:  draft.everySite ? null : scope.facilityId,
      })
      onSaved(`${obligation.title}: added.`)
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a deadline</DialogTitle>
        </DialogHeader>

        <form onSubmit={e => { e.preventDefault(); void save() }} className="space-y-4">
          <DeadlineFields draft={draft} onChange={update} scope={scope} ctx={ctx} dueLabel="First due date" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Repeats">
              <select value={draft.cadence} onChange={e => update({ cadence: e.target.value as ObligationCadence })} className={inputCls}>
                {DEADLINE_CADENCES.map(cadence => <option key={cadence} value={cadence}>{CADENCE_LABELS[cadence]}</option>)}
              </select>
            </Field>
            {draft.cadence === 'custom_days' && (
              <Field label="Days between deadlines" hint="1 to 3650.">
                <input type="number" min={1} max={3650} step={1} value={draft.cadenceDays} onChange={e => update({ cadenceDays: e.target.value })} required className={inputCls} />
              </Field>
            )}
          </div>

          <label className={checkboxLabel}>
            <input type="checkbox" checked={draft.periodEnd} onChange={e => update({ periodEnd: e.target.checked })} className="mt-0.5" />
            <span>
              Due on period end
              <span className="block text-xs text-slate-500 dark:text-slate-400">A deadline on the last day of a month stays on the last day each time it repeats (Mar 31, Jun 30, Sep 30). It applies to monthly and longer repeats.</span>
            </span>
          </label>

          <label className={checkboxLabel}>
            <input type="checkbox" checked={draft.everySite} onChange={e => update({ everySite: e.target.checked })} className="mt-0.5" />
            <span>
              Applies to every site
              <span className="block text-xs text-slate-500 dark:text-slate-400">Shows on every site&apos;s calendar instead of only one.</span>
            </span>
          </label>

          {needsSite && <SiteRequired>Pick the site this deadline is for, or tick &quot;Applies to every site&quot;.</SiteRequired>}

          <ErrorList errors={errors} />

          <DialogFooter>
            <button type="button" onClick={onClose} disabled={busy} className={secondaryButtonCls}>Cancel</button>
            <button type="submit" disabled={busy || needsSite} className={primaryButtonCls}>Add deadline</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
