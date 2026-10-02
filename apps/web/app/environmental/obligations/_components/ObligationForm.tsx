'use client'

import { useState } from 'react'
import { OBLIGATION_CADENCES } from '@soteria/core/complianceCalendar'
import { OBLIGATION_SOURCE_KINDS } from '@soteria/core/complianceEvaluation'
import {
  EmsApiError,
  createObligation,
  updateObligation,
  type FieldError,
  type ObligationBody,
  type ObligationRow,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor } from '../../_components/formStyles'
import { TermTooltip } from '../../_components/TermTooltip'

// Adds an obligation to the register, or edits its register fields. A new
// obligation also needs the calendar's deadline; an existing one's deadline
// stays with the Compliance Calendar, so the edit form leaves it alone.

type Level = 'federal' | 'state' | 'local'

function splitJurisdiction(value: string | null): { level: Level; detail: string } {
  if (value?.startsWith('state:')) return { level: 'state', detail: value.slice('state:'.length) }
  if (value?.startsWith('local:')) return { level: 'local', detail: value.slice('local:'.length) }
  return { level: 'federal', detail: '' }
}

function joinJurisdiction(level: Level, detail: string): string {
  if (level === 'federal') return 'federal'
  return level === 'state' ? `state:${detail.trim().toUpperCase()}` : `local:${detail.trim()}`
}

const SOURCE_LABEL: Record<string, string> = {
  law: 'Law or regulation', permit: 'Permit', contract: 'Contract', voluntary: 'Voluntary commitment', internal: 'Internal requirement',
}

export function ObligationForm({ tenantId, initial, onSaved, onCancel }: {
  tenantId: string; initial: ObligationRow | null; onSaved: (obligation: ObligationRow) => void; onCancel: () => void
}) {
  const jurisdiction = splitJurisdiction(initial?.jurisdiction ?? null)
  const [form, setForm] = useState({
    title:                   initial?.title ?? '',
    source_kind:             initial?.source_kind ?? 'law',
    regulatory_ref:          initial?.regulatory_ref ?? '',
    level:                   jurisdiction.level,
    jurisdiction_detail:     jurisdiction.detail,
    applicability_rationale: initial?.applicability_rationale ?? '',
    evaluation_cadence_days: initial?.evaluation_cadence_days?.toString() ?? '365',
    next_due_at:             '',
    cadence:                 'annual',
    description:             '',
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
    const cadenceDays = form.evaluation_cadence_days.trim()
    // Checked here because JSON.stringify(NaN) is null, which the API would
    // read as "never schedule evaluations" instead of a typo.
    if (cadenceDays !== '' && !/^\d+$/.test(cadenceDays)) {
      setFieldErrors([{ field: 'evaluation_cadence_days', message: 'must be a whole number of days, or blank' }])
      setSaving(false)
      return
    }
    const register: ObligationBody = {
      title:                   form.title,
      source_kind:             form.source_kind,
      regulatory_ref:          form.regulatory_ref || null,
      jurisdiction:            joinJurisdiction(form.level, form.jurisdiction_detail),
      applicability_rationale: form.applicability_rationale || null,
      evaluation_cadence_days: cadenceDays === '' ? null : Number(cadenceDays),
    }
    try {
      const { obligation } = initial
        ? await updateObligation(tenantId, initial.id, register)
        : await createObligation(tenantId, {
          ...register, next_due_at: form.next_due_at, cadence: form.cadence, description: form.description || null,
        })
      onSaved(obligation)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the obligation.')
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
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}><TermTooltip term="compliance obligation">Obligation</TermTooltip></span>
          <input className={INPUT} value={form.title} onChange={e => set('title', e.target.value)}
            placeholder="e.g. Stormwater discharge monitoring reports" />
          {fieldError('title')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Source</span>
          <select className={INPUT} value={form.source_kind} onChange={e => set('source_kind', e.target.value)}>
            {OBLIGATION_SOURCE_KINDS.map(kind => <option key={kind} value={kind}>{SOURCE_LABEL[kind]}</option>)}
          </select>
          {fieldError('source_kind')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Citation (optional)</span>
          <input className={INPUT} value={form.regulatory_ref} onChange={e => set('regulatory_ref', e.target.value)}
            placeholder="e.g. 40 CFR 122.26 or the permit number" />
          {fieldError('regulatory_ref')}
        </label>
        <div className={LABEL}>
          <span className={LABEL_TEXT}>Jurisdiction</span>
          <div className="flex gap-2">
            <select className={INPUT} aria-label="Jurisdiction level" value={form.level}
              onChange={e => set('level', e.target.value as Level)}>
              <option value="federal">Federal</option>
              <option value="state">State</option>
              <option value="local">Local</option>
            </select>
            {form.level !== 'federal' && (
              <input className={INPUT} aria-label={form.level === 'state' ? 'State code' : 'Local authority'}
                value={form.jurisdiction_detail} onChange={e => set('jurisdiction_detail', e.target.value)}
                placeholder={form.level === 'state' ? 'TX' : 'e.g. City of Northfield'}
                maxLength={form.level === 'state' ? 2 : 120} />
            )}
          </div>
          {fieldError('jurisdiction')}
        </div>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Evaluate compliance every (days)</span>
          <input className={INPUT} inputMode="numeric" value={form.evaluation_cadence_days}
            onChange={e => set('evaluation_cadence_days', e.target.value)} placeholder="Blank: never scheduled" />
          {fieldError('evaluation_cadence_days')}
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}>Why it applies (optional)</span>
          <textarea className={INPUT} rows={2} value={form.applicability_rationale}
            onChange={e => set('applicability_rationale', e.target.value)}
            placeholder="e.g. Industrial activity in SIC 3462 discharges stormwater to a municipal system" />
          {fieldError('applicability_rationale')}
        </label>
        {!initial && (
          <>
            <label className={LABEL}>
              <span className={LABEL_TEXT}>Next deadline</span>
              <input type="date" className={INPUT} value={form.next_due_at} onChange={e => set('next_due_at', e.target.value)} />
              {fieldError('next_due_at')}
            </label>
            <label className={LABEL}>
              <span className={LABEL_TEXT}>Deadline repeats</span>
              <select className={INPUT} value={form.cadence} onChange={e => set('cadence', e.target.value)}>
                {OBLIGATION_CADENCES.filter(c => c !== 'custom_days').map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </>
        )}
      </div>
      {error && fieldErrors.length === 0 && <p className={FIELD_ERROR} role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add to register'}
        </button>
      </div>
    </form>
  )
}
