'use client'

import type { ReactNode } from 'react'
import { ArrowUpRight, CheckCircle2, Hand, Lightbulb, Loader2, XCircle } from 'lucide-react'
import { useStrikeCopy } from './copy'

export type InteractionFeedback =
  | { state: 'idle' }
  | { state: 'correct'; message: string }
  | { state: 'incorrect'; message: string }

/** Hints revealed one at a time; the player owns the count so it can log it. */
export interface HintControl {
  revealed: string[]
  canReveal: boolean
  onReveal: () => void
}

interface InteractionShellProps {
  blockKey: string
  label: string
  prompt: string
  /** How to operate the activity, phrased for touch first. */
  instructions?: string
  feedback: InteractionFeedback
  completed: boolean
  checking?: boolean
  canCheck: boolean
  onCheck: () => void
  remediation: { blockKey: string; title: string } | null
  hint: HintControl
  children: ReactNode
}

// Shared frame for formative checks: prompt, the activity, a Check button,
// hints on request, and feedback that names what to fix and links back to
// the scene that teaches it. Never scored for credit — the graded quiz is
// separate.
export function InteractionShell({
  blockKey, label, prompt, instructions, feedback, completed, checking, canCheck, onCheck, remediation, hint, children,
}: InteractionShellProps) {
  const t = useStrikeCopy()
  return (
    <section
      aria-labelledby={`${blockKey}-prompt`}
      className={`placard-surface p-4 sm:p-5 ${feedback.state === 'incorrect' ? 'strike-shake' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded bg-brand-navy px-2 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-white">
          <Hand className="h-3.5 w-3.5" aria-hidden /> {label}
        </span>
        {completed && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> {t.solved}
          </span>
        )}
      </div>
      <h3 id={`${blockKey}-prompt`} className="stencil-title text-lg text-slate-900 dark:text-slate-100">{prompt}</h3>
      {!completed && instructions && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{instructions}</p>}
      <div className="mt-4">{children}</div>

      {!completed && hint.revealed.length > 0 && (
        <ol aria-label={t.hintsLabel} className="mt-4 space-y-1.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
          {hint.revealed.map((text, i) => (
            <li key={text} className="flex items-start gap-2">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span><span className="font-semibold">{t.hintN(i + 1)}</span> {text}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!completed && (
          <button
            type="button"
            onClick={onCheck}
            disabled={!canCheck || checking}
            className="motion-press inline-flex min-h-12 items-center gap-2 rounded-lg bg-brand-navy px-5 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t.check}
          </button>
        )}
        {!completed && hint.canReveal && (
          <button
            type="button"
            onClick={hint.onReveal}
            className="motion-press inline-flex min-h-12 items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:border-brand-navy dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Lightbulb className="h-4 w-4" aria-hidden />
            {hint.revealed.length === 0 ? t.hint : t.anotherHint}
          </button>
        )}
        <div aria-live="polite" className="min-w-0 flex-1">
          {feedback.state === 'correct' && (
            <p className="flex items-start gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {feedback.message}
            </p>
          )}
          {feedback.state === 'incorrect' && (
            <div className="space-y-1">
              <p className="flex items-start gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {feedback.message}
              </p>
              {remediation && (
                <a href={`#block-${remediation.blockKey}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-navy underline-offset-2 hover:underline dark:text-blue-300">
                  {t.review(remediation.title)} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
