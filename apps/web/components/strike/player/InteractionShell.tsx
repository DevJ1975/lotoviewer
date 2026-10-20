'use client'

import type { ReactNode } from 'react'
import { ArrowUpRight, CheckCircle2, Hand, Loader2, XCircle } from 'lucide-react'

export type InteractionFeedback =
  | { state: 'idle' }
  | { state: 'correct'; message: string }
  | { state: 'incorrect'; message: string }

interface InteractionShellProps {
  blockKey: string
  label: string
  prompt: string
  feedback: InteractionFeedback
  completed: boolean
  checking?: boolean
  canCheck: boolean
  onCheck: () => void
  remediation: { blockKey: string; title: string } | null
  children: ReactNode
}

// Shared frame for formative checks: prompt, the activity, a Check button,
// and feedback that names what to fix and links back to the scene that
// teaches it. Never scored for credit — the graded quiz is separate.
export function InteractionShell({
  blockKey, label, prompt, feedback, completed, checking, canCheck, onCheck, remediation, children,
}: InteractionShellProps) {
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
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Solved
          </span>
        )}
      </div>
      <h3 id={`${blockKey}-prompt`} className="stencil-title text-lg text-slate-900 dark:text-slate-100">{prompt}</h3>
      <div className="mt-4">{children}</div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!completed && (
          <button
            type="button"
            onClick={onCheck}
            disabled={!canCheck || checking}
            className="motion-press inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Check
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
                  Review: {remediation.title} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
