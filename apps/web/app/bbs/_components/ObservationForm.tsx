'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, AlertOctagon, ShieldCheck, Loader2 } from 'lucide-react'
import {
  BBS_KIND_LABEL,
  validateBBSCreateInput,
  bbsScoreFor,
  type BBSKind,
  type BBSSeverity,
  type BBSLikelihood,
  type BBSValidationError,
} from '@soteria/core/bbs'
import { RiskMatrix } from './RiskMatrix'
import { cn } from '@/lib/utils'

// Shared submit form. Used by both:
//   - /bbs/new (logged-in submission via /api/bbs/observations)
//   - /r/bbs/[token] (anonymous submission via /api/bbs/intake/[token])
//
// The parent page wires up the actual fetch + redirect via `onSubmit`.

export interface BBSFormPayload {
  kind:                   BBSKind
  description:            string
  severity:               BBSSeverity | null
  likelihood:             BBSLikelihood | null
  category:               string | null
  location_text:          string | null
  department:             string | null
  immediate_action_taken: string | null
  abc_antecedent:         string | null
  abc_behavior:           string | null
  abc_consequence:        string | null
  submitted_name:         string | null
  submitted_email:        string | null
}

interface Props {
  /** Show the optional "your name" / email fields (anonymous flow). */
  anonymous:          boolean
  /** Pre-fill location text from the QR location, if any. */
  defaultLocation?:   string | null
  onSubmit:           (payload: BBSFormPayload) => Promise<void>
  submittingLabel?:   string
}

const KIND_OPTIONS: Array<{ value: BBSKind; icon: React.ComponentType<{ className?: string }>; tone: string }> = [
  { value: 'unsafe_act',       icon: AlertTriangle, tone: 'amber' },
  { value: 'unsafe_condition', icon: AlertOctagon,  tone: 'rose' },
  { value: 'safe_behavior',    icon: ShieldCheck,   tone: 'emerald' },
]

const TONE_CLASS: Record<string, { selected: string; idle: string }> = {
  amber:   { selected: 'border-amber-500 bg-amber-50 dark:bg-amber-900/20', idle: 'border-slate-300 dark:border-slate-700 hover:border-amber-300' },
  rose:    { selected: 'border-rose-500 bg-rose-50 dark:bg-rose-900/20',   idle: 'border-slate-300 dark:border-slate-700 hover:border-rose-300' },
  emerald: { selected: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20', idle: 'border-slate-300 dark:border-slate-700 hover:border-emerald-300' },
}

export function ObservationForm({ anonymous, defaultLocation, onSubmit, submittingLabel }: Props) {
  const [kind,       setKind]       = useState<BBSKind | null>(null)
  const [severity,   setSeverity]   = useState<BBSSeverity | null>(null)
  const [likelihood, setLikelihood] = useState<BBSLikelihood | null>(null)
  const [description, setDescription] = useState('')
  const [category,    setCategory]    = useState('')
  const [locationText, setLocationText] = useState(defaultLocation ?? '')
  const [department,  setDepartment]  = useState('')
  const [immediate,   setImmediate]   = useState('')
  const [showAbc,     setShowAbc]     = useState(false)
  const [abcA,        setAbcA]        = useState('')
  const [abcB,        setAbcB]        = useState('')
  const [abcC,        setAbcC]        = useState('')
  const [submittedName, setSubmittedName] = useState('')
  const [submittedEmail, setSubmittedEmail] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [errors,     setErrors]     = useState<BBSValidationError[]>([])
  const [serverError, setServerError] = useState<string | null>(null)

  const score = useMemo(() => bbsScoreFor(severity, likelihood), [severity, likelihood])
  const requiresMatrix = kind !== null && kind !== 'safe_behavior'

  function fieldError(name: string): string | undefined {
    return errors.find(e => e.field === name)?.message
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!kind) {
      setErrors([{ field: 'kind', message: 'Pick a kind' }])
      return
    }

    const payload: BBSFormPayload = {
      kind,
      description:            description.trim(),
      severity:               requiresMatrix ? severity : null,
      likelihood:             requiresMatrix ? likelihood : null,
      category:               category.trim() || null,
      location_text:          locationText.trim() || null,
      department:             department.trim() || null,
      immediate_action_taken: immediate.trim() || null,
      abc_antecedent:         showAbc ? (abcA.trim() || null) : null,
      abc_behavior:           showAbc ? (abcB.trim() || null) : null,
      abc_consequence:        showAbc ? (abcC.trim() || null) : null,
      submitted_name:         anonymous ? (submittedName.trim() || null) : null,
      submitted_email:        anonymous ? (submittedEmail.trim() || null) : null,
    }

    const errs = validateBBSCreateInput({
      kind:        payload.kind,
      description: payload.description,
      severity:    payload.severity,
      likelihood:  payload.likelihood,
      submitted_email: payload.submitted_email,
    })
    setErrors(errs)
    if (errs.length > 0) return

    setSubmitting(true)
    setServerError(null)
    try {
      await onSubmit(payload)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Kind selector — three big buttons */}
      <fieldset>
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          What did you observe?
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {KIND_OPTIONS.map(opt => {
            const Icon = opt.icon
            const selected = kind === opt.value
            const tone = TONE_CLASS[opt.tone]
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setKind(opt.value)}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition text-left',
                  selected ? tone.selected : tone.idle,
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{BBS_KIND_LABEL[opt.value]}</span>
              </button>
            )
          })}
        </div>
        {fieldError('kind') && <p className="mt-1 text-xs text-rose-600">{fieldError('kind')}</p>}
      </fieldset>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          Describe what you saw <span className="text-rose-500">*</span>
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={4}
          placeholder="Be specific: what happened, who was involved, what could have gone wrong"
          className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        {fieldError('description') && <p className="mt-1 text-xs text-rose-600">{fieldError('description')}</p>}
      </div>

      {/* Risk matrix — required for unsafe_* */}
      {requiresMatrix && (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Risk rating <span className="text-rose-500">*</span>
            {score != null && <span className="ml-2 text-xs font-normal text-slate-500">score: {score}</span>}
          </label>
          <RiskMatrix
            severity={severity}
            likelihood={likelihood}
            onChange={(sev, like) => { setSeverity(sev); setLikelihood(like) }}
          />
          {(fieldError('severity') || fieldError('likelihood')) && (
            <p className="mt-1 text-xs text-rose-600">Tap a cell to set both severity and likelihood.</p>
          )}
        </div>
      )}

      {/* Optional fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
          <input
            type="text" value={category} onChange={e => setCategory(e.target.value)}
            placeholder="PPE, housekeeping, ergonomics…"
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Department</label>
          <input
            type="text" value={department} onChange={e => setDepartment(e.target.value)}
            placeholder="Maintenance, packaging…"
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Location detail</label>
        <input
          type="text" value={locationText} onChange={e => setLocationText(e.target.value)}
          placeholder="e.g. line 3, north dock"
          className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Immediate action taken (optional)</label>
        <textarea
          value={immediate} onChange={e => setImmediate(e.target.value)}
          rows={2}
          placeholder="Did you stop the work, isolate the hazard, or notify a supervisor?"
          className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        />
      </div>

      {/* ABC analysis (optional) */}
      <details
        open={showAbc}
        onToggle={e => setShowAbc((e.target as HTMLDetailsElement).open)}
        className="rounded-md border border-slate-200 dark:border-slate-800 p-3"
      >
        <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">
          ABC analysis (optional)
        </summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Antecedent–Behavior–Consequence helps coaches understand what triggered a behavior and what reinforced or
            corrected it.
          </p>
          <div>
            <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Antecedent (what came before)</label>
            <input type="text" value={abcA} onChange={e => setAbcA(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Behavior (what they did)</label>
            <input type="text" value={abcB} onChange={e => setAbcB(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Consequence (what followed)</label>
            <input type="text" value={abcC} onChange={e => setAbcC(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
        </div>
      </details>

      {anonymous && (
        <fieldset className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
          <legend className="text-xs px-1 text-slate-500 dark:text-slate-400">
            Optional credit (anonymous submissions are accepted)
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Your name</label>
              <input
                type="text" value={submittedName} onChange={e => setSubmittedName(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Your email</label>
              <input
                type="email" value={submittedEmail} onChange={e => setSubmittedEmail(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
              {fieldError('submitted_email') && <p className="mt-1 text-xs text-rose-600">{fieldError('submitted_email')}</p>}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Anonymous submissions are accepted but don&apos;t earn leaderboard points.
          </p>
        </fieldset>
      )}

      {serverError && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{serverError}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className={cn(
          'w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-md font-medium text-white',
          'bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 transition',
        )}
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {submitting ? (submittingLabel ?? 'Submitting…') : 'Submit observation'}
      </button>
    </form>
  )
}
