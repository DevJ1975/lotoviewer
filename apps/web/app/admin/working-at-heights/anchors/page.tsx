'use client'

import { useEffect, useState } from 'react'
import { Anchor } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { InventoryShell, InventoryEmpty } from '../_components/InventoryShell'

interface Row {
  id:                          string
  asset_tag:                   string | null
  location_label:              string
  kind:                        string
  rated_capacity_lbf:          number
  workers_max:                 number
  qp_name:                     string | null
  recertification_due_at:      string | null
  status:                      string
}

interface DecoratedRow extends Row {
  days_left: number | null
}

const KIND_LABEL: Record<string, string> = {
  engineered_permanent:  'Engineered (permanent)',
  engineered_portable:   'Engineered (portable)',
  horizontal_lifeline:   'Horizontal lifeline',
  improvised:            'Improvised (CP-chosen)',
}

export default function AnchorsPage() {
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
        .from('wah_anchors')
        .select('id, asset_tag, location_label, kind, rated_capacity_lbf, workers_max, qp_name, recertification_due_at, status')
        .eq('tenant_id', tenantId)
        .order('recertification_due_at', { ascending: true, nullsFirst: false })
        .returns<Row[]>()
      if (cancelled) return
      if (err) { setError(err.message); return }
      const now = Date.now()
      const decorated: DecoratedRow[] = (data ?? []).map(r => ({
        ...r,
        days_left: r.recertification_due_at
          ? Math.ceil((new Date(r.recertification_due_at).getTime() - now) / (24 * 3600 * 1000))
          : null,
      }))
      setRows(decorated)
    })()
    return () => { cancelled = true }
  }, [tenantId, canManage])

  if (authLoading || tenantLoading) return <InventoryShell title="Anchor points" description="Loading…" Icon={Anchor}><div className="p-6 text-sm text-slate-500">Loading…</div></InventoryShell>
  if (!canManage)                   return <InventoryShell title="Anchor points" description="Admins only" Icon={Anchor}><div className="p-6 text-sm text-slate-500">Admins only.</div></InventoryShell>

  return (
    <InventoryShell
      title="Anchor points"
      description="Engineered + improvised anchors. OSHA requires 5,000 lbf per worker OR engineered 2:1 safety factor; engineered systems carry a QP-of-record + 5-year recertification cycle."
      Icon={Anchor}
      newHref="/admin/working-at-heights/anchors/new"
      newLabel="+ Add anchor"
    >
      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</div>
      )}
      {rows === null ? (
        <div className="p-6 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <InventoryEmpty
          Icon={Anchor}
          title="No anchors on file"
          description="A fall arrest system without a proven anchor is a costume. Add each engineered anchor with its load rating, QP-of-record, and certification date; track improvised anchors per task."
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 text-left">Location</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">Rated</th>
              <th className="px-4 py-2 text-left">Workers</th>
              <th className="px-4 py-2 text-left">QP-of-record</th>
              <th className="px-4 py-2 text-left">Recert due</th>
              <th className="px-4 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const daysLeft = r.days_left
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{r.location_label}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.rated_capacity_lbf.toLocaleString()} lbf</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.workers_max}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.qp_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    {r.recertification_due_at ? (
                      <span className={
                        daysLeft !== null && daysLeft < 0     ? 'font-semibold text-rose-700 dark:text-rose-300'
                        : daysLeft !== null && daysLeft <= 90 ? 'font-semibold text-amber-700 dark:text-amber-300'
                                                              : 'text-slate-700 dark:text-slate-300'
                      }>{new Date(r.recertification_due_at).toLocaleDateString()}</span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.status.replaceAll('_', ' ')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </InventoryShell>
  )
}
