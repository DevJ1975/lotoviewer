'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Check, Loader2, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import {
  WIZARD_STEPS,
  buildSubmitPayload,
  makeInitialWizardState,
  validateStep,
  type WizardState,
  type WizardStepId,
} from '@/lib/risk-wizard'
import StepIdentify   from './wizard/StepIdentify'
import StepCategorize from './wizard/StepCategorize'
import StepInherent   from './wizard/StepInherent'
import StepControls   from './wizard/StepControls'
import StepResidual   from './wizard/StepResidual'
import StepAssign     from './wizard/StepAssign'
import StepReview     from './wizard/StepReview'
import StepConfirm    from './wizard/StepConfirm'

// Single-page wizard shell. Holds wizard state in component state +
// renders the active step component. Step nav (Back / Next /
// Submit) lives at the bottom; the step indicator at the top is
// non-interactive in slice 3 (slice 4 may make completed steps
// clickable for jump-back).
//
// Refresh-state persistence: state + step index are mirrored to
// sessionStorage on every change, scoped by `tenant.id` so an
// accidental tenant switch in another tab can't poison the draft.
// Cleared after a successful submit.

const DRAFT_VERSION = 1
function draftKey(tenantId: string) {
  return `soteria.risk-wizard.draft.${tenantId}`
}
interface DraftEnvelope {
  v:        number
  state:    WizardState
  stepIdx:  number
  savedAt:  number
}

export default function RiskWizard() {
  const router = useRouter()
  const { tenant } = useTenant()
  const [state,    setState]    = useState<WizardState>(() => makeInitialWizardState())
  const [stepIdx,  setStepIdx]  = useState<number>(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState<boolean>(false)
  const [restored, setRestored] = useState<number | null>(null)

  // Hydrate draft on mount once we know the tenant.
  useEffect(() => {
    if (!tenant?.id) return
    if (typeof window === 'undefined') { setHydrated(true); return }
    try {
      const raw = window.sessionStorage.getItem(draftKey(tenant.id))
      if (raw) {
        const parsed = JSON.parse(raw) as DraftEnvelope
        if (parsed && parsed.v === DRAFT_VERSION && parsed.state) {
          setState(parsed.state)
          if (typeof parsed.stepIdx === 'number'
              && parsed.stepIdx >= 0
              && parsed.stepIdx < WIZARD_STEPS.length) {
            setStepIdx(parsed.stepIdx)
          }
          setRestored(parsed.savedAt)
        }
      }
    } catch { /* malformed JSON / quota / private mode — start fresh */ }
    setHydrated(true)
  }, [tenant?.id])

  // Persist on every state/step change. sessionStorage writes are
  // sub-millisecond; the wizard fires changes at user typing speed
  // at most so no debounce.
  useEffect(() => {
    if (!hydrated || !tenant?.id) return
    if (typeof window === 'undefined') return
    try {
      const env: DraftEnvelope = { v: DRAFT_VERSION, state, stepIdx, savedAt: Date.now() }
      window.sessionStorage.setItem(draftKey(tenant.id), JSON.stringify(env))
    } catch { /* quota / private mode — silently lose persistence */ }
  }, [hydrated, tenant?.id, state, stepIdx])

  function clearDraft() {
    if (!tenant?.id || typeof window === 'undefined') return
    try { window.sessionStorage.removeItem(draftKey(tenant.id)) } catch { /* ignore */ }
  }

  function discardDraft() {
    if (!confirm('Discard this draft and start over?')) return
    clearDraft()
    setState(makeInitialWizardState())
    setStepIdx(0)
    setRestored(null)
    setSubmitError(null)
  }

  const currentStep = WIZARD_STEPS[stepIdx]!
  const isFirst = stepIdx === 0
  const isLast  = stepIdx === WIZARD_STEPS.length - 1
  const stepError = useMemo(() => validateStep(currentStep.id, state), [currentStep.id, state])

  function set<K extends keyof WizardState>(k: K, v: WizardState[K]) {
    setState(s => ({ ...s, [k]: v }))
  }

  function next() {
    if (stepError) return
    if (isLast)    return  // last step submits via the Submit button below
    setStepIdx(i => Math.min(i + 1, WIZARD_STEPS.length - 1))
  }

  function back() {
    setStepIdx(i => Math.max(i - 1, 0))
  }

  async function submit() {
    if (submitting) return
    if (stepError)  return
    setSubmitting(true); setSubmitError(null)
    try {
      const payload = buildSubmitPayload(state)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/risk', {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          authorization:      `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant':  tenant?.id ?? '',
        },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) {
        // Surface the PPE-alone code from the API + send the user
        // back to the controls step where they can fix it.
        if (body.code === 'ppe_only_justification_required') {
          setSubmitError(body.error ?? 'PPE-alone rule violation.')
          const ctrlIdx = WIZARD_STEPS.findIndex(s => s.id === 'controls')
          if (ctrlIdx >= 0) setStepIdx(ctrlIdx)
          return
        }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      // On success, drop the draft + navigate to the new risk.
      clearDraft()
      const riskId = body?.risk?.id as string | undefined
      if (riskId) router.push(`/risk/${riskId}`)
      else        router.push('/risk')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      {restored !== null && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
          <div className="text-amber-900 dark:text-amber-200">
            <span className="font-semibold">Draft restored.</span>{' '}
            Picked up where you left off ({new Date(restored).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}).
          </div>
          <button
            type="button"
            onClick={discardDraft}
            className="inline-flex items-center gap-1 text-amber-900 dark:text-amber-200 hover:underline"
          >
            <Trash2 className="h-3 w-3" /> Discard
          </button>
        </div>
      )}

      <StepIndicator currentIdx={stepIdx} />

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 space-y-4">
        <header>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Step {stepIdx + 1} of {WIZARD_STEPS.length}
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">{currentStep.label}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{currentStep.subtitle}</p>
        </header>

        <ActiveStep step={currentStep.id} state={state} set={set} />

        {stepError && (
          <p className="text-xs text-rose-700 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{stepError}</p>
        )}

        {submitError && isLast && (
          <p className="text-xs text-rose-700 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
            {submitError}
          </p>
        )}
      </section>

      <nav className="flex items-center justify-between">
        <button
          type="button"
          disabled={isFirst || submitting}
          onClick={back}
          className="text-sm font-semibold inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>

        {isLast ? (
          <button
            type="button"
            disabled={!!stepError || submitting}
            onClick={submit}
            className="text-sm font-bold inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-brand-navy text-white disabled:opacity-40 hover:bg-brand-navy/90"
          >
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
              : <><Check className="h-4 w-4" /> Submit risk</>}
          </button>
        ) : (
          <button
            type="button"
            disabled={!!stepError}
            onClick={next}
            className="text-sm font-semibold inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-brand-navy text-white disabled:opacity-40 hover:bg-brand-navy/90"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </nav>
    </div>
  )
}

function StepIndicator({ currentIdx }: { currentIdx: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {WIZARD_STEPS.map((s, i) => {
        const isActive = i === currentIdx
        const isPast   = i < currentIdx
        return (
          <li
            key={s.id}
            className={
              'inline-flex items-center gap-1 px-2 py-1 rounded-md font-semibold ' +
              (isActive
                ? 'bg-brand-navy text-white'
                : isPast
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400')
            }
          >
            <span className="font-mono">{i + 1}</span>
            <span>{s.label}</span>
            {isPast && <Check className="h-3 w-3" />}
          </li>
        )
      })}
    </ol>
  )
}

function ActiveStep({
  step, state, set,
}: {
  step:  WizardStepId
  state: WizardState
  set:   <K extends keyof WizardState>(k: K, v: WizardState[K]) => void
}) {
  switch (step) {
    case 'identify':   return <StepIdentify   state={state} set={set} />
    case 'categorize': return <StepCategorize state={state} set={set} />
    case 'inherent':   return <StepInherent   state={state} set={set} />
    case 'controls':   return <StepControls   state={state} set={set} />
    case 'residual':   return <StepResidual   state={state} set={set} />
    case 'assign':     return <StepAssign     state={state} set={set} />
    case 'review':     return <StepReview     state={state} set={set} />
    case 'confirm':    return <StepConfirm    state={state} />
  }
}
