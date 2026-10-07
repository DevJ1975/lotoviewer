import { useState, type ReactNode } from 'react'
import { Ban, Pencil, RotateCcw } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { StatusChip } from '@/components/environmental/badges'
import {
  ApiError, completeDeadline, errorList, updateDeadline, type Deadline, type Scope,
} from '@/lib/environmental/client'
import {
  bucketOf, BUCKET_LABELS, cadenceLabel, completionMessage, formatDate, formatLocalDate, ownerLabel, relativeDueText, siteLabel,
} from '@/lib/environmental/calendarView'
import { commonBody, DeadlineFields, draftFrom, type DeadlineDraft } from './DeadlineFields'
import { BUCKET_ICON, BUCKET_TONE, DeadlineChips, QuickActions, type ViewContext } from './shared'

// One deadline in a dialog: what it is, and the things a person can do to it.
// Completing and editing are modes of the same dialog so focus stays in one place.

type Mode = 'detail' | 'complete' | 'edit'

interface Props {
  deadline:    Deadline
  initialMode: 'detail' | 'complete'
  scope:       Scope
  ctx:         ViewContext
  onClose:     () => void
  /** A change went through: the screen reloads and tells the person what happened. */
  onSaved:     (message: string) => void
  /** The deadline moved since the list was loaded, so nothing was changed. */
  onStale:     () => void
}

export function DeadlineDialog({ deadline, initialMode, scope, ctx, onClose, onSaved, onStale }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const submit = async (action: () => Promise<string>) => {
    setBusy(true); setErrors([])
    try {
      onSaved(await action())
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale') onStale()
      else setErrors(errorList(e))
    } finally {
      setBusy(false)
    }
  }

  const goTo = (next: Mode) => { setErrors([]); setMode(next) }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? `Edit: ${deadline.title}` : deadline.title}</DialogTitle>
        </DialogHeader>

        {mode === 'detail' && (
          <Detail
            deadline={deadline}
            ctx={ctx}
            busy={busy}
            onComplete={() => goTo('complete')}
            onEdit={() => goTo('edit')}
            onSetStatus={status => submit(async () => {
              await updateDeadline(scope, deadline.id, { status })
              return `${deadline.title}: ${status === 'dismissed' ? 'dismissed' : 'reopened'}.`
            })}
          />
        )}
        {mode === 'complete' && (
          <CompleteForm
            deadline={deadline}
            busy={busy}
            onBack={() => goTo('detail')}
            onSubmit={note => submit(async () => {
              const { obligation } = await completeDeadline(scope, deadline.id, { occurrence_at: deadline.next_due_at, ...(note ? { note } : {}) })
              return completionMessage(obligation)
            })}
          />
        )}
        {mode === 'edit' && (
          <EditForm
            deadline={deadline}
            scope={scope}
            ctx={ctx}
            busy={busy}
            onBack={() => goTo('detail')}
            onSubmit={draft => submit(async () => {
              const { obligation } = await updateDeadline(scope, deadline.id, commonBody(draft))
              return `${obligation.title}: saved.`
            })}
          />
        )}

        <ErrorList errors={errors} />
      </DialogContent>
    </Dialog>
  )
}

// ── what it is ──────────────────────────────────────────────────────────────

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">{children}</dd>
    </div>
  )
}

interface DetailProps {
  deadline:    Deadline
  ctx:         ViewContext
  busy:        boolean
  onComplete:  () => void
  onEdit:      () => void
  onSetStatus: (status: 'open' | 'dismissed') => void
}

function Detail({ deadline, ctx, busy, onComplete, onEdit, onSetStatus }: DetailProps) {
  const bucket = bucketOf(deadline, ctx.now)
  const Icon = BUCKET_ICON[bucket]
  const isOpen = deadline.status === 'open'
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1">
        <StatusChip tone={BUCKET_TONE[bucket]}><Icon aria-hidden="true" className="h-3 w-3" />{BUCKET_LABELS[bucket]}</StatusChip>
        <DeadlineChips deadline={deadline} />
      </div>

      {deadline.description && <p className="text-sm text-slate-700 dark:text-slate-300">{deadline.description}</p>}

      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label="Due">
          {formatDate(deadline.next_due_at)}{isOpen && ` (${relativeDueText(deadline.next_due_at, ctx.now)})`}
        </Fact>
        <Fact label="Repeats">{cadenceLabel(deadline.cadence, deadline.cadence_days)}</Fact>
        <Fact label="Reminders">{deadline.lead_days} days before it is due</Fact>
        <Fact label="Owner">{ownerLabel(deadline.owner_user_id, ctx.ownerNames)}</Fact>
        {ctx.showSite && <Fact label="Site">{siteLabel(deadline.facility_id, ctx.siteNames)}</Fact>}
        {deadline.regulatory_ref && <Fact label="Regulatory reference">{deadline.regulatory_ref}</Fact>}
        {deadline.last_completed_at && <Fact label="Last completed">{formatLocalDate(deadline.last_completed_at)}</Fact>}
      </dl>

      <DialogFooter className="sm:justify-start">
        <QuickActions deadline={deadline} ctx={ctx} onComplete={onComplete} />
        {ctx.actor.canAdmin && (
          <>
            <button type="button" onClick={onEdit} disabled={busy} className={secondaryButtonCls}><Pencil className="h-4 w-4" /> Edit</button>
            {isOpen
              ? <button type="button" onClick={() => onSetStatus('dismissed')} disabled={busy} className={secondaryButtonCls}><Ban className="h-4 w-4" /> Dismiss</button>
              : <button type="button" onClick={() => onSetStatus('open')} disabled={busy} className={secondaryButtonCls}><RotateCcw className="h-4 w-4" /> Reopen</button>}
          </>
        )}
      </DialogFooter>
    </div>
  )
}

// ── complete it ─────────────────────────────────────────────────────────────

function CompleteForm({ deadline, busy, onBack, onSubmit }: { deadline: Deadline; busy: boolean; onBack: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('')
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(note.trim()) }} className="space-y-4">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Mark the deadline due {formatDate(deadline.next_due_at)} as done.
        {deadline.cadence !== 'once' && ' The next one is scheduled automatically.'}
      </p>
      <Field label="Note (optional)" hint="What was done, or where the record is kept.">
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={2000} className={inputCls} />
      </Field>
      <DialogFooter>
        <button type="button" onClick={onBack} disabled={busy} className={secondaryButtonCls}>Back</button>
        <button type="submit" disabled={busy} className={primaryButtonCls}>Mark complete</button>
      </DialogFooter>
    </form>
  )
}

// ── change it ───────────────────────────────────────────────────────────────

interface EditProps {
  deadline: Deadline
  scope:    Scope
  ctx:      ViewContext
  busy:     boolean
  onBack:   () => void
  onSubmit: (draft: DeadlineDraft) => void
}

function EditForm({ deadline, scope, ctx, busy, onBack, onSubmit }: EditProps) {
  const [draft, setDraft] = useState(() => draftFrom(deadline))
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(draft) }} className="space-y-4">
      <DeadlineFields draft={draft} onChange={patch => setDraft(d => ({ ...d, ...patch }))} scope={scope} ctx={ctx} dueLabel="Due date" />
      <DialogFooter>
        <button type="button" onClick={onBack} disabled={busy} className={secondaryButtonCls}>Cancel</button>
        <button type="submit" disabled={busy} className={primaryButtonCls}>Save changes</button>
      </DialogFooter>
    </form>
  )
}
