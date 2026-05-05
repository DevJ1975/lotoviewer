'use client'

import Link from 'next/link'
import type { HotWorkPermit } from '@soteria/core/types'
import { hotWorkState } from '@soteria/core/hotWorkPermitStatus'

// Reverse cross-link of the FK on loto_hot_work_permits.associated_cs_permit_id.
// Renders only when at least one hot-work permit points here. Shows
// the lifecycle state and a deep-link to the hot-work detail page so
// the CS entry supervisor can hop over to verify fire watch / pre-work
// conditions. Active hot-work permits get a rose ring; closed/expired
// ones get a quieter slate ring so the eye is drawn to live concerns.

export function LinkedHotWorkBanner({ permits }: { permits: HotWorkPermit[] }) {
  return (
    <div className="rounded-xl border-2 border-rose-300 bg-rose-50/60 dark:bg-rose-950/40/60 p-4 space-y-2">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-rose-900 dark:text-rose-100">
          🔥 Linked hot-work permits · §1910.146(f)(15)
        </p>
        <p className="text-[11px] text-rose-900/80 dark:text-rose-100/80 mt-0.5">
          Concurrent fire-risk work inside this space — verify each fire watcher is on duty before entrants are allowed.
        </p>
      </header>
      <ul className="space-y-1">
        {permits.map(p => {
          const s = hotWorkState(p)
          const isLive = s === 'active' || s === 'post_work_watch' || s === 'pending_signature'
          return (
            <li key={p.id}>
              <Link
                href={`/hot-work/${p.id}`}
                className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-xs transition-colors ${
                  isLive
                    ? 'bg-white dark:bg-slate-900 ring-1 ring-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                    : 'bg-slate-50 dark:bg-slate-900/40 ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span className="font-mono font-bold tracking-wider">{p.serial}</span>
                <span className="text-slate-600 dark:text-slate-300 truncate">{p.work_location}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  isLive ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}>{s.replace(/_/g, ' ')}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
