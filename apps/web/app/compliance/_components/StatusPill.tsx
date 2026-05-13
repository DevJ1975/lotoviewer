import { STATUS_LABEL, STATUS_TONE, type ObligationStatus } from '@soteria/core/compliance'

// Tailwind 4 JIT scans verbatim — keep these as literal class strings.
const TONE_CLASS: Record<typeof STATUS_TONE[ObligationStatus], string> = {
  rose:    'bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800',
  amber:   'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800',
  sky:     'bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800',
  slate:   'bg-slate-100 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700',
  emerald: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800',
}

export function StatusPill({ status }: { status: ObligationStatus }) {
  const tone = STATUS_TONE[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${TONE_CLASS[tone]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}
