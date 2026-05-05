'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { ConfinedSpacePermit } from '@soteria/core/types'

// Two optional signatures on top of the supervisor's mandatory authorization:
//   - Attendant on duty (§(i)) — picks a name from the attendants[] roster,
//     clicks to sign on. Times the moment they took post.
//   - Entrant briefing acknowledgement (§(f)(6)) — supervisor attests the
//     entrants were briefed on hazards. Single timestamp; the briefing is
//     a group act, not per-entrant.
//
// Both are write-once for now — once recorded, we surface the timestamp.
// Re-attestation can be done on a fresh permit if the situation changes.

export function AuthorizationBlock({
  permit, readOnly, onUpdated,
}: {
  permit:    ConfinedSpacePermit
  readOnly:  boolean
  onUpdated: (updated: ConfinedSpacePermit) => void
}) {
  const [attendantPick, setAttendantPick] = useState<string>(permit.attendants[0] ?? '')
  const [busy, setBusy]   = useState<null | 'attendant' | 'briefing'>(null)
  const [error, setError] = useState<string | null>(null)

  async function signAsAttendant() {
    if (!attendantPick.trim()) { setError('Pick the attendant name first.'); return }
    setBusy('attendant'); setError(null)
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('loto_confined_space_permits')
      .update({
        attendant_signature_at:   now,
        attendant_signature_name: attendantPick,
        updated_at:               now,
      })
      .eq('id', permit.id)
      .select('*')
      .single()
    setBusy(null)
    if (err || !data) { setError(formatSupabaseError(err, 'record attendant sign-on')); return }
    onUpdated(data as ConfinedSpacePermit)
  }

  async function ackEntrants() {
    setBusy('briefing'); setError(null)
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('loto_confined_space_permits')
      .update({ entrant_acknowledgement_at: now, updated_at: now })
      .eq('id', permit.id)
      .select('*')
      .single()
    setBusy(null)
    if (err || !data) { setError(formatSupabaseError(err, 'record acknowledgement')); return }
    onUpdated(data as ConfinedSpacePermit)
  }

  return (
    <div className="space-y-3">
      {/* Attendant sign-on */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#214487]">Attendant on duty · §1910.146(i)</p>
        {permit.attendant_signature_at ? (
          <p className="text-xs text-slate-700 dark:text-slate-300">
            <span className="font-semibold">{permit.attendant_signature_name ?? '—'}</span> signed on at{' '}
            {new Date(permit.attendant_signature_at).toLocaleString()}.
          </p>
        ) : permit.attendants.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">No attendants on the roster — add one to enable sign-on.</p>
        ) : readOnly ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">No attendant signed on while the permit was active.</p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={attendantPick}
              onChange={e => setAttendantPick(e.target.value)}
              className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
            >
              {permit.attendants.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={signAsAttendant}
              disabled={busy === 'attendant'}
              className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-50 hover:bg-brand-navy/90 transition-colors"
            >
              {busy === 'attendant' ? '…' : 'Sign on as attendant'}
            </button>
          </div>
        )}
      </div>

      {/* Entrant briefing ack */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#214487]">Entrant briefing · §1910.146(f)(6)</p>
        {permit.entrant_acknowledgement_at ? (
          <p className="text-xs text-slate-700 dark:text-slate-300">
            Supervisor attested entrants were briefed on hazards at{' '}
            {new Date(permit.entrant_acknowledgement_at).toLocaleString()}.
          </p>
        ) : readOnly ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">No briefing acknowledgement was recorded while the permit was active.</p>
        ) : (
          <button
            type="button"
            onClick={ackEntrants}
            disabled={busy === 'briefing'}
            className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-50 hover:bg-brand-navy/90 transition-colors"
          >
            {busy === 'briefing' ? '…' : 'I have briefed entrants on hazards'}
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  )
}
