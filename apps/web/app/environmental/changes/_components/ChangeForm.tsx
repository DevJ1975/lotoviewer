'use client'

import { useState } from 'react'
import { CHANGE_KINDS, CHANGE_KIND_LABELS, type ChangeKind } from '@soteria/core/managementOfChange'
import {
  EmsApiError,
  openChange,
  previewChange,
  type ChangeBody,
  type ChangeRow,
  type FieldError,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor, generalError } from '../../_components/formStyles'

// Opens a change (Phase 2 plan D12). Opening works out which records the change
// touches and gives each an impact to resolve, so the form can say what that
// will be before anything is created.

const TARGET_LABEL: Record<string, string> = {
  permit: 'permit step', scope: 'scope', policy: 'policy', aspect: 'aspect', obligation: 'obligation', objective: 'objective',
}

const SITE_KINDS: readonly ChangeKind[] = ['equipment', 'process']

const SHOWN_FIELDS = ['title', 'description', 'kind', 'processArea', 'newLegalEntity', 'effectiveOn']

export function ChangeForm({ tenantId, facilityChosen, onOpened, onCancel }: {
  tenantId: string
  /** A change of owner or legal name covers every site, so it opens only with none selected. */
  facilityChosen: boolean
  onOpened: (change: ChangeRow) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    kind: 'equipment' as ChangeKind, title: '', description: '', process_area: '', new_legal_entity: '', effective_on: '',
  })
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(f => ({ ...f, [key]: value }))
    setPreview(null)   // a preview describes the values it was asked about
  }

  const ownership = form.kind === 'ownership_name'
  const needsSite = ownership && facilityChosen
  const body = (): ChangeBody => ({
    kind: form.kind,
    title: form.title,
    description: form.description,
    process_area: SITE_KINDS.includes(form.kind) ? form.process_area || null : null,
    new_legal_entity: ownership ? form.new_legal_entity || null : null,
    effective_on: form.effective_on || null,
  })

  async function run(action: () => Promise<void>, fallback: string) {
    setSaving(true)
    setError(null)
    setFieldErrors([])
    try { await action() }
    catch (err) {
      setError(err instanceof Error ? err.message : fallback)
      if (err instanceof EmsApiError) setFieldErrors(err.fieldErrors)
    } finally { setSaving(false) }
  }

  const showPreview = () => run(async () => {
    const { preview: result } = await previewChange(tenantId, body())
    const parts = Object.entries(result.byTarget).map(([target, count]) => `${count} ${TARGET_LABEL[target] ?? target}${count === 1 ? '' : 's'}`)
    setPreview(result.impacts === 0
      ? 'This change touches no records automatically: it opens with an empty checklist.'
      : `This will create ${result.impacts} ${result.impacts === 1 ? 'impact' : 'impacts'} to resolve: ${parts.join(', ')}.`)
  }, 'Could not work out the impacts.')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    return run(async () => { onOpened((await openChange(tenantId, body())).change) }, 'Could not open the change.')
  }

  const fieldError = (field: string) => {
    const message = errorFor(fieldErrors, field)
    return message ? <p className={FIELD_ERROR}>{message}</p> : null
  }
  const general = generalError(error, fieldErrors, SHOWN_FIELDS)

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>What kind of change</span>
          <select className={INPUT} value={form.kind} onChange={e => set('kind', e.target.value as ChangeKind)}>
            {CHANGE_KINDS.map(k => <option key={k} value={k}>{CHANGE_KIND_LABELS[k]}</option>)}
          </select>
          {fieldError('kind')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Effective on (optional)</span>
          <input type="date" className={INPUT} value={form.effective_on} onChange={e => set('effective_on', e.target.value)} />
          {fieldError('effectiveOn')}
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}>Title</span>
          <input className={INPUT} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. New powder-coating line" />
          {fieldError('title')}
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}>What is changing, and why</span>
          <textarea className={INPUT} rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
          {fieldError('description')}
        </label>
        {SITE_KINDS.includes(form.kind) && (
          <label className={`${LABEL} sm:col-span-2`}>
            <span className={LABEL_TEXT}>Process area it happens in</span>
            <input className={INPUT} value={form.process_area} onChange={e => set('process_area', e.target.value)} placeholder="e.g. Paint booth" />
            {fieldError('processArea')}
          </label>
        )}
        {ownership && (
          <label className={`${LABEL} sm:col-span-2`}>
            <span className={LABEL_TEXT}>New legal entity</span>
            <input className={INPUT} value={form.new_legal_entity} onChange={e => set('new_legal_entity', e.target.value)}
              placeholder="The name the permits will be held in" />
            {fieldError('newLegalEntity')}
          </label>
        )}
      </div>
      {needsSite && (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          A change of owner or legal name covers every site. Switch to all facilities in the header to open it.
        </p>
      )}
      {preview && <p className="rounded-lg bg-sky-50 p-2 text-xs text-sky-900 dark:bg-sky-950/30 dark:text-sky-100" role="status">{preview}</p>}
      {general && <p className={FIELD_ERROR} role="alert">{general}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving || needsSite}>{saving ? 'Working…' : 'Open change'}</button>
        <button type="button" className={BUTTON_SECONDARY} disabled={saving || needsSite} onClick={() => void showPreview()}>Preview impacts</button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
