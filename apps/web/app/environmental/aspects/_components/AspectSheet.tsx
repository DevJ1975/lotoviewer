'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  ASPECT_OPERATING_CONDITIONS,
  scoreAspect as scoreUnderMethod,
  type AspectOperatingCondition,
} from '@soteria/core/environmentalAspect'
import { DEFAULT_SCORING_METHOD } from '@soteria/core/scoringMethod'
import { Sheet } from '@/components/ui/sheet'
import {
  EmsApiError,
  getAspect,
  listObligations,
  obsoleteAspect,
  reviewAspect,
  scoreAspect,
  setAspectObligations,
  type AspectRow,
  type FieldError,
  type ObligationRow,
  type ScoreHistoryRow,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR, INPUT, LABEL, LABEL_TEXT, errorFor, generalError } from '../../_components/formStyles'
import { ReasonPrompt } from '../../_components/ReasonPrompt'
import { TermTooltip } from '../../_components/TermTooltip'
import { AspectForm } from './AspectForm'
import { ConditionChips } from './ConditionChips'

// One aspect: what it is, how each operating condition scored over time,
// which compliance obligations it is subject to, and the register actions
// (score a condition, review, edit, retire). Members see it read-only.

const SCALE = [1, 2, 3, 4, 5] as const

interface Props {
  tenantId:     string
  aspectId:     string | null
  canEdit:      boolean
  processAreas: readonly string[]
  onChanged:    () => void
  onClose:      () => void
}

export function AspectSheet({ tenantId, aspectId, canEdit, processAreas, onChanged, onClose }: Props) {
  const [aspect, setAspect] = useState<AspectRow | null>(null)
  const [history, setHistory] = useState<ScoreHistoryRow[]>([])
  const [linkedIds, setLinkedIds] = useState<string[]>([])
  const [obligations, setObligations] = useState<ObligationRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'edit' | 'links' | 'obsolete'>('view')

  // A slow answer for an aspect the user has since moved away from must not
  // replace the one now open: only the newest request's answer is shown.
  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    if (!aspectId) return
    const request = ++latestRequest.current
    setLoadError(null)
    try {
      const [detail, register] = await Promise.all([
        getAspect(tenantId, aspectId),
        listObligations(tenantId, { status: 'all' }),
      ])
      if (request !== latestRequest.current) return
      setAspect(detail.aspect)
      setHistory(detail.history)
      setLinkedIds(detail.obligationIds)
      setObligations(register.obligations)
    } catch (err) {
      if (request === latestRequest.current) setLoadError(err instanceof Error ? err.message : 'Could not load the aspect.')
    }
  }, [tenantId, aspectId])

  useEffect(() => {
    setAspect(null)
    setMode('view')
    void load()
  }, [load])

  const changed = async () => {
    setMode('view')
    await load()
    onChanged()
  }

  const titleOf = (id: string) => obligations.find(o => o.id === id)?.title ?? 'An obligation outside the environmental register'
  const writable = canEdit && aspect !== null && aspect.obsolete_at === null

  return (
    <Sheet open={aspectId !== null} onClose={onClose}
      title={aspect ? aspect.activity : 'Aspect'}
      subtitle={aspect ? `${aspect.aspect} → ${aspect.impact}` : undefined}>
      {loadError && <p className={FIELD_ERROR} role="alert">{loadError}</p>}
      {!aspect && !loadError && (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      )}
      {aspect && mode === 'edit' && (
        <AspectForm tenantId={tenantId} initial={aspect} processAreas={processAreas}
          onSaved={() => void changed()} onCancel={() => setMode('view')} />
      )}
      {aspect && mode !== 'edit' && (
        <div className="space-y-6 text-sm">
          <section className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-300">
            <Fact label="Process area" value={aspect.process_area ?? '—'} />
            <Fact label="Life-cycle stage" value={aspect.life_cycle_stage.replace(/_/g, ' ')} />
            <Fact label="Flow" value={aspect.flow ?? '—'} />
            <Fact label="Control status" value={aspect.status} />
            <Fact label="Controls" value={aspect.controls ?? 'None recorded'} wide />
            {aspect.source_reference && <Fact label="Source" value={aspect.source_reference} />}
            <Fact label="Last reviewed" value={aspect.last_reviewed_at?.slice(0, 10) ?? 'Never'} />
            <Fact label="Next review due" value={aspect.next_review_due} />
            {aspect.obsolete_at && (
              <Fact label="Obsolete" value={`${aspect.obsolete_at.slice(0, 10)}: ${aspect.obsolete_reason}`} wide />
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              <TermTooltip term="operating condition">Operating conditions</TermTooltip>
            </h3>
            <ConditionChips scores={aspect.current_scores} />
            {writable && (
              <ScoreForm tenantId={tenantId} aspectId={aspect.id} onScored={() => void changed()} />
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Scoring history</h3>
            {history.length === 0 ? (
              <p className="text-xs italic text-slate-500">Not scored yet.</p>
            ) : (
              <ul className="space-y-2">
                {history.map(h => (
                  <li key={h.id} className="rounded-lg border border-slate-100 p-2 text-xs dark:border-slate-800">
                    <span className="font-semibold capitalize">{h.operating_condition}</span>
                    {' · '}{h.severity} × {h.likelihood} = <span className="placard-numeric font-semibold">{h.score}</span>
                    {h.significant && <span className="ml-1 font-bold uppercase text-rose-600 dark:text-rose-300">significant</span>}
                    <span className="text-slate-400"> · {h.scored_at.slice(0, 10)} · {h.method_name}</span>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">{h.rationale}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              <TermTooltip term="compliance obligation">Compliance obligations</TermTooltip>
            </h3>
            {mode === 'links' ? (
              <LinkEditor tenantId={tenantId} aspectId={aspect.id} obligations={obligations} linkedIds={linkedIds}
                onSaved={() => void changed()} onCancel={() => setMode('view')} />
            ) : linkedIds.length === 0 ? (
              <p className="text-xs italic text-slate-500">None linked.</p>
            ) : (
              <ul className="list-disc pl-5 text-xs">{linkedIds.map(id => <li key={id}>{titleOf(id)}</li>)}</ul>
            )}
          </section>

          {mode === 'obsolete' && (
            <ReasonPrompt key={aspect.id}
              explanation="An obsolete aspect leaves the active register but keeps its scores and history. Say why it no longer applies."
              label="Why the aspect is obsolete" placeholder="e.g. Degreasing line removed in March" confirmLabel="Mark obsolete"
              onSubmit={async reason => { await obsoleteAspect(tenantId, aspect.id, reason); await changed() }}
              onCancel={() => setMode('view')} />
          )}

          {writable && mode === 'view' && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <ActionButton label="Mark reviewed" run={() => reviewAspect(tenantId, aspect.id)} onDone={() => void changed()} />
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setMode('edit')}>Edit</button>
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setMode('links')}>Link obligations</button>
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setMode('obsolete')}>Mark obsolete</button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <span className="text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  )
}

function ActionButton({ label, run, onDone }: { label: string; run: () => Promise<unknown>; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <span>
      <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={async () => {
        setBusy(true)
        setError(null)
        try { await run(); onDone() }
        catch (err) { setError(err instanceof Error ? err.message : 'That did not work.') }
        finally { setBusy(false) }
      }}>{busy ? 'Working…' : label}</button>
      {error && <span className={FIELD_ERROR} role="alert">{error}</span>}
    </span>
  )
}

function ScoreForm({ tenantId, aspectId, onScored }: { tenantId: string; aspectId: string; onScored: () => void }) {
  const [condition, setCondition] = useState<AspectOperatingCondition>('normal')
  const [severity, setSeverity] = useState(1)
  const [likelihood, setLikelihood] = useState(1)
  const [rationale, setRationale] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [error, setError] = useState<string | null>(null)
  // Phase 1 has no method editor: every tenant scores under the default rule.
  const preview = scoreUnderMethod(severity, likelihood, DEFAULT_SCORING_METHOD)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setFieldErrors([])
    try {
      await scoreAspect(tenantId, aspectId, { operating_condition: condition, severity, likelihood, rationale })
      setRationale('')
      onScored()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the score.')
      if (err instanceof EmsApiError) setFieldErrors(err.fieldErrors)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-100 p-3 dark:border-slate-800" noValidate>
      <div className="grid grid-cols-3 gap-2">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Condition</span>
          <select className={INPUT} value={condition} onChange={e => setCondition(e.target.value as AspectOperatingCondition)}>
            {ASPECT_OPERATING_CONDITIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Severity</span>
          <select className={INPUT} value={severity} onChange={e => setSeverity(Number(e.target.value))}>
            {SCALE.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Likelihood</span>
          <select className={INPUT} value={likelihood} onChange={e => setLikelihood(Number(e.target.value))}>
            {SCALE.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <label className={LABEL}>
        <span className={LABEL_TEXT}>Why this score</span>
        <textarea className={INPUT} rows={2} value={rationale} onChange={e => setRationale(e.target.value)}
          placeholder="What you saw, and what would happen" />
        {errorFor(fieldErrors, 'rationale') && <p className={FIELD_ERROR}>{errorFor(fieldErrors, 'rationale')}</p>}
      </label>
      {generalError(error, fieldErrors, ['rationale']) && <p className={FIELD_ERROR} role="alert">{generalError(error, fieldErrors, ['rationale'])}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          Score {preview.score}{preview.significant ? ', significant' : ''} under the default rule (5 × 5, significant at 12)
        </span>
        <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>{saving ? 'Saving…' : 'Add score'}</button>
      </div>
    </form>
  )
}

function LinkEditor({ tenantId, aspectId, obligations, linkedIds, onSaved, onCancel }: {
  tenantId: string; aspectId: string; obligations: readonly ObligationRow[]; linkedIds: readonly string[]
  onSaved: () => void; onCancel: () => void
}) {
  const [chosen, setChosen] = useState(new Set(linkedIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = (id: string) => setChosen(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return (
    <div className="space-y-2">
      {obligations.length === 0 ? (
        <p className="text-xs italic text-slate-500">The obligations register is empty.</p>
      ) : (
        <ul className="max-h-60 space-y-1 overflow-y-auto">
          {obligations.map(o => (
            <li key={o.id}>
              <label className="inline-flex items-center gap-2 text-xs">
                <input type="checkbox" checked={chosen.has(o.id)} onChange={() => toggle(o.id)} />
                {o.title}
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p className={FIELD_ERROR} role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className={BUTTON_PRIMARY} disabled={saving} onClick={async () => {
          setSaving(true)
          setError(null)
          try { await setAspectObligations(tenantId, aspectId, [...chosen]); onSaved() }
          catch (err) { setError(err instanceof Error ? err.message : 'Could not save the links.') }
          finally { setSaving(false) }
        }}>{saving ? 'Saving…' : 'Save links'}</button>
      </div>
    </div>
  )
}
