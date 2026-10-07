import { OwnerPicker } from '@/components/environmental/OwnerPicker'
import { Field, inputCls } from '@/components/environmental/form'
import type { Deadline, Scope } from '@/lib/environmental/client'
import { wholeNumberOrNull } from '@/lib/environmental/calendarView'
import { DEFAULT_LEAD_DAYS } from '@soteria/core/environmental/deadlines'
import { ENV_PROGRAMS, ENV_PROGRAM_LABELS } from '@soteria/core/environmental/siteProfile'
import type { ViewContext } from './shared'

// The fields a deadline has whether it is being added or edited. The draft holds
// what is typed, as text; commonBody turns it into the API's request body and
// leaves judging it to the API.

export interface DeadlineDraft {
  title:         string
  description:   string
  regulatoryRef: string
  /** An EnvProgram, or '' for none. */
  program:       string
  dueDate:       string
  leadDays:      string
  ownerUserId:   string | null
}

export const emptyDraft: DeadlineDraft = {
  title: '', description: '', regulatoryRef: '', program: '', dueDate: '', leadDays: String(DEFAULT_LEAD_DAYS), ownerUserId: null,
}

export function draftFrom(deadline: Deadline): DeadlineDraft {
  return {
    title:         deadline.title,
    description:   deadline.description ?? '',
    regulatoryRef: deadline.regulatory_ref ?? '',
    program:       deadline.program ?? '',
    dueDate:       deadline.next_due_at.slice(0, 10),
    leadDays:      String(deadline.lead_days),
    ownerUserId:   deadline.owner_user_id,
  }
}

export function commonBody(draft: DeadlineDraft) {
  return {
    title:          draft.title,
    description:    draft.description || null,
    regulatory_ref: draft.regulatoryRef || null,
    program:        draft.program || null,
    next_due_at:    draft.dueDate,
    lead_days:      wholeNumberOrNull(draft.leadDays),
    owner_user_id:  draft.ownerUserId,
  }
}

interface Props {
  draft:    DeadlineDraft
  onChange: (patch: Partial<DeadlineDraft>) => void
  scope:    Scope
  ctx:      ViewContext
  dueLabel: string
}

export function DeadlineFields({ draft, onChange, scope, ctx, dueLabel }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Title">
          <input value={draft.title} onChange={e => onChange({ title: e.target.value })} required maxLength={200} className={inputCls} />
        </Field>
      </div>
      <Field label="Program">
        <select value={draft.program} onChange={e => onChange({ program: e.target.value })} className={inputCls}>
          <option value="">No specific program</option>
          {ENV_PROGRAMS.map(program => <option key={program} value={program}>{ENV_PROGRAM_LABELS[program]}</option>)}
        </select>
      </Field>
      <Field label={dueLabel}>
        <input type="date" value={draft.dueDate} onChange={e => onChange({ dueDate: e.target.value })} required className={inputCls} />
      </Field>
      <Field label="Reminder window (days)" hint="Reminders start this many days before it is due, 0 to 365.">
        <input type="number" min={0} max={365} step={1} value={draft.leadDays} onChange={e => onChange({ leadDays: e.target.value })} required className={inputCls} />
      </Field>
      <fieldset className="min-w-0 space-y-1">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Owner</legend>
        <OwnerPicker
          scope={scope}
          value={draft.ownerUserId}
          valueLabel={draft.ownerUserId ? ctx.ownerNames.get(draft.ownerUserId) ?? null : null}
          onChange={(userId, name) => {
            onChange({ ownerUserId: userId })
            if (userId && name) ctx.rememberOwner(userId, name)
          }}
        />
      </fieldset>
      <div className="sm:col-span-2">
        <Field label="Regulatory reference" hint="The rule or permit condition this comes from.">
          <input value={draft.regulatoryRef} onChange={e => onChange({ regulatoryRef: e.target.value })} maxLength={300} className={inputCls} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Description">
          <textarea value={draft.description} onChange={e => onChange({ description: e.target.value })} rows={3} maxLength={2000} className={inputCls} />
        </Field>
      </div>
    </div>
  )
}
