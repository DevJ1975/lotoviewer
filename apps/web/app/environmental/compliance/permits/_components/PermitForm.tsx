'use client'

import { useState, type FormEvent } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EvidenceUpload } from '@/components/environmental/EvidenceUpload'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import {
  createPermit, errorList, updatePermit, type Permit, type Scope, type SiteDetail,
} from '@/lib/environmental/client'
import {
  blankConditionRow, blankPermitForm, buildPermitRequest, jurisdictionOptions, PERMIT_PROGRAM_LABELS, PERMIT_STATUS_LABELS,
  permitLabel, permitToForm, type ConditionRow, type IdentifierRow, type PermitFormState,
} from '@/lib/environmental/permitView'
import { PERMIT_PROGRAMS, PERMIT_STATUSES, type PermitProgram, type PermitStatus } from '@soteria/core/environmental/permits'

// Add a permit to the active site, or edit one. A permit's site is fixed once it
// exists, so the site is never asked for: a new permit takes the active site from
// the request's headers, and an edit ignores it.

interface Props {
  scope: Scope
  site: SiteDetail
  /** The permit being edited, or null to add one. */
  permit: Permit | null
  onSaved: () => void
  onClose: () => void
}

export function PermitForm({ scope, site, permit, onSaved, onClose }: Props) {
  const [form, setForm] = useState<PermitFormState>(() => (permit ? permitToForm(permit) : blankPermitForm()))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof PermitFormState>(key: K, value: PermitFormState[K]) => setForm(f => ({ ...f, [key]: value }))
  const editIdentifier = (index: number, change: Partial<IdentifierRow>) =>
    setForm(f => ({ ...f, identifiers: f.identifiers.map((row, i) => (i === index ? { ...row, ...change } : row)) }))
  const editCondition = (id: string, change: Partial<ConditionRow>) =>
    setForm(f => ({ ...f, conditions: f.conditions.map(row => (row.id === id ? { ...row, ...change } : row)) }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const request = buildPermitRequest(form)
    if (!request.ok) { setErrors(request.errors); return }

    setBusy(true); setErrors([])
    try {
      if (permit) await updatePermit(scope, permit.id, request.body)
      else await createPermit(scope, request.body)
      onSaved()
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{permit ? `Edit ${permitLabel(permit)}` : 'Add a permit'}</DialogTitle>
          <DialogDescription>
            {permit
              ? 'Changing its status, expiration date or renewal lead time updates its renewal deadline on the calendar.'
              : `Recorded at ${site.facility.name}. If it is active and has an expiration date, its renewal deadline is added to the calendar.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={e => void submit(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Program" hint="Required">
              <select required value={form.program} onChange={e => set('program', e.target.value as PermitProgram | '')} className={inputCls}>
                <option value="">Choose a program</option>
                {PERMIT_PROGRAMS.map(p => <option key={p} value={p}>{PERMIT_PROGRAM_LABELS[p]}</option>)}
              </select>
            </Field>
            <Field label="Permit type" hint="Required, such as NPDES industrial stormwater general permit">
              <input required value={form.permitType} onChange={e => set('permitType', e.target.value)} maxLength={200} className={inputCls} />
            </Field>
            <Field label="Permit number">
              <input value={form.permitNumber} onChange={e => set('permitNumber', e.target.value)} maxLength={100} className={inputCls} />
            </Field>
            <Field label="Issuing agency">
              <input value={form.issuingAgency} onChange={e => set('issuingAgency', e.target.value)} maxLength={200} className={inputCls} />
            </Field>
            <Field label="Jurisdiction">
              <select value={form.jurisdiction} onChange={e => set('jurisdiction', e.target.value)} className={inputCls}>
                {jurisdictionOptions(site.jurisdiction.state, permit?.jurisdiction ?? '').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Status" hint="Only an active permit is tracked and gets a renewal deadline">
              <select value={form.status} onChange={e => set('status', e.target.value as PermitStatus)} className={inputCls}>
                {PERMIT_STATUSES.map(s => <option key={s} value={s}>{PERMIT_STATUS_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label="Effective date">
              <input type="date" value={form.effectiveDate} onChange={e => set('effectiveDate', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Expiration date" hint="Leave empty for a permit that does not expire">
              <input type="date" value={form.expirationDate} onChange={e => set('expirationDate', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Renewal lead time (days)" hint="The permit itself says what your agency requires; this is your safety margin">
              <input
                type="number" inputMode="numeric" min={0} max={1095} step={1} required
                value={form.renewalLeadDays} onChange={e => set('renewalLeadDays', e.target.value)} className={inputCls}
              />
            </Field>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Identifiers</legend>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Numbers the agency knows this permit by, such as a WDID or an NPDES ID.</p>
            {form.identifiers.map((row, index) => (
              // Index keys are safe here: the inputs are controlled and a row holds no state of its own.
              <div key={index} className="flex gap-2">
                <input
                  aria-label={`Identifier ${index + 1} name`} placeholder="Name" value={row.name} maxLength={60} className={inputCls}
                  onChange={e => editIdentifier(index, { name: e.target.value })}
                />
                <input
                  aria-label={`Identifier ${index + 1} value`} placeholder="Value" value={row.value} maxLength={200} className={inputCls}
                  onChange={e => editIdentifier(index, { value: e.target.value })}
                />
                <button
                  type="button" aria-label={`Remove identifier ${index + 1}`} className="rounded p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setForm(f => ({ ...f, identifiers: f.identifiers.filter((_, i) => i !== index) }))}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" className={secondaryButtonCls} onClick={() => setForm(f => ({ ...f, identifiers: [...f.identifiers, { name: '', value: '' }] }))}>
              <Plus className="h-4 w-4" /> Add identifier
            </button>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Conditions</legend>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Duties the permit puts on the site, such as sampling, inspections or reports.</p>
            {form.conditions.map((row, index) => (
              <div key={row.id} className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex gap-2">
                  <textarea
                    aria-label={`Condition ${index + 1} text`} placeholder="What the permit requires" rows={2} maxLength={1000} value={row.text} className={inputCls}
                    onChange={e => editCondition(row.id, { text: e.target.value })}
                  />
                  <button
                    type="button" aria-label={`Remove condition ${index + 1}`} className="self-start rounded p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => setForm(f => ({ ...f, conditions: f.conditions.filter(c => c.id !== row.id) }))}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    aria-label={`Condition ${index + 1} frequency`} placeholder="How often, such as quarterly" maxLength={100} value={row.frequency} className={inputCls}
                    onChange={e => editCondition(row.id, { frequency: e.target.value })}
                  />
                  <input
                    aria-label={`Condition ${index + 1} reference`} placeholder="Where in the permit, such as Part III.A" maxLength={200} value={row.reference} className={inputCls}
                    onChange={e => editCondition(row.id, { reference: e.target.value })}
                  />
                </div>
              </div>
            ))}
            <button type="button" className={secondaryButtonCls} onClick={() => setForm(f => ({ ...f, conditions: [...f.conditions, blankConditionRow(crypto.randomUUID())] }))}>
              <Plus className="h-4 w-4" /> Add condition
            </button>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Permit document</legend>
            <EvidenceUpload
              tenantId={scope.tenantId} folder="permits" accept="application/pdf,image/*" label="Attach the permit document"
              value={form.documentPath} onChange={path => set('documentPath', path)}
            />
          </fieldset>

          <Field label="Notes">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} maxLength={2000} className={inputCls} />
          </Field>

          <ErrorList errors={errors} />

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondaryButtonCls} onClick={onClose}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButtonCls}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {permit ? 'Save changes' : 'Add permit'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
