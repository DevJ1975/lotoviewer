'use client'

import { useEffect, useState } from 'react'
import { HardHat } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { InventoryShell, InventoryEmpty } from '../_components/InventoryShell'

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

interface DecoratedRow extends ComponentRow {
  /** Days until service_expires_at; null when no expiry on file. Snapshotted at fetch. */
  days_left: number | null
}

const TYPE_LABEL: Record<string, string> = {
  harness:                'Harness',
  shock_lanyard:          'Shock lanyard',
  positioning_lanyard:    'Positioning lanyard',
  restraint_lanyard:      'Restraint lanyard',
  srl_class1:             'SRL (Class 1)',
  srl_class2:             'SRL (Class 2)',
  anchor_connector:       'Anchor connector',
  rope_grab:              'Rope grab',
  trauma_strap:           'Trauma strap',
  rescue_descent_device:  'Rescue descent device',
}

const STATUS_BADGE: Record<string, string> = {
  in_service:      'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  quarantined:     'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  condemned:       'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  in_rescue_cache: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  pending_recert:  'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
}

export default function FallProtectionPage() {
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
        .from('wah_components')
        .select('id, type, manufacturer, model, serial, service_expires_at, status, storage_location')
        .eq('tenant_id', tenantId)
        .order('service_expires_at', { ascending: true, nullsFirst: false })
        .returns<ComponentRow[]>()
      if (cancelled) return
      if (err) { setError(err.message); return }
      const now = Date.now()
      const decorated: DecoratedRow[] = (data ?? []).map(r => ({
        ...r,
        days_left: r.service_expires_at
          ? Math.ceil((new Date(r.service_expires_at).getTime() - now) / (24 * 3600 * 1000))
          : null,
      }))
      setRows(decorated)
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
              const daysLeft = r.days_left
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{TYPE_LABEL[r.type] ?? r.type}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    {r.manufacturer}{r.model ? ` · ${r.model}` : ''}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{r.serial}</td>
                  <td className="px-4 py-3">
                    {r.service_expires_at ? (
                      <span className={
                        daysLeft !== null && daysLeft < 0     ? 'font-semibold text-rose-700 dark:text-rose-300'
                        : daysLeft !== null && daysLeft <= 90 ? 'font-semibold text-amber-700 dark:text-amber-300'
                                                              : 'text-slate-700 dark:text-slate-300'
                      }>
                        {new Date(r.service_expires_at).toLocaleDateString()}
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[r.status] ?? 'bg-slate-100'}`}>
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
