'use client'

import { useState, type ReactNode } from 'react'
import { Plus, Minus } from 'lucide-react'

export interface FaqItem { q: string; a: ReactNode }

// Interactive FAQ accordion with "expand all / collapse all" controls.
// Replaces the server-rendered <details> list so users can scan many
// questions quickly without 12 separate clicks.

export default function FaqGroup({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set())

  function toggle(i: number) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const allOpen = open.size === items.length
  function expandAll()  { setOpen(new Set(items.map((_, i) => i))) }
  function collapseAll() { setOpen(new Set()) }

  return (
    <div className="not-prose">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {items.length} questions · {open.size} open
        </p>
        <button
          type="button"
          onClick={allOpen ? collapseAll : expandAll}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {allOpen ? <><Minus className="h-3 w-3" /> Collapse all</> : <><Plus className="h-3 w-3" /> Expand all</>}
        </button>
      </div>
      <ul className="space-y-2">
        {items.map((item, i) => {
          const isOpen = open.has(i)
          return (
            <li
              key={i}
              className={[
                'rounded-lg border transition-colors',
                isOpen
                  ? 'border-brand-navy/30 bg-slate-50 dark:border-brand-yellow/30 dark:bg-slate-900/60'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/30 hover:border-slate-300 dark:hover:border-slate-700',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
                className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-start justify-between gap-3"
              >
                <span>{item.q}</span>
                <span
                  aria-hidden
                  className={[
                    'shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-xs transition-all',
                    isOpen
                      ? 'bg-brand-navy text-white dark:bg-brand-yellow dark:text-brand-navy rotate-45'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                  ].join(' ')}
                >
                  +
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 text-sm text-slate-700 dark:text-slate-300 leading-6 space-y-2 [&_a]:underline [&_a]:text-brand-navy dark:[&_a]:text-brand-yellow [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px]">
                  {item.a}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
