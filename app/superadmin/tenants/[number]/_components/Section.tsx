import type { ReactNode } from 'react'

// Card-style wrapper used by every sub-section on the tenant detail page.
// Pulled into its own file so the sub-components don't all redeclare it.
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-5">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{title}</h2>
      {children}
    </section>
  )
}
