'use client'

import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { SupervisorRow } from '@soteria/core/insightsMetrics'

// Per-supervisor permit activity. Resolves supervisor IDs to email
// (via profiles table) lazily on first render so the metrics card can
// render immediately while the join completes — the table fills in
// names below the spinner.

export function SupervisorTable({ rows, windowDays }: {
  rows:       SupervisorRow[]
  windowDays: number
}) {
  const [emailById, setEmailById] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (rows.length === 0) return
    const ids = rows.map(r => r.supervisorId)
    let cancelled = false
    supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', ids)
      .then(({ data }) => {
        if (cancelled || !data) return
        const m = new Map<string, string>()
        for (const p of data as Array<{ id: string; email?: string; full_name?: string }>) {
          m.set(p.id, p.full_name || p.email || p.id.slice(0, 8))
        }
        setEmailById(m)
      })
    return () => { cancelled = true }
  }, [rows])

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <Users className="h-4 w-4 text-brand-navy" />
          Supervisor activity
        </h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          last {windowDays}d · ranked by permits issued
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          No permits issued in this window.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="pb-2 pr-2">Supervisor</th>
                <th className="pb-2 pr-2 text-right">Issued</th>
                <th className="pb-2 pr-2 text-right">Signed</th>
                <th className="pb-2 pr-2 text-right">Done</th>
                <th className="pb-2 pr-2 text-right">For-cause</th>
                <th className="pb-2 pl-2 text-right">Avg min</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(r => {
                const label = emailById.get(r.supervisorId) ?? `User ${r.supervisorId.slice(0, 8)}`
                return (
                  <tr key={r.supervisorId}>
                    <td className="py-2 pr-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{label}</span>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.permitsIssued}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {r.permitsSigned}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                      {r.cancelTaskComplete}
                    </td>
                    <td className={`py-2 pr-2 text-right tabular-nums ${
                      r.cancelForCause > 0
                        ? 'text-rose-700 dark:text-rose-300 font-semibold'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}>
                      {r.cancelForCause}
                    </td>
                    <td className="py-2 pl-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {r.avgPermitMinutes || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug pt-1">
        <span className="font-semibold">Done</span> = canceled with reason &ldquo;task complete&rdquo;.
        <span className="font-semibold"> For-cause</span> = canceled for prohibited condition / expired / other.
        For-cause non-zero is worth a conversation.
      </p>
    </section>
  )
}
