import { AlertTriangle, CheckCircle2, FileWarning } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { PackStatus } from '@/lib/environmental/client'

// The two honesty markers of the library. Its content is drafted, with citations,
// and signed off by a Certified Safety Professional before it is treated as
// reviewed; anything specific that has not been confirmed against current text
// carries a note saying what to check. The screens show both, always.

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold'

/** "Draft" until every pack behind the content has been signed off. */
export function DraftBadge({ packs, className }: { packs: PackStatus[]; className?: string }) {
  const draft = packs.some(p => p.status === 'draft')
  return draft ? (
    <span
      className={cn(chip, 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200', className)}
      title="This content was drafted with citations and has not yet been reviewed and signed off by a Certified Safety Professional. Confirm it against the current regulation before relying on it."
    >
      <FileWarning className="h-3 w-3" /> Draft: pending expert review
    </span>
  ) : (
    <span className={cn(chip, 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200', className)}>
      <CheckCircle2 className="h-3 w-3" /> Reviewed
    </span>
  )
}

/** A marker on a citation the library has not confirmed, with what to check. */
export function VerifyNote({ note }: { note: string }) {
  return (
    <span className="inline-flex items-start gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span><strong>Verify:</strong> {note}</span>
    </span>
  )
}

export interface CitationView { ref: string; title?: string; url?: string; verify?: string }

export function CitationList({ citations, className }: { citations: CitationView[]; className?: string }) {
  if (citations.length === 0) return null
  return (
    <ul className={cn('space-y-1 text-xs text-slate-600 dark:text-slate-400', className)}>
      {citations.map(c => (
        <li key={c.ref} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {c.url
            ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-navy underline-offset-2 hover:underline dark:text-brand-yellow">{c.ref}</a>
            : <span className="font-medium text-slate-700 dark:text-slate-300">{c.ref}</span>}
          {c.title && <span>{c.title}</span>}
          {c.verify && <VerifyNote note={c.verify} />}
        </li>
      ))}
    </ul>
  )
}

const TONES = {
  good: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  bad:  'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200',
  idle: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
} as const

export function StatusChip({ tone, children, className }: { tone: keyof typeof TONES; children: ReactNode; className?: string }) {
  return <span className={cn(chip, TONES[tone], className)}>{children}</span>
}
