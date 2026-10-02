'use client'

import { useState } from 'react'
import {
  PERMIT_INSTRUMENTS,
  PERMIT_PROGRAMS,
  PERMIT_PROGRAM_LABELS,
  type PermitInstrument,
  type PermitProgram,
} from '@soteria/core/environmentalPermit'
import MemberPicker from '@/app/risk/_components/wizard/MemberPicker'
import {
  EmsApiError,
  createPermit,
  updatePermit,
  type FieldError,
  type PermitBody,
  type PermitRow,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor, generalError } from '../../_components/formStyles'

// Records a permit, registration or plan, or corrects one. Renewal and
// retirement are their own actions on the permit page: a renewal is an event
// with a new term, and retiring keeps the record as history. The renewal dates
// come from the permit's own terms; nothing here works them out.

type Level = 'federal' | 'state' | 'local'

const INSTRUMENT_LABEL: Record<PermitInstrument, string> = {
  permit: 'Permit', registration: 'Registration', plan: 'Plan',
}

function splitJurisdiction(value: string): { level: Level; detail: string } {
  if (value.startsWith('state:')) return { level: 'state', detail: value.slice('state:'.length) }
  if (value.startsWith('local:')) return { level: 'local', detail: value.slice('local:'.length) }
  return { level: 'federal', detail: '' }
}

function joinJurisdiction(level: Level, detail: string): string {
  if (level === 'federal') return 'federal'
  return level === 'state' ? `state:${detail.trim().toUpperCase()}` : `local:${detail.trim()}`
}

const SHOWN_FIELDS = [
  'title', 'agency', 'permitNumber', 'jurisdiction', 'holderOfRecord', 'issuedOn', 'expiresOn', 'renewalApplicationDueOn', 'program', 'instrument',
]

export function PermitForm({ tenantId, initial, defaultHolder, onSaved, onCancel }: {
  tenantId: string
  initial: PermitRow | null
  /** The legal entity the scope names: the likeliest holder of a new permit. */
  defaultHolder: string | null
  onSaved: (permit: PermitRow) => void
  onCancel: () => void
}) {
  const jurisdiction = splitJurisdiction(initial?.jurisdiction ?? 'federal')
  const [form, setForm] = useState({
    program:                    (initial?.program ?? 'air') as PermitProgram,
    instrument:                 (initial?.instrument ?? 'permit') as PermitInstrument,
    title:                      initial?.title ?? '',
    agency:                     initial?.agency ?? '',
    permit_number:              initial?.permit_number ?? '',
    level:                      jurisdiction.level,
    jurisdiction_detail:        jurisdiction.detail,
    holder_of_record:           initial?.holder_of_record ?? defaultHolder ?? '',
    issued_on:                  initial?.issued_on ?? '',
    expires_on:                 initial?.expires_on ?? '',
    renewal_application_due_on: initial?.renewal_application_due_on ?? '',
    business_critical:          initial?.business_critical ?? false,
    owner_user_id:              initial?.owner_user_id ?? '',
    notes:                      initial?.notes ?? '',
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
    const body: PermitBody = {
      program:                    form.program,
      instrument:                 form.instrument,
      title:                      form.title,
      agency:                     form.agency,
      permit_number:              form.permit_number || null,
      jurisdiction:               joinJurisdiction(form.level, form.jurisdiction_detail),
      holder_of_record:           form.holder_of_record,
      issued_on:                  form.issued_on || null,
      expires_on:                 form.expires_on || null,
      renewal_application_due_on: form.renewal_application_due_on || null,
      business_critical:          form.business_critical,
      notes:                      form.notes || null,
      owner_user_id:              form.owner_user_id || null,
    }
    try {
      const { permit } = initial ? await updatePermit(tenantId, initial.id, body) : await createPermit(tenantId, body)
      onSaved(permit)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the permit.')
      if (err instanceof EmsApiError) setFieldErrors(err.fieldErrors)
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (field: string) => {
    const message = errorFor(fieldErrors, field)
    return message ? <p className={FIELD_ERROR}>{message}</p> : null
  }
  const general = generalError(error, fieldErrors, SHOWN_FIELDS)

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}>Title</span>
          <input className={INPUT} value={form.title} onChange={e => set('title', e.target.value)}
            placeholder="e.g. Industrial wastewater discharge permit" />
          {fieldError('title')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Program</span>
          <select className={INPUT} value={form.program} onChange={e => set('program', e.target.value as PermitProgram)}>
            {PERMIT_PROGRAMS.map(p => <option key={p} value={p}>{PERMIT_PROGRAM_LABELS[p]}</option>)}
          </select>
          {fieldError('program')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Kind of paper</span>
          <select className={INPUT} value={form.instrument} onChange={e => set('instrument', e.target.value as PermitInstrument)}>
            {PERMIT_INSTRUMENTS.map(i => <option key={i} value={i}>{INSTRUMENT_LABEL[i]}</option>)}
          </select>
          {fieldError('instrument')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Issuing agency</span>
          <input className={INPUT} value={form.agency} onChange={e => set('agency', e.target.value)} placeholder="e.g. City of Northfield" />
          {fieldError('agency')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Number (optional)</span>
          <input className={INPUT} value={form.permit_number} onChange={e => set('permit_number', e.target.value)} />
          {fieldError('permitNumber')}
        </label>
        <div className={LABEL}>
          <span className={LABEL_TEXT}>Jurisdiction</span>
          <div className="flex gap-2">
            <select className={INPUT} aria-label="Jurisdiction level" value={form.level} onChange={e => set('level', e.target.value as Level)}>
              <option value="federal">Federal</option>
              <option value="state">State</option>
              <option value="local">Local</option>
            </select>
            {form.level !== 'federal' && (
              <input className={INPUT} aria-label={form.level === 'state' ? 'State code' : 'Local authority'}
                value={form.jurisdiction_detail} onChange={e => set('jurisdiction_detail', e.target.value)}
                placeholder={form.level === 'state' ? 'TX' : 'e.g. City of Northfield'} maxLength={form.level === 'state' ? 2 : 120} />
            )}
          </div>
          {fieldError('jurisdiction')}
        </div>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Holder of record</span>
          <input className={INPUT} value={form.holder_of_record} onChange={e => set('holder_of_record', e.target.value)}
            placeholder="The name on the permit itself" />
          {fieldError('holderOfRecord')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Issued on</span>
          <input type="date" className={INPUT} value={form.issued_on} onChange={e => set('issued_on', e.target.value)} />
          {fieldError('issuedOn')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Expires on (blank: no fixed term)</span>
          <input type="date" className={INPUT} value={form.expires_on} onChange={e => set('expires_on', e.target.value)} />
          {fieldError('expiresOn')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Renewal application due (from the permit&apos;s terms)</span>
          <input type="date" className={INPUT} value={form.renewal_application_due_on}
            onChange={e => set('renewal_application_due_on', e.target.value)} />
          {fieldError('renewalApplicationDueOn')}
        </label>
        <div className={LABEL}>
          <span className={LABEL_TEXT}>Owner (optional)</span>
          <MemberPicker value={form.owner_user_id} onChange={value => set('owner_user_id', value)} placeholder="Unassigned" />
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 sm:col-span-2">
          <input type="checkbox" className="mt-0.5" checked={form.business_critical}
            onChange={e => set('business_critical', e.target.checked)} />
          <span>Business-critical: operations stop without it, so its renewal notices also reach the Compliance obligations holder and, at 30 days, every owner and admin.</span>
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}>Notes (optional)</span>
          <textarea className={INPUT} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </label>
      </div>
      {general && <p className={FIELD_ERROR} role="alert">{general}</p>}
      <div className="flex gap-2">
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add permit'}</button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
