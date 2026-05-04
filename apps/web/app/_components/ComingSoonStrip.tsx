'use client'

import { getModules } from '@/lib/features'

export function ComingSoonStrip() {
  const upcoming = getModules('safety').filter(m => m.comingSoon)
  if (upcoming.length === 0) return null
  return (
    <section className="rounded-xl border border-dashed border-violet-200 bg-violet-50 dark:bg-violet-950/40/40 p-4 space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-widest text-violet-800 dark:text-violet-200">Coming Soon</p>
      <div className="flex flex-wrap gap-3">
        {upcoming.map(m => (
          <div key={m.id} className="flex-1 min-w-[200px]">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{m.name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{m.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
