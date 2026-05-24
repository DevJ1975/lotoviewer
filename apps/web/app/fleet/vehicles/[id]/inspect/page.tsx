'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, Loader2, Check, X, Minus } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import { createInspection } from '@/lib/fleet/client'
import { buildDefaultChecklist, type ChecklistItem, type ItemStatus } from '@soteria/core/fleetInspection'

const STATUS_BTN: Record<ItemStatus, { label: string; on: string; icon: typeof Check }> = {
  pass: { label: 'Pass', on: 'bg-emerald-600 text-white border-emerald-600', icon: Check },
  fail: { label: 'Fail', on: 'bg-rose-600 text-white border-rose-600', icon: X },
  na:   { label: 'N/A',  on: 'bg-slate-500 text-white border-slate-500', icon: Minus },
}

export default function InspectVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { tenant } = useTenant()
  const tenantId = tenant?.id

  const [items, setItems] = useState<ChecklistItem[]>(buildDefaultChecklist())
  const [odometer, setOdometer] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setStatus(i: number, status: ItemStatus) {
    setItems(prev => prev.map((it, j) => (j === i ? { ...it, status } : it)))
  }
  function setNote(i: number, note: string) {
    setItems(prev => prev.map((it, j) => (j === i ? { ...it, note } : it)))
  }

  const failCount = items.filter(i => i.status === 'fail').length

  async function submit() {
    if (!tenantId) return
    setSaving(true); setError(null)
    try {
      const r = await createInspection(tenantId, id, {
        items,
        odometer_miles: odometer.trim() ? Number(odometer) : null,
      })
      if (r.vehicleOutOfService) {
        alert('Inspection failed — vehicle marked OUT OF SERVICE.')
      }
      router.push(`/fleet/vehicles/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setSaving(false)
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-5">
      <PageHeader icon={ClipboardCheck} title="Pre-trip inspection" description="Mark each item, then submit. A failed item takes the vehicle out of service." back={`/fleet/vehicles/${id}`} />

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}

      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <label className="block max-w-xs">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Odometer (mi)</span>
          <input type="number" value={odometer} onChange={e => setOdometer(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
        </label>
      </div>

      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={it.key} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{it.label}</span>
              <div className="flex gap-1">
                {(Object.keys(STATUS_BTN) as ItemStatus[]).map(s => {
                  const cfg = STATUS_BTN[s]; const active = it.status === s; const Icon = cfg.icon
                  return (
                    <button key={s} type="button" onClick={() => setStatus(i, s)}
                      className={'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold ' + (active ? cfg.on : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400')}>
                      <Icon className="h-3.5 w-3.5" /> {cfg.label}
                    </button>
                  )
                })}
              </div>
            </div>
            {it.status === 'fail' && (
              <input value={it.note ?? ''} onChange={e => setNote(i, e.target.value)} placeholder="Describe the defect…" className="mt-2 w-full rounded-md border border-rose-200 px-3 py-1.5 text-sm dark:border-rose-900 dark:bg-slate-900" />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className={'text-sm font-semibold ' + (failCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
          {failCount > 0 ? `${failCount} item${failCount === 1 ? '' : 's'} failing` : 'All items passing'}
        </p>
        <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Submit inspection
        </button>
      </div>
    </main>
  )
}
