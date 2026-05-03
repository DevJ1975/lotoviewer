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
import {
  validateHotWorkTraining,
  type HotWorkTrainingIssue,
} from '@/lib/trainingRecords'
import { loadHotWorkPermit }            from '@/lib/queries/hotWorkPermits'
import { loadPermit }                   from '@/lib/queries/confinedSpacePermits'
import { loadAllTrainingRecordsSafe }   from '@/lib/queries/trainingRecords'
import { FireWatchSignOnDialog } from './_components/FireWatchSignOnDialog'
import { CancelDialog }          from './_components/CancelDialog'
import { ChecklistDisplay }      from './_components/ChecklistDisplay'

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
    const [p, trainingRecords] = await Promise.all([
      loadHotWorkPermit(permitId),
      loadAllTrainingRecordsSafe(),
    ])
    if (!p) {
      setNotFound(true); setLoading(false); return
    }
    setPermit(p)
    setTrainingRecords(trainingRecords)

    // Load cross-linked CS permit if any.
    if (p.associated_cs_permit_id) {
      const cs = await loadPermit(p.associated_cs_permit_id)
      if (cs) setCsPermit(cs)
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
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (notFound || !permit || !state || !countdown) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center space-y-3">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Hot work permit not found.</p>
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
        <Link href="/hot-work" className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-300 dark:border-slate-700 hover:border-slate-400 rounded-md px-2.5 py-1 transition-colors"
            aria-label="Download PDF"
          >
            <Download className="h-3.5 w-3.5" /> PDF
          </button>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono font-bold tracking-wider">{permit.serial}</span>
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
        <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 rounded-lg px-3 py-2">{serverError}</p>
      )}

      {/* Cross-link banners */}
      {csPermit && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/40 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-blue-900 dark:text-blue-100">Linked confined-space permit</p>
          <p className="text-sm text-blue-900 dark:text-blue-100 mt-0.5">
            <Link href={`/confined-spaces/${encodeURIComponent(csPermit.space_id)}/permits/${csPermit.id}`} className="font-mono font-bold hover:underline">
              {csPermit.serial}
            </Link>
            {' — '}
            <span className="font-semibold">{csPermit.space_id}</span>
            {' (expires ' + new Date(csPermit.expires_at).toLocaleString() + ')'}
          </p>
          <p className="text-[11px] text-blue-900 dark:text-blue-100/80 mt-1">
            §1910.146(f)(15) — work in this space requires both permits to remain valid.
          </p>
        </div>
      )}

      {permit.equipment_id && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Linked equipment</p>
          <p className="text-sm text-slate-800 dark:text-slate-200 mt-0.5">
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
            <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 space-y-1">
              <p className="text-[11px] font-bold text-rose-900 dark:text-rose-100">Sign blocked — resolve these first:</p>
              <ul className="text-[11px] text-rose-900 dark:text-rose-100/85 space-y-0.5 pl-4">
                {signBlocks.map(b => <li key={b.code}>• {b.message}</li>)}
              </ul>
            </div>
          )}
          {trainingIssues.length > 0 && signBlocks.length === 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 space-y-1.5">
              <p className="text-[11px] font-bold text-amber-900 dark:text-amber-100">§1910.252(a)(2)(xv) — training records not on file</p>
              <ul className="text-[11px] text-amber-900 dark:text-amber-100/85 space-y-0.5 pl-4">
                {trainingIssues.map((i, idx) => (
                  <li key={`${i.worker_name}:${i.slot}:${idx}`}>
                    • <span className="font-semibold">{i.worker_name}</span> ({i.slot}) — {i.kind === 'missing' ? 'no training record' : `cert expired${i.expired_on ? ` ${i.expired_on}` : ''}`}
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-100 pt-1 cursor-pointer">
                <input type="checkbox" checked={trainingOverride} onChange={e => setTrainingOverride(e.target.checked)} className="mt-0.5" />
                <span>I have verified each worker's training off-app and accept responsibility for authorizing entry.</span>
              </label>
            </div>
          )}
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">Sign &amp; authorize this permit</p>
              <p className="text-[11px] text-emerald-900 dark:text-emerald-100/80">
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
        <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-bold text-blue-900 dark:text-blue-100">Fire watcher on-duty sign-on</p>
            <p className="text-[11px] text-blue-900 dark:text-blue-100/80">NFPA 51B §6.5 — confirm a watcher is in position before work proceeds.</p>
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
            className="text-xs font-semibold text-rose-700 dark:text-rose-300 hover:underline"
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
        <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 p-4 space-y-2">
          <p className="text-sm font-bold text-blue-900 dark:text-blue-100">
            Fire watch active — {formatMinutes(countdown.postWatchMinutesRemaining)} remaining
          </p>
          <p className="text-[11px] text-blue-900 dark:text-blue-100/80">
            NFPA 51B §8.7 — the fire watcher must remain on site and observe for smoke / fire. Permit cannot be closed
            until the timer elapses.
          </p>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              onClick={() => { setCancelInitial('fire_observed'); setCancelOpen(true) }}
              className="text-xs font-semibold text-rose-700 dark:text-rose-300 hover:underline"
            >
              Fire / unsafe condition observed →
            </button>
          </div>
        </div>
      )}

      {/* Ready to close */}
      {state === 'post_watch_complete' && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">Post-work watch elapsed — ready to close.</p>
            <p className="text-[11px] text-emerald-900 dark:text-emerald-100/80">No fire was observed. Confirm and close to lock the audit trail.</p>
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
        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-rose-900 dark:text-rose-100/80">
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

// ── Layout helpers ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
      <header><h2 className="text-[11px] font-bold uppercase tracking-wider text-[#214487]">{title}</h2></header>
      {children}
    </section>
  )
}

function KV({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="font-semibold text-slate-500 dark:text-slate-400 w-44 shrink-0">{label}</span>
      <span className="text-slate-800 dark:text-slate-200 break-words">{value}</span>
    </div>
  )
}
function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}
