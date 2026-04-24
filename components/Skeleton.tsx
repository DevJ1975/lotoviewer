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

// Composed skeleton for /decommission. Mirrors header + 3 counter tiles +
// search + grouped list so the layout doesn't snap on hydration.
export function DecommissionSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3.5 border-t border-slate-100 first:border-t-0 flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded shrink-0" />
            <Skeleton className="h-5 w-5 rounded shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Composed skeleton for /status. Mirrors the header, four stat cards, and
// the two-up ring + chart row.
export function StatusSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <Skeleton className="h-4 w-14 rounded-full" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
      </div>
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
