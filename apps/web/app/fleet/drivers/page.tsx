'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, Plus, Loader2, ShieldAlert } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { listDrivers, type DriverWithWorker } from '@/lib/fleet/client'
import { LICENSE_CLASS_LABELS, type LicenseClass } from '@soteria/core/fleetDriver'

const STATUS_STYLE: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  inactive:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

function expiryTone(date: string | null): string {
  if (!date) return 'text-slate-400'
  const days = Math.round((Date.parse(date + 'T00:00:00Z') - Date.now()) / 86400000)
  if (days < 0) return 'text-rose-600 dark:text-rose-400 font-semibold'
  if (days <= 30) return 'text-amber-600 dark:text-amber-400 font-semibold'
  return 'text-slate-600 dark:text-slate-400'
}

export default function DriversPage() {
  const { tenant, role } = useTenant()
  const tenantId = tenant?.id
  const isAdmin = role === 'owner' || role === 'admin'
  const [rows, setRows] = useState<DriverWithWorker[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true); setError(null)
    try { setRows(await listDrivers(tenantId)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <PageHeader
        icon={Users}
        title="Drivers"
        description="Licensing, DOT medical, and hazmat endorsements layered on the worker roster."
        back="/fleet"
        actions={isAdmin ? (
          <Link href="/fleet/drivers/new" className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-navy/90">
            <Plus className="h-4 w-4" /> Add driver
          </Link>
        ) : undefined}
      />

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}

      <section className="rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} eyebrow="Empty" title="No drivers yet" description={isAdmin ? 'Add a driver from your worker roster to track licensing and medical certs.' : 'No drivers have been added.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Class</th>
                  <th className="px-4 py-3 font-semibold">License expires</th>
                  <th className="px-4 py-3 font-semibold">Medical expires</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Hazmat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(d => (
                  <tr key={d.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3"><Link href={`/fleet/drivers/${d.id}`} className="font-semibold text-brand-navy hover:underline dark:text-sky-300">{d.loto_workers?.full_name ?? 'Driver'}</Link></td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{d.license_class ? LICENSE_CLASS_LABELS[d.license_class as LicenseClass] : '—'}</td>
                    <td className={'px-4 py-3 ' + expiryTone(d.license_expires_at)}>{d.license_expires_at || '—'}</td>
                    <td className={'px-4 py-3 ' + expiryTone(d.medical_card_expires_at)}>{d.medical_card_expires_at || '—'}</td>
                    <td className="px-4 py-3"><span className={'inline-block rounded-full px-2 py-0.5 text-xs font-semibold ' + (STATUS_STYLE[d.status] ?? STATUS_STYLE.inactive)}>{d.status}</span></td>
                    <td className="px-4 py-3">{d.hazmat_endorsement && <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"><ShieldAlert className="h-3 w-3" /> HME</span>}</td>
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
