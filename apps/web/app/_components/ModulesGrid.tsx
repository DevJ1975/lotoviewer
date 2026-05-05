'use client'

import Link from 'next/link'
import { getModules } from '@/lib/features'
import { isModuleVisible } from '@/lib/moduleVisibility'
import { useTenant } from '@/components/TenantProvider'

// Module navigation grid — deemphasized at the bottom of the dashboard
// because the drawer is the primary navigation surface. Filters out
// coming-soon modules; those render as ads via ComingSoonStrip. Also
// filters out modules the active tenant doesn't have visibility on so
// the dashboard mirrors the drawer's per-tenant gating.

export function ModulesGrid() {
  const { tenant } = useTenant()
  const modules = getModules('safety')
    .filter(m => !m.comingSoon)
    .filter(m => isModuleVisible(m.id, tenant?.modules))
  if (modules.length === 0) return null
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Your modules</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {modules.map(m => (
          <Link
            key={m.id}
            href={m.href!}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:border-brand-navy hover:shadow-sm transition-all group"
          >
            <p className="text-base font-bold text-slate-900 dark:text-slate-100 group-hover:text-brand-navy transition-colors">{m.name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">{m.description}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
