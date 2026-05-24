'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Users, Loader2, Pencil, Trash2, Truck } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import { DriverForm } from '../../_components/DriverForm'
import { getDriver, updateDriver, deleteDriver, type DriverWithWorker } from '@/lib/fleet/client'
import { LICENSE_CLASS_LABELS, type DriverInput, type LicenseClass } from '@soteria/core/fleetDriver'

type AssignedVehicle = { id: string; unit_number: string | null; make: string | null; model: string | null; status: string }

export default function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { tenant, role } = useTenant()
  const tenantId = tenant?.id
  const isAdmin = role === 'owner' || role === 'admin'

  const [driver, setDriver] = useState<DriverWithWorker | null>(null)
  const [vehicles, setVehicles] = useState<AssignedVehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true); setError(null)
    try { const data = await getDriver(tenantId, id); setDriver(data.driver); setVehicles(data.vehicles) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [tenantId, id])

  useEffect(() => { void load() }, [load])

  async function handleEdit(input: DriverInput) {
    if (!tenantId) return
    await updateDriver(tenantId, id, input)
    setEditing(false); await load()
  }

  async function handleDelete() {
    if (!tenantId || !confirm('Delete this driver profile? (The roster worker is kept.)')) return
    await deleteDriver(tenantId, id)
    router.push('/fleet/drivers')
  }

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  if (error) return <main className="mx-auto max-w-3xl px-4 py-6"><div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div></main>
  if (!driver) return null

  const name = driver.loto_workers?.full_name ?? 'Driver'

  if (editing) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 space-y-5">
        <PageHeader icon={Users} title={`Edit ${name}`} back={`/fleet/drivers/${id}`} />
        {tenant?.id && <DriverForm tenantId={tenant.id} includeWorkerPicker={false} workerName={name} submitLabel="Save changes" onSubmit={handleEdit} initial={toInput(driver)} />}
        <button onClick={() => setEditing(false)} className="text-sm text-slate-500 hover:underline">Cancel</button>
      </main>
    )
  }

  const rows: [string, string | null][] = [
    ['License #', driver.license_number],
    ['Class', driver.license_class ? LICENSE_CLASS_LABELS[driver.license_class as LicenseClass] : null],
    ['State', driver.license_state],
    ['License expires', driver.license_expires_at],
    ['DOT medical expires', driver.medical_card_expires_at],
    ['Hazmat endorsement', driver.hazmat_endorsement ? (driver.hazmat_endorsement_expires_at ? `Yes · expires ${driver.hazmat_endorsement_expires_at}` : 'Yes') : 'No'],
    ['Defensive training', driver.defensive_training_at],
    ['Status', driver.status],
  ]

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-5">
      <PageHeader
        icon={Users}
        title={name}
        description={driver.loto_workers?.employee_id ? `Employee ${driver.loto_workers.employee_id}` : undefined}
        back="/fleet/drivers"
        actions={isAdmin ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"><Pencil className="h-4 w-4" /> Edit</button>
            <button onClick={handleDelete} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700"><Trash2 className="h-4 w-4" /></button>
          </div>
        ) : undefined}
      />

      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{k}</dt><dd className="text-sm capitalize text-slate-800 dark:text-slate-200">{v || '—'}</dd></div>
          ))}
        </dl>
        {(driver.endorsements ?? []).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {driver.endorsements.map(e => <span key={e} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{e.replace(/_/g, ' ')}</span>)}
          </div>
        )}
        {driver.notes && <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">{driver.notes}</p>}
      </div>

      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300"><Truck className="h-4 w-4" /> Assigned vehicles</h2>
        {vehicles.length === 0 ? <p className="text-sm text-slate-500">No vehicles assigned.</p> : (
          <ul className="space-y-1.5">
            {vehicles.map(v => <li key={v.id}><Link href={`/fleet/vehicles/${v.id}`} className="text-sm text-brand-navy hover:underline dark:text-sky-300">{v.unit_number || [v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'}</Link> <span className="text-xs text-slate-400">· {v.status.replace(/_/g, ' ')}</span></li>)}
          </ul>
        )}
      </section>
    </main>
  )
}

function toInput(d: DriverWithWorker): Partial<DriverInput> {
  return {
    license_number: d.license_number, license_class: d.license_class, license_state: d.license_state,
    license_expires_at: d.license_expires_at, medical_card_expires_at: d.medical_card_expires_at,
    hazmat_endorsement: d.hazmat_endorsement, hazmat_endorsement_expires_at: d.hazmat_endorsement_expires_at,
    endorsements: d.endorsements, defensive_training_at: d.defensive_training_at, status: d.status, notes: d.notes,
  }
}
