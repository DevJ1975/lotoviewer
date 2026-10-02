/**
 * How many of a change's impacts are resolved. A change with none listed is not "complete":
 * nothing was checked, so it says that, in a neutral bar.
 */
export function Progress({ resolved, total, label = 'Impacts resolved' }: { resolved: number; total: number; label?: string }) {
  if (total === 0) {
    return <p className="w-40 text-right text-xs text-slate-600 dark:text-slate-400">No records listed automatically</p>
  }
  const percent = Math.round((resolved / total) * 100)
  return (
    <div className="w-40 text-right">
      <p className="text-xs text-slate-600 dark:text-slate-300">{resolved} of {total} resolved</p>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={total} aria-valuenow={resolved} aria-valuetext={`${resolved} of ${total} resolved`}>
        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
