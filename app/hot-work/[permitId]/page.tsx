'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, Flame, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import type {
  ConfinedSpacePermit,
  HotWorkCancelReason,
  HotWorkPermit,
  HotWorkPreChecks,
  TrainingRecord,
} from '@/lib/types'
import {
  HOT_WORK_TYPE_LABELS,
  HOT_WORK_CANCEL_REASON_LABELS,
} from '@/lib/types'
import {
  hotWorkState,
  hotWorkCountdown,
  evaluateSignGates,
  type HotWorkState,
} from '@/lib/hotWorkPermitStatus'
import { validateChecklist } from '@/lib/hotWorkChecklist'
import {
  validateHotWorkTraining,
  type HotWorkTrainingIssue,
} from '@/lib/trainingRecords'

// Hot Work permit detail page. Six-state lifecycle with action buttons
// shown contextually:
//
//   pending_signature → Sign & authorize (PAI)
//                       Cancel (PAI can abandon a draft)
//   active            → Mark work complete (starts post-watch timer)
//                       Cancel for cause (prohibited, fire, etc.)
//   post_work_watch   → Cancel for cause; Close-out disabled until
//                       countdown elapses
//   post_watch_complete → Close out (sets canceled_at + 'task_complete')
//   expired           → Close out (forced-late close per §6777)
//   canceled          → Read-only with audit trail
//
// All transitions go through supabase update + the audit_log trigger
// captures the row before/after for compliance traceability.

const STATE_LABEL: Record<HotWorkState, string> = {
  pending_signature:   'Pending signature',
  active:              'Active — work in progress',
  post_work_watch:     'Post-work fire watch',
  post_watch_complete: 'Ready to close',
  expired:             'Expired — needs close-out',
  canceled:            'Closed',
}

const STATE_BG: Record<HotWorkState, string> = {
  pending_signature:   'bg-amber-500',
  active:              'bg-emerald-600',
  post_work_watch:     'bg-blue-600',
  post_watch_complete: 'bg-emerald-700',
  expired:             'bg-rose-600',
  canceled:            'bg-slate-600',
}

export default function HotWorkPermitDetailPage() {
  const params  = useParams<{ permitId: string }>()
  const router  = useRouter()
  const { profile, loading: authLoading } = useAuth()
  const permitId = params.permitId

  const [permit, setPermit]       = useState<HotWorkPermit | null>(null)
  const [csPermit, setCsPermit]   = useState<ConfinedSpacePermit | null>(null)
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([])
  const [loading, setLoading]     = useState(true)
  const [notFound, setNotFound]   = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy]           = useState<null | 'sign' | 'fire_watch' | 'complete' | 'cancel'>(null)
  const [now, setNow]             = useState(() => Date.now())
  const [trainingOverride, setTrainingOverride] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelInitial, setCancelInitial] = useState<HotWorkCancelReason>('task_complete')
  const [fireWatchOpen, setFireWatchOpen] = useState(false)

  // 1Hz tick keeps countdowns live without a refetch.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [pRes, trRes] = await Promise.all([
      supabase.from('loto_hot_work_permits').select('*').eq('id', permitId).single(),
      supabase.from('loto_training_records').select('*'),
    ])
    if (pRes.error || !pRes.data) {
      setNotFound(true); setLoading(false); return
    }
    const p = pRes.data as HotWorkPermit
    setPermit(p)
    if (trRes.data) setTrainingRecords(trRes.data as TrainingRecord[])

    // Load cross-linked CS permit if any.
    if (p.associated_cs_permit_id) {
      const { data: cs } = await supabase
        .from('loto_confined_space_permits')
        .select('*')
        .eq('id', p.associated_cs_permit_id)
        .single()
      if (cs) setCsPermit(cs as ConfinedSpacePermit)
    } else {
      setCsPermit(null)
    }
    setLoading(false)
  }, [permitId])
  useEffect(() => { load() }, [load])

  const state = useMemo(() => permit ? hotWorkState(permit, now) : null, [permit, now])
  const countdown = useMemo(() => permit ? hotWorkCountdown(permit, now) : null, [permit, now])

  const signBlocks = useMemo(
    () => permit ? evaluateSignGates(permit) : [],
    [permit],
  )
  const trainingIssues: HotWorkTrainingIssue[] = useMemo(
    () => permit ? validateHotWorkTraining({
      operators: permit.hot_work_operators,
      watchers:  permit.fire_watch_personnel,
      records:   trainingRecords,
      asOf:      new Date(),
    }) : [],
    [permit, trainingRecords],
  )

  if (authLoading || loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (notFound || !permit || !state || !countdown) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center space-y-3">
        <p className="text-sm font-semibold text-slate-700">Hot work permit not found.</p>
        <Link href="/hot-work" className="inline-block px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors">
          Back to permits
        </Link>
      </div>
    )
  }

  // ── Actions ───────────────────────────────────────────────────────────
  async function handleSign() {
    if (!profile?.id || !permit) return
    if (signBlocks.length > 0) {
      setServerError('Resolve the sign-gate issues below before authorizing.')
      return
    }
    if (trainingIssues.length > 0 && !trainingOverride) {
      setServerError('Some operators or watchers have missing or expired training — review the §(g) banner and confirm verification before signing.')
      return
    }
    setBusy('sign'); setServerError(null)
    const { data, error } = await supabase
      .from('loto_hot_work_permits')
      .update({ pai_signature_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', permitId)
      .select('*')
      .single()
    setBusy(null)
    if (error || !data) { setServerError(error?.message ?? 'Could not sign.'); return }
    setPermit(data as HotWorkPermit)
  }

  async function handleMarkComplete() {
    if (!permit) return
    if (!confirm('Mark work complete? This starts the ' + permit.post_watch_minutes + '-minute post-work fire watch. The fire watcher must remain on duty until the timer elapses.')) return
    setBusy('complete'); setServerError(null)
    const { data, error } = await supabase
      .from('loto_hot_work_permits')
      .update({ work_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', permitId)
      .select('*')
      .single()
    setBusy(null)
    if (error || !data) { setServerError(error?.message ?? 'Could not mark complete.'); return }
    setPermit(data as HotWorkPermit)
  }

  // PDF download — same iOS-Safari-friendly pattern as the CS permit:
  // open the blob in a new tab so the native viewer gets Share / Save / Print
  // chrome, with an anchor-click fallback when popups are blocked.
  async function handleDownloadPdf() {
    if (!permit) return
    setServerError(null)
    try {
      const { generateHotWorkPermitPdf } = await import('@/lib/pdfHotWorkPermit')
      const permitUrl = `${window.location.origin}/hot-work/${permit.id}`
      const bytes = await generateHotWorkPermitPdf({ permit, permitUrl })
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const url  = URL.createObjectURL(blob)
      const filename = `${permit.serial ?? `hot-work-${permit.id.slice(0, 8)}`}.pdf`

      const newWin = window.open(url, '_blank', 'noopener,noreferrer')
      if (!newWin) {
        const a = document.createElement('a')
        a.href     = url
        a.download = filename
        a.rel      = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      console.error('[hot-work-pdf] download failed', err)
      setServerError(`Could not generate PDF: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center justify-between gap-3">
        <Link href="/hot-work" className="text-sm font-semibold text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 border border-slate-300 hover:border-slate-400 rounded-md px-2.5 py-1 transition-colors"
            aria-label="Download PDF"
          >
            <Download className="h-3.5 w-3.5" /> PDF
          </button>
          <span className="text-[11px] text-slate-500 font-mono font-bold tracking-wider">{permit.serial}</span>
        </div>
      </header>

      {/* State banner */}
      <div className={`${STATE_BG[state]} text-white rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap`}>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">Status</p>
          <p className="text-lg font-black">{STATE_LABEL[state]}</p>
        </div>
        {state === 'active' && countdown.activeMinutesRemaining != null && (
          <p className="text-2xl font-mono font-bold tabular-nums">{formatMinutes(countdown.activeMinutesRemaining)} left</p>
        )}
        {state === 'post_work_watch' && countdown.postWatchMinutesRemaining != null && (
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-widest opacity-80">Watch ends in</p>
            <p className="text-2xl font-mono font-bold tabular-nums">{formatMinutes(countdown.postWatchMinutesRemaining)}</p>
          </div>
        )}
      </div>

      {serverError && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{serverError}</p>
      )}

      {/* Cross-link banners */}
      {csPermit && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-blue-900">Linked confined-space permit</p>
          <p className="text-sm text-blue-900 mt-0.5">
            <Link href={`/confined-spaces/${encodeURIComponent(csPermit.space_id)}/permits/${csPermit.id}`} className="font-mono font-bold hover:underline">
              {csPermit.serial}
            </Link>
            {' — '}
            <span className="font-semibold">{csPermit.space_id}</span>
            {' (expires ' + new Date(csPermit.expires_at).toLocaleString() + ')'}
          </p>
          <p className="text-[11px] text-blue-900/80 mt-1">
            §1910.146(f)(15) — work in this space requires both permits to remain valid.
          </p>
        </div>
      )}

      {permit.equipment_id && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Linked equipment</p>
          <p className="text-sm text-slate-800 mt-0.5">
            <Link href={`/equipment/${encodeURIComponent(permit.equipment_id)}?from=${encodeURIComponent('/hot-work/' + permit.id)}`} className="font-mono font-bold hover:underline">
              {permit.equipment_id}
            </Link>
            {' — review the LOTO procedure before authorizing.'}
          </p>
        </div>
      )}

      {/* Scope */}
      <Section title="Scope">
        <KV label="Location" value={permit.work_location} />
        <KV label="Description" value={permit.work_description} />
        <KV label="Work types" value={permit.work_types.map(t => HOT_WORK_TYPE_LABELS[t]).join(', ')} />
        <KV label="Started"  value={new Date(permit.started_at).toLocaleString()} />
        <KV label="Expires"  value={new Date(permit.expires_at).toLocaleString()} />
        <KV label="Post-watch duration" value={`${permit.post_watch_minutes} min`} />
        {permit.work_order_ref && <KV label="Work order ref" value={permit.work_order_ref} />}
        {permit.notes && <KV label="Notes" value={permit.notes} />}
      </Section>

      {/* Personnel */}
      <Section title="Personnel">
        <KV label="Permit Authorizing Individual" value={permit.pai_id.slice(0, 8) + (permit.pai_signature_at ? ` · signed ${new Date(permit.pai_signature_at).toLocaleString()}` : ' · unsigned')} />
        <KV label="Hot work operators" value={permit.hot_work_operators.length === 0 ? '—' : permit.hot_work_operators.join(', ')} />
        <KV label="Fire watch personnel" value={permit.fire_watch_personnel.length === 0 ? '—' : permit.fire_watch_personnel.join(', ')} />
        {permit.fire_watch_signature_at && (
          <KV label="Fire watch on duty" value={`${permit.fire_watch_signature_name ?? '—'} · ${new Date(permit.fire_watch_signature_at).toLocaleString()}`} />
        )}
      </Section>

      {/* Pre-work checklist */}
      <Section title="Pre-work checklist">
        <ChecklistDisplay checks={permit.pre_work_checks} />
      </Section>

      {/* Sign gates / training warnings (only when relevant) */}
      {state === 'pending_signature' && (
        <>
          {signBlocks.length > 0 && (
            <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 space-y-1">
              <p className="text-[11px] font-bold text-rose-900">Sign blocked — resolve these first:</p>
              <ul className="text-[11px] text-rose-900/85 space-y-0.5 pl-4">
                {signBlocks.map(b => <li key={b.code}>• {b.message}</li>)}
              </ul>
            </div>
          )}
          {trainingIssues.length > 0 && signBlocks.length === 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 space-y-1.5">
              <p className="text-[11px] font-bold text-amber-900">§1910.252(a)(2)(xv) — training records not on file</p>
              <ul className="text-[11px] text-amber-900/85 space-y-0.5 pl-4">
                {trainingIssues.map((i, idx) => (
                  <li key={`${i.worker_name}:${i.slot}:${idx}`}>
                    • <span className="font-semibold">{i.worker_name}</span> ({i.slot}) — {i.kind === 'missing' ? 'no training record' : `cert expired${i.expired_on ? ` ${i.expired_on}` : ''}`}
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2 text-[11px] text-amber-900 pt-1 cursor-pointer">
                <input type="checkbox" checked={trainingOverride} onChange={e => setTrainingOverride(e.target.checked)} className="mt-0.5" />
                <span>I have verified each worker's training off-app and accept responsibility for authorizing entry.</span>
              </label>
            </div>
          )}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-bold text-emerald-900">Sign &amp; authorize this permit</p>
              <p className="text-[11px] text-emerald-900/80">
                You're acting as the Permit Authorizing Individual. The permit becomes active immediately on sign.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSign}
              disabled={
                busy === 'sign' ||
                signBlocks.length > 0 ||
                (trainingIssues.length > 0 && !trainingOverride)
              }
              className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-emerald-700 transition-colors"
            >
              {busy === 'sign' ? 'Signing…' : '✓ Sign & authorize'}
            </button>
          </div>
        </>
      )}

      {/* Fire watch sign-on (active permits, watcher hasn't signed yet) */}
      {state === 'active' && !permit.fire_watch_signature_at && permit.fire_watch_personnel.length > 0 && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-bold text-blue-900">Fire watcher on-duty sign-on</p>
            <p className="text-[11px] text-blue-900/80">NFPA 51B §6.5 — confirm a watcher is in position before work proceeds.</p>
          </div>
          <button
            type="button"
            onClick={() => setFireWatchOpen(true)}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            Sign on as fire watcher
          </button>
        </div>
      )}

      {/* Mark complete (active state) */}
      {state === 'active' && (
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => { setCancelInitial('unsafe_condition'); setCancelOpen(true) }}
            className="text-xs font-semibold text-rose-700 hover:underline"
          >
            Cancel for cause…
          </button>
          <button
            type="button"
            onClick={handleMarkComplete}
            disabled={busy === 'complete'}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50 hover:bg-blue-700 transition-colors"
          >
            {busy === 'complete' ? 'Saving…' : 'Mark work complete'}
          </button>
        </div>
      )}

      {/* Post-work watch — countdown + cancel-for-cause; no close until elapsed */}
      {state === 'post_work_watch' && countdown.postWatchMinutesRemaining != null && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 space-y-2">
          <p className="text-sm font-bold text-blue-900">
            Fire watch active — {formatMinutes(countdown.postWatchMinutesRemaining)} remaining
          </p>
          <p className="text-[11px] text-blue-900/80">
            NFPA 51B §8.7 — the fire watcher must remain on site and observe for smoke / fire. Permit cannot be closed
            until the timer elapses.
          </p>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              onClick={() => { setCancelInitial('fire_observed'); setCancelOpen(true) }}
              className="text-xs font-semibold text-rose-700 hover:underline"
            >
              Fire / unsafe condition observed →
            </button>
          </div>
        </div>
      )}

      {/* Ready to close */}
      {state === 'post_watch_complete' && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-bold text-emerald-900">Post-work watch elapsed — ready to close.</p>
            <p className="text-[11px] text-emerald-900/80">No fire was observed. Confirm and close to lock the audit trail.</p>
          </div>
          <button
            type="button"
            onClick={() => { setCancelInitial('task_complete'); setCancelOpen(true) }}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
          >
            Close out permit
          </button>
        </div>
      )}

      {/* Expired without close-out */}
      {state === 'expired' && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-rose-900/80">
            This permit expired without being formally closed. Close it out now to clear the alert and lock the audit trail.
          </p>
          <button
            type="button"
            onClick={() => { setCancelInitial('expired'); setCancelOpen(true) }}
            className="shrink-0 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-colors"
          >
            Close out expired permit
          </button>
        </div>
      )}

      {/* Cancellation history when canceled */}
      {state === 'canceled' && permit.canceled_at && (
        <Section title="Closure">
          <KV label="Closed at" value={new Date(permit.canceled_at).toLocaleString()} />
          <KV label="Reason"    value={permit.cancel_reason ? HOT_WORK_CANCEL_REASON_LABELS[permit.cancel_reason] : '—'} />
          {permit.cancel_notes && <KV label="Notes" value={permit.cancel_notes} />}
        </Section>
      )}

      {/* Dialogs */}
      {fireWatchOpen && (
        <FireWatchSignOnDialog
          permit={permit}
          onClose={() => setFireWatchOpen(false)}
          onSigned={(updated) => { setPermit(updated); setFireWatchOpen(false) }}
        />
      )}
      {cancelOpen && (
        <CancelDialog
          permit={permit}
          initialReason={cancelInitial}
          onClose={() => setCancelOpen(false)}
          onCanceled={(updated) => {
            setPermit(updated)
            setCancelOpen(false)
            // For close-out flows the user may want to verify; route
            // back to the list to free their attention.
            if (updated.cancel_reason === 'task_complete') router.push('/hot-work')
          }}
        />
      )}
    </div>
  )
}

// ── Fire watch sign-on dialog ─────────────────────────────────────────────

function FireWatchSignOnDialog({
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
    if (error || !data) { setErr(error?.message ?? 'Could not sign on.'); return }
    onSigned(data as HotWorkPermit)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Fire watch sign-on</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1">×</button>
        </header>
        <p className="text-[11px] text-slate-600">
          By signing on you accept the watcher duties under NFPA 51B §6.5: continuous observation during work and
          for at least {permit.post_watch_minutes} minutes after work ends. You may not perform other tasks while on watch.
        </p>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-600">Watcher signing on</span>
          <select
            value={pick}
            onChange={e => setPick(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          >
            {permit.fire_watch_personnel.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {err && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
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

// ── Cancel / close-out dialog ─────────────────────────────────────────────

function CancelDialog({
  permit, initialReason, onClose, onCanceled,
}: {
  permit:        HotWorkPermit
  initialReason: HotWorkCancelReason
  onClose:       () => void
  onCanceled:    (updated: HotWorkPermit) => void
}) {
  const [reason, setReason] = useState<HotWorkCancelReason>(initialReason)
  const [notes, setNotes]   = useState('')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  const requiresNotes = reason !== 'task_complete'
  const isCloseOut    = reason === 'task_complete'
  const dialogTitle   = isCloseOut ? 'Close out permit' : 'Cancel permit'
  const submitLabel   = isCloseOut ? 'Close out' : 'Cancel permit'
  const submitTone    = isCloseOut
    ? 'bg-emerald-600 hover:bg-emerald-700'
    : reason === 'fire_observed' ? 'bg-rose-700 hover:bg-rose-800'
    : 'bg-rose-600 hover:bg-rose-700'

  async function submit() {
    if (requiresNotes && !notes.trim()) {
      setErr('Describe the situation when canceling for this reason.'); return
    }
    setBusy(true); setErr(null)
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('loto_hot_work_permits')
      .update({
        canceled_at:   now,
        cancel_reason: reason,
        cancel_notes:  notes.trim() || null,
        updated_at:    now,
      })
      .eq('id', permit.id)
      .select('*')
      .single()
    setBusy(false)
    if (error || !data) { setErr(error?.message ?? 'Could not save.'); return }
    onCanceled(data as HotWorkPermit)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{dialogTitle}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1">×</button>
        </header>
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600">Reason</span>
            <select
              value={reason}
              onChange={e => setReason(e.target.value as HotWorkCancelReason)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            >
              {Object.entries(HOT_WORK_CANCEL_REASON_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600">
              Notes {requiresNotes && <span className="text-rose-500">*</span>}
            </span>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={
                reason === 'fire_observed'    ? 'What was observed? Was the fire suppressed? Was emergency response activated?'
              : reason === 'unsafe_condition' ? 'What condition triggered the cancel? (sprinklers down, ignition near combustibles, etc.)'
              : reason === 'expired'          ? 'Permit ran past expiration — describe the disposition.'
              : reason === 'other'            ? 'Describe the close-out reason.'
              :                                 '(optional)'
              }
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>
        </div>
        {err && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Back</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className={`px-5 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40 transition-colors ${submitTone}`}
          >
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Layout helpers ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
      <header><h2 className="text-[11px] font-bold uppercase tracking-wider text-[#214487]">{title}</h2></header>
      {children}
    </section>
  )
}

function KV({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="font-semibold text-slate-500 w-44 shrink-0">{label}</span>
      <span className="text-slate-800 break-words">{value}</span>
    </div>
  )
}

function ChecklistDisplay({ checks }: { checks: HotWorkPreChecks }) {
  const issues = validateChecklist(checks)
  const failedCodes = new Set(issues.map(i => i.code))
  // Static rendering so the printed-permit format and the on-screen
  // detail page stay in lockstep. Each row shows the question and the
  // current answer. Failures get a rose pill so the supervisor sees
  // gaps at a glance.
  const rows: Array<{ key: keyof HotWorkPreChecks; label: string; code?: string; format?: 'tri' }> = [
    { key: 'combustibles_cleared_35ft',    label: 'Combustibles cleared / shielded within 35 ft',  code: 'combustibles' },
    { key: 'floor_swept',                  label: 'Floor swept clean for 35 ft radius',             code: 'floor_swept' },
    { key: 'floor_openings_protected',     label: 'Floor openings within 35 ft protected',          code: 'floor_openings' },
    { key: 'wall_openings_protected',      label: 'Wall openings within 35 ft protected',           code: 'wall_openings' },
    { key: 'sprinklers_operational',       label: 'Sprinklers operational',                         code: 'sprinklers' },
    { key: 'ventilation_adequate',         label: 'Ventilation adequate',                           code: 'ventilation' },
    { key: 'fire_extinguisher_present',    label: 'Fire extinguisher present within reach',         code: 'extinguisher_present' },
    { key: 'curtains_or_shields_in_place', label: 'Curtains / shields in place where needed',       code: 'curtains' },
    { key: 'gas_lines_isolated',           label: 'Gas lines isolated (or N/A)',                    format: 'tri', code: 'gas_lines' },
    { key: 'adjacent_areas_notified',      label: 'Adjacent areas notified before work begins',     code: 'adjacent_notified' },
    { key: 'confined_space',               label: 'Hot work performed inside a confined space' },
    { key: 'elevated_work',                label: 'Elevated work (>4 ft / fall protection req.)' },
  ]
  return (
    <ul className="text-xs space-y-0.5">
      {rows.map(r => {
        const v = checks[r.key]
        const isFailed = r.code != null && failedCodes.has(r.code)
        return (
          <li key={String(r.key)} className="flex items-baseline justify-between gap-3 py-0.5 border-t border-slate-100 first:border-t-0">
            <span className="text-slate-700">{r.label}</span>
            <AnswerBadge value={v} format={r.format} failed={isFailed} />
          </li>
        )
      })}
      {checks.sprinklers_operational === false && checks.alternate_protection_if_no_spr && (
        <li className="text-[11px] text-slate-500 pt-1.5">
          <span className="font-semibold">Alternate protection:</span> {checks.alternate_protection_if_no_spr}
        </li>
      )}
      {checks.fire_extinguisher_present === true && checks.fire_extinguisher_type && (
        <li className="text-[11px] text-slate-500">
          <span className="font-semibold">Extinguisher type:</span> {checks.fire_extinguisher_type}
        </li>
      )}
    </ul>
  )
}

function AnswerBadge({ value, format, failed }: {
  value:  HotWorkPreChecks[keyof HotWorkPreChecks]
  format?: 'tri'
  failed?: boolean
}) {
  if (value === undefined) {
    return <span className="text-[10px] uppercase tracking-wider text-slate-400">unanswered</span>
  }
  if (format === 'tri' && value === null) {
    return <span className="text-[10px] uppercase tracking-wider text-slate-500">N/A</span>
  }
  const cls = failed
    ? 'bg-rose-100 text-rose-800'
    : value === true  ? 'bg-emerald-100 text-emerald-800'
    : value === false ? 'bg-rose-100 text-rose-800'
    : 'bg-slate-100 text-slate-700'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>
      {value === true ? 'Yes' : value === false ? 'No' : String(value)}
    </span>
  )
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}
