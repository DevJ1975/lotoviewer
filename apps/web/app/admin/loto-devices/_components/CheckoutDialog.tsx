'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, UserPlus, X as XIcon, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import { useAuth } from '@/components/AuthProvider'
import { evaluateLotoTraining, type LotoTrainingStatus } from '@/lib/trainingRecords'
import type { LotoDevice, TrainingRecord } from '@soteria/core/types'

// Modal for an admin to record a checkout on behalf of a worker. Picks
// owner from the profile list. Equipment is free-text (not a select)
// because group locks may apply to bays / circuits not in loto_equipment.
//
// Self-enroll affordance: the admin can hand the device to the worker,
// who fills out their email, name, and LOTO training (completion date,
// cert authority, optional expiry). On submit we create the auth user
// via /api/admin/users (same as /admin/users) AND insert a
// loto_training_records row in role 'authorized_employee' so the
// checkout gate sees them as trained immediately. Owner remains a
// profile FK; non-app shop-floor workers without an email are still
// out of scope (they need a workers table).
//
// Training gate: when the admin selects an owner, we look up
// training_records for that worker_name (case-insensitive, same
// pattern as the CS permit gate) and disable Check out unless the
// status is 'current' or 'expiring' (still valid, but warn).

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

  // Inline-invite state — visible when the admin clicks "Add new worker"
  // beneath the dropdown. Kept local because the only thing the parent
  // needs is the eventual new owner_id, and we set it via setOwnerId().
  const [inviteOpen,         setInviteOpen]         = useState(false)
  const [inviteEmail,        setInviteEmail]        = useState('')
  const [inviteName,         setInviteName]         = useState('')
  // LOTO §1910.147(c)(7) requires a current authorized-employee
  // qualification before issuing a locktag. Worker fills these in on
  // the device; admin verifies the cert paperwork before clicking.
  const [trainingCompleted,  setTrainingCompleted]  = useState('')   // YYYY-MM-DD
  const [trainingExpires,    setTrainingExpires]    = useState('')   // YYYY-MM-DD or ''
  const [trainingAuthority,  setTrainingAuthority]  = useState('')
  const [inviteBusy,         setInviteBusy]         = useState(false)
  const [inviteError,        setInviteError]        = useState<string | null>(null)
  const [inviteSuccess,      setInviteSuccess]      = useState<{ tempPassword: string; emailSent: boolean } | null>(null)

  // Training records for the current tenant — used to evaluate the
  // selected owner's status. Refetched after a successful invite so
  // the new authorized-employee row shows up immediately.
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([])

  async function loadProfiles({ selectId }: { selectId?: string } = {}) {
    const { data, error: err } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .order('full_name', { ascending: true })
    if (err || !data) {
      setError(formatSupabaseError(err, 'load profile list'))
      return
    }
    setProfiles(data as ProfileLite[])
    if (selectId) setOwnerId(selectId)
    else if (profile?.id && !ownerId) setOwnerId(profile.id)
  }

  async function loadTrainingRecords() {
    const { data, error: err } = await supabase
      .from('loto_training_records')
      .select('*')
      .eq('role', 'authorized_employee')
    if (err || !data) return  // soft-fail: gate falls through to "missing"
    setTrainingRecords(data as TrainingRecord[])
  }

  // Load the profile list + training records once. Small site = small
  // list — no need to paginate. If a workplace grows large, swap to a
  // typeahead.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await Promise.all([loadProfiles(), loadTrainingRecords()])
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Resolve training status for the currently-selected owner.
  const selectedOwnerName = useMemo(() => {
    const p = profiles.find(p => p.id === ownerId)
    return p?.full_name ?? p?.email ?? ''
  }, [profiles, ownerId])

  const trainingStatus: LotoTrainingStatus | null = useMemo(() => {
    if (!ownerId || !selectedOwnerName) return null
    return evaluateLotoTraining({
      workerName: selectedOwnerName,
      records:    trainingRecords,
      asOf:       new Date(),
    })
  }, [ownerId, selectedOwnerName, trainingRecords])

  const trainingBlocks = trainingStatus?.status === 'missing' || trainingStatus?.status === 'expired'

  async function onInviteSubmit() {
    if (inviteBusy) return
    const email = inviteEmail.trim().toLowerCase()
    const fullName = inviteName.trim()
    const completedAt = trainingCompleted.trim()
    const expiresAt   = trainingExpires.trim() || null
    const authority   = trainingAuthority.trim() || null
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setInviteError('A valid email is required.')
      return
    }
    if (!fullName) {
      setInviteError('Full name is required for the training record.')
      return
    }
    if (!completedAt || !/^\d{4}-\d{2}-\d{2}$/.test(completedAt)) {
      setInviteError('LOTO training completion date is required.')
      return
    }
    if (expiresAt && expiresAt < completedAt) {
      setInviteError('Training expiry cannot be before the completion date.')
      return
    }
    setInviteBusy(true)
    setInviteError(null)
    setInviteSuccess(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setInviteError('Sign-in expired — please sign back in.'); return }
      const res = await fetch('/api/admin/users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body:    JSON.stringify({ email, fullName }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setInviteError(body.error ?? `Server returned ${res.status}`)
        return
      }
      // Insert the training record. RLS policy on loto_training_records
      // permits admin writes, so the authenticated client works directly.
      // We tolerate a failure here — the user IS created — but surface
      // the issue prominently so the admin can re-enter via /admin/training-records.
      const { error: trainErr } = await supabase
        .from('loto_training_records')
        .insert({
          worker_name:    fullName,
          role:           'authorized_employee',
          completed_at:   completedAt,
          expires_at:     expiresAt,
          cert_authority: authority,
          notes:          'Self-enrolled at LOTO device checkout',
        })
      if (trainErr) {
        setInviteError(
          `User created, but training record failed: ${trainErr.message}. ` +
          `Add it manually under Admin → Training records before checkout.`,
        )
      }
      // Refresh the profile + training lists so the new user + cert show
      // up, and auto-select them so the checkout flow continues without
      // a second click.
      await Promise.all([loadProfiles(), loadTrainingRecords()])
      const created = (await supabase.from('profiles').select('id').eq('email', body.email).maybeSingle()).data
      if (created?.id) setOwnerId(created.id)
      setInviteSuccess({ tempPassword: body.tempPassword, emailSent: body.emailSent === true })
      setInviteEmail('')
      setInviteName('')
      setTrainingCompleted('')
      setTrainingExpires('')
      setTrainingAuthority('')
      // Auto-collapse on full success so the dialog goes back to the
      // checkout view with the new user selected.
      if (!trainErr) setInviteOpen(false)
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Invite failed.')
    } finally {
      setInviteBusy(false)
    }
  }

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

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Owner</span>
            {!inviteOpen && (
              <button
                type="button"
                onClick={() => { setInviteOpen(true); setInviteSuccess(null); setInviteError(null) }}
                disabled={busy}
                className="text-[11px] font-semibold text-brand-navy dark:text-brand-yellow hover:underline inline-flex items-center gap-1 disabled:opacity-40"
              >
                <UserPlus className="h-3 w-3" />
                Add new worker
              </button>
            )}
          </div>
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

          {/* Training-status badge under the dropdown — visible whenever an
              owner is selected. Hand the device to the worker before
              issuing a locktag and they can confirm their cert is current. */}
          {trainingStatus && (
            <TrainingBadge status={trainingStatus} workerName={selectedOwnerName} />
          )}

          {inviteOpen && (
            <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Add new worker</p>
                <button
                  type="button"
                  onClick={() => { setInviteOpen(false); setInviteError(null); setInviteSuccess(null) }}
                  disabled={inviteBusy}
                  aria-label="Cancel"
                  className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-40"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                Hand the device to the worker — they fill out their email, name, and LOTO
                training. Verify the certification document before submitting.
              </p>
              <input
                type="email"
                placeholder="Email — worker@company.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                disabled={inviteBusy}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
              />
              <input
                type="text"
                placeholder="Full name (required)"
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                disabled={inviteBusy}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
              />

              {/* LOTO training fields — required by §1910.147(c)(7) */}
              <div className="pt-1 border-t border-slate-200 dark:border-slate-700">
                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mt-2 mb-1">
                  LOTO training (29 CFR 1910.147)
                </p>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Completed on
                  <input
                    type="date"
                    value={trainingCompleted}
                    onChange={e => setTrainingCompleted(e.target.value)}
                    disabled={inviteBusy}
                    className="block w-full mt-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
                  />
                </label>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                  Expires (optional — leave blank for "no expiry")
                  <input
                    type="date"
                    value={trainingExpires}
                    onChange={e => setTrainingExpires(e.target.value)}
                    disabled={inviteBusy}
                    className="block w-full mt-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
                  />
                </label>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                  Issued by
                  <input
                    type="text"
                    placeholder="e.g. Plant Safety, ABC Training Inc."
                    value={trainingAuthority}
                    onChange={e => setTrainingAuthority(e.target.value)}
                    disabled={inviteBusy}
                    className="block w-full mt-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
                  />
                </label>
              </div>

              {inviteError && (
                <p className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-md px-2 py-1">
                  {inviteError}
                </p>
              )}
              {inviteSuccess && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 rounded-md px-2 py-1">
                  Worker added.
                  {inviteSuccess.emailSent
                    ? ' Login email sent.'
                    : <> Email send failed — share the temp password manually: <code className="font-mono">{inviteSuccess.tempPassword}</code></>}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onInviteSubmit}
                  disabled={inviteBusy}
                  className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors inline-flex items-center gap-1.5"
                >
                  {inviteBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                  {inviteBusy ? 'Saving…' : 'Add & select'}
                </button>
              </div>
            </div>
          )}
        </div>

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
            disabled={busy || !ownerId || trainingBlocks}
            title={trainingBlocks
              ? 'LOTO training is missing or expired for this worker. Add or renew before issuing a locktag.'
              : undefined}
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

// ── Training badge ──────────────────────────────────────────────────────
// Shown beneath the Owner dropdown whenever a worker is selected. The
// status string is supplied by lib/trainingRecords.evaluateLotoTraining.
function TrainingBadge({ status, workerName }: {
  status:     LotoTrainingStatus
  workerName: string
}) {
  if (status.status === 'current') {
    return (
      <p className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 rounded-md px-2 py-1 inline-flex items-center gap-1.5 mt-2">
        <ShieldCheck className="h-3 w-3" />
        LOTO training current
        {status.expires_on
          ? <> · expires {status.expires_on}</>
          : <> · no expiry on file</>}
      </p>
    )
  }
  if (status.status === 'expiring') {
    return (
      <p className="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 rounded-md px-2 py-1 inline-flex items-center gap-1.5 mt-2">
        <ShieldAlert className="h-3 w-3" />
        Training expires in {status.days_remaining} day{status.days_remaining === 1 ? '' : 's'} ({status.expires_on}). Renew soon.
      </p>
    )
  }
  if (status.status === 'expired') {
    return (
      <p className="text-[11px] text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-md px-2 py-1 inline-flex items-center gap-1.5 mt-2">
        <ShieldX className="h-3 w-3" />
        Training expired on {status.expires_on}. Renew before issuing a locktag.
      </p>
    )
  }
  // 'missing'
  return (
    <p className="text-[11px] text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-md px-2 py-1 inline-flex items-center gap-1.5 mt-2">
      <ShieldX className="h-3 w-3" />
      No LOTO training record on file for {workerName || 'this worker'}. Add one before issuing a locktag.
    </p>
  )
}
