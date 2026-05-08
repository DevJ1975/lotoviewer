'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Lock, MessageSquare, Pin } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { listThreadsByEntity, KIND_LABEL, type EntityLinkType, type ThreadKind } from '@/lib/safetyBoards/client'

// Drop-in component for entity detail pages (incident, equipment,
// near-miss, …) showing the safety-board threads that link to this
// entity. Renders nothing when there are no threads, so the host page
// can include it unconditionally and only show the section when
// there's content.

interface Props {
  type: EntityLinkType
  id:   string
  className?: string
}

interface ThreadLite {
  id: string; board_id: string; kind: ThreadKind; title: string;
  pinned: boolean; locked: boolean; last_reply_at: string;
}

export default function RelatedDiscussions({ type, id, className }: Props) {
  const { tenant } = useTenant()
  const [threads, setThreads] = useState<ThreadLite[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    void (async () => {
      try {
        const list = await listThreadsByEntity(tenant.id, type, id)
        if (!cancelled) setThreads(list)
      } catch { /* swallow — non-essential surface */ }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [tenant?.id, type, id])

  if (loading || threads.length === 0) return null

  return (
    <section className={'rounded-xl border border-slate-200 dark:border-slate-800 p-3 ' + (className ?? '')}>
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 inline-flex items-center gap-1.5">
        <MessageSquare className="h-4 w-4 text-slate-400" />
        Related safety-board discussions
      </h3>
      <ul className="space-y-1">
        {threads.map(t => (
          <li key={t.id}>
            <Link
              href={`/safety-boards/${t.board_id}/${t.id}`}
              className="block text-sm hover:bg-slate-50 dark:hover:bg-slate-800 rounded px-2 py-1"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  {KIND_LABEL[t.kind]}
                </span>
                {t.pinned && <Pin className="h-3 w-3 text-amber-500" />}
                {t.locked && <Lock className="h-3 w-3 text-slate-400" />}
                <span className="text-slate-800 dark:text-slate-200 truncate">{t.title}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                last activity {new Date(t.last_reply_at).toLocaleString()}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
