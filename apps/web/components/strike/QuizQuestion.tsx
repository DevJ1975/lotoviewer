'use client'

import type { StrikeQuestionType } from '@soteria/core/strike'
import { useStrikeCopy } from './player/copy'

// `explanation` is deliberately absent: it is a soft copy of the answer key
// and the strike_security_hardening migration revoked it from `authenticated`.
// It comes back in the submit response, per missed question, after grading.
export interface QuizQuestionRow {
  id: string
  question_type: StrikeQuestionType
  prompt: string
  sort_order: number
  required: boolean
  points: number
}

export interface QuizAnswerRow {
  id: string
  question_id: string
  answer_text: string
  sort_order: number
}

export type QuizResponse = string[] | string | boolean

export function QuizQuestion({
  index,
  question,
  answers,
  value,
  onChange,
}: {
  index: number
  question: QuizQuestionRow
  answers: QuizAnswerRow[]
  value: QuizResponse | undefined
  onChange: (value: QuizResponse) => void
}) {
  const t = useStrikeCopy()
  const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const isMulti = question.question_type === 'select_all'
  const isAck = question.question_type === 'acknowledgement'

  return (
    <fieldset className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
      <legend className="px-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {index + 1}. {question.prompt}
      </legend>
      {isAck ? (
        <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 border-slate-200 px-3 py-2.5 text-sm text-slate-700 has-[:checked]:border-brand-navy has-[:checked]:bg-blue-50 dark:border-slate-700 dark:text-slate-200 dark:has-[:checked]:bg-blue-950/40">
          <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-brand-navy" />
          {t.acknowledgeRequirement}
        </label>
      ) : (
        <div className="mt-3 space-y-2">
          {answers.map(answer => (
            <label key={answer.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 border-slate-200 px-3 py-2.5 text-sm text-slate-700 has-[:checked]:border-brand-navy has-[:checked]:bg-blue-50 dark:border-slate-700 dark:text-slate-200 dark:has-[:checked]:bg-blue-950/40">
              <input
                type={isMulti ? 'checkbox' : 'radio'}
                name={question.id}
                value={answer.id}
                checked={selected.includes(answer.id)}
                onChange={e => {
                  if (isMulti) {
                    const next = e.target.checked
                      ? Array.from(new Set([...selected, answer.id]))
                      : selected.filter(id => id !== answer.id)
                    onChange(next)
                  } else {
                    onChange(answer.id)
                  }
                }}
                className="h-5 w-5 shrink-0 accent-brand-navy"
              />
              {answer.answer_text}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}
