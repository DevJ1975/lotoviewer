'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Search, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import {
  searchBoards, KIND_LABEL, type SearchHit, type ThreadKind, THREAD_KINDS,
} from '@/lib/safetyBoards/client'

// Inline search bar shown above the board / index pages. Postgres
// websearch_to_tsquery syntax. Results render inline below; clicking
// a hit takes you to the thread (if it's a reply hit, the URL hash
// targets the reply).

interface Props {
  /** Restrict to a board (used on /safety-boards/[boardId] page). */
  boardId?: string
  className?: string
}

export default function BoardSearch({ boardId, className }: Props) {
  const { tenant } = useTenant()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<ThreadKind | 'all'>('all')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!tenant?.id) return
    if (debounce.current) clearTimeout(debounce.current)
    if (!q.trim()) { setHits(null); return }
    debounce.current = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await searchBoards(tenant.id, q, { boardId, kind: kind === 'all' ? undefined : kind })
        setHits(r)
      } catch { setHits([]) }
      finally { setBusy(false) }
    }, 250)
  }, [tenant?.id, q, kind, boardId])

  return (
    <div className={'space-y-2 ' + (className ?? '')}>
      <div className="relative">
        <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={'Search threads + replies… (e.g. "fall protection" -guardrail)'}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 pl-9 pr-9 py-2 text-sm"
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(''); setHits(null) }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            title="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {q && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Kind:</span>
          <FilterChip active={kind === 'all'} onClick={() => setKind('all')}>All</FilterChip>
          {THREAD_KINDS.map(k => (
            <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</FilterChip>
          ))}
        </div>
      )}

      {busy && (
        <p className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> searching…
        </p>
      )}

      {hits && !busy && (
        hits.length === 0 ? (
          <p className="text-xs italic text-slate-500 dark:text-slate-400">No matches.</p>
        ) : (
          <ul className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
            {hits.map(h => (
              <li key={`${h.thread_id}-${h.reply_id ?? 'thread'}`}>
                <Link
                  href={h.reply_id
                    ? `/safety-boards/${h.board_id}/${h.thread_id}#reply-${h.reply_id}`
                    : `/safety-boards/${h.board_id}/${h.thread_id}`}
                  className="block px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                      {KIND_LABEL[h.kind as ThreadKind]}
                    </span>
                    {h.hit_in === 'reply' && (
                      <span className="text-[10px] uppercase font-semibold text-slate-400">Reply hit</span>
                    )}
                    {h.is_anonymous && (
                      <span className="text-[10px] italic text-slate-400">anonymous</span>
                    )}
                    <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{h.title}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{h.snippet}</p>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full px-2 py-0.5 text-xs ' +
        (active
          ? 'bg-brand-navy/10 dark:bg-brand-yellow/15 text-brand-navy dark:text-brand-yellow font-semibold'
          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800')
      }
    >
      {children}
    </button>
  )
}
