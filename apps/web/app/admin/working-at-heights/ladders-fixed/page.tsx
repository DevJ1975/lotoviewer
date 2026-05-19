'use client'

import { useEffect, useState } from 'react'
import { Triangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { InventoryShell, InventoryEmpty } from '../_components/InventoryShell'

interface Row {
  id:                          string
  asset_tag:                   string | null
  location_label:              string
  height_ft:                   number
  has_cage:                    boolean
  has_ladder_safety_system:    boolean
  retrofit_target_date:        string | null
  status:                      string
}

export default function LaddersFixedPage() {
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
        .from('wah_ladders_fixed')
        .select('id, asset_tag, location_label, height_ft, has_cage, has_ladder_safety_system, retrofit_target_date, status')
        .eq('tenant_id', tenantId)
        .order('location_label', { ascending: true })
        .returns<Row[]>()
      if (cancelled) return
      if (err) { setError(err.message); return }
      setRows(data ?? [])
    })()
    return () => { cancelled = true }
  }, [tenantId, canManage])

  if (authLoading || tenantLoading) return <InventoryShell title="Fixed ladders" description="Loading…" Icon={Triangle}><div className="p-6 text-sm text-slate-500">Loading…</div></InventoryShell>
  if (!canManage)                   return <InventoryShell title="Fixed ladders" description="Admins only" Icon={Triangle}><div className="p-6 text-sm text-slate-500">Admins only.</div></InventoryShell>

  return (
    <InventoryShell
      title="Fixed ladders"
      description="1910.28(b)(9) inventory. Existing fixed ladders over 24 ft must have a ladder safety system or PFAS by November 18, 2036; cage-only is non-compliant after that date."
      Icon={Triangle}
      newHref="/admin/working-at-heights/ladders-fixed/new"
      newLabel="+ Add fixed ladder"
    >
      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</div>
      )}
      {rows === null ? (
        <div className="p-6 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <InventoryEmpty
          Icon={Triangle}
          title="No fixed ladders on file"
          description="Add each fixed ladder with its location, height, cage / safety-system status, and a 2036 retrofit target date for ladders over 24 ft that still rely on a cage."
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 text-left">Location</th>
              <th className="px-4 py-2 text-left">Asset tag</th>
              <th className="px-4 py-2 text-left">Height</th>
              <th className="px-4 py-2 text-left">Cage</th>
              <th className="px-4 py-2 text-left">Safety system</th>
              <th className="px-4 py-2 text-left">Retrofit due</th>
              <th className="px-4 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const needsRetrofit = r.height_ft >= 24 && !r.has_ladder_safety_system
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{r.location_label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{r.asset_tag ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.height_ft} ft</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.has_cage ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3">
                    {r.has_ladder_safety_system
                      ? <span className="text-emerald-700 dark:text-emerald-300">Yes</span>
                      : <span className={needsRetrofit ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-slate-500'}>No{needsRetrofit ? ' — retrofit required' : ''}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    {r.retrofit_target_date ? new Date(r.retrofit_target_date).toLocaleDateString() : '—'}
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
