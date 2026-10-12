'use client'

import { useId, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { errorList, type Outfall, type Scope } from '@/lib/environmental/complianceClient'
import { createLimit, updateLimit } from '@/lib/environmental/monitoringClient'
import { outfallOptionLabel, outfallPermitLabel } from '@/lib/environmental/outfallView'
import {
  blankLimitForm, buildLimitRequest, LIMIT_BASIS_CHOICES, LIMIT_KIND_CHOICES, limitToForm, permitChoicesForLimit,
  type LimitFormState,
} from '@/lib/environmental/monitoringView'
import type { PermitRef } from '@/lib/environmental/permitRefs'
import type { LimitBasis, LimitKind, MonitoringLimit } from '@soteria/core/environmental/monitoring'

// Add a discharge limit to the active site, or edit one (tenant admins). The kind of limit
// ("basis") is asked with its consequence beside it, because it decides what an exceedance
// means: a permit or local limit binds the site, a benchmark or action level calls for a
// response. The outfall and the permit are offered from this site only, because the API
// refuses any other.

interface Props {
  scope: Scope
  siteId: string
  siteName: string
  /** The limit being edited, or null to add one. */
  limit: MonitoringLimit | null
  outfalls: Outfall[]
  /** The site's permits, retired ones included, so a link to a retired permit can still be shown. */
  permits: PermitRef[]
  parameters: string[]
  onSaved: () => void
  onClose: () => void
}

export function LimitForm({ scope, siteId, siteName, limit, outfalls, permits, parameters, onSaved, onClose }: Props) {
  const parameterListId = useId()
  const [form, setForm] = useState<LimitFormState>(() => (limit ? limitToForm(limit) : blankLimitForm()))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof LimitFormState>(key: K, value: LimitFormState[K]) => setForm(f => ({ ...f, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const request = buildLimitRequest(form)
    if (!request.ok) { setErrors(request.errors); return }

    setBusy(true); setErrors([])
    try {
      if (limit) await updateLimit(scope, limit.id, request.body)
      else await createLimit(scope, request.body)
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
          <DialogTitle>{limit ? `Edit limit: ${limit.parameter}` : 'Add a limit'}</DialogTitle>
          <DialogDescription>{limit ? `At ${siteName}.` : `It will apply at ${siteName}.`}</DialogDescription>
        </DialogHeader>

        <form onSubmit={e => void submit(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Applies to" hint="A site-wide limit applies to every outfall">
              <select value={form.outfallId} onChange={e => set('outfallId', e.target.value)} className={inputCls}>
                <option value="">Whole site</option>
                {outfalls.map(o => <option key={o.id} value={o.id}>{outfallOptionLabel(o)}</option>)}
              </select>
            </Field>
            <Field label="Parameter" hint="What it limits, such as pH or TSS. Spell it as results are entered">
              <input required value={form.parameter} list={parameterListId} maxLength={80} autoComplete="off" onChange={e => set('parameter', e.target.value)} className={inputCls} />
              <datalist id={parameterListId}>{parameters.map(p => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="How it is judged">
              <select value={form.kind} onChange={e => set('kind', e.target.value as LimitKind)} className={inputCls}>
                {LIMIT_KIND_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Kind of limit" hint="A permit or local limit binds the site. A benchmark or numeric action level calls for a response but is not itself a violation">
              <select value={form.basis} onChange={e => set('basis', e.target.value as LimitBasis)} className={inputCls}>
                {LIMIT_BASIS_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Limit">
              <input required type="number" inputMode="decimal" step="any" min={0} value={form.value} onChange={e => set('value', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Unit" hint="Such as mg/L or s.u.">
              <input required value={form.unit} onChange={e => set('unit', e.target.value)} maxLength={20} className={inputCls} />
            </Field>
            <Field label="Permit" hint="The permit it comes from, if you keep it in the Permits register">
              <select value={form.permitId} onChange={e => set('permitId', e.target.value)} className={inputCls}>
                <option value="">No permit selected</option>
                {permitChoicesForLimit(permits, siteId, limit?.permitId ?? null).map(p => <option key={p.id} value={p.id}>{outfallPermitLabel(p)}</option>)}
              </select>
            </Field>
            <Field label="Source" hint="Where the number is written, such as Table 2 of the permit">
              <input value={form.citation} onChange={e => set('citation', e.target.value)} maxLength={300} className={inputCls} />
            </Field>
            <Field label="In force from" hint="Leave blank if it has always applied">
              <input type="date" value={form.effectiveFrom} onChange={e => set('effectiveFrom', e.target.value)} className={inputCls} />
            </Field>
            <Field label="In force until" hint="Leave blank if it still applies">
              <input type="date" value={form.effectiveTo} onChange={e => set('effectiveTo', e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Check before relying on this" hint="Anything a reviewer must confirm about this number. It stays visible beside the limit">
            <textarea value={form.verify} onChange={e => set('verify', e.target.value)} rows={2} maxLength={1000} className={inputCls} />
          </Field>

          <ErrorList errors={errors} />

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondaryButtonCls} onClick={onClose}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButtonCls}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {limit ? 'Save changes' : 'Add limit'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
