'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ScrollText, Monitor } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { InventoryShell, InventoryEmpty } from '../_components/InventoryShell'

interface PermitRow {
  id:               string
  permit_number:    string
  work_location:    string
  status:           string
  valid_from:       string
  valid_until:      string
  worker:           { display_name: string } | null
  cp:               { display_name: string } | null
}

interface DecoratedRow extends PermitRow {
  /** Hours of validity remaining; null when not active. */
  hours_left: number | null
}

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  completed: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  cancelled: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

export default function PermitsPage() {
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
        .from('wah_permits')
        .select('id, permit_number, work_location, status, valid_from, valid_until, worker:members!worker_id(display_name), cp:members!cp_id(display_name)')
        .eq('tenant_id', tenantId)
        // Active first, then by valid_from desc.
        .order('status', { ascending: true })
        .order('valid_from', { ascending: false })
        .returns<PermitRow[]>()
      if (cancelled) return
      if (err) { setError(err.message); return }
      const now = Date.now()
      const decorated: DecoratedRow[] = (data ?? []).map(r => ({
        ...r,
        hours_left: r.status === 'active'
          ? Math.max(0, Math.round((new Date(r.valid_until).getTime() - now) / (3600 * 1000)))
          : null,
      }))
      setRows(decorated)
    })()
    return () => { cancelled = true }
  }, [tenantId, canManage])

  if (authLoading || tenantLoading) return <InventoryShell title="Permits" description="Loading…" Icon={ScrollText}><div className="p-6 text-sm text-slate-500">Loading…</div></InventoryShell>
  if (!canManage)                   return <InventoryShell title="Permits" description="Admins only" Icon={ScrollText}><div className="p-6 text-sm text-slate-500">Admins only.</div></InventoryShell>

  return (
    <InventoryShell
      title="Working-at-Heights Permits"
      description="One-shift authorisation gating every at-height task. Pre-condition checklist + clearance calc snapshot + named CP sign-off."
      Icon={ScrollText}
      newHref="/admin/working-at-heights/permits/new"
      newLabel="+ Issue permit"
    >
      <div className="flex items-center justify-end border-b border-slate-200 px-4 py-2 text-xs dark:border-slate-800">
        <Link
          href="/working-at-heights/permits/status"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Monitor className="size-3.5" />
          Open status board
        </Link>
      </div>
      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</div>
      )}
      {rows === null ? (
        <div className="p-6 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <InventoryEmpty
          Icon={ScrollText}
          title="No permits issued yet"
          description="Issue a permit before any at-height task. The form runs the pre-condition checklist (worker authorisation, equipment in date, anchor inspected, rescue plan present, weather acceptable) and snapshots the clearance calculation for the audit trail."
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 text-left">Permit #</th>
              <th className="px-4 py-2 text-left">Location</th>
              <th className="px-4 py-2 text-left">Worker</th>
              <th className="px-4 py-2 text-left">CP</th>
              <th className="px-4 py-2 text-left">Valid until</th>
              <th className="px-4 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40">
                <td className="px-4 py-3 font-mono text-xs text-slate-900 dark:text-slate-100">
                  <Link href={`/admin/working-at-heights/permits/${r.id}`} className="hover:underline">
                    {r.permit_number}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.work_location}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.worker?.display_name ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.cp?.display_name ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                  {new Date(r.valid_until).toLocaleString()}
                  {r.hours_left !== null && (
                    <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">
                      {r.hours_left}h left
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[r.status] ?? ''}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </InventoryShell>
  )
}
