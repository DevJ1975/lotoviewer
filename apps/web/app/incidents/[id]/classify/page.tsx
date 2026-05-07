'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, AlertTriangle, Loader2, ShieldCheck, ShieldAlert, FileText, Sparkles } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  decideRecordability,
  type RecordabilityAnswers,
} from '@soteria/core/incidentClassification'
import {
  INJURY_TYPES,
  INJURY_TYPE_LABEL,
  type InjuryType,
} from '@soteria/core/oshaForms'

// /incidents/[id]/classify — OSHA 1904.7 recordability wizard.
//
// The classifier walks through the work-relatedness gate, the
// new-case gate, and then the four outcome questions in OSHA's
// "most serious wins" order. The user fills a checkbox for each
// gate; the live preview at the bottom runs decideRecordability
// against the current answers without persisting. Submitting POSTs
// to /api/incidents/[id]/classify, which persists the snapshot AND
// refreshes the OSHA 300 log row.
//
// Admin only — gated server-side too.

interface EstablishmentOption { id: string; name: string }

const FIELD_HELP: Record<keyof RecordabilityAnswers, string> = {
  is_work_related:                 'Per 1904.5, did the work environment cause or contribute to the case (or significantly aggravate a pre-existing condition)?',
  is_new_case:                     'Per 1904.6, has the worker fully recovered from any prior recordable case of the same type?',
  resulted_in_death:               'Did the case result in the death of an employee?',
  resulted_in_days_away:           'Did the worker miss any calendar days of work because of the case?',
  resulted_in_restricted_duty:     'Was the worker placed on light/modified duty or job transfer because of the case?',
  loss_of_consciousness:           'Did the worker lose consciousness as a result of the event?',
  medical_treatment_beyond_first_aid: 'Did the case require treatment beyond the first-aid list in 1904.7(b)(5)(ii) (sutures, prescription drugs, chiropractic, etc.)?',
  significant_diagnosed_condition: 'Did a physician or other healthcare professional diagnose a significant condition (e.g. cancer, fractured/cracked bone, punctured eardrum)?',
  days_away_count:                 '',
  days_restricted_count:           '',
}

export default function ClassifyPage() {
  const { id } = useParams<{ id: string }>()
  const { tenant } = useTenant()

  const [loading,    setLoading] = useState(true)
  const [error,      setError]   = useState<string | null>(null)
  const [busy,       setBusy]    = useState(false)
  const [forbidden,  setForbidden] = useState(false)
  const [submittedDecision, setSubmittedDecision] = useState<ReturnType<typeof decideRecordability> | null>(null)

  // AI suggestion state — fetched on demand via the Sparkles button.
  const [aiBusy,        setAiBusy]        = useState(false)
  const [aiSuggestion,  setAiSuggestion]  = useState<{
    classification: 'death' | 'days_away' | 'restricted' | 'other_recordable' | null
    confidence:     number
    reasoning:      string
    missing_info:   string[]
  } | null>(null)
  const [aiError,       setAiError]       = useState<string | null>(null)

  // Wizard state — start "no" everywhere; the operator flips them on.
  const [answers, setAnswers] = useState<RecordabilityAnswers>({
    is_work_related:                 false,
    is_new_case:                     true,
    resulted_in_death:               false,
    resulted_in_days_away:           false,
    days_away_count:                 0,
    resulted_in_restricted_duty:     false,
    days_restricted_count:           0,
    loss_of_consciousness:           false,
    medical_treatment_beyond_first_aid: false,
    significant_diagnosed_condition: false,
  })
  const [isPrivacy,  setIsPrivacy]  = useState(false)
  const [injuryType, setInjuryType] = useState<InjuryType>('injury')
  const [estId,      setEstId]      = useState<string>('')
  const [overrideReason, setOverrideReason] = useState('')

  const [establishments, setEstablishments] = useState<EstablishmentOption[]>([])

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      // Load any existing classification snapshot to pre-fill.
      const res = await fetch(`/api/incidents/${id}/classify`, { headers })
      const body = await res.json()
      if (res.status === 403) { setForbidden(true); return }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const existing = body.classification as {
        is_work_related: boolean; is_new_case: boolean;
        is_privacy_case: boolean;
        decision_path: Array<{ question: string; answer: string }>;
        meets_recording_criteria: boolean;
        classification: 'death' | 'days_away' | 'restricted' | 'other_recordable' | null;
      } | null
      if (existing) {
        setAnswers(prev => ({
          ...prev,
          is_work_related: existing.is_work_related,
          is_new_case:     existing.is_new_case,
        }))
        setIsPrivacy(existing.is_privacy_case)
      }

      // Load establishment options.
      const estRes = await fetch('/api/osha/establishments', { headers })
      const estBody = await estRes.json()
      if (estRes.ok) {
        type Row = { id: string; establishment_name: string }
        setEstablishments(
          (estBody.establishments as Row[]).map(e => ({ id: e.id, name: e.establishment_name })),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant, id])

  useEffect(() => { void load() }, [load])

  const livePreview = decideRecordability(answers)

  async function fetchAiSuggestion() {
    if (!tenant?.id || !id) return
    setAiBusy(true); setAiError(null); setAiSuggestion(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/incidents/${id}/classify/ai-suggest`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({}),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setAiSuggestion(body.suggestion)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiBusy(false)
    }
  }

  async function submit() {
    if (!tenant?.id || !id) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/incidents/${id}/classify`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          answers,
          is_privacy_case:  isPrivacy,
          injury_type:      injuryType,
          establishment_id: estId || null,
          override_reason:  overrideReason.trim() || undefined,
          // Pass through any AI suggestion the user reviewed; the
          // server compares it to the human's classification and
          // records human_overrode_ai if they differ.
          ai_suggested_classification: aiSuggestion?.classification ?? null,
          ai_confidence:               aiSuggestion?.confidence ?? null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setSubmittedDecision(body.decision)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }
  if (forbidden) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-3">
        <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 text-center">
          <ShieldAlert className="h-8 w-8 text-amber-500 mx-auto" />
          <h1 className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-100">Admin only</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            OSHA classification is restricted to tenant admins and owners.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to incident
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">OSHA recordability</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Walk the 29 CFR 1904.7 decision tree. The full Q&amp;A path is saved as the classification audit trail.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Gates (1904.5 + 1904.6)</h2>
        <YesNoCheck
          label="Was the case work-related?"
          help={FIELD_HELP.is_work_related}
          checked={answers.is_work_related}
          onChange={v => setAnswers(a => ({ ...a, is_work_related: v }))}
        />
        <YesNoCheck
          label="Is this a new case (not a continuation)?"
          help={FIELD_HELP.is_new_case}
          checked={answers.is_new_case}
          onChange={v => setAnswers(a => ({ ...a, is_new_case: v }))}
        />
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Outcomes (1904.7)</h2>
        <YesNoCheck
          label="Death"
          help={FIELD_HELP.resulted_in_death}
          checked={answers.resulted_in_death}
          onChange={v => setAnswers(a => ({ ...a, resulted_in_death: v }))}
        />
        <YesNoCheck
          label="Days away from work"
          help={FIELD_HELP.resulted_in_days_away}
          checked={answers.resulted_in_days_away}
          onChange={v => setAnswers(a => ({ ...a, resulted_in_days_away: v }))}
        />
        {answers.resulted_in_days_away && (
          <NumberField
            label="How many calendar days away?"
            value={answers.days_away_count ?? 0}
            onChange={v => setAnswers(a => ({ ...a, days_away_count: v }))}
          />
        )}
        <YesNoCheck
          label="Restricted work / job transfer"
          help={FIELD_HELP.resulted_in_restricted_duty}
          checked={answers.resulted_in_restricted_duty}
          onChange={v => setAnswers(a => ({ ...a, resulted_in_restricted_duty: v }))}
        />
        {answers.resulted_in_restricted_duty && (
          <NumberField
            label="How many calendar days restricted?"
            value={answers.days_restricted_count ?? 0}
            onChange={v => setAnswers(a => ({ ...a, days_restricted_count: v }))}
          />
        )}
        <YesNoCheck
          label="Medical treatment beyond first aid"
          help={FIELD_HELP.medical_treatment_beyond_first_aid}
          checked={answers.medical_treatment_beyond_first_aid}
          onChange={v => setAnswers(a => ({ ...a, medical_treatment_beyond_first_aid: v }))}
        />
        <YesNoCheck
          label="Loss of consciousness"
          help={FIELD_HELP.loss_of_consciousness}
          checked={answers.loss_of_consciousness}
          onChange={v => setAnswers(a => ({ ...a, loss_of_consciousness: v }))}
        />
        <YesNoCheck
          label="Significant diagnosed condition"
          help={FIELD_HELP.significant_diagnosed_condition}
          checked={answers.significant_diagnosed_condition}
          onChange={v => setAnswers(a => ({ ...a, significant_diagnosed_condition: v }))}
        />
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">300 form details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Injury / illness type</span>
            <select
              value={injuryType}
              onChange={e => setInjuryType(e.target.value as InjuryType)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            >
              {INJURY_TYPES.map(t => (
                <option key={t} value={t}>{INJURY_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Establishment</span>
            <select
              value={estId}
              onChange={e => setEstId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            >
              <option value="">— unassigned —</option>
              {establishments.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={isPrivacy}
            onChange={e => setIsPrivacy(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <strong>Privacy case</strong> — name + location suppressed on the 300 log per 1904.29(b)(7-9)
            (intimate-body-part injury, sexual assault, mental illness, HIV/hepatitis/TB, or worker request in writing).
          </span>
        </label>
      </section>

      <section className="rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50/40 dark:bg-violet-950/20 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-700 dark:text-violet-300" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">AI assist · Claude Haiku</h2>
          </div>
          <button
            type="button"
            disabled={aiBusy}
            onClick={() => void fetchAiSuggestion()}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-violet-700 disabled:opacity-50"
          >
            {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {aiBusy ? 'Asking Claude…' : 'Get AI suggestion'}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
          Suggestions are advisory only — your classification is the final word. The AI&apos;s suggestion + your decision are both saved for audit.
        </p>
        {aiError && (
          <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">{aiError}</p>
        )}
        {aiSuggestion && (
          <div className="mt-3 rounded-lg bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-900 p-3 space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-violet-700 dark:text-violet-300">
              Suggested: <strong className="text-slate-900 dark:text-slate-100">{aiSuggestion.classification ?? 'not recordable'}</strong>
              {' · '}
              <span className="font-mono">{Math.round(aiSuggestion.confidence * 100)}% confidence</span>
            </p>
            <p className="text-xs text-slate-700 dark:text-slate-200">{aiSuggestion.reasoning}</p>
            {aiSuggestion.missing_info.length > 0 && (
              <div className="mt-1">
                <p className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300 font-semibold">Sharpen the call by adding:</p>
                <ul className="list-disc pl-4 text-[11px] text-slate-600 dark:text-slate-300">
                  {aiSuggestion.missing_info.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section className={
        'rounded-xl border p-4 ' +
        (livePreview.recordable
          ? 'border-rose-200 bg-rose-50/40 dark:bg-rose-950/20 dark:border-rose-900'
          : 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-900')
      }>
        <div className="flex items-center gap-2">
          {livePreview.recordable
            ? <ShieldAlert className="h-5 w-5 text-rose-600" />
            : <ShieldCheck className="h-5 w-5 text-emerald-600" />}
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Live preview: {livePreview.recordable ? 'RECORDABLE' : 'Not recordable'}
            {livePreview.classification && ` — ${livePreview.classification.replace(/_/g, ' ')}`}
          </h2>
        </div>
        <ol className="mt-2 list-decimal pl-5 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
          {livePreview.path.map((p, i) => (
            <li key={i}>
              <span className="text-slate-700 dark:text-slate-200">{p.question}</span>
              {' — '}
              <span className={
                p.answer === 'yes' ? 'font-semibold text-rose-700 dark:text-rose-300'
                : p.answer === 'no' ? 'font-semibold text-emerald-700 dark:text-emerald-300'
                : 'italic text-slate-500'
              }>{p.answer}</span>
              {p.reason && <span className="text-slate-500"> ({p.reason})</span>}
            </li>
          ))}
        </ol>
      </section>

      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes / override reason</span>
        <textarea
          value={overrideReason}
          onChange={e => setOverrideReason(e.target.value)}
          rows={2}
          placeholder="Optional. Use when the classification differs from a prior judgement or AI suggestion."
          className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
      </label>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
        >
          <FileText className="h-4 w-4" />
          {busy ? 'Saving…' : 'Save classification + refresh 300 log'}
        </button>
      </div>

      {submittedDecision && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-900 p-3 text-sm text-emerald-800 dark:text-emerald-200">
          Saved. Classification is{' '}
          <strong>{submittedDecision.classification ?? 'not recordable'}</strong>.
          {' '}The 300 log has been refreshed.
        </div>
      )}
    </div>
  )
}

function YesNoCheck({
  label, help, checked, onChange,
}: {
  label: string; help?: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-1"
      />
      <span className="text-sm">
        <span className="font-medium text-slate-800 dark:text-slate-200">{label}</span>
        {help && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{help}</span>}
      </span>
    </label>
  )
}

function NumberField({
  label, value, onChange,
}: {
  label: string; value: number; onChange: (v: number) => void
}) {
  return (
    <label className="block ml-7">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="mt-1 w-32 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-1.5 text-sm"
      />
    </label>
  )
}
