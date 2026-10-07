'use client'

import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EvidenceUpload } from '@/components/environmental/EvidenceUpload'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { createOutfall, errorList, updateOutfall, type Outfall, type Permit, type Scope } from '@/lib/environmental/client'
import {
  blankOutfallForm, buildOutfallRequest, otherOutfallsAtSite, OUTFALL_STATUS_META, OUTFALL_TYPE_LABELS, outfallOptionLabel,
  outfallToForm, permitsAtSite, type OutfallFormState,
} from '@/lib/environmental/outfallView'
import { permitLabel } from '@/lib/environmental/permitView'
import { OUTFALL_STATUSES, OUTFALL_TYPES, type OutfallStatus, type OutfallType } from '@soteria/core/environmental/outfalls'

// Add an outfall to the active site, or edit one. An outfall's site is fixed once it
// exists, so the site is never asked for: a new outfall takes the active site from
// the request's headers, and an edit ignores it. The permit and the outfall it is
// "substantially identical to" are offered from this site only, because the API
// refuses any other.

interface Props {
  scope: Scope
  siteId: string
  siteName: string
  /** The outfall being edited, or null to add one. */
  outfall: Outfall | null
  /** Every outfall at the site, to choose the one this is substantially identical to. */
  outfalls: Outfall[]
  permits: Permit[]
  onSaved: () => void
  onClose: () => void
}

export function OutfallForm({ scope, siteId, siteName, outfall, outfalls, permits, onSaved, onClose }: Props) {
  const [form, setForm] = useState<OutfallFormState>(() => (outfall ? outfallToForm(outfall) : blankOutfallForm()))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof OutfallFormState>(key: K, value: OutfallFormState[K]) => setForm(f => ({ ...f, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const request = buildOutfallRequest(form)
    if (!request.ok) { setErrors(request.errors); return }

    setBusy(true); setErrors([])
    try {
      if (outfall) await updateOutfall(scope, outfall.id, request.body)
      else await createOutfall(scope, request.body)
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
          <DialogTitle>{outfall ? `Edit outfall ${outfall.code}` : 'Add an outfall'}</DialogTitle>
          <DialogDescription>{outfall ? `At ${siteName}.` : `It will be recorded at ${siteName}.`}</DialogDescription>
        </DialogHeader>

        <form onSubmit={e => void submit(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" hint="Required. Matches your site map, such as OF-001">
              <input required value={form.code} onChange={e => set('code', e.target.value)} maxLength={30} className={inputCls} />
            </Field>
            <Field label="Name">
              <input value={form.name} onChange={e => set('name', e.target.value)} maxLength={200} className={inputCls} />
            </Field>
            <Field label="Receiving water" hint="Where it discharges to, such as a creek or a storm sewer">
              <input value={form.receivingWater} onChange={e => set('receivingWater', e.target.value)} maxLength={200} className={inputCls} />
            </Field>
            <Field label="Drainage area" hint="What drains to it">
              <input value={form.drainageArea} onChange={e => set('drainageArea', e.target.value)} maxLength={500} className={inputCls} />
            </Field>
            <Field label="Latitude" hint="Decimal degrees, such as 30.267153. Give latitude and longitude together or neither">
              <input
                type="number" inputMode="decimal" step="any" min={-90} max={90}
                value={form.latitude} onChange={e => set('latitude', e.target.value)} className={inputCls}
              />
            </Field>
            <Field label="Longitude" hint="Decimal degrees, such as -97.743057">
              <input
                type="number" inputMode="decimal" step="any" min={-180} max={180}
                value={form.longitude} onChange={e => set('longitude', e.target.value)} className={inputCls}
              />
            </Field>
            <Field label="Type">
              <select value={form.outfallType} onChange={e => set('outfallType', e.target.value as OutfallType)} className={inputCls}>
                {OUTFALL_TYPES.map(t => <option key={t} value={t}>{OUTFALL_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={e => set('status', e.target.value as OutfallStatus)} className={inputCls}>
                {OUTFALL_STATUSES.map(s => <option key={s} value={s}>{OUTFALL_STATUS_META[s].label}</option>)}
              </select>
            </Field>
            <Field label="Substantially identical to" hint="Another outfall at this site, if this one is substantially identical to it">
              <select value={form.substantiallyIdenticalTo} onChange={e => set('substantiallyIdenticalTo', e.target.value)} className={inputCls}>
                <option value="">Not identical to another outfall</option>
                {otherOutfallsAtSite(outfalls, siteId, outfall?.id ?? null).map(o => <option key={o.id} value={o.id}>{outfallOptionLabel(o)}</option>)}
              </select>
            </Field>
            <Field label="Permit" hint="A permit recorded at this site">
              <select value={form.permitId} onChange={e => set('permitId', e.target.value)} className={inputCls}>
                <option value="">No permit selected</option>
                {permitsAtSite(permits, siteId).map(p => <option key={p.id} value={p.id}>{permitLabel(p)}</option>)}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
            <input
              type="checkbox" checked={form.isSamplingPoint} onChange={e => set('isSamplingPoint', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
            />
            This is a sampling point
          </label>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Photo</legend>
            <EvidenceUpload
              tenantId={scope.tenantId} folder="outfalls" accept="image/*" capture label="Take or attach a photo"
              value={form.photoPath} onChange={path => set('photoPath', path)}
            />
          </fieldset>

          <Field label="Notes">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} maxLength={2000} className={inputCls} />
          </Field>

          <ErrorList errors={errors} />

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondaryButtonCls} onClick={onClose}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButtonCls}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {outfall ? 'Save changes' : 'Add outfall'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
