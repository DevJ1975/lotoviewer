'use client'

import { useEffect, useState } from 'react'
import { HardHat } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { InventoryShell, InventoryEmpty } from '../_components/InventoryShell'
import {
  decorateWithDaysLeft,
  expiryBand,
  EXPIRY_BAND_CLASS,
  FALL_PROTECTION_TYPE_LABELS,
  STATUS_BADGE_CLASS,
} from '@/lib/wah/inventoryHelpers'

interface ComponentRow {
  id:                    string
  type:                  string
  manufacturer:          string
  model:                 string | null
  serial:                string
  service_expires_at:    string | null
  status:                string
  storage_location:      string | null
}

export default function FallProtectionPage() {
  const { tenantId, loading: tenantLoading } = useTenant()
  const { profile, loading: authLoading } = useAuth()
  const canManage = !!profile?.is_admin || !!profile?.is_superadmin
  const [rows, setRows] = useState<Array<ComponentRow & { days_left: number | null }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tenantId || !canManage) return
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await supabase
        .from('wah_components')
        .select('id, type, manufacturer, model, serial, service_expires_at, status, storage_location')
        .eq('tenant_id', tenantId)
        .order('service_expires_at', { ascending: true, nullsFirst: false })
        .returns<ComponentRow[]>()
      if (cancelled) return
      if (err) { setError(err.message); return }
      setRows(decorateWithDaysLeft(data ?? [], 'service_expires_at'))
    })()
    return () => { cancelled = true }
  }, [tenantId, canManage])

  if (authLoading || tenantLoading) return <InventoryShell title="Fall protection equipment" description="Loading…" Icon={HardHat}><div className="p-6 text-sm text-slate-500">Loading…</div></InventoryShell>
  if (!canManage)                   return <InventoryShell title="Fall protection equipment" description="Admins only" Icon={HardHat}><div className="p-6 text-sm text-slate-500">Admins only.</div></InventoryShell>

  return (
    <InventoryShell
      title="Fall protection equipment"
      description="Per-serial inventory of harnesses, lanyards, SRLs, anchor connectors, rope grabs, trauma straps, and RDDs. Each row tracks manufacturer service life, current location, and inspection state."
      Icon={HardHat}
      newHref={`/admin/working-at-heights/fall-protection/new`}
      newLabel="+ Add component"
    >
      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
          {error}
        </div>
      )}
      {rows === null ? (
        <div className="p-6 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <InventoryEmpty
          Icon={HardHat}
          title="No fall protection components on file"
          description="Add each harness, lanyard, SRL, and anchor connector individually — every serial is its own row, with its own manufacturer service life and inspection history."
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">Manufacturer / Model</th>
              <th className="px-4 py-2 text-left">Serial</th>
              <th className="px-4 py-2 text-left">Service expires</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const band = expiryBand(r.days_left)
              const typeLabel = (FALL_PROTECTION_TYPE_LABELS as Record<string, string>)[r.type] ?? r.type
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{typeLabel}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    {r.manufacturer}{r.model ? ` · ${r.model}` : ''}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{r.serial}</td>
                  <td className="px-4 py-3">
                    {r.service_expires_at ? (
                      <span className={EXPIRY_BAND_CLASS[band]}>
                        {new Date(r.service_expires_at).toLocaleDateString()}
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE_CLASS[r.status] ?? 'bg-slate-100'}`}>
                      {r.status.replaceAll('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.storage_location ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </InventoryShell>
  )
}
