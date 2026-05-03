'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import { useAuth } from '@/components/AuthProvider'
import type { LotoDevice } from '@/lib/types'

// Modal for an admin to record a checkout on behalf of a worker. Picks
// owner from the profile list. Equipment is free-text (not a select)
// because group locks may apply to bays / circuits not in loto_equipment.

interface ProfileLite {
  id:        string
  email:     string | null
  full_name: string | null
}

export function CheckoutDialog({ device, onClose, onCheckedOut }: {
  device:        LotoDevice
  onClose:       () => void
  onCheckedOut:  () => void
}) {
  const { profile } = useAuth()
  const [profiles, setProfiles] = useState<ProfileLite[]>([])
  const [ownerId, setOwnerId]   = useState<string>('')
  const [equipmentId, setEquipmentId] = useState('')
  const [notes, setNotes]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // Load the profile list once. Small site = small list — no need to
  // paginate. If a workplace grows large, swap to a typeahead.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('profiles')
      .select('id, email, full_name')
      .order('full_name', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err || !data) {
          setError(formatSupabaseError(err, 'load profile list'))
          return
        }
        setProfiles(data as ProfileLite[])
        // Default the owner to the current admin — most common case is
        // an admin acting on their own behalf. They can change it.
        if (profile?.id && !ownerId) setOwnerId(profile.id)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  async function submit() {
    if (!ownerId) { setError('Pick an owner.'); return }
    if (!profile?.id) { setError('You must be signed in.'); return }
    setBusy(true); setError(null)

    // Two writes — checkout INSERT, device UPDATE. Run sequentially so
    // we can capture the new checkout id and stamp it on the device.
    // Best-effort transactional: if the device update fails after the
    // checkout insert, the unique-open-checkout index keeps a re-try
    // safe (it'll see the existing open row and let the admin resolve).
    const { data: row, error: insErr } = await supabase
      .from('loto_device_checkouts')
      .insert({
        device_id:    device.id,
        owner_id:     ownerId,
        equipment_id: equipmentId.trim() || null,
        recorded_by:  profile.id,
        notes:        notes.trim() || null,
      })
      .select('id')
      .single()
    if (insErr || !row) {
      setBusy(false)
      // Catch the unique-open-checkout violation specifically — friendlier
      // error for the most likely "double-tap" mistake.
      if (insErr?.message?.includes('idx_device_checkouts_one_open')) {
        setError('This device already has an open checkout. Return it before checking out again.')
      } else {
        setError(formatSupabaseError(insErr, 'record checkout'))
      }
      return
    }

    const { error: updErr } = await supabase
      .from('loto_devices')
      .update({
        status:              'checked_out',
        current_checkout_id: row.id,
      })
      .eq('id', device.id)
    setBusy(false)
    if (updErr) {
      setError(formatSupabaseError(updErr, 'update device status'))
      return
    }
    onCheckedOut()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Check out <span className="font-mono">{device.device_label}</span>
          </h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none px-1">×</button>
        </header>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Owner</span>
          <select
            value={ownerId}
            onChange={e => setOwnerId(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
          >
            <option value="">— pick a worker —</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email || p.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Equipment / area</span>
          <input
            type="text"
            value={equipmentId}
            onChange={e => setEquipmentId(e.target.value)}
            placeholder="EQ-014, or descriptive bay/circuit"
            disabled={busy}
            maxLength={200}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Optional. Free-text so a group lock on a bay can be recorded.
          </span>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Notes</span>
          <textarea
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
          />
        </label>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !ownerId}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? 'Saving…' : 'Check out'}
          </button>
        </div>
      </div>
    </div>
  )
}
