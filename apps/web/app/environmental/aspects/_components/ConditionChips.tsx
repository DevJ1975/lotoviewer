import { OPERATING_CONDITION_ORDER, type AspectOperatingCondition } from '@soteria/core/environmentalAspect'
import type { CurrentScore } from '@/lib/environmental/client'

// N / A / E: which operating conditions an aspect has been scored under
// (clause 6.1.2 asks for all three to be considered). A scored chip shows
// its current score; a significant one is marked; a missing one is hollow.

const LETTER: Record<AspectOperatingCondition, string> = { normal: 'N', abnormal: 'A', emergency: 'E' }
const NAME: Record<AspectOperatingCondition, string> = { normal: 'Normal', abnormal: 'Abnormal', emergency: 'Emergency' }

export function ConditionChips({ scores }: { scores: readonly CurrentScore[] }) {
  const byCondition = new Map(scores.map(s => [s.operating_condition, s]))
  return (
    <span className="inline-flex gap-1" aria-label="Operating-condition coverage">
      {OPERATING_CONDITION_ORDER.map(condition => {
        const score = byCondition.get(condition)
        const description = score
          ? `${NAME[condition]}: score ${score.score}${score.significant ? ', significant' : ''}`
          : `${NAME[condition]}: not scored`
        const look = !score
          ? 'border border-dashed border-slate-300 text-slate-400 dark:border-slate-600 dark:text-slate-500'
          : score.significant
            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
        return (
          <span key={condition} title={description} aria-label={description}
            className={`inline-flex h-6 min-w-[2.25rem] items-center justify-center rounded px-1 text-[10px] font-bold ${look}`}>
            {LETTER[condition]}{score ? ` ${score.score}` : ''}
          </span>
        )
      })}
    </span>
  )
}
