'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, Lock, MessageSquare, Pin, TrendingUp } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { fetchTrending, KIND_LABEL, type TrendingRow } from '@/lib/safetyBoards/client'

// "Trending in the past 7 days" panel for the boards index. Hidden
// when there's no recent activity so a quiet tenant doesn't see an
// empty section.

export default function TrendingWidget({ className }: { className?: string }) {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<TrendingRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    void (async () => {
      try {
        const t = await fetchTrending(tenant.id, 8)
        if (!cancelled) setRows(t)
      } catch { /* swallow */ }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [tenant?.id])

  if (loading || rows.length === 0) return null

  return (
    <section className={'rounded-xl border border-slate-200 dark:border-slate-800 p-3 ' + (className ?? '')}>
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 inline-flex items-center gap-1.5">
        <TrendingUp className="h-4 w-4 text-slate-400" />
        Trending this week
      </h3>
      <ul className="space-y-1">
        {rows.map(r => (
          <li key={r.thread_id}>
            <Link
              href={`/safety-boards/${r.board_id}/${r.thread_id}`}
              className="block text-sm hover:bg-slate-50 dark:hover:bg-slate-800 rounded px-2 py-1"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  {KIND_LABEL[r.kind]}
                </span>
                {r.pinned && <Pin className="h-3 w-3 text-amber-500" />}
                {r.locked && <Lock className="h-3 w-3 text-slate-400" />}
                {r.acknowledgement_required && <Bell className="h-3 w-3 text-amber-600" />}
                <span className="text-slate-800 dark:text-slate-100 truncate">{r.title}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-2">
                <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{r.reply_count_7d}</span>
                <span>· {r.reaction_count_7d} reactions</span>
                <span>· score {r.score}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
