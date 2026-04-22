// Tiny shimmer block used to fill space while real data loads. Tailwind's
// animate-pulse is enough — keeps the bundle clean. Pass any className for
// sizing, rounding, or color overrides.
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse bg-slate-200 rounded ${className}`} />
}

// Composed skeleton matching an equipment list row: status dot, two stacked
// text lines, and right-side meta. Matches the live row's px-4 py-3 padding
// and ~68px height so the list doesn't jump on hydration.
export function EquipmentRowSkeleton() {
  return (
    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
      <Skeleton className="w-2.5 h-2.5 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-5 w-12 rounded-full shrink-0" />
    </div>
  )
}

// Composed skeleton for the home dashboard's three-pane layout. Mirrors the
// final shape so the user sees structure first, content second.
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-6rem)]">
      {/* Sidebar */}
      <aside className="shrink-0 w-full lg:w-72 bg-white border-r border-slate-100 p-4 space-y-4">
        <div className="flex gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-7 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
        <div className="space-y-2 pt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      </aside>
      {/* Equipment list */}
      <section className="flex-1 min-w-0 bg-slate-50">
        <div className="bg-white border-b border-slate-200 p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <div className="flex gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20 rounded-full" />
            ))}
          </div>
        </div>
        <div>
          {Array.from({ length: 8 }).map((_, i) => (
            <EquipmentRowSkeleton key={i} />
          ))}
        </div>
      </section>
      {/* Detail */}
      <aside className="shrink-0 w-full lg:w-[520px] bg-slate-100 border-l border-slate-200 p-4 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="aspect-[3/2] w-full rounded-lg" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </aside>
    </div>
  )
}
