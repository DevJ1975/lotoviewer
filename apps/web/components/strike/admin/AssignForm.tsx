'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import {
  STRIKE_RECURRENCE_FREQS,
  STRIKE_RECURRENCE_LABELS,
  serializeRecurrenceRule,
  type StrikeRecurrenceFreq,
} from '@soteria/core/strikeSchedule'
import type { ComplianceMember } from '@soteria/core/strikeCompliance'
import { supabase } from '@/lib/supabase'
import type { AdminModule } from './useStrikeAdminData'

type TargetType = 'tenant' | 'department' | 'site' | 'role' | 'user'

const TARGET_LABELS: Record<TargetType, string> = {
  tenant: 'Everyone',
  department: 'A department',
  site: 'A site',
  role: 'An app role',
  user: 'One person',
}

interface AssignFormProps {
  tenantId: string
  userId: string | null
  module: AdminModule
  members: ComplianceMember[]
  onDone: () => void
  onCancel: () => void
}

const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900'
const label = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'

export function AssignForm({ tenantId, userId, module, members, onDone, onCancel }: AssignFormProps) {
  const [targetType, setTargetType] = useState<TargetType>('tenant')
  const [targetId, setTargetId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [repeat, setRepeat] = useState<'none' | StrikeRecurrenceFreq>('none')
  const [intervalDays, setIntervalDays] = useState(30)
  const [expiryDays, setExpiryDays] = useState(14)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const departments = useMemo(() => uniqueLabels(members.map(m => m.department)), [members])
  const sites = useMemo(() => uniqueLabels(members.map(m => m.site)), [members])
  const accountHolders = useMemo(() => members.filter(m => m.profileId), [members])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (targetType !== 'tenant' && !targetId) { setError('Choose who this is for.'); return }
    if (repeat !== 'none' && !dueAt) { setError('A repeating assignment needs a first due date.'); return }
    setBusy(true)
    setError(null)
    const recurrence = repeat === 'none' ? null : serializeRecurrenceRule({
      freq: repeat,
      intervalDays: repeat === 'interval' ? intervalDays : null,
      expiryDays: expiryDays > 0 ? expiryDays : null,
    })
    const { error: insertError } = await supabase.from('strike_assignments').insert({
      tenant_id: tenantId,
      module_id: module.id,
      module_version_id: null,
      target_type: targetType,
      target_id: targetType === 'tenant' ? null : targetId,
      assigned_by: userId,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      recurrence_rule: recurrence,
      trigger_kind: repeat === 'none' ? 'manual' : 'schedule',
      reason: reason.trim() || null,
    })
    setBusy(false)
    if (insertError) { setError(insertError.message); return }
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">Assign <strong>{module.title}</strong></p>
      <label className={label}>
        Who
        <select value={targetType} onChange={e => { setTargetType(e.target.value as TargetType); setTargetId('') }} className={field}>
          {(Object.keys(TARGET_LABELS) as TargetType[]).map(t => <option key={t} value={t}>{TARGET_LABELS[t]}</option>)}
        </select>
      </label>
      {targetType === 'department' && <LabelSelect value={targetId} onChange={setTargetId} options={departments} empty="No departments on the roster yet" />}
      {targetType === 'site' && <LabelSelect value={targetId} onChange={setTargetId} options={sites} empty="No sites on the roster yet" />}
      {targetType === 'role' && (
        <select value={targetId} onChange={e => setTargetId(e.target.value)} className={field} aria-label="Role">
          <option value="">Choose a role</option>
          {['member', 'viewer', 'admin', 'owner'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      )}
      {targetType === 'user' && (
        <>
          <select value={targetId} onChange={e => setTargetId(e.target.value)} className={field} aria-label="Person">
            <option value="">Choose a person</option>
            {accountHolders.map(m => <option key={m.id} value={m.profileId as string}>{m.displayName}</option>)}
          </select>
          <p className="text-xs text-slate-500">Workers without a login train through Train now on a permit, or a department/site assignment.</p>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Release on
          <input type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} className={field} />
        </label>
        <label className={label}>
          Due
          <input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} className={field} />
        </label>
      </div>

      <label className={label}>
        Repeat
        <select value={repeat} onChange={e => setRepeat(e.target.value as typeof repeat)} className={field}>
          <option value="none">Once</option>
          {STRIKE_RECURRENCE_FREQS.map(f => <option key={f} value={f}>{STRIKE_RECURRENCE_LABELS[f]}</option>)}
        </select>
      </label>
      {repeat === 'interval' && (
        <label className={label}>
          Every how many days
          <input type="number" min={1} value={intervalDays} onChange={e => setIntervalDays(Math.max(1, Number(e.target.value)))} className={field} />
        </label>
      )}
      {repeat !== 'none' && (
        <label className={label}>
          Window to complete after each due date (days)
          <input type="number" min={0} value={expiryDays} onChange={e => setExpiryDays(Math.max(0, Number(e.target.value)))} className={field} />
        </label>
      )}

      <label className={label}>
        Reason (shown to learners)
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Annual LOTO refresher" className={field} />
      </label>

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600">Cancel</button>
        <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Assign
        </button>
      </div>
    </form>
  )
}

function LabelSelect({ value, onChange, options, empty }: { value: string; onChange: (v: string) => void; options: string[]; empty: string }) {
  if (options.length === 0) return <p className="text-xs text-slate-500">{empty}</p>
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={field} aria-label="Target">
      <option value="">Choose…</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function uniqueLabels(values: (string | null)[]): string[] {
  const byKey = new Map<string, string>()
  for (const v of values) {
    const trimmed = v?.trim()
    if (trimmed && !byKey.has(trimmed.toLowerCase())) byKey.set(trimmed.toLowerCase(), trimmed)
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}
