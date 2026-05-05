'use client'

import Link from 'next/link'
import type { ActivePermitSummary } from '@soteria/core/homeMetrics'
import { permitCountdown, type CountdownTone } from '@soteria/core/permitStatus'

// Live list of active confined-space permits with a countdown timer per
// row. `now` is passed in from the parent's 1Hz tick so all rows share
// one timer source — no per-row setInterval cost.

export function ActivePermitsPanel({ permits, now }: { permits: ActivePermitSummary[] | null; now: Date }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Active Permits</h2>
        <Link href="/confined-spaces/status" className="text-[11px] font-semibold text-brand-navy dark:text-brand-yellow hover:underline">
          View all →
        </Link>
      </header>
      {permits === null ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">Loading…</p>
      ) : permits.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No active permits.</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Issue one from the Confined Spaces module.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {permits.map(p => <ActivePermitRow key={p.id} permit={p} now={now} />)}
        </ul>
      )}
    </section>
  )
}

function ActivePermitRow({ permit, now }: { permit: ActivePermitSummary; now: Date }) {
  // Live countdown — recomputed on every parent render (1Hz from the home
  // clock tick).
  const c = permitCountdown({ expires_at: permit.expiresAt }, now.getTime())
  const timerCls: Record<CountdownTone, string> = {
    safe:     'text-emerald-700 dark:text-emerald-300',
    warning:  'text-amber-700 dark:text-amber-300',
    critical: 'text-rose-700 dark:text-rose-300',
    expired:  'text-rose-700 dark:text-rose-300',
  }
  return (
    <li className="py-2.5">
      <Link
        href={`/confined-spaces/${encodeURIComponent(permit.spaceId)}/permits/${permit.id}`}
        className="block hover:bg-slate-50 dark:hover:bg-slate-900/40 -mx-2 px-2 py-1 rounded-lg transition-colors"
      >
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold tracking-wider text-slate-700 dark:text-slate-300">{permit.serial}</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {permit.spaceId}
              {permit.spaceDescription && <span className="text-slate-500 dark:text-slate-400 font-normal"> · {permit.spaceDescription}</span>}
            </p>
          </div>
          <p className={`text-lg font-black font-mono tabular-nums ${timerCls[c.tone]}`}>{c.label}</p>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          {permit.entrants.length === 0
            ? 'No entrants recorded'
            : <>{permit.entrants.length} entrant{permit.entrants.length === 1 ? '' : 's'}: {permit.entrants.join(', ')}</>}
          {permit.attendants.length > 0 && (
            <> · attendant: {permit.attendants.join(', ')}</>
          )}
        </p>
      </Link>
    </li>
  )
}
