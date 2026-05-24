'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Truck, Users, ArrowRight, Loader2, ShieldAlert } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import { listVehicles, listDrivers } from '@/lib/fleet/client'

// /fleet — module landing. Two registers (vehicles, drivers) with at-a-glance
// counts. Later slices add journeys + monitoring tiles here.

export default function FleetHomePage() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id
  const [counts, setCounts] = useState<{ vehicles: number; outOfService: number; hazmat: number; drivers: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([listVehicles(tenantId), listDrivers(tenantId)])
      .then(([vehicles, drivers]) => {
        if (cancelled) return
        setCounts({
          vehicles:     vehicles.length,
          outOfService: vehicles.filter(v => v.status === 'out_of_service').length,
          hazmat:       vehicles.filter(v => v.carries_hazmat).length,
          drivers:      drivers.length,
        })
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tenantId])

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <PageHeader
        icon={Truck}
        title="Fleet Safety & Journeys"
        description="Vehicle and driver registers, DOT + hazmat records, and (coming soon) monitored journey plans."
      />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Vehicles" value={counts?.vehicles ?? 0} />
          <StatCard label="Out of service" value={counts?.outOfService ?? 0} tone={counts && counts.outOfService > 0 ? 'warn' : undefined} />
          <StatCard label="Carrying hazmat" value={counts?.hazmat ?? 0} icon={ShieldAlert} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <NavCard href="/fleet/vehicles" icon={Truck} title="Vehicles" description="Inventory with photos, DOT data, hazmat placards, insurance + registration scans." />
        <NavCard href="/fleet/drivers" icon={Users} title="Drivers" description="Licensing, DOT medical cards, and hazmat endorsements on your worker roster." />
      </div>
    </main>
  )
}

function StatCard({ label, value, tone, icon: Icon }: { label: string; value: number; tone?: 'warn'; icon?: typeof Truck }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-slate-400" />}
      </div>
      <p className={'mt-2 text-3xl font-bold tabular-nums ' + (tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100')}>{value}</p>
    </div>
  )
}

function NavCard({ href, icon: Icon, title, description }: { href: string; icon: typeof Truck; title: string; description: string }) {
  return (
    <Link href={href} className="group rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-colors hover:border-sky-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-700">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"><Icon className="h-5 w-5" /></span>
        <div className="flex-1">
          <h2 className="flex items-center gap-1 font-semibold text-slate-900 dark:text-slate-100">{title} <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" /></h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
    </Link>
  )
}
