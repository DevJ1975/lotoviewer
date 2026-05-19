'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, UserPlus, X as XIcon, ShieldCheck, ShieldAlert, ShieldX, User, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { evaluateLotoTraining, lotoTrainingStatusText, lotoTrainingStatusTone, type LotoTrainingStatus } from '@/lib/trainingRecords'
import { loadAllWorkers } from '@/lib/queries/lotoDevices'
import type { LotoDevice, LotoWorker, TrainingRecord } from '@soteria/core/types'

// Modal for an admin to record a checkout on behalf of a worker.
//
// The Owner picker lists two kinds of people:
//   - app users (from public.profiles), who have email + login
//   - shop-floor workers (from public.loto_workers), tracked as
//     names + optional employee_id; no app login
// The composite "OwnerKey" carries enough info to disambiguate which
// table the selected row lives in, since the FK on loto_device_checkouts
// is a XOR between owner_id (profile) and worker_id (worker).
//
// "Add new worker" form supports both flows — the toggle picks app
// user (creates profile via /api/admin/users) or shop-floor worker
// (creates loto_workers row directly via authenticated client).
//
// Training gate: when an owner is selected we look up
// loto_training_records by case-insensitive name match for role
// 'authorized_employee' (LOTO §1910.147). Status drives a colored
// badge under the dropdown. Check out is disabled when training is
// missing or expired.

type AddKind = 'app_user' | 'shop_worker'
type OwnerKind = 'profile' | 'worker'

interface ProfileLite {
  id:        string
  email:     string | null
  full_name: string | null
}

// Composite key for the dropdown — encodes which table the selected
// row lives in. The select element value is `${kind}:${id}`.
function ownerKey(kind: OwnerKind, id: string) { return `${kind}:${id}` }
function parseOwnerKey(v: string): { kind: OwnerKind; id: string } | null {
  const ix = v.indexOf(':')
  if (ix < 0) return null
  const kind = v.slice(0, ix)
  if (kind !== 'profile' && kind !== 'worker') return null
  return { kind, id: v.slice(ix + 1) }
}

export function CheckoutDialog({ device, onClose, onCheckedOut }: {
  device:        LotoDevice
  onClose:       () => void
  onCheckedOut:  () => void
}) {
  const { profile } = useAuth()
  const { tenantId } = useTenant()
  const [profiles, setProfiles] = useState<ProfileLite[]>([])
  const [workers,  setWorkers]  = useState<LotoWorker[]>([])
  const [ownerKeyV, setOwnerKeyV] = useState<string>('')   // 'profile:<uuid>' | 'worker:<uuid>' | ''
  const [equipmentId, setEquipmentId] = useState('')
  const [notes, setNotes]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // Inline-add form state.
  const [addOpen,           setAddOpen]           = useState(false)
  const [addKind,           setAddKind]           = useState<AddKind>('shop_worker')
  const [addEmail,          setAddEmail]          = useState('')
  const [addName,           setAddName]           = useState('')
  const [addEmployeeId,     setAddEmployeeId]     = useState('')
  const [trainingCompleted, setTrainingCompleted] = useState('')
  const [trainingExpires,   setTrainingExpires]   = useState('')
  const [trainingAuthority, setTrainingAuthority] = useState('')
  const [addBusy,           setAddBusy]           = useState(false)
  const [addError,          setAddError]          = useState<string | null>(null)
  const [addSuccess,        setAddSuccess]        = useState<{ kind: AddKind; tempPassword?: string; emailSent?: boolean } | null>(null)

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
    if (selectId) setOwnerKeyV(ownerKey('profile', selectId))
    else if (profile?.id && !ownerKeyV) setOwnerKeyV(ownerKey('profile', profile.id))
  }

  async function loadWorkers({ selectId }: { selectId?: string } = {}) {
    try {
      const list = await loadAllWorkers()
      setWorkers(list)
      if (selectId) setOwnerKeyV(ownerKey('worker', selectId))
    } catch (e) {
      // Soft-fail — page still works with profiles only. Surface in UI
      // only if the dropdown is otherwise empty.
      console.warn('loadAllWorkers failed', e)
    }
  }

  async function loadTrainingRecords() {
    const { data, error: err } = await supabase
      .from('loto_training_records')
      .select('*')
      .eq('role', 'authorized_employee')
    if (err || !data) return
    setTrainingRecords(data as TrainingRecord[])
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await Promise.all([loadProfiles(), loadWorkers(), loadTrainingRecords()])
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Resolve display info for the currently-selected owner, regardless
  // of whether they're a profile or a worker.
  const selectedOwnerName = useMemo(() => {
    const k = parseOwnerKey(ownerKeyV)
    if (!k) return ''
    if (k.kind === 'profile') {
      const p = profiles.find(p => p.id === k.id)
      return p?.full_name ?? p?.email ?? ''
    }
    const w = workers.find(w => w.id === k.id)
    return w?.full_name ?? ''
  }, [ownerKeyV, profiles, workers])

  const trainingStatus: LotoTrainingStatus | null = useMemo(() => {
    if (!ownerKeyV || !selectedOwnerName) return null
    return evaluateLotoTraining({
      workerName: selectedOwnerName,
      records:    trainingRecords,
      asOf:       new Date(),
    })
  }, [ownerKeyV, selectedOwnerName, trainingRecords])

  const trainingBlocks = trainingStatus?.status === 'missing' || trainingStatus?.status === 'expired'

  async function submit() {
    const k = parseOwnerKey(ownerKeyV)
    if (!k)            { setError('Pick a worker.');         return }
    if (!profile?.id)  { setError('You must be signed in.'); return }
    if (trainingBlocks) { setError('LOTO training is missing or expired for this worker. Add or renew before issuing a locktag.'); return }
    setBusy(true); setError(null)

    const insertPayload: Record<string, unknown> = {
      device_id:    device.id,
      equipment_id: equipmentId.trim() || null,
      recorded_by:  profile.id,
      notes:        notes.trim() || null,
    }
    if (k.kind === 'profile') insertPayload.owner_id  = k.id
    else                      insertPayload.worker_id = k.id

    const { data: row, error: insErr } = await supabase
      .from('loto_device_checkouts')
      .insert(insertPayload)
      .select('id')
      .single()
    if (insErr || !row) {
      setBusy(false)
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

  async function onAddSubmit() {
    if (addBusy) return
    const fullName = addName.trim()
    const completedAt = trainingCompleted.trim()
    const expiresAt   = trainingExpires.trim() || null
    const authority   = trainingAuthority.trim() || null

    if (!fullName) {
      setAddError('Full name is required.')
      return
    }
    if (!completedAt || !/^\d{4}-\d{2}-\d{2}$/.test(completedAt)) {
      setAddError('LOTO training completion date is required.')
      return
    }
    if (expiresAt && expiresAt < completedAt) {
      setAddError('Training expiry cannot be before the completion date.')
      return
    }

    setAddBusy(true)
    setAddError(null)
    setAddSuccess(null)

    try {
      let createdProfileId: string | null = null
      let createdWorkerId:  string | null = null
      let tempPassword: string | undefined
      let emailSent: boolean | undefined

      if (addKind === 'app_user') {
        const email = addEmail.trim().toLowerCase()
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          setAddError('A valid email is required for an app user.')
          return
        }
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) { setAddError('Sign-in expired — please sign back in.'); return }
        const res = await fetch('/api/admin/users', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body:    JSON.stringify({ email, fullName }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) { setAddError(body.error ?? `Server returned ${res.status}`); return }
        tempPassword = body.tempPassword
        emailSent    = body.emailSent === true
        // handle_new_user trigger inserted the profiles row.
        const { data: created } = await supabase
          .from('profiles').select('id').eq('email', email).maybeSingle()
        createdProfileId = created?.id ?? null
      } else {
        // Shop-floor worker — direct insert into loto_workers (RLS
        // permits admin write; tenant_id required since there's no
        // DB default).
        if (!tenantId) {
          setAddError('No active tenant — switch tenant before adding a worker.')
          return
        }
        const employeeId = addEmployeeId.trim() || null
        const { data: created, error: wErr } = await supabase
          .from('loto_workers')
          .insert({
            tenant_id:    tenantId,
            full_name:    fullName,
            employee_id:  employeeId,
            email:        addEmail.trim() || null,
            created_by:   profile?.id ?? null,
          })
          .select('id')
          .single()
        if (wErr || !created) {
          if (wErr?.message?.includes('idx_loto_workers_employee_id')) {
            setAddError(`A worker with employee ID "${employeeId}" already exists.`)
          } else {
            setAddError(formatSupabaseError(wErr, 'add worker'))
          }
          return
        }
        createdWorkerId = created.id
      }

      // Insert the training record. RLS on loto_training_records permits
      // admin writes via authenticated client.
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
        setAddError(
          `Worker created, but training record failed: ${trainErr.message}. ` +
          `Add it manually under Admin → Training records before checkout.`,
        )
      }

      await Promise.all([loadProfiles(), loadWorkers(), loadTrainingRecords()])
      if (createdProfileId)     setOwnerKeyV(ownerKey('profile', createdProfileId))
      else if (createdWorkerId) setOwnerKeyV(ownerKey('worker',  createdWorkerId))
      setAddSuccess({ kind: addKind, tempPassword, emailSent })

      // Reset fields
      setAddEmail('')
      setAddName('')
      setAddEmployeeId('')
      setTrainingCompleted('')
      setTrainingExpires('')
      setTrainingAuthority('')

      if (!trainErr) setAddOpen(false)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Add worker failed.')
    } finally {
      setAddBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4 max-h-[92vh] overflow-y-auto">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Check out <span className="font-mono">{device.device_label}</span>
          </h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none px-1">×</button>
        </header>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Owner</span>
            {!addOpen && (
              <button
                type="button"
                onClick={() => { setAddOpen(true); setAddSuccess(null); setAddError(null) }}
                disabled={busy}
                className="text-[11px] font-semibold text-brand-navy dark:text-brand-yellow hover:underline inline-flex items-center gap-1 disabled:opacity-40"
              >
                <UserPlus className="h-3 w-3" />
                Add new worker
              </button>
            )}
          </div>

          <select
            value={ownerKeyV}
            onChange={e => setOwnerKeyV(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
          >
            <option value="">— pick a worker —</option>
            {workers.length > 0 && (
              <optgroup label="Workers">
                {workers.map(w => (
                  <option key={w.id} value={ownerKey('worker', w.id)}>
                    {w.full_name}{w.employee_id ? ` · ${w.employee_id}` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {profiles.length > 0 && (
              <optgroup label="App users">
                {profiles.map(p => (
                  <option key={p.id} value={ownerKey('profile', p.id)}>
                    {p.full_name || p.email || p.id.slice(0, 8)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {trainingStatus && (
            <TrainingBadge status={trainingStatus} workerName={selectedOwnerName} />
          )}

          {addOpen && (
            <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Add new worker</p>
                <button
                  type="button"
                  onClick={() => { setAddOpen(false); setAddError(null); setAddSuccess(null) }}
                  disabled={addBusy}
                  aria-label="Cancel"
                  className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-40"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                Hand the device to the worker — they fill out their info and LOTO training. Verify the cert paperwork before submitting.
              </p>

              {/* Type toggle */}
              <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setAddKind('shop_worker')}
                  disabled={addBusy}
                  className={(addKind === 'shop_worker' ? 'bg-brand-navy text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300') + ' px-2.5 py-1 inline-flex items-center gap-1 disabled:opacity-50'}
                >
                  <Wrench className="h-3 w-3" /> Shop-floor worker
                </button>
                <button
                  type="button"
                  onClick={() => setAddKind('app_user')}
                  disabled={addBusy}
                  className={(addKind === 'app_user' ? 'bg-brand-navy text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300') + ' px-2.5 py-1 inline-flex items-center gap-1 disabled:opacity-50'}
                >
                  <User className="h-3 w-3" /> App user
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                {addKind === 'shop_worker'
                  ? 'No app login. Tracked by name + optional employee ID for OSHA recordkeeping.'
                  : 'Email-based login. Worker can sign in to the app.'}
              </p>

              <input
                type="text"
                placeholder="Full name (required)"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                disabled={addBusy}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
              />
              <input
                type="email"
                placeholder={addKind === 'app_user' ? 'Email (required)' : 'Email (optional)'}
                value={addEmail}
                onChange={e => setAddEmail(e.target.value)}
                disabled={addBusy}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
              />
              {addKind === 'shop_worker' && (
                <input
                  type="text"
                  placeholder="Employee ID (optional, e.g. EMP-1234)"
                  value={addEmployeeId}
                  onChange={e => setAddEmployeeId(e.target.value)}
                  disabled={addBusy}
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
                />
              )}

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
                    disabled={addBusy}
                    className="block w-full mt-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
                  />
                </label>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                  Expires (optional)
                  <input
                    type="date"
                    value={trainingExpires}
                    onChange={e => setTrainingExpires(e.target.value)}
                    disabled={addBusy}
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
                    disabled={addBusy}
                    className="block w-full mt-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
                  />
                </label>
              </div>

              {addError && (
                <p className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-md px-2 py-1">
                  {addError}
                </p>
              )}
              {addSuccess && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 rounded-md px-2 py-1">
                  {addSuccess.kind === 'app_user' ? 'App user created.' : 'Worker added.'}
                  {addSuccess.kind === 'app_user' && (
                    addSuccess.emailSent
                      ? ' Login email sent.'
                      : addSuccess.tempPassword
                        ? <> Email send failed — share the temp password manually: <code className="font-mono">{addSuccess.tempPassword}</code></>
                        : null
                  )}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onAddSubmit}
                  disabled={addBusy}
                  className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors inline-flex items-center gap-1.5"
                >
                  {addBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                  {addBusy ? 'Saving…' : 'Add & select'}
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
            disabled={busy || !ownerKeyV || trainingBlocks}
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
// Visual layer over lotoTrainingStatusTone() / lotoTrainingStatusText() —
// the tone-to-class map is the single piece of styling logic here, the
// rest (text, icon mapping) is shared with the mobile and the workers
// page versions.
const TONE_CLS: Record<'success' | 'warn' | 'danger', string> = {
  success: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900',
  warn:    'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900',
  danger:  'text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/40 border-rose-100 dark:border-rose-900',
}

function TrainingBadge({ status, workerName }: {
  status:     LotoTrainingStatus
  workerName: string
}) {
  const tone = lotoTrainingStatusTone(status)
  const Icon = tone === 'success' ? ShieldCheck : tone === 'warn' ? ShieldAlert : ShieldX
  return (
    <p className={`text-[11px] border rounded-md px-2 py-1 inline-flex items-center gap-1.5 mt-2 ${TONE_CLS[tone]}`}>
      <Icon className="h-3 w-3" />
      {lotoTrainingStatusText(status, workerName)}
    </p>
  )
}
