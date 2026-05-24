'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Truck, Plus, Loader2, ShieldAlert } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { listVehicles, type VehicleListRow } from '@/lib/fleet/client'
import { VEHICLE_TYPE_LABELS, type VehicleType } from '@soteria/core/fleet'

const STATUS_STYLE: Record<string, string> = {
  active:         'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  out_of_service: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  retired:        'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

export default function VehiclesPage() {
  const { tenant, role } = useTenant()
  const tenantId = tenant?.id
  const isAdmin = role === 'owner' || role === 'admin'
  const [rows, setRows] = useState<VehicleListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true); setError(null)
    try { setRows(await listVehicles(tenantId)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <PageHeader
        icon={Truck}
        title="Vehicles"
        description="Fleet inventory with DOT and hazmat records."
        back="/fleet"
        actions={isAdmin ? (
          <Link href="/fleet/vehicles/new" className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-navy/90">
            <Plus className="h-4 w-4" /> Add vehicle
          </Link>
        ) : undefined}
      />

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}

      <section className="rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Truck} eyebrow="Empty" title="No vehicles yet" description={isAdmin ? 'Add your first vehicle to start tracking DOT, hazmat, and documents.' : 'No vehicles have been added to this fleet.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-3 font-semibold">Unit</th>
                  <th className="px-4 py-3 font-semibold">Vehicle</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Plate / VIN</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(v => (
                  <tr key={v.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <Link href={`/fleet/vehicles/${v.id}`} className="font-semibold text-brand-navy hover:underline dark:text-sky-300">{v.unit_number || '—'}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{[v.model_year, v.make, v.model].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{VEHICLE_TYPE_LABELS[v.vehicle_type as VehicleType] ?? v.vehicle_type}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{v.license_plate || v.vin || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={'inline-block rounded-full px-2 py-0.5 text-xs font-semibold ' + (STATUS_STYLE[v.status] ?? STATUS_STYLE.retired)}>{v.status.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-4 py-3">
                      {v.carries_hazmat && <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"><ShieldAlert className="h-3 w-3" /> Hazmat</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
