'use client'

import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { Award } from 'lucide-react'

const CONFETTI_COLORS = ['#FFD900', '#1D3ECF', '#22c55e', '#ffffff', '#f97316']

interface PassCelebrationProps {
  moduleTitle: string
  scorePercent: number
  learnerName: string | null
  actions?: ReactNode
}

// Celebrates completion, never the score itself: the number is shown, but
// nothing rewards a higher pass over a lower one (see the gamification
// decisions in docs/handoffs/2026-08-29-strike-phase-2.md).
export function PassCelebration({ moduleTitle, scorePercent, learnerName, actions }: PassCelebrationProps) {
  const pieces = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    dx: `${Math.round(Math.cos((i / 28) * Math.PI * 2) * (120 + (i % 5) * 30))}px`,
    dy: `${Math.round(Math.sin((i / 28) * Math.PI * 2) * (90 + (i % 4) * 25) - 40)}px`,
    rot: `${(i * 47) % 360}deg`,
    delay: `${(i % 7) * 30}ms`,
  })), [])

  return (
    <div className="relative mt-4 overflow-hidden rounded-xl border-2 border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-800 dark:bg-emerald-950/40" role="status">
      {pieces.map((p, i) => (
        <span
          key={i}
          aria-hidden
          className="strike-confetti-piece"
          style={{ background: p.color, '--dx': p.dx, '--dy': p.dy, '--rot': p.rot, animationDelay: p.delay } as CSSProperties}
        />
      ))}
      <Award className="mx-auto h-12 w-12 text-emerald-600 dark:text-emerald-300" aria-hidden />
      <p className="mt-2 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">Training complete</p>
      <h3 className="stencil-title mt-1 text-2xl text-slate-900 dark:text-slate-50">
        {learnerName ? `Nice work, ${learnerName}.` : 'Nice work.'}
      </h3>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
        You passed <strong>{moduleTitle}</strong> with {scorePercent}%. Your training record is updated.
      </p>
      {actions && <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}
