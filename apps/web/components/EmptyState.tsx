import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface Props {
  /** Lucide (or custom safety pictogram) icon for the empty illustration. */
  icon?:        LucideIcon
  /** Headline. Short, one phrase. */
  title:        string
  /** Sub-text — explain what's missing and what to do about it. */
  description?: string
  /** Optional eyebrow above the title (e.g. "STANDBY", "ALL CLEAR"). */
  eyebrow?:     string
  /** Optional CTA — usually a single <Button>. */
  action?:      React.ReactNode
  className?:   string
}

// Placard-styled empty state for any list / table / panel that returns
// zero rows. Uses the same vocabulary as the rest of the app —
// placard-label eyebrow, stencil-title headline, square-cornered icon
// tile that mirrors module placards.
//
// Default eyebrow is "All Clear" — appropriate for safety dashboards
// where "no rows" usually means "no problems found." Pass a different
// eyebrow ("Empty", "Offline", "Standby") when the absence is a state
// the user needs to act on.
export function EmptyState({
  icon: Icon,
  title,
  description,
  eyebrow = 'All Clear',
  action,
  className,
}: Props) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className
      )}
    >
      {Icon && (
        <div className="module-icon-tile flex items-center justify-center size-12 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-brand-navy dark:text-brand-yellow">
          <Icon className="size-6" />
        </div>
      )}
      <div className="space-y-1.5 max-w-sm">
        <p className="placard-label text-slate-500 dark:text-slate-500">{eyebrow}</p>
        <p className="stencil-title text-base text-slate-950 dark:text-slate-50">{title}</p>
        {description && (
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
