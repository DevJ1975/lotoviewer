'use client'

import { useState } from 'react'
import {
  ASPECT_LIFE_CYCLE_STAGES,
  ASPECT_STATUSES,
  type AspectFlow,
  type AspectLifeCycleStage,
  type AspectStatus,
} from '@soteria/core/environmentalAspect'
import {
  EmsApiError,
  createAspect,
  updateAspect,
  type AspectBody,
  type AspectRow,
  type FieldError,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor } from '../../_components/formStyles'
import { TermTooltip } from '../../_components/TermTooltip'

// Records a new aspect, or edits an existing one's description. Scores are
// not part of this form: each operating condition is scored separately,
// with its own rationale, from the aspect's sheet.

interface Props {
  tenantId:     string
  /** The aspect being edited, or null to record a new one. */
  initial:      AspectRow | null
  /** Process areas already in use, offered as suggestions. */
  processAreas: readonly string[]
  onSaved:      (aspect: AspectRow) => void
  onCancel:     () => void
}

export function AspectForm({ tenantId, initial, processAreas, onSaved, onCancel }: Props) {
  const [form, setForm] = useState({
    activity:         initial?.activity ?? '',
    aspect:           initial?.aspect ?? '',
    impact:           initial?.impact ?? '',
    process_area:     initial?.process_area ?? '',
    life_cycle_stage: (initial?.life_cycle_stage ?? 'operation') as AspectLifeCycleStage,
    flow:             (initial?.flow ?? '') as '' | AspectFlow,
    status:           (initial?.status ?? 'identified') as AspectStatus,
    controls:         initial?.controls ?? '',
    notes:            initial?.notes ?? '',
    source_reference: initial?.source_reference ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(f => ({ ...f, [key]: value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setFieldErrors([])
    const body: AspectBody = {
      ...form,
      flow:             form.flow || null,
      controls:         form.controls || null,
      notes:            form.notes || null,
      source_reference: form.source_reference || null,
    }
    try {
      const { aspect } = initial
        ? await updateAspect(tenantId, initial.id, body)
        : await createAspect(tenantId, body)
      onSaved(aspect)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the aspect.')
      if (err instanceof EmsApiError) setFieldErrors(err.fieldErrors)
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (field: string) => {
    const message = errorFor(fieldErrors, field)
    return message ? <p className={FIELD_ERROR}>{message}</p> : null
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Activity, product or service</span>
          <input className={INPUT} value={form.activity} onChange={e => set('activity', e.target.value)}
            placeholder="e.g. Parts degreasing" />
          {fieldError('activity')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Process area</span>
          <input className={INPUT} value={form.process_area} onChange={e => set('process_area', e.target.value)}
            list="aspect-process-areas" placeholder="e.g. Finishing" />
          <datalist id="aspect-process-areas">
            {processAreas.map(area => <option key={area} value={area} />)}
          </datalist>
          {fieldError('process_area')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Environmental <TermTooltip term="aspect" /></span>
          <input className={INPUT} value={form.aspect} onChange={e => set('aspect', e.target.value)}
            placeholder="e.g. Solvent vapour release" />
          {fieldError('aspect')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Environmental <TermTooltip term="impact" /></span>
          <input className={INPUT} value={form.impact} onChange={e => set('impact', e.target.value)}
            placeholder="e.g. Air pollution (VOC)" />
          {fieldError('impact')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Life-cycle stage</span>
          <select className={INPUT} value={form.life_cycle_stage}
            onChange={e => set('life_cycle_stage', e.target.value as AspectLifeCycleStage)}>
            {ASPECT_LIFE_CYCLE_STAGES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Flow (optional)</span>
          <select className={INPUT} value={form.flow} onChange={e => set('flow', e.target.value as '' | AspectFlow)}>
            <option value="">—</option>
            <option value="input">Input (resource use)</option>
            <option value="output">Output (emission, discharge, waste)</option>
          </select>
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}>Existing or planned controls (optional)</span>
          <input className={INPUT} value={form.controls} onChange={e => set('controls', e.target.value)}
            placeholder="e.g. Lidded tank; fume extraction" />
          {fieldError('controls')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Control status</span>
          <select className={INPUT} value={form.status} onChange={e => set('status', e.target.value as AspectStatus)}>
            {ASPECT_STATUSES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Source reference (optional)</span>
          <input className={INPUT} value={form.source_reference} onChange={e => set('source_reference', e.target.value)}
            placeholder="e.g. SDS-114 or a waste stream" />
          {fieldError('source_reference')}
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}>Notes (optional)</span>
          <textarea className={INPUT} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
          {fieldError('notes')}
        </label>
      </div>
      {error && fieldErrors.length === 0 && <p className={FIELD_ERROR} role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Record aspect'}
        </button>
      </div>
    </form>
  )
}
