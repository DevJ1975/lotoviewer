'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { scoreStrikeInteraction, type StrikeHotspotBlock } from '@soteria/core/strikeContent'
import { InteractionShell, type InteractionFeedback } from './InteractionShell'

interface HotspotProps {
  block: StrikeHotspotBlock
  urls: Record<string, string>
  completed: boolean
  remediation: { blockKey: string; title: string } | null
  onResult: (correct: boolean, detail: Record<string, unknown>) => void
}

// Graded by target id, never by tap coordinates, so the pictorial markers
// and the accessible checklist below are two renderings of one input.
export function Hotspot({ block, urls, completed, remediation, onResult }: HotspotProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(completed ? block.targets.filter(t => t.correct).map(t => t.id) : []),
  )
  const [wrong, setWrong] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState<InteractionFeedback>({ state: 'idle' })
  const imageUrl = urls[block.image.path]

  function toggle(id: string) {
    if (completed) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setWrong(new Set())
    setFeedback({ state: 'idle' })
  }

  function check() {
    const result = scoreStrikeInteraction(block, { kind: 'hotspot', selectedIds: [...selected] })
    setWrong(new Set(result.incorrectIds))
    const decoys = result.incorrectIds.filter(id => selected.has(id))
    const missed = result.incorrectIds.length - decoys.length
    setFeedback(result.correct
      ? { state: 'correct', message: 'Exactly right. Only a device that physically blocks energy is an isolation point.' }
      : {
          state: 'incorrect',
          message: [
            decoys.length > 0 ? `${decoys.length} of your picks ${decoys.length === 1 ? 'is a control, not an isolation point' : 'are controls, not isolation points'}.` : '',
            missed > 0 ? `You missed ${missed} isolation point${missed === 1 ? '' : 's'}.` : '',
          ].filter(Boolean).join(' '),
        })
    onResult(result.correct, { selected_ids: [...selected] })
  }

  return (
    <InteractionShell
      blockKey={block.key}
      label="Find the hazard"
      prompt={block.prompt}
      feedback={feedback}
      completed={completed}
      canCheck={selected.size > 0}
      onCheck={check}
      remediation={remediation}
    >
      <div className="relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img src={imageUrl} alt={block.image.alt} className="block w-full" />
        )}
        {block.targets.map((target, i) => {
          const isOn = selected.has(target.id)
          const isWrong = wrong.has(target.id)
          return (
            <button
              key={target.id}
              type="button"
              onClick={() => toggle(target.id)}
              aria-pressed={isOn}
              aria-label={target.label}
              tabIndex={-1}
              style={{ left: `${target.x_pct}%`, top: `${target.y_pct}%` }}
              className={`absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] text-sm font-black shadow-lg transition ${
                isWrong ? 'border-amber-400 bg-amber-500 text-white'
                  : isOn ? 'border-white bg-brand-navy text-white'
                    : 'border-white bg-slate-900/60 text-white hover:bg-brand-navy/80'
              }`}
            >
              {isOn ? <Check className="h-5 w-5" aria-hidden /> : i + 1}
            </button>
          )
        })}
      </div>
      <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">{block.prompt}</legend>
        {block.targets.map((target, i) => (
          <label
            key={target.id}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              wrong.has(target.id) ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/40' : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <input type="checkbox" checked={selected.has(target.id)} disabled={completed} onChange={() => toggle(target.id)} className="h-4 w-4 accent-brand-navy" />
            <span className="font-semibold text-slate-500">{i + 1}.</span>
            <span className="text-slate-800 dark:text-slate-100">{target.label}</span>
          </label>
        ))}
      </fieldset>
    </InteractionShell>
  )
}
