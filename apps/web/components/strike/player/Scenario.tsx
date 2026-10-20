'use client'

import { useState } from 'react'
import { scoreStrikeInteraction, type StrikeScenarioBlock } from '@soteria/core/strikeContent'
import { InteractionShell, type HintControl, type InteractionFeedback } from './InteractionShell'

interface ScenarioProps {
  block: StrikeScenarioBlock
  urls: Record<string, string>
  completed: boolean
  remediation: { blockKey: string; title: string } | null
  hint: HintControl
  onResult: (correct: boolean, detail: Record<string, unknown>) => void
}

export function Scenario({ block, urls, completed, remediation, hint, onResult }: ScenarioProps) {
  const correctId = block.choices.find(c => c.correct)?.id ?? null
  const [choiceId, setChoiceId] = useState<string | null>(completed ? correctId : null)
  const [feedback, setFeedback] = useState<InteractionFeedback>(() => {
    const correct = block.choices.find(c => c.correct)
    return completed && correct ? { state: 'correct', message: correct.feedback } : { state: 'idle' }
  })
  const imageUrl = block.image ? urls[block.image.path] : undefined

  function check() {
    if (!choiceId) return
    const result = scoreStrikeInteraction(block, { kind: 'scenario', choiceId })
    const choice = block.choices.find(c => c.id === choiceId)
    setFeedback({ state: result.correct ? 'correct' : 'incorrect', message: choice?.feedback ?? '' })
    onResult(result.correct, { choice_id: choiceId })
  }

  return (
    <InteractionShell
      blockKey={block.key}
      label="What would you do?"
      prompt={block.stem}
      feedback={feedback}
      completed={completed}
      canCheck={!!choiceId}
      onCheck={check}
      remediation={remediation}
      hint={hint}
    >
      {imageUrl && block.image && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
        <img src={imageUrl} alt={block.image.alt} className="mb-3 w-full rounded-lg border border-slate-200 dark:border-slate-700" />
      )}
      <div role="radiogroup" aria-labelledby={`${block.key}-prompt`} className="space-y-2">
        {block.choices.map(choice => {
          const isOn = choiceId === choice.id
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={isOn}
              disabled={completed}
              onClick={() => { setChoiceId(choice.id); setFeedback({ state: 'idle' }) }}
              className={`motion-press flex min-h-12 w-full items-start gap-3 rounded-lg border-2 px-3 py-2.5 text-left text-sm font-medium transition ${
                isOn ? 'border-brand-navy bg-blue-50 text-slate-900 dark:bg-blue-950/40 dark:text-slate-100'
                  : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
              }`}
            >
              <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${isOn ? 'border-brand-navy bg-brand-navy' : 'border-slate-400'}`} aria-hidden />
              {choice.label}
            </button>
          )
        })}
      </div>
    </InteractionShell>
  )
}
