'use client'

import { useId, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EvidenceUpload } from '@/components/environmental/EvidenceUpload'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { errorList, type Outfall, type Scope } from '@/lib/environmental/complianceClient'
import { createResult, updateResult } from '@/lib/environmental/monitoringClient'
import { outfallOptionLabel } from '@/lib/environmental/outfallView'
import {
  blankResultForm, buildResultRequest, resultToForm, unitSuggestion, type ResultFormState,
} from '@/lib/environmental/monitoringView'
import type { MonitoringLimit, MonitoringResult } from '@soteria/core/environmental/monitoring'

// Record a sample result at the active site, or (a tenant admin) correct one. Who sampled it
// is never asked: it is the person signed in, and an edit cannot change it. The parameter
// offers the ones the site has limits for, so a result is spelled the way its limit is and is
// judged against it; the unit follows the limit's.

interface Props {
  scope: Scope
  siteName: string
  /** The result being corrected, or null to record a new one. */
  result: MonitoringResult | null
  outfalls: Outfall[]
  limits: MonitoringLimit[]
  /** Parameters to suggest: the site's limits first, then any it only has results for. */
  parameters: string[]
  /** The moment the form opens, for the sample time a new result starts with. */
  nowMs: number
  onSaved: () => void
  onClose: () => void
}

export function ResultForm({ scope, siteName, result, outfalls, limits, parameters, nowMs, onSaved, onClose }: Props) {
  const parameterListId = useId()
  const [form, setForm] = useState<ResultFormState>(() => (result ? resultToForm(result) : blankResultForm(nowMs)))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof ResultFormState>(key: K, value: ResultFormState[K]) => setForm(f => ({ ...f, [key]: value }))

  // Filling the unit is a convenience for a blank field: a unit already typed is never replaced.
  function suggestUnit() {
    const suggestion = unitSuggestion(limits, form.parameter)
    if (suggestion && form.unit.trim() === '') set('unit', suggestion)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const request = buildResultRequest(form)
    if (!request.ok) { setErrors(request.errors); return }

    setBusy(true); setErrors([])
    try {
      if (result) await updateResult(scope, result.id, request.body)
      else await createResult(scope, request.body)
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
          <DialogTitle>{result ? 'Correct a result' : 'Add a result'}</DialogTitle>
          <DialogDescription>
            {result
              ? `At ${siteName}. Your correction is kept in the audit log.`
              : `It will be recorded at ${siteName}, as taken by you. Only an administrator can change it afterwards.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={e => void submit(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Outfall" hint="Where the sample was taken">
              <select value={form.outfallId} onChange={e => set('outfallId', e.target.value)} className={inputCls}>
                <option value="">Site as a whole (no outfall)</option>
                {outfalls
                  .filter(o => o.status !== 'removed' || o.id === form.outfallId)
                  .map(o => <option key={o.id} value={o.id}>{outfallOptionLabel(o)}</option>)}
              </select>
            </Field>
            <Field label="Parameter" hint="What was measured, such as pH or TSS">
              <input
                required value={form.parameter} list={parameterListId} maxLength={80} autoComplete="off" className={inputCls}
                onChange={e => set('parameter', e.target.value)} onBlur={suggestUnit}
              />
              <datalist id={parameterListId}>{parameters.map(p => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label={form.belowDetection ? 'Reporting limit' : 'Result'} hint={form.belowDetection ? 'The lowest value the laboratory could detect' : 'As the laboratory reported it'}>
              <input
                required type="number" inputMode="decimal" step="any" min={0} className={inputCls}
                value={form.value} onChange={e => set('value', e.target.value)}
              />
            </Field>
            <Field label="Unit" hint="Such as mg/L or s.u. A unit that does not match the limit's is not judged">
              <input required value={form.unit} onChange={e => set('unit', e.target.value)} maxLength={20} className={inputCls} />
            </Field>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
            <input
              type="checkbox" checked={form.belowDetection} onChange={e => set('belowDetection', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700"
            />
            <span>
              Not detected
              <span className="block text-xs text-slate-500 dark:text-slate-400">The value above is the laboratory&apos;s reporting limit, not a measurement.</span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sampled at" hint="On your computer's clock. It is kept, and shown, in UTC">
              <input required type="datetime-local" value={form.sampledAt} onChange={e => set('sampledAt', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Storm event or sample ID" hint="Such as QSE 2026-02-03">
              <input value={form.eventLabel} onChange={e => set('eventLabel', e.target.value)} maxLength={120} className={inputCls} />
            </Field>
            <Field label="Laboratory">
              <input value={form.lab} onChange={e => set('lab', e.target.value)} maxLength={120} className={inputCls} />
            </Field>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Laboratory report</legend>
            <EvidenceUpload
              tenantId={scope.tenantId} folder="monitoring" label="Attach the laboratory report"
              value={form.evidenceId} onChange={path => set('evidenceId', path)}
            />
          </fieldset>

          <Field label="Notes">
            <textarea value={form.note} onChange={e => set('note', e.target.value)} rows={2} maxLength={2000} className={inputCls} />
          </Field>

          <ErrorList errors={errors} />

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondaryButtonCls} onClick={onClose}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButtonCls}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {result ? 'Save correction' : 'Add result'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
