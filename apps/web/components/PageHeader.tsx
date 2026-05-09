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
      className={cn('flex items-start gap-3 pb-4 border-b border-slate-100 dark:border-slate-800', className)}
    >
      {back && (
        <Link
          href={back}
          aria-label="Back"
          className="mt-1 text-slate-400 dark:text-slate-500 hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="font-heading text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 leading-tight tracking-tight flex items-center gap-2">
          {Icon && <Icon className="h-5 w-5 text-slate-500 dark:text-slate-400 shrink-0" />}
          <span className="truncate">{title}</span>
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 truncate">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  )
}
