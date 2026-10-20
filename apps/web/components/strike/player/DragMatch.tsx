'use client'

import { useMemo, useRef, useState } from 'react'
import { useDrag, useDrop, type TextDropItem } from 'react-aria'
import { X } from 'lucide-react'
import { scoreStrikeInteraction, stableShuffle, type StrikeDragMatchBlock } from '@soteria/core/strikeContent'
import { InteractionShell, type HintControl, type InteractionFeedback } from './InteractionShell'

interface DragMatchProps {
  block: StrikeDragMatchBlock
  seed: string
  completed: boolean
  remediation: { blockKey: string; title: string } | null
  hint: HintControl
  onResult: (correct: boolean, detail: Record<string, unknown>) => void
}

const DRAG_TYPE = 'strike-match-answer'

// Two input paths over one state: drag a chip onto a slot (react-aria gives
// mouse, touch and keyboard drag), or tap a chip then tap a slot — the path
// that works with gloves, where a long-press drag does not.
export function DragMatch({ block, seed, completed, remediation, hint, onResult }: DragMatchProps) {
  const answers = useMemo(
    () => stableShuffle(block.pairs.map(p => p.answer), `${seed}:${block.key}`),
    [block, seed],
  )
  const [placed, setPlaced] = useState<Record<string, string>>(() =>
    completed ? Object.fromEntries(block.pairs.map(p => [p.id, p.answer])) : {},
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [wrong, setWrong] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState<InteractionFeedback>({ state: 'idle' })
  const placedAnswers = new Set(Object.values(placed))

  function place(pairId: string, answer: string) {
    setPlaced(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([, a]) => a !== answer))
      next[pairId] = answer
      return next
    })
    setSelected(null)
    setWrong(new Set())
    setFeedback({ state: 'idle' })
  }

  function clear(pairId: string) {
    setPlaced(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== pairId)))
    setFeedback({ state: 'idle' })
  }

  function check() {
    const result = scoreStrikeInteraction(block, { kind: 'drag_match', answerByPairId: placed })
    setWrong(new Set(result.incorrectIds))
    setFeedback(result.correct
      ? { state: 'correct', message: 'All matched. Each energy source has the right way to isolate it.' }
      : { state: 'incorrect', message: `${result.incorrectIds.length} match${result.incorrectIds.length === 1 ? ' is' : 'es are'} wrong. Fix the highlighted rows.` })
    onResult(result.correct, { answer_by_pair_id: placed })
  }

  return (
    <InteractionShell
      blockKey={block.key}
      label="Drag to match"
      prompt={block.prompt}
      instructions="Tap an answer, then tap the row it belongs to. You can also drag it."
      feedback={feedback}
      completed={completed}
      canCheck={Object.keys(placed).length === block.pairs.length}
      onCheck={check}
      remediation={remediation}
      hint={hint}
    >
      {!completed && (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Answers">
          {answers.map(answer => (
            <AnswerChip
              key={answer}
              answer={answer}
              used={placedAnswers.has(answer)}
              selected={selected === answer}
              onSelect={() => setSelected(prev => (prev === answer ? null : answer))}
            />
          ))}
        </div>
      )}
      <ul className="space-y-2">
        {block.pairs.map(pair => (
          <MatchSlot
            key={pair.id}
            prompt={pair.prompt}
            answer={placed[pair.id] ?? null}
            wrong={wrong.has(pair.id)}
            disabled={completed}
            armedAnswer={selected}
            onPlace={answer => place(pair.id, answer)}
            onTap={() => selected && place(pair.id, selected)}
            onClear={() => clear(pair.id)}
          />
        ))}
      </ul>
    </InteractionShell>
  )
}

function AnswerChip({ answer, used, selected, onSelect }: { answer: string; used: boolean; selected: boolean; onSelect: () => void }) {
  const { dragProps, isDragging } = useDrag({
    getItems: () => [{ [DRAG_TYPE]: answer, 'text/plain': answer }],
  })
  return (
    <button
      type="button"
      {...dragProps}
      onClick={onSelect}
      aria-pressed={selected}
      className={`motion-press min-h-12 select-none rounded-lg border px-4 py-2 text-left text-sm font-semibold transition [-webkit-touch-callout:none] ${
        selected
          ? 'border-brand-navy bg-brand-navy text-white'
          : used
            ? 'border-dashed border-slate-300 text-slate-400 dark:border-slate-700'
            : 'border-slate-300 bg-white text-slate-800 hover:border-brand-navy dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      {answer}
    </button>
  )
}

function MatchSlot({
  prompt, answer, wrong, disabled, armedAnswer, onPlace, onTap, onClear,
}: {
  prompt: string
  answer: string | null
  wrong: boolean
  disabled: boolean
  /** The chip the learner tapped, waiting for a row to land in. */
  armedAnswer: string | null
  onPlace: (answer: string) => void
  onTap: () => void
  onClear: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { dropProps, isDropTarget } = useDrop({
    ref,
    isDisabled: disabled,
    getDropOperation: types => (types.has(DRAG_TYPE) ? 'move' : 'cancel'),
    async onDrop(e) {
      const item = e.items.find((i): i is TextDropItem => i.kind === 'text' && i.types.has(DRAG_TYPE))
      if (item) onPlace(await item.getText(DRAG_TYPE))
    },
  })

  return (
    <li className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,10rem)_1fr] sm:items-center">
      <span className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-200">{prompt}</span>
      <div
        ref={ref}
        {...dropProps}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={answer ? `${prompt}: ${answer}` : `${prompt}: empty. ${armedAnswer ? `Press to place ${armedAnswer}.` : 'Select an answer first.'}`}
        onClick={onTap}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap() } }}
        className={`flex min-h-12 items-center justify-between gap-2 rounded-lg border-2 px-3 py-2 text-sm transition ${
          isDropTarget ? 'border-brand-navy bg-blue-50 dark:bg-blue-950/40'
            : wrong ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/40'
              : answer ? 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900'
                : `border-dashed ${armedAnswer ? 'border-brand-navy bg-blue-50/60 dark:bg-blue-950/30' : 'border-slate-300 dark:border-slate-700'}`
        }`}
      >
        <span className={answer ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-400'}>
          {answer ?? (armedAnswer ? `Tap to place “${armedAnswer}”` : 'Empty')}
        </span>
        {answer && !disabled && (
          <button type="button" onClick={e => { e.stopPropagation(); onClear() }} aria-label={`Clear ${prompt}`}
            className="-my-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </li>
  )
}
