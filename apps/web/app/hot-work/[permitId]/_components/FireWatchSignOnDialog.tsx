'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { HotWorkPermit } from '@soteria/core/types'

// Sign-on dialog for fire watchers acknowledging NFPA 51B §6.5 duties.
// Fire watchers are picked from the permit's roster (fire_watch_personnel)
// — first one is pre-selected since most permits have a single watcher;
// multi-watcher shifts pick from the dropdown.

export function FireWatchSignOnDialog({
  permit, onClose, onSigned,
}: {
  permit:   HotWorkPermit
  onClose:  () => void
  onSigned: (updated: HotWorkPermit) => void
}) {
  const [pick, setPick] = useState(permit.fire_watch_personnel[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)

  async function submit() {
    if (!pick.trim()) { setErr('Pick the watcher signing on.'); return }
    setBusy(true); setErr(null)
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('loto_hot_work_permits')
      .update({
        fire_watch_signature_at:   now,
        fire_watch_signature_name: pick,
        updated_at:                now,
      })
      .eq('id', permit.id)
      .select('*')
      .single()
    setBusy(false)
    if (error || !data) { setErr(formatSupabaseError(error, 'sign on')); return }
    onSigned(data as HotWorkPermit)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Fire watch sign-on</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none px-1">×</button>
        </header>
        <p className="text-[11px] text-slate-600 dark:text-slate-300">
          By signing on you accept the watcher duties under NFPA 51B §6.5: continuous observation during work and
          for at least {permit.post_watch_minutes} minutes after work ends. You may not perform other tasks while on watch.
        </p>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Watcher signing on</span>
          <select
            value={pick}
            onChange={e => setPick(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          >
            {permit.fire_watch_personnel.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {err && <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            {busy ? 'Signing…' : 'Sign on as watcher'}
          </button>
        </div>
      </div>
    </div>
  )
}
