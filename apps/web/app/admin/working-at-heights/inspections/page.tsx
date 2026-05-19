'use client'

import { useEffect, useState } from 'react'
import { ScanSearch } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { InventoryShell, InventoryEmpty } from '../_components/InventoryShell'

interface Row {
  id:              string
  kind:            string
  outcome:         string
  performed_at:    string
  notes:           string | null
  inspector:       { display_name: string } | null
  component_id:    string | null
  ladder_portable_id: string | null
  ladder_fixed_id: string | null
  anchor_id:       string | null
}

const KIND_LABEL: Record<string, string> = {
  pre_use:    'Pre-use',
  periodic:   'Periodic',
  post_event: 'Post-event',
}

const OUTCOME_BADGE: Record<string, string> = {
  pass:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  concern: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  condemn: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

function targetLabel(r: Row): string {
  if (r.component_id)        return 'Fall-protection component'
  if (r.ladder_portable_id)  return 'Portable ladder'
  if (r.ladder_fixed_id)     return 'Fixed ladder'
  if (r.anchor_id)           return 'Anchor'
  return '—'
}

export default function InspectionsPage() {
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
        .from('wah_inspections')
        .select('id, kind, outcome, performed_at, notes, inspector:members!inspector_id(display_name), component_id, ladder_portable_id, ladder_fixed_id, anchor_id')
        .eq('tenant_id', tenantId)
        .order('performed_at', { ascending: false })
        .limit(100)
        .returns<Row[]>()
      if (cancelled) return
      if (err) { setError(err.message); return }
      setRows(data ?? [])
    })()
    return () => { cancelled = true }
  }, [tenantId, canManage])

  if (authLoading || tenantLoading) return <InventoryShell title="Inspections log" description="Loading…" Icon={ScanSearch}><div className="p-6 text-sm text-slate-500">Loading…</div></InventoryShell>
  if (!canManage)                   return <InventoryShell title="Inspections log" description="Admins only" Icon={ScanSearch}><div className="p-6 text-sm text-slate-500">Admins only.</div></InventoryShell>

  return (
    <InventoryShell
      title="Inspections log"
      description="Chronological audit of every pre-use, periodic, and post-event inspection across components, ladders, and anchors. Limited to the 100 most recent rows."
      Icon={ScanSearch}
      newHref={null}
    >
      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</div>
      )}
      {rows === null ? (
        <div className="p-6 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <InventoryEmpty
          Icon={ScanSearch}
          title="No inspections recorded yet"
          description="Inspections attach via the per-item detail page (Phase 3 ships the QR-scan mobile flow). Once workers start recording pre-use checks, every row shows here."
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 text-left">When</th>
              <th className="px-4 py-2 text-left">Target</th>
              <th className="px-4 py-2 text-left">Kind</th>
              <th className="px-4 py-2 text-left">Inspector</th>
              <th className="px-4 py-2 text-left">Outcome</th>
              <th className="px-4 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40">
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{new Date(r.performed_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{targetLabel(r)}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{KIND_LABEL[r.kind] ?? r.kind}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.inspector?.display_name ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${OUTCOME_BADGE[r.outcome] ?? ''}`}>
                    {r.outcome}
                  </span>
                </td>
                <td className="px-4 py-3 max-w-xs truncate text-slate-700 dark:text-slate-300" title={r.notes ?? ''}>
                  {r.notes ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </InventoryShell>
  )
}
