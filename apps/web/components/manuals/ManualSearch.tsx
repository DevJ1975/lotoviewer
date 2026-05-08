'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Search, X } from 'lucide-react'
import { searchManuals, type SearchHit } from '@/lib/manuals/client'

// Type-ahead search across all manuals. Backed by
// /api/manuals/search (Postgres websearch_to_tsquery).

export default function ManualSearch({ className }: { className?: string }) {
  const [q, setQ]       = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!q.trim()) { setHits(null); return }
    debounce.current = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await searchManuals(q)
        setHits(r)
      } catch { setHits([]) }
      finally { setBusy(false) }
    }, 250)
  }, [q])

  return (
    <div className={'space-y-2 ' + (className ?? '')}>
      <div className="relative">
        <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder='Search manuals — e.g. "group lock" -trial'
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
              <li key={h.manual_id}>
                <Link
                  href={`/manuals/${h.module_id}`}
                  className="block px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                      {h.module_id}
                    </span>
                    {h.is_draft && (
                      <span className="inline-block rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-200">
                        draft
                      </span>
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
