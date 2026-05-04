'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { ConfinedSpaceEntry, ConfinedSpacePermit } from '@/lib/types'

// Entrant in/out log — one row per name in permit.entrants[]. Status comes
// from the entries table — if there's a row with exited_at IS NULL, the
// entrant is inside. The attendant clicks "Log in" / "Log out" and we
// insert/update the row. Names match string-compare against
// permit.entrants[]; the supervisor can edit the roster on the permit but
// in/out actions are name-keyed so a rename mid-shift breaks the live
// mapping (acceptable trade — name edits during an active permit are rare
// and we surface an "Unrostered" row for any orphan entry rather than
// dropping it silently).

export function EntrantLog({
  permit, entries, attendantUserId, readOnly, onEntered, onExited,
}: {
  permit:          ConfinedSpacePermit
  entries:         ConfinedSpaceEntry[]
  attendantUserId: string | null
  readOnly:        boolean
  onEntered:       (row: ConfinedSpaceEntry) => void
  onExited:        (row: ConfinedSpaceEntry) => void
}) {
  // Group entries by name so we can render the chronological in/out cycles
  // grouped under each rostered entrant. An "open" row (exited_at == null)
  // means the entrant is currently inside.
  const byName = new Map<string, ConfinedSpaceEntry[]>()
  for (const e of entries) {
    const list = byName.get(e.entrant_name) ?? []
    list.push(e)
    byName.set(e.entrant_name, list)
  }
  // Names that have entries but aren't on the roster — rare, but visible
  // so the supervisor sees the discrepancy.
  const orphan = [...byName.keys()].filter(n => !permit.entrants.includes(n))

  const insideCount = entries.filter(e => e.exited_at == null).length

  if (permit.entrants.length === 0 && orphan.length === 0) {
    return <p className="text-xs text-slate-400 dark:text-slate-500 italic">No entrants on the roster yet.</p>
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-600 dark:text-slate-300">
        <span className="font-semibold">{insideCount}</span> currently inside
        {' · '}
        §1910.146(i)(4) — the attendant logs each entrant in and out so the count is accurate at any moment.
      </p>
      <ul className="space-y-2">
        {permit.entrants.map(name => (
          <EntrantRow
            key={name}
            name={name}
            entries={byName.get(name) ?? []}
            permitId={permit.id}
            attendantUserId={attendantUserId}
            readOnly={readOnly}
            onEntered={onEntered}
            onExited={onExited}
          />
        ))}
        {orphan.map(name => (
          <EntrantRow
            key={`orphan:${name}`}
            name={name}
            entries={byName.get(name) ?? []}
            permitId={permit.id}
            attendantUserId={attendantUserId}
            readOnly={readOnly}
            isOrphan
            onEntered={onEntered}
            onExited={onExited}
          />
        ))}
      </ul>
    </div>
  )
}

function EntrantRow({
  name, entries, permitId, attendantUserId, readOnly, isOrphan,
  onEntered, onExited,
}: {
  name:            string
  entries:         ConfinedSpaceEntry[]
  permitId:        string
  attendantUserId: string | null
  readOnly:        boolean
  isOrphan?:       boolean
  onEntered:       (row: ConfinedSpaceEntry) => void
  onExited:        (row: ConfinedSpaceEntry) => void
}) {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sort newest-first so the open cycle (if any) is at the top.
  const sorted = [...entries].sort((a, b) =>
    new Date(b.entered_at).getTime() - new Date(a.entered_at).getTime(),
  )
  const open = sorted.find(e => e.exited_at == null) ?? null
  const inside = open != null

  async function logIn() {
    if (!attendantUserId) { setError('Attendant must be logged in to record entry.'); return }
    setBusy(true); setError(null)
    const { data, error: err } = await supabase
      .from('loto_confined_space_entries')
      .insert({
        permit_id:    permitId,
        entrant_name: name,
        entered_by:   attendantUserId,
      })
      .select('*')
      .single()
    setBusy(false)
    if (err || !data) { setError(formatSupabaseError(err, 'record entry')); return }
    onEntered(data as ConfinedSpaceEntry)
  }

  async function logOut() {
    if (!open) return
    if (!attendantUserId) { setError('Attendant must be logged in to record exit.'); return }
    setBusy(true); setError(null)
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('loto_confined_space_entries')
      .update({ exited_at: now, exited_by: attendantUserId })
      .eq('id', open.id)
      .select('*')
      .single()
    setBusy(false)
    if (err || !data) { setError(formatSupabaseError(err, 'record exit')); return }
    onExited(data as ConfinedSpaceEntry)
  }

  return (
    <li className={`rounded-lg border ${inside ? 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/40/60' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'} px-3 py-2`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {name}
            {isOrphan && (
              <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">unrostered</span>
            )}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {inside
              ? <>Inside since {new Date(open!.entered_at).toLocaleString()}</>
              : sorted.length === 0
                ? 'Has not entered yet'
                : <>Last out {new Date(sorted[0].exited_at!).toLocaleString()}</>
            }
          </p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={inside ? logOut : logIn}
            disabled={busy}
            className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold disabled:opacity-50 transition-colors ${
              inside
                ? 'bg-slate-700 text-white hover:bg-slate-800'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {busy ? '…' : inside ? 'Log out' : 'Log in'}
          </button>
        )}
      </div>
      {/* Cycle history — show prior in/out pairs for the audit trail. Cap
          at 4 entries with an ellipsis to keep long shifts compact. */}
      {sorted.length > 1 && (
        <ul className="mt-2 space-y-0.5 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
          {sorted.slice(inside ? 1 : 0, (inside ? 1 : 0) + 4).map(e => (
            <li key={e.id}>
              {new Date(e.entered_at).toLocaleTimeString()} in
              {' → '}
              {e.exited_at ? new Date(e.exited_at).toLocaleTimeString() + ' out' : 'still inside'}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{error}</p>}
    </li>
  )
}
