'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { CONTEXT_ISSUE_EFFECTS, CONTEXT_ISSUE_KINDS, type ContextIssueKind } from '@soteria/core/managementSystem'
import {
  EmsApiError,
  createContextIssue,
  listContextIssues,
  reviewContextIssue,
  updateContextIssue,
  type ContextIssueRow,
  type FieldError,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor } from '../../_components/formStyles'
import { ReasonPrompt } from '../../_components/ReasonPrompt'

// Clause 4.1: the internal and external issues that shape the EMS, and,
// since Amendment 1:2024, whether climate change is one of them. Each issue
// is a risk, an opportunity or both (clause 6.1.1 picks them up from here).

const KIND_LABEL: Record<ContextIssueKind, string> = { internal: 'Internal', external: 'External', climate: 'Climate change' }
const KIND_HINT: Record<ContextIssueKind, string> = {
  internal: 'Inside the organization: culture, capability, equipment, finances.',
  external: 'Outside it: regulation, markets, neighbours, the local environment.',
  climate:  'Whether climate change is relevant, and how: heat, flooding, water, carbon pricing.',
}

export function IssuesTab({ tenantId, canEdit, onChanged }: { tenantId: string; canEdit: boolean; onChanged: () => void }) {
  const [issues, setIssues] = useState<ContextIssueRow[] | null>(null)
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<ContextIssueRow | 'new' | null>(null)
  const [retiring, setRetiring] = useState<ContextIssueRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setIssues((await listContextIssues(tenantId, showRetired ? 'all' : 'active')).issues) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load the context register.') }
  }, [tenantId, showRetired])

  useEffect(() => { void load() }, [load])

  const changed = async () => {
    setEditing(null)
    setRetiring(null)
    await load()
    onChanged()
  }

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try { await action(); await changed() }
    catch (err) { setError(err instanceof Error ? err.message : 'That did not work.') }
  }

  const today = new Date().toISOString().slice(0, 10)
  const climateRecorded = (issues ?? []).some(i => i.kind === 'climate' && !i.retired_at)

  return (
    <div className="space-y-4">
      {issues && !climateRecorded && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          ISO 14001 Amendment 1:2024 asks every organization to decide whether climate change is a relevant issue.
          Record that decision as a climate-change issue, even when the answer is &ldquo;not significant here&rdquo;.
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} /> Show retired
        </label>
        {canEdit && <button type="button" className={BUTTON_PRIMARY} onClick={() => setEditing('new')}>Record an issue</button>}
      </div>
      {editing && (
        <IssueForm tenantId={tenantId} initial={editing === 'new' ? null : editing}
          onSaved={() => void changed()} onCancel={() => setEditing(null)} />
      )}
      {retiring && (
        <ReasonPrompt explanation="A retired issue leaves the active register but stays in its history. Say why it no longer applies."
          label="Why the issue is retired" placeholder="e.g. Permit requirement withdrawn by the state" confirmLabel="Retire issue"
          onSubmit={async reason => { await updateContextIssue(tenantId, retiring.id, { retired_reason: reason }); await changed() }}
          onCancel={() => setRetiring(null)} />
      )}
      {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
      {issues === null ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : issues.length === 0 ? (
        <p className="py-6 text-center text-sm italic text-slate-500">No issues recorded yet.</p>
      ) : (
        CONTEXT_ISSUE_KINDS.map(kind => {
          const ofKind = issues.filter(i => i.kind === kind)
          if (ofKind.length === 0) return null
          return (
            <section key={kind} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{KIND_LABEL[kind]}</h3>
              <ul className="space-y-2">
                {ofKind.map(issue => (
                  <li key={issue.id} className={`rounded-lg border border-slate-100 p-3 text-sm dark:border-slate-800 ${issue.retired_at ? 'opacity-60' : ''}`}>
                    <p className="text-slate-900 dark:text-slate-100">{issue.description}</p>
                    {issue.relevance && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{issue.relevance}</p>}
                    <p className="mt-1 text-[11px] text-slate-500">
                      {issue.effect ? `${issue.effect === 'both' ? 'Risk and opportunity' : issue.effect === 'risk' ? 'Risk' : 'Opportunity'} · ` : ''}
                      Next review <span className={issue.next_review_due < today ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>{issue.next_review_due}</span>
                      {issue.retired_at && ` · Retired: ${issue.retired_reason}`}
                    </p>
                    {canEdit && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {issue.retired_at ? (
                          <button type="button" className={BUTTON_SECONDARY}
                            onClick={() => void run(() => updateContextIssue(tenantId, issue.id, { retired_reason: null }))}>
                            Reinstate
                          </button>
                        ) : (
                          <>
                            <button type="button" className={BUTTON_SECONDARY}
                              onClick={() => void run(() => reviewContextIssue(tenantId, issue.id))}>Mark reviewed</button>
                            <button type="button" className={BUTTON_SECONDARY} onClick={() => setEditing(issue)}>Edit</button>
                            <button type="button" className={BUTTON_SECONDARY} onClick={() => setRetiring(issue)}>Retire</button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}

function IssueForm({ tenantId, initial, onSaved, onCancel }: {
  tenantId: string; initial: ContextIssueRow | null; onSaved: () => void; onCancel: () => void
}) {
  const [kind, setKind] = useState<ContextIssueKind>(initial?.kind ?? 'external')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [relevance, setRelevance] = useState(initial?.relevance ?? '')
  const [effect, setEffect] = useState(initial?.effect ?? '')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setFieldErrors([])
    const body = { kind, description, relevance: relevance || null, effect: (effect || null) as ContextIssueRow['effect'] }
    try {
      if (initial) await updateContextIssue(tenantId, initial.id, body)
      else await createContextIssue(tenantId, body)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the issue.')
      if (err instanceof EmsApiError) setFieldErrors(err.fieldErrors)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Kind of issue</span>
          <select className={INPUT} value={kind} onChange={e => setKind(e.target.value as ContextIssueKind)}>
            {CONTEXT_ISSUE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <span className="mt-1 block text-[11px] text-slate-500">{KIND_HINT[kind]}</span>
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Risk or opportunity (optional)</span>
          <select className={INPUT} value={effect} onChange={e => setEffect(e.target.value)}>
            <option value="">Not decided</option>
            {CONTEXT_ISSUE_EFFECTS.map(value => (
              <option key={value} value={value}>{value === 'both' ? 'Both' : value === 'risk' ? 'Risk' : 'Opportunity'}</option>
            ))}
          </select>
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}>The issue</span>
          <textarea className={INPUT} rows={2} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Hotter summers raise cooling-water demand at the finishing line" />
          {errorFor(fieldErrors, 'description') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'description')}</p>}
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          <span className={LABEL_TEXT}>Why it matters to the EMS (optional)</span>
          <textarea className={INPUT} rows={2} value={relevance} onChange={e => setRelevance(e.target.value)} />
        </label>
      </div>
      {error && fieldErrors.length === 0 && <p className={FIELD_ERROR} role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Record issue'}</button>
      </div>
    </form>
  )
}
