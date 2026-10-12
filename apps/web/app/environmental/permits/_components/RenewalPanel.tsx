'use client'

import { useState } from 'react'
import {
  EmsApiError,
  recordRenewalSubmitted,
  recordRenewedTerm,
  type FieldError,
  type PermitRow,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor, generalError } from '../../_components/formStyles'

// The two things that happen to a permit's term. "Submitted" says the renewal
// application went in, which stops the countdown and its notices. "Renewed"
// says the agency issued the new term: the dates on the record move forward and
// the submission is cleared. The old term is not kept as a record of its own,
// so file the renewed permit under Documents, and the audit log shows the change.

type Mode = 'submitted' | 'renewed' | null

export function RenewalPanel({ tenantId, permit, onChanged }: { tenantId: string; permit: PermitRow; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>(null)
  const submitted = permit.renewal_submitted_on !== null

  return (
    <section className="space-y-3" aria-label="Renewal">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Renewal</h3>
      {submitted && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          The renewal application was submitted on {permit.renewal_submitted_on}; the countdown has stopped.
          Record the new term when the agency issues it.
        </p>
      )}
      {mode === null && (
        <div className="flex flex-wrap gap-2">
          {!submitted && <button type="button" className={BUTTON_SECONDARY} onClick={() => setMode('submitted')}>Record renewal application submitted</button>}
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setMode('renewed')}>Record the renewed term</button>
        </div>
      )}
      {mode === 'submitted' && <SubmittedForm tenantId={tenantId} permit={permit} onDone={() => { setMode(null); onChanged() }} onCancel={() => setMode(null)} />}
      {mode === 'renewed' && <RenewedForm tenantId={tenantId} permit={permit} onDone={() => { setMode(null); onChanged() }} onCancel={() => setMode(null)} />}
    </section>
  )
}

function useSave(run: () => Promise<unknown>, onDone: () => void, fallback: string) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setFieldErrors([])
    try { await run(); onDone() }
    catch (err) {
      setError(err instanceof Error ? err.message : fallback)
      if (err instanceof EmsApiError) setFieldErrors(err.fieldErrors)
    } finally { setSaving(false) }
  }
  return { saving, error, fieldErrors, submit }
}

function SubmittedForm({ tenantId, permit, onDone, onCancel }: {
  tenantId: string; permit: PermitRow; onDone: () => void; onCancel: () => void
}) {
  const [date, setDate] = useState('')
  const { saving, error, fieldErrors, submit } = useSave(
    () => recordRenewalSubmitted(tenantId, permit.id, date), onDone, 'Could not record the submission.')
  const general = generalError(error, fieldErrors, ['submittedOn'])
  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700" noValidate>
      <label className={LABEL}>
        <span className={LABEL_TEXT}>Date the renewal application was submitted</span>
        <input type="date" className={INPUT} value={date} onChange={e => setDate(e.target.value)} />
        {errorFor(fieldErrors, 'submittedOn') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'submittedOn')}</p>}
      </label>
      {general && <p className={FIELD_ERROR} role="alert">{general}</p>}
      <div className="flex gap-2">
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving || date === ''}>{saving ? 'Saving…' : 'Record submission'}</button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function RenewedForm({ tenantId, permit, onDone, onCancel }: {
  tenantId: string; permit: PermitRow; onDone: () => void; onCancel: () => void
}) {
  const [form, setForm] = useState({ issued_on: '', expires_on: '', renewal_application_due_on: '', permit_number: permit.permit_number ?? '' })
  // A blank expiry would mean "no fixed term" and silence every countdown, so that is said, not assumed.
  const [noFixedTerm, setNoFixedTerm] = useState(false)
  const set = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }))
  const { saving, error, fieldErrors, submit } = useSave(() => recordRenewedTerm(tenantId, permit.id, {
    issued_on: form.issued_on,
    expires_on: noFixedTerm ? null : form.expires_on || null,
    renewal_application_due_on: form.renewal_application_due_on || null,
    permit_number: form.permit_number || null,
  }), onDone, 'Could not record the renewal.')
  const general = generalError(error, fieldErrors, ['issuedOn', 'expiresOn', 'renewalApplicationDueOn', 'permitNumber'])
  const fieldError = (field: string) => errorFor(fieldErrors, field) ? <p className={FIELD_ERROR}>{errorFor(fieldErrors, field)}</p> : null
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700" noValidate>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        Enter the new term as the agency issued it. The submission date is cleared and the countdown starts again from the new dates.
        The current term is issued {permit.issued_on ?? 'on no recorded date'} and {permit.expires_on ? `expires ${permit.expires_on}` : 'has no recorded expiry'}.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Issued on</span>
          <input type="date" className={INPUT} value={form.issued_on} onChange={e => set('issued_on', e.target.value)} />
          {fieldError('issuedOn')}
        </label>
        <div>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Expires on</span>
            <input type="date" className={INPUT} value={form.expires_on} disabled={noFixedTerm} onChange={e => set('expires_on', e.target.value)} />
          </label>
          {fieldError('expiresOn')}
          <label className="mt-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={noFixedTerm} onChange={e => setNoFixedTerm(e.target.checked)} />
            The renewed permit has no fixed term
          </label>
        </div>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Next renewal application due</span>
          <input type="date" className={INPUT} value={form.renewal_application_due_on}
            onChange={e => set('renewal_application_due_on', e.target.value)} />
          {fieldError('renewalApplicationDueOn')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Number (if it changed)</span>
          <input className={INPUT} value={form.permit_number} onChange={e => set('permit_number', e.target.value)} />
          {fieldError('permitNumber')}
        </label>
      </div>
      {general && <p className={FIELD_ERROR} role="alert">{general}</p>}
      <div className="flex gap-2">
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving || form.issued_on === '' || (!noFixedTerm && form.expires_on === '')}>{saving ? 'Saving…' : 'Record renewed term'}</button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
