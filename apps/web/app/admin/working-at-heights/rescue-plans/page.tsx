'use client'

import { useEffect, useState } from 'react'
import { LifeBuoy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { InventoryShell, InventoryEmpty } from '../_components/InventoryShell'

interface Row {
  id:               string
  location_label:   string
  primary_rescuer:  { display_name: string } | null
  backup_rescuer:   { display_name: string } | null
  last_drilled_at:  string | null
  next_drill_due:   string | null
}

interface DecoratedRow extends Row {
  days_left: number | null
}

export default function RescuePlansPage() {
  const { tenantId, loading: tenantLoading } = useTenant()
  const { profile, loading: authLoading } = useAuth()
  const canManage = !!profile?.is_admin || !!profile?.is_superadmin
  const [rows, setRows] = useState<DecoratedRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tenantId || !canManage) return
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await supabase
        .from('wah_rescue_plans')
        .select('id, location_label, primary_rescuer:members!primary_rescuer_id(display_name), backup_rescuer:members!backup_rescuer_id(display_name), last_drilled_at, next_drill_due')
        .eq('tenant_id', tenantId)
        .order('next_drill_due', { ascending: true, nullsFirst: false })
        .returns<Row[]>()
      if (cancelled) return
      if (err) { setError(err.message); return }
      const now = Date.now()
      const decorated: DecoratedRow[] = (data ?? []).map(r => ({
        ...r,
        days_left: r.next_drill_due
          ? Math.ceil((new Date(r.next_drill_due).getTime() - now) / (24 * 3600 * 1000))
          : null,
      }))
      setRows(decorated)
    })()
    return () => { cancelled = true }
  }, [tenantId, canManage])

  if (authLoading || tenantLoading) return <InventoryShell title="Rescue plans" description="Loading…" Icon={LifeBuoy}><div className="p-6 text-sm text-slate-500">Loading…</div></InventoryShell>
  if (!canManage)                   return <InventoryShell title="Rescue plans" description="Admins only" Icon={LifeBuoy}><div className="p-6 text-sm text-slate-500">Admins only.</div></InventoryShell>

  return (
    <InventoryShell
      title="Rescue plans"
      description="29 CFR 1926.502(d)(20) requires a written rescue plan IN ADVANCE for every fall arrest task. Suspension trauma starts in 6 to 15 minutes; rescue must be self-sufficient."
      Icon={LifeBuoy}
      newHref="/admin/working-at-heights/rescue-plans/new"
      newLabel="+ Add rescue plan"
    >
      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</div>
      )}
      {rows === null ? (
        <div className="p-6 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <InventoryEmpty
          Icon={LifeBuoy}
          title="No rescue plans on file"
          description="Every at-height location needs a written rescue plan with named rescuers and equipment cache before a permit can be issued. The most-cited fall protection violation is operating without one."
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 text-left">Location</th>
              <th className="px-4 py-2 text-left">Primary rescuer</th>
              <th className="px-4 py-2 text-left">Backup rescuer</th>
              <th className="px-4 py-2 text-left">Last drill</th>
              <th className="px-4 py-2 text-left">Next drill due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const daysLeft = r.days_left
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{r.location_label}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.primary_rescuer?.display_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.backup_rescuer?.display_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    {r.last_drilled_at ? new Date(r.last_drilled_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {r.next_drill_due ? (
                      <span className={
                        daysLeft !== null && daysLeft < 0     ? 'font-semibold text-rose-700 dark:text-rose-300'
                        : daysLeft !== null && daysLeft <= 30 ? 'font-semibold text-amber-700 dark:text-amber-300'
                                                              : 'text-slate-700 dark:text-slate-300'
                      }>{new Date(r.next_drill_due).toLocaleDateString()}</span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </InventoryShell>
  )
}
