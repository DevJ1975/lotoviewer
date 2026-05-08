import { AlertTriangle, AlertOctagon, ShieldCheck } from 'lucide-react'
import { BBS_KIND_LABEL, type BBSKind } from '@soteria/core/bbs'
import { cn } from '@/lib/utils'

const KIND_CLASS: Record<BBSKind, string> = {
  unsafe_act:       'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 ring-amber-200 dark:ring-amber-800',
  unsafe_condition: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300 ring-rose-200 dark:ring-rose-800',
  safe_behavior:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800',
}

const KIND_ICON: Record<BBSKind, React.ComponentType<{ className?: string }>> = {
  unsafe_act:       AlertTriangle,
  unsafe_condition: AlertOctagon,
  safe_behavior:    ShieldCheck,
}

export function KindBadge({ kind, className }: { kind: BBSKind; className?: string }) {
  const Icon = KIND_ICON[kind]
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ring-1',
      KIND_CLASS[kind],
      className,
    )}>
      <Icon className="w-3 h-3" />
      {BBS_KIND_LABEL[kind]}
    </span>
  )
}

const SCORE_BAND_CLASS = {
  low:      'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  moderate: 'bg-amber-100  text-amber-800  dark:bg-amber-900/30  dark:text-amber-300',
  high:     'bg-rose-100   text-rose-800   dark:bg-rose-900/30   dark:text-rose-300',
} as const

export function RiskScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null
  const band = score <= 2 ? 'low' : score <= 4 ? 'moderate' : 'high'
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
      SCORE_BAND_CLASS[band],
    )}>
      Risk {score}
    </span>
  )
}
