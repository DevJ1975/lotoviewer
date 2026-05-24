'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Building2, Layers } from 'lucide-react'
import { useFacility } from '@/components/FacilityProvider'

// Facility indicator + switcher in the app header, sitting next to the tenant
// pill. Only rendered when the active tenant has MORE THAN ONE facility —
// single-facility tenants (the common case) have nothing to switch and the
// tenant pill already conveys the org.
//
// The menu offers an "All facilities" roll-up option (facilityId = null) plus
// one row per facility. Selecting writes sessionStorage and hard-reloads via
// switchFacility; the Supabase fetch wrapper then carries the new
// x-active-facility header and migration 201's RLS scopes the data.

export default function FacilityHeaderPill() {
  const { facilityId, facility, available, loading, switchFacility } = useFacility()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Dismiss on outside click / Esc.
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Nothing to pick when the tenant has 0 or 1 facility.
  if (loading || available.length <= 1) return null

  const isRollup = facilityId === null
  const label    = isRollup ? 'All facilities' : (facility?.name ?? 'Facility')

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 min-w-0 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 cursor-pointer transition-colors"
      >
        {isRollup
          ? <Layers className="h-4 w-4 text-white/70 shrink-0" />
          : <Building2 className="h-4 w-4 text-white/70 shrink-0" />}
        <span className="hidden sm:inline text-white/90 text-sm font-medium truncate max-w-[140px]">
          {label}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-white/60 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 w-72 max-h-[60vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-lg shadow-2xl border border-slate-200 dark:border-slate-700 z-50"
        >
          <FacilityRow
            active={isRollup}
            icon={<Layers className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />}
            title="All facilities"
            subtitle="Combined roll-up view"
            onSelect={() => { switchFacility(null); setOpen(false) }}
          />
          <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
          {available.map(f => (
            <FacilityRow
              key={f.id}
              active={f.id === facilityId}
              icon={<Building2 className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />}
              title={f.name}
              subtitle={[f.code, f.city, f.is_primary ? 'Primary' : null].filter(Boolean).join(' · ') || undefined}
              onSelect={() => { switchFacility(f.id); setOpen(false) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FacilityRow({
  active, icon, title, subtitle, onSelect,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  subtitle?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
        active
          ? 'bg-brand-navy/5 dark:bg-brand-navy/30'
          : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
      }`}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{title}</div>
        {subtitle && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{subtitle}</div>
        )}
      </div>
      {active && <Check className="h-4 w-4 text-brand-navy dark:text-brand-yellow shrink-0" />}
    </button>
  )
}
