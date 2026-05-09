import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface Props {
  /** Lucide icon for the empty illustration. */
  icon?:        LucideIcon
  /** Headline. Short, one phrase. */
  title:        string
  /** Sub-text — explain what's missing and what to do about it. */
  description?: string
  /** Optional CTA — usually a single <Button>. */
  action?:      React.ReactNode
  className?:   string
}

// Replaces "no items" italic text everywhere with a consistent empty
// state: centered icon in a circle, headline, supporting copy, and
// optional CTA. Use anywhere a list / table / panel can return zero
// rows so users always get a friendly explanation + next-step.
export function EmptyState({ icon: Icon, title, description, action, className }: Props) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className
      )}
    >
      {Icon && (
        <div className="flex items-center justify-center size-12 rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" />
        </div>
      )}
      <div className="space-y-1 max-w-sm">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
