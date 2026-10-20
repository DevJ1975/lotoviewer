'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import { Button as DragButton, DropIndicator, GridList, GridListItem, useDragAndDrop } from 'react-aria-components'
import { scoreStrikeInteraction, stableShuffle, type StrikeDragSortBlock } from '@soteria/core/strikeContent'
import { InteractionShell, type HintControl, type InteractionFeedback } from './InteractionShell'
import { useStrikeCopy } from './copy'

interface DragSortProps {
  block: StrikeDragSortBlock
  seed: string
  completed: boolean
  remediation: { blockKey: string; title: string } | null
  hint: HintControl
  onResult: (correct: boolean, detail: Record<string, unknown>) => void
}

export function DragSort({ block, seed, completed, remediation, hint, onResult }: DragSortProps) {
  const t = useStrikeCopy()
  const [order, setOrder] = useState(() =>
    completed ? block.items.map(i => i.id) : stableShuffle(block.items, `${seed}:${block.key}`).map(i => i.id),
  )
  const [wrong, setWrong] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState<InteractionFeedback>({ state: 'idle' })
  const labelById = new Map(block.items.map(i => [i.id, i.label]))

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length) return
    setOrder(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
    setWrong(new Set())
    setFeedback({ state: 'idle' })
  }

  const { dragAndDropHooks } = useDragAndDrop({
    isDisabled: completed,
    getItems: keys => [...keys].map(k => ({ 'strike-sort-item': String(k), 'text/plain': labelById.get(String(k)) ?? '' })),
    acceptedDragTypes: ['strike-sort-item'],
    getDropOperation: () => 'move',
    onReorder(e) {
      const moved = String([...e.keys][0] ?? '')
      const from = order.indexOf(moved)
      let to = order.indexOf(String(e.target.key))
      if (from < 0 || to < 0) return
      if (e.target.dropPosition === 'after') to += 1
      if (from < to) to -= 1
      move(from, to)
    },
    renderDropIndicator: target => (
      <DropIndicator target={target} className="my-0.5 h-1 rounded bg-transparent outline-none data-[drop-target]:bg-brand-navy" />
    ),
  })

  function check() {
    const result = scoreStrikeInteraction(block, { kind: 'drag_sort', orderedIds: order })
    setWrong(new Set(result.incorrectIds))
    setFeedback(result.correct
      ? { state: 'correct', message: t.sortCorrect }
      : { state: 'incorrect', message: t.sortWrong(result.incorrectIds.length) })
    onResult(result.correct, { ordered_ids: order })
  }

  return (
    <InteractionShell
      blockKey={block.key}
      label={t.sortLabel}
      prompt={block.prompt}
      instructions={t.sortInstructions}
      feedback={feedback}
      completed={completed}
      canCheck
      onCheck={check}
      remediation={remediation}
      hint={hint}
    >
      <GridList
        aria-label={block.prompt}
        items={order.map(id => ({ id, label: labelById.get(id) ?? id }))}
        selectionMode="none"
        dragAndDropHooks={dragAndDropHooks}
        className="space-y-2 outline-none"
      >
        {item => {
          const index = order.indexOf(item.id)
          const isWrong = wrong.has(item.id)
          return (
            <GridListItem
              id={item.id}
              textValue={item.label}
              className={`flex select-none items-center gap-2 rounded-lg border bg-white p-1.5 outline-none [-webkit-touch-callout:none] data-[dragging]:opacity-50 data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand-navy dark:bg-slate-900 ${
                isWrong ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/40' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <DragButton slot="drag" aria-label={t.move(item.label)} isDisabled={completed}
                className="flex min-h-12 w-11 shrink-0 cursor-grab touch-none flex-col items-center justify-center gap-0.5 self-stretch rounded text-slate-400 outline-none data-[disabled]:cursor-default data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand-navy">
                <span className="text-sm font-black tabular-nums text-slate-700 dark:text-slate-200">{index + 1}</span>
                <GripVertical className="h-5 w-5" aria-hidden />
              </DragButton>
              <span className="min-w-0 flex-1 text-sm font-medium text-slate-900 dark:text-slate-100">{item.label}</span>
              {!completed && (
                // Stacked on phones so the step text keeps its width; side by side on tablets.
                <span className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0}
                    aria-label={t.moveUp(item.label)}
                    className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300">
                    <ChevronUp className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => move(index, index + 1)} disabled={index === order.length - 1}
                    aria-label={t.moveDown(item.label)}
                    className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300">
                    <ChevronDown className="h-5 w-5" />
                  </button>
                </span>
              )}
            </GridListItem>
          )
        }}
      </GridList>
    </InteractionShell>
  )
}
