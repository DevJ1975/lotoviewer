import Link from 'next/link'
import { ArrowLeft, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface Props {
  /** Optional Lucide icon rendered next to the title at h1-size. */
  icon?:        LucideIcon
  /** Page title. h1, font-bold, tight tracking. Required. */
  title:        string
  /** One-line description shown below the title. Optional. */
  description?: string
  /** Path the back-arrow links to. Omit to hide the back arrow. */
  back?:        string
  /** Right-aligned action slot — usually one or two <Button>s. */
  actions?:     React.ReactNode
  className?:   string
}

// Page-top header used across every authenticated page so the visual
// hierarchy stays the same: optional back-arrow, icon + title, optional
// description, optional right-aligned actions. Replaces the
// `<header><Link><div><h1>...` boilerplate that was repeating across
// 50+ pages.
export function PageHeader({ icon: Icon, title, description, back, actions, className }: Props) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        'placard-surface animate-panel-in relative flex items-start gap-3 px-4 py-3 pl-5',
        className,
      )}
    >
      {/* Brand-yellow left edge accent — ties every page header to
          the same identity rail used on module cards and the hero. */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-2 bottom-2 w-1 rounded-r-sm bg-brand-yellow"
      />
      {back && (
        <Link
          href={back}
          aria-label="Back"
          className="motion-press mt-1 flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-brand-navy/30 hover:bg-brand-navy/5 hover:text-brand-navy dark:border-slate-800 dark:text-slate-400 dark:hover:border-brand-yellow/30 dark:hover:bg-brand-yellow/10 dark:hover:text-brand-yellow"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="stencil-title flex items-center gap-2 text-lg leading-tight text-slate-950 sm:text-xl dark:text-slate-50">
          {Icon && (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-brand-navy dark:border-slate-800 dark:bg-slate-900 dark:text-brand-yellow">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <span className="truncate">{title}</span>
        </h1>
        {description && (
          <p className="ops-muted mt-1 truncate text-sm">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
