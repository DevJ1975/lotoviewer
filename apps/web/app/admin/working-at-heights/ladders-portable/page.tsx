'use client'

import { useEffect, useState } from 'react'
import { Triangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { InventoryShell, InventoryEmpty } from '../_components/InventoryShell'

interface Row {
  id:                 string
  asset_tag:          string | null
  ladder_type:        string
  material:           string
  duty_rating:        string
  height_ft:          number | null
  status:             string
  storage_location:   string | null
}

export default function LaddersPortablePage() {
  const { tenantId, loading: tenantLoading } = useTenant()
  const { profile, loading: authLoading } = useAuth()
  const canManage = !!profile?.is_admin || !!profile?.is_superadmin
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tenantId || !canManage) return
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await supabase
        .from('wah_ladders_portable')
        .select('id, asset_tag, ladder_type, material, duty_rating, height_ft, status, storage_location')
        .eq('tenant_id', tenantId)
        .order('asset_tag', { ascending: true })
        .returns<Row[]>()
      if (cancelled) return
      if (err) { setError(err.message); return }
      setRows(data ?? [])
    })()
    return () => { cancelled = true }
  }, [tenantId, canManage])

  if (authLoading || tenantLoading) return <InventoryShell title="Portable ladders" description="Loading…" Icon={Triangle}><div className="p-6 text-sm text-slate-500">Loading…</div></InventoryShell>
  if (!canManage)                   return <InventoryShell title="Portable ladders" description="Admins only" Icon={Triangle}><div className="p-6 text-sm text-slate-500">Admins only.</div></InventoryShell>

  return (
    <InventoryShell
      title="Portable ladders"
      description="ANSI A14-rated portable ladders. Industrial sites default to IA or IAA duty rating (≥300 lbf). Type III is explicitly not for industrial use."
      Icon={Triangle}
      newHref="/admin/working-at-heights/ladders-portable/new"
      newLabel="+ Add ladder"
    >
      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</div>
      )}
      {rows === null ? (
        <div className="p-6 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <InventoryEmpty
          Icon={Triangle}
          title="No portable ladders on file"
          description="Add each ladder with its asset tag, ANSI duty rating, height, material, and storage location. Pre-use and periodic inspections attach per ladder."
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 text-left">Asset tag</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">Duty</th>
              <th className="px-4 py-2 text-left">Material</th>
              <th className="px-4 py-2 text-left">Height</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40">
                <td className="px-4 py-3 font-mono text-xs text-slate-900 dark:text-slate-100">{r.asset_tag ?? '—'}</td>
                <td className="px-4 py-3 capitalize text-slate-700 dark:text-slate-300">{r.ladder_type}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.duty_rating}</td>
                <td className="px-4 py-3 capitalize text-slate-700 dark:text-slate-300">{r.material}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.height_ft ? `${r.height_ft} ft` : '—'}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.status.replaceAll('_', ' ')}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.storage_location ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </InventoryShell>
  )
}
