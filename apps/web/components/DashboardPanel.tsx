import Link from 'next/link'
import { ArrowRight, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// One panel anatomy for the home dashboard.
//
// Eight panels shipped the same 6-line header by hand — surface classes,
// eyebrow, title, right-aligned link — and the eyebrow's ad-hoc
// `text-[10px] font-bold uppercase tracking-widest` was pasted verbatim
// beside siblings (ActivePermitsPanel, PageHeader, EmptyState) already
// speaking the placard vocabulary from globals.css. Two card geometries,
// two type scales, one screen.
//
// The two-line eyebrow/title split is kept because it carries real
// information in a safety product: the eyebrow names the standard the
// panel answers to ("Risk Assessment · ISO 45001 6.1") and the title
// names the thing. Only the vocabulary changes — every class below is
// one a sibling component on the same page already uses.

interface Props {
  /** Standard or programme the panel reports against. Rendered as a placard label. */
  eyebrow:    React.ReactNode
  /** Human name of the panel. Sentence case; becomes the section's h2. */
  title:      React.ReactNode
  /** Optional icon rendered left of the eyebrow/title block. */
  icon?:      LucideIcon
  /** Right-aligned slot — usually a <PanelLink> or a status badge. */
  action?:    React.ReactNode
  className?: string
  children:   React.ReactNode
}

export function DashboardPanel({ eyebrow, title, icon: Icon, action, className, children }: Props) {
  return (
    <section
      data-slot="dashboard-panel"
      className={cn('placard-surface space-y-4 p-5', className)}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <Icon className="h-4 w-4 shrink-0 text-brand-navy dark:text-brand-yellow" />
          )}
          <div className="min-w-0">
            <PanelEyebrow>{eyebrow}</PanelEyebrow>
            <h2 className="stencil-title mt-1 text-base text-slate-950 dark:text-slate-50">
              {title}
            </h2>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  )
}

/**
 * The panel's small tracked-out label. Exported because panels also use it
 * for the headings of mini-lists inside their body ("Top risks", "Recent
 * observations"), which is the same element in a different place.
 */
export function PanelEyebrow({
  children,
  className,
}: {
  children:   React.ReactNode
  className?: string
}) {
  return (
    <p className={cn('placard-label text-slate-500 dark:text-slate-400', className)}>
      {children}
    </p>
  )
}

/**
 * The "go to the full module" link every panel puts in its `action` slot.
 *
 * `dark:text-brand-yellow` is not a restyle: brand-navy on dark slate-900
 * was close to invisible, and the yellow pairing is what ActivePermitsPanel
 * already does one panel over.
 */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-semibold text-brand-navy hover:underline dark:text-brand-yellow"
    >
      {children}
      <ArrowRight className="h-3 w-3" />
    </Link>
  )
}
