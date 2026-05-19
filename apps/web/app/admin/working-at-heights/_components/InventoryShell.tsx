'use client'

import Link from 'next/link'
import { ArrowLeft, ListPlus, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// Shared shell for every Working at Heights inventory page. Keeps the
// header layout, breadcrumb, action bar, and empty-state slot
// consistent across the seven inventory surfaces so a worker
// switching between, say, ladders and anchors sees the same chrome.

export interface InventoryShellProps {
  title:       string
  description: string
  Icon:        LucideIcon
  /** Link href for the "+ New" button. null suppresses the button. */
  newHref?:    string | null
  /** Label for the "+ New" button. */
  newLabel?:   string
  children:    ReactNode
}

export function InventoryShell({
  title, description, Icon, newHref = null, newLabel = '+ New', children,
}: InventoryShellProps) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy dark:hover:text-brand-yellow"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Admin
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow">
              <Icon className="size-5" />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Working at Heights
              </p>
              <h1 className="text-2xl font-black text-slate-950 dark:text-slate-50 sm:text-3xl">
                {title}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
                {description}
              </p>
            </div>
          </div>
          {newHref && (
            <Link
              href={newHref}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 dark:bg-brand-yellow dark:text-slate-950 dark:hover:bg-brand-yellow/90"
            >
              <ListPlus className="size-4" />
              {newLabel}
            </Link>
          )}
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {children}
      </section>
    </main>
  )
}

// Empty-state block for inventory pages with no rows yet. Carries the
// same "what this is + how to start" hook every list shows when the
// table is fresh.
export function InventoryEmpty({
  Icon, title, description, action,
}: {
  Icon:        LucideIcon
  title:       string
  description: string
  action?:     ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <Icon className="size-6" />
      </span>
      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>
      {action}
    </div>
  )
}
