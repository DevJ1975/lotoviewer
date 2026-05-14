'use client'

import Link from 'next/link'
import { getModules } from '@soteria/core/features'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
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
      <div className="flex items-center gap-3">
        <h2 className="placard-label-lg text-slate-800 dark:text-slate-100">Your modules</h2>
        <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-slate-300 to-transparent dark:from-slate-700" />
        <span className="placard-label text-slate-400 dark:text-slate-500 placard-numeric">
          {modules.length.toString().padStart(2, '0')} ACTIVE
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {modules.map((m, idx) => (
          <Link
            key={m.id}
            href={m.href!}
            className="placard-surface placard-surface-interactive placard-corner-mark group relative overflow-hidden bg-white dark:bg-slate-900 p-4 pt-5"
          >
            {/* Hazard-yellow header rail on every module card — the
                single most consistent visual hook across the grid. */}
            <span
              aria-hidden="true"
              className="absolute left-0 right-0 top-0 h-[3px] bg-brand-yellow group-hover:bg-brand-navy transition-colors"
            />
            <div className="flex items-baseline justify-between gap-2">
              <p className="stencil-title text-base text-slate-950 dark:text-slate-50 group-hover:text-brand-navy dark:group-hover:text-brand-yellow transition-colors">
                {m.name}
              </p>
              <span className="placard-numeric text-[10px] text-slate-400 dark:text-slate-500">
                M-{(idx + 1).toString().padStart(2, '0')}
              </span>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
              {m.description}
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}
