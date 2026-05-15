'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, KeyRound, Loader2, Plus, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { LotoGroupPermit } from '@soteria/core/lotoGroupPermit'

// /loto/group-permits — §147(f)(3) group lockout permits.
//
// Lists open + recently-closed group permits. Each row drills down
// to the detail page where members can be added / removed and the
// shift-change handoff can be executed.

const STATUS_LABEL: Record<LotoGroupPermit['status'], string> = {
  open:             'Open',
  shift_handed_off: 'Handed off',
  closed:           'Closed',
}

const STATUS_PILL: Record<LotoGroupPermit['status'], string> = {
  open:             'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  shift_handed_off: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  closed:           'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

export default function GroupPermitsListPage() {
  const { loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [permits, setPermits] = useState<LotoGroupPermit[] | null>(null)
  const [memberCounts, setMemberCounts] = useState<Map<string, number>>(new Map())
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const { data: permitData, error: permitErr } = await supabase
        .from('loto_group_permits')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false })
      if (permitErr) throw new Error(formatSupabaseError(permitErr, 'load group permits'))
      const list = (permitData ?? []) as LotoGroupPermit[]
      setPermits(list)

      // Member counts in one query — Postgres returns a row per
      // active member; we collapse client-side.
      const openIds = list.filter(p => p.status !== 'closed').map(p => p.id)
      if (openIds.length === 0) { setMemberCounts(new Map()); return }
      const { data: members, error: memErr } = await supabase
        .from('loto_group_permit_members')
        .select('group_permit_id')
        .in('group_permit_id', openIds)
        .is('left_at', null)
      if (memErr) throw new Error(formatSupabaseError(memErr, 'load member counts'))
      const counts = new Map<string, number>()
      for (const row of (members ?? []) as { group_permit_id: string }[]) {
        counts.set(row.group_permit_id, (counts.get(row.group_permit_id) ?? 0) + 1)
      }
      setMemberCounts(counts)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load group permits.')
    }
  }, [tenantId])

  useEffect(() => { if (!authLoading) load() }, [authLoading, load])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href="/loto" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
            <ArrowLeft className="h-3 w-3" /> Back to LOTO
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Users className="h-6 w-6 text-brand-navy" />
            Group LOTO permits
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            §1910.147(f)(3) — group lockout for crew work, with personal
            locks attached to a group box. §(f)(4) shift-change handoffs
            are recorded inside each permit.
          </p>
        </div>
        <Link
          href="/loto/group-permits/new"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New group permit
        </Link>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      {permits === null ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : permits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No group permits yet.</p>
          <p className="text-[11px] text-slate-400 mt-1">Create one when a crew needs a single energy-control lockout.</p>
        </div>
      ) : (
        <ul className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {permits.map(p => {
            const count = memberCounts.get(p.id) ?? 0
            return (
              <li key={p.id}>
                <Link
                  href={`/loto/group-permits/${p.id}`}
                  className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <KeyRound className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {p.work_description}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Started {new Date(p.started_at).toLocaleString()}
                        {p.equipment_ids.length > 0 && (
                          <> · {p.equipment_ids.length} equipment</>
                        )}
                        {p.status !== 'closed' && <> · {count} active member{count === 1 ? '' : 's'}</>}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${STATUS_PILL[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
