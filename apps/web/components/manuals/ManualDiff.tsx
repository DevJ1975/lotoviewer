'use client'

import { useMemo } from 'react'
import { diffWords } from '@/lib/manuals/diff'

// Inline word-level diff for two manual versions. Insertions render
// green; deletions render red with a strikethrough. Equal text is
// muted so the eye snaps to changes.

interface Props {
  before: string
  after:  string
  className?: string
}

export default function ManualDiff({ before, after, className }: Props) {
  const segments = useMemo(() => diffWords(before, after), [before, after])
  return (
    <div className={'rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-3 text-sm leading-relaxed whitespace-pre-wrap break-words ' + (className ?? '')}>
      {segments.map((s, i) => {
        if (s.op === 'equal') {
          return <span key={i} className="text-slate-500 dark:text-slate-400">{s.text}</span>
        }
        if (s.op === 'insert') {
          return (
            <span
              key={i}
              className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-100 rounded px-0.5"
            >
              {s.text}
            </span>
          )
        }
        return (
          <span
            key={i}
            className="bg-rose-100 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 rounded px-0.5 line-through"
          >
            {s.text}
          </span>
        )
      })}
    </div>
  )
}
