'use client'

import { useEffect, useState } from 'react'
import { IdCard, ShieldCheck, GraduationCap, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { InventoryShell, InventoryEmpty } from '../_components/InventoryShell'

interface AuthorizationRow {
  id:           string
  member_id:    string
  role:         'authorized' | 'competent' | 'qualified'
  scope:        string | null
  valid_from:   string
  valid_until:  string
  notes:        string | null
}

interface JoinedRow extends AuthorizationRow {
  member?: { display_name: string; email: string | null } | null
}

interface DecoratedRow extends JoinedRow {
  /** Days until valid_until — negative when expired. Snapshotted at
   * fetch time so the rendered cell stays a pure read. */
  days_left: number
}

const ROLE_BADGE: Record<AuthorizationRow['role'], { label: string; cls: string; Icon: typeof IdCard }> = {
  authorized: { label: 'Authorized Person', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200', Icon: IdCard },
  competent:  { label: 'Competent Person',  cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', Icon: ShieldCheck },
  qualified:  { label: 'Qualified Person',  cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200', Icon: Wrench },
}

export default function AuthorizationsPage() {
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
        .from('wah_authorizations')
        .select('id, member_id, role, scope, valid_from, valid_until, notes, member:members(display_name, email)')
        .eq('tenant_id', tenantId)
        .order('valid_until', { ascending: true })
        .returns<JoinedRow[]>()
      if (cancelled) return
      if (err) { setError(err.message); return }
      const now = Date.now()
      const decorated: DecoratedRow[] = (data ?? []).map(r => ({
        ...r,
        days_left: Math.ceil((new Date(r.valid_until).getTime() - now) / (24 * 3600 * 1000)),
      }))
      setRows(decorated)
    })()
    return () => { cancelled = true }
  }, [tenantId, canManage])

  if (authLoading || tenantLoading) return <InventoryShell title="Authorizations" description="Loading…" Icon={IdCard}><div className="p-6 text-sm text-slate-500">Loading…</div></InventoryShell>
  if (!canManage)                   return <InventoryShell title="Authorizations" description="Admins only" Icon={IdCard}><div className="p-6 text-sm text-slate-500">Admins only.</div></InventoryShell>

  return (
    <InventoryShell
      title="Authorizations"
      description="Authorized / Competent / Qualified Person designations. Track scope, validity windows, training certificates, and PE license for QP."
      Icon={IdCard}
      newHref={`/admin/working-at-heights/authorizations/new`}
      newLabel="+ Designate"
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
          Icon={GraduationCap}
          title="No authorizations on file"
          description="Designate the people in your program. Workers doing at-height tasks need Authorized Person status; the inspector who signs off equipment needs Competent Person; the engineer who certifies anchors needs Qualified Person."
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 text-left">Member</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-left">Scope</th>
              <th className="px-4 py-2 text-left">Valid through</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const badge = ROLE_BADGE[r.role]
              const expiringSoon = r.days_left <= 90 && r.days_left >= 0
              const expired = r.days_left < 0
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{r.member?.display_name ?? '—'}</div>
                    <div className="text-xs text-slate-500">{r.member?.email ?? ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>
                      <badge.Icon className="size-3" />
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.scope ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={
                      expired       ? 'font-semibold text-rose-700 dark:text-rose-300'
                      : expiringSoon ? 'font-semibold text-amber-700 dark:text-amber-300'
                                      : 'text-slate-700 dark:text-slate-300'
                    }>
                      {new Date(r.valid_until).toLocaleDateString()}
                    </span>
                    {expired       && <span className="ml-2 text-xs text-rose-600">expired</span>}
                    {expiringSoon  && <span className="ml-2 text-xs text-amber-600">{r.days_left}d left</span>}
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
