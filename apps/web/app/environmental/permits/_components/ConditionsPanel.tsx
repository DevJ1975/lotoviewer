'use client'

import { useCallback, useEffect, useState } from 'react'
import { OBLIGATION_CADENCES } from '@soteria/core/complianceCalendar'
import MemberPicker, { memberName, useTenantMembers, type Member } from '@/app/risk/_components/wizard/MemberPicker'
import { useAuth } from '@/components/AuthProvider'
import {
  EmsApiError,
  addPermitCondition,
  listOccurrences,
  recordOccurrence,
  type EvidenceRow,
  type FieldError,
  type OccurrenceRow,
  type PermitCondition,
} from '@/lib/environmental/client'
import { EvidenceList, EvidenceUpload } from '../../_components/EvidenceUpload'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor, generalError } from '../../_components/formStyles'

// A permit's conditions are obligations linked to it (Phase 2 plan D4), so each
// is also in the compliance register and the calendar. "Mark done" records that
// the condition was done for the deadline shown; the next deadline follows from
// its cadence. Evidence goes on that occurrence, so the file proves that
// instance, not the condition in general.

const CADENCE_LABEL: Record<string, string> = {
  once: 'Once', monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Twice a year', annual: 'Yearly',
  biennial: 'Every 2 years', triennial: 'Every 3 years', quinquennial: 'Every 5 years', custom_days: 'Every N days',
}

export function ConditionsPanel({ tenantId, permitId, retired, conditions, canEdit, onChanged }: {
  tenantId: string; permitId: string; retired: boolean; conditions: readonly PermitCondition[]; canEdit: boolean; onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const { members } = useTenantMembers()
  const today = new Date().toISOString().slice(0, 10)

  return (
    <section className="space-y-3" aria-label="Conditions">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Conditions</h3>
        {canEdit && !retired && !adding && (
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setAdding(true)}>Add a condition</button>
        )}
      </div>
      {adding && (
        <AddConditionForm tenantId={tenantId} permitId={permitId} onCancel={() => setAdding(false)}
          onAdded={() => { setAdding(false); onChanged() }} />
      )}
      {conditions.length === 0 ? (
        <p className="text-xs italic text-slate-500">
          No conditions recorded. A permit&apos;s monitoring, reporting and inspection duties go here, each with a deadline.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {conditions.map(condition => (
            <ConditionItem key={condition.id} tenantId={tenantId} condition={condition} members={members} today={today}
              canEdit={canEdit} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ConditionItem({ tenantId, condition, members, today, canEdit, onChanged }: {
  tenantId: string; condition: PermitCondition; members: Member[] | null; today: string
  canEdit: boolean; onChanged: () => void
}) {
  const { userId } = useAuth()
  const [open, setOpen] = useState(false)
  const owner = condition.owner_user_id && members ? members.find(m => m.user_id === condition.owner_user_id) ?? null : null
  const overdue = condition.status === 'open' && condition.next_due_at < today
  const isOwnerOrAdmin = canEdit || (userId !== null && condition.owner_user_id === userId)
  // A retired permit's conditions stay obligations until dismissed, so they can still be done.
  const mayRecord = condition.status === 'open' && isOwnerOrAdmin

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{condition.title}</p>
          <p className="text-xs text-slate-500">
            {CADENCE_LABEL[condition.cadence] ?? condition.cadence}
            {' · '}{owner ? memberName(owner)
              : condition.owner_user_id ? (members === null ? 'Owner' : 'Owner no longer a member')
              : 'No owner: admins are told'}
          </p>
        </div>
        <div className="text-right text-xs">
          <p className={overdue ? 'font-semibold text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'}>
            {condition.status === 'open' ? `${overdue ? 'Overdue since' : 'Due'} ${condition.next_due_at}`
              : condition.status === 'completed' ? 'Done' : 'Dismissed'}
          </p>
          <button type="button" className="mt-1 text-brand-navy hover:underline dark:text-brand-yellow"
            aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? 'Hide' : mayRecord ? 'Mark done, or see history' : 'See history'}
          </button>
        </div>
      </div>
      {open && (
        <ConditionHistory tenantId={tenantId} condition={condition} mayRecord={mayRecord} mayAttach={isOwnerOrAdmin} canDownloadControlled={canEdit} onChanged={onChanged} />
      )}
    </li>
  )
}

function ConditionHistory({ tenantId, condition, mayRecord, mayAttach, canDownloadControlled, onChanged }: {
  tenantId: string; condition: PermitCondition; mayRecord: boolean; mayAttach: boolean; canDownloadControlled: boolean; onChanged: () => void
}) {
  const [occurrences, setOccurrences] = useState<OccurrenceRow[] | null>(null)
  const [evidence, setEvidence] = useState<EvidenceRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The occurrence just recorded, so its evidence can be attached before moving on. */
  const [justRecorded, setJustRecorded] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await listOccurrences(tenantId, condition.id)
      setOccurrences(result.occurrences)
      setEvidence(result.evidence)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the history.')
    }
  }, [tenantId, condition.id])

  useEffect(() => { void load() }, [load])

  async function markDone() {
    setBusy(true)
    setError(null)
    try {
      const { occurrence } = await recordOccurrence(tenantId, condition.id, condition.next_due_at, note.trim() || null)
      setNote('')
      setJustRecorded(occurrence.id)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950/40">
      {mayRecord && (
        <div className="space-y-2">
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Done for the {condition.next_due_at} deadline: note (optional)</span>
            <input className={INPUT} value={note} onChange={e => setNote(e.target.value)} />
          </label>
          {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
          <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={() => void markDone()}>
            {busy ? 'Recording…' : 'Mark done'}
          </button>
        </div>
      )}
      {loadError && <p className={FIELD_ERROR} role="alert">{loadError}</p>}
      {occurrences !== null && occurrences.length === 0 && <p className="text-xs italic text-slate-500">Not yet done.</p>}
      {occurrences !== null && occurrences.length > 0 && (
        <ul className="space-y-2">
          {occurrences.map(occurrence => {
            const files = evidence.filter(e => e.subject_id === occurrence.id)
            return (
              <li key={occurrence.id} className="space-y-1 text-xs">
                <p>
                  <span className="font-medium">Done for {occurrence.occurrence_at.slice(0, 10)}</span>
                  <span className="text-slate-500"> · recorded {occurrence.completed_at.slice(0, 10)}</span>
                  {occurrence.note && <span className="text-slate-600 dark:text-slate-300"> · {occurrence.note}</span>}
                </p>
                <EvidenceList tenantId={tenantId} evidence={files} canDownloadControlled={canDownloadControlled} />
                {mayAttach && (occurrence.id === justRecorded || files.length === 0) && (
                  <EvidenceUpload tenantId={tenantId} subjectType="compliance_calendar_event" subjectId={occurrence.id}
                    current={files.filter(f => !f.superseded_by)} onUploaded={() => void load()} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function AddConditionForm({ tenantId, permitId, onAdded, onCancel }: {
  tenantId: string; permitId: string; onAdded: () => void; onCancel: () => void
}) {
  const [form, setForm] = useState({
    title: '', next_due_at: '', cadence: 'annual', cadence_days: '', owner_user_id: '', description: '',
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
    try {
      await addPermitCondition(tenantId, permitId, {
        title: form.title,
        next_due_at: form.next_due_at,
        cadence: form.cadence,
        cadence_days: form.cadence === 'custom_days' ? Number(form.cadence_days) : null,
        owner_user_id: form.owner_user_id || null,
        description: form.description || null,
      })
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the condition.')
      if (err instanceof EmsApiError) setFieldErrors(err.fieldErrors)
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (field: string) => {
    const message = errorFor(fieldErrors, field)
    return message ? <p className={FIELD_ERROR}>{message}</p> : null
  }
  const general = generalError(error, fieldErrors, ['title', 'nextDueAt', 'cadence', 'cadenceDays'])

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}>Condition</span>
          <input className={INPUT} value={form.title} onChange={e => set('title', e.target.value)}
            placeholder="e.g. Submit the quarterly discharge monitoring report" />
          {fieldError('title')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Next due</span>
          <input type="date" className={INPUT} value={form.next_due_at} onChange={e => set('next_due_at', e.target.value)} />
          {fieldError('nextDueAt')}
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Repeats</span>
          <select className={INPUT} value={form.cadence} onChange={e => set('cadence', e.target.value)}>
            {OBLIGATION_CADENCES.map(c => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
          </select>
          {fieldError('cadence')}
        </label>
        {form.cadence === 'custom_days' && (
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Days between</span>
            <input className={INPUT} inputMode="numeric" value={form.cadence_days} onChange={e => set('cadence_days', e.target.value)} />
            {fieldError('cadenceDays')}
          </label>
        )}
        <div className={LABEL}>
          <span className={LABEL_TEXT}>Owner (optional)</span>
          <MemberPicker value={form.owner_user_id} onChange={value => set('owner_user_id', value)} placeholder="Unassigned" />
        </div>
      </div>
      {general && <p className={FIELD_ERROR} role="alert">{general}</p>}
      <div className="flex gap-2">
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>{saving ? 'Adding…' : 'Add condition'}</button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
