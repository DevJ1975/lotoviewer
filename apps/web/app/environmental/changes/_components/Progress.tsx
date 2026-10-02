/** How many of a change's impacts are resolved. An empty checklist reads as complete: there is nothing left to do. */
export function Progress({ resolved, total }: { resolved: number; total: number }) {
  const percent = total === 0 ? 100 : Math.round((resolved / total) * 100)
  return (
    <div className="w-40 text-right">
      <p className="text-xs text-slate-600 dark:text-slate-300">{resolved} of {total} resolved</p>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar"
        aria-label="Impacts resolved" aria-valuemin={0} aria-valuemax={total} aria-valuenow={resolved}>
        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
