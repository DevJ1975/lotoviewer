'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  Copy,
  History,
  Link as LinkIcon,
  Loader2,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { toast } from '@/components/ui/sonner'
import type {
  AuditRunStatus,
  AuditSeverity,
  LotoAuditChange,
  LotoAuditRun,
} from '@/lib/loto/audit/schemas'
import { authHeaders } from '../../_lib/authHeaders'
import {
  AGENT_BADGE,
  AGENT_LABEL,
  CHANGE_KIND_LABEL,
  SEVERITY_BADGE,
  formatChangeValue,
} from '../../_lib/changeDisplay'

// Admin run-detail surface. Four jobs:
//   1. Show run progress (processed/total + status); poll while running.
//   2. Render the change-set grouped by equipment, each as an old→new diff
//      with severity + agent badges.
//   3. Mint the reviewer link (copyable) and apply the approved change-set
//      (snapshot-first, behind a confirm dialog; only when awaiting_review).
//   4. Emergency rollback: list snapshots, restore one behind a typed
//      confirmation.

const POLL_MS = 4000

interface RunSummary {
  run:           LotoAuditRun
  results:       EquipmentResult[]
  snapshots:     Snapshot[]
  change_counts: { by_status: Record<string, number>; by_severity: Record<string, number>; total: number }
}

interface EquipmentResult {
  equipment_id:           string
  equip_photo_verdict:    string | null
  iso_photo_verdict:      string | null
  ds_equipment_confidence: string | null
  ehs_pass:               boolean | null
  agent_phase:            string
}

interface Snapshot {
  id:              string
  reason:          string
  captured_at:     string
  equipment_count: number
  step_count:      number
}

const STATUS_BADGE: Record<AuditRunStatus, string> = {
  running:           'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  awaiting_review:   'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  partially_applied: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
  applied:           'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  failed:            'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
  cancelled:         'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
}

const STATUS_LABEL: Record<AuditRunStatus, string> = {
  running:           'Running',
  awaiting_review:   'Awaiting review',
  partially_applied: 'Partially applied',
  applied:           'Applied',
  failed:            'Failed',
  cancelled:         'Cancelled',
}

const ROLLBACK_CONFIRM_PHRASE = 'ROLLBACK'

export default function AuditDetailClient({ runId }: { runId: string }) {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [summary, setSummary]   = useState<RunSummary | null>(null)
  const [changes, setChanges]   = useState<LotoAuditChange[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  const [minting, setMinting]   = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)

  const [rollbackTarget, setRollbackTarget] = useState<Snapshot | null>(null)
  const [rollbackPhrase, setRollbackPhrase] = useState('')
  const [rollingBack, setRollingBack] = useState(false)

  const loadSummary = useCallback(async () => {
    if (!tenantId) return
    const headers = await authHeaders(tenantId)
    const res = await fetch(`/api/admin/loto/audit/${runId}`, { headers })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    setSummary(body as RunSummary)
  }, [tenantId, runId])

  const loadChanges = useCallback(async () => {
    if (!tenantId) return
    const headers = await authHeaders(tenantId)
    const res = await fetch(`/api/admin/loto/audit/${runId}/changes`, { headers })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    setChanges((body.changes ?? []) as LotoAuditChange[])
  }, [tenantId, runId])

  const loadAll = useCallback(async () => {
    setLoadError(null)
    try {
      await Promise.all([loadSummary(), loadChanges()])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this audit run.')
    }
  }, [loadSummary, loadChanges])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void loadAll()
  }, [authLoading, profile, loadAll])

  // Poll the summary while the engine is still working. We re-read the latest
  // status off `summary` inside the interval (via the ref) so the effect only
  // re-subscribes when the run id changes, not on every progress tick.
  const summaryRef = useRef<RunSummary | null>(null)
  summaryRef.current = summary
  useEffect(() => {
    if (!profile?.is_admin) return
    const id = setInterval(() => {
      if (summaryRef.current?.run.status !== 'running') return
      void loadSummary().catch(() => { /* transient; next tick retries */ })
    }, POLL_MS)
    return () => clearInterval(id)
  }, [profile, loadSummary])

  // When the run finishes (running → terminal), refresh the change-set once so
  // the staged diffs appear without the admin reloading.
  const prevStatus = useRef<AuditRunStatus | null>(null)
  useEffect(() => {
    const status = summary?.run.status ?? null
    if (prevStatus.current === 'running' && status && status !== 'running') {
      void loadChanges().catch(() => {})
    }
    prevStatus.current = status
  }, [summary, loadChanges])

  async function mintReviewLink() {
    if (!tenantId) return
    setMinting(true)
    try {
      const headers = await authHeaders(tenantId)
      const res = await fetch(`/api/admin/loto/audit/${runId}/review-link`, { method: 'POST', headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setReviewUrl(body.review_url as string)
      toast.success(body.created ? 'Review link minted.' : 'Returning the existing review link.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not mint the review link.')
    } finally {
      setMinting(false)
    }
  }

  async function applyApproved() {
    if (!tenantId) return
    setApplyOpen(false)
    setApplying(true)
    try {
      const headers = await authHeaders(tenantId)
      const res = await fetch(`/api/admin/loto/audit/${runId}/apply`, { method: 'POST', headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const regen = body.placards_regenerated as { ok: number; failed: number }
      toast.success(`Applied ${body.applied} change${body.applied === 1 ? '' : 's'}. Placards: ${regen.ok} regenerated${regen.failed ? `, ${regen.failed} failed` : ''}.`)
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Apply failed.')
    } finally {
      setApplying(false)
    }
  }

  async function rollback() {
    if (!tenantId || !rollbackTarget) return
    const snapshot = rollbackTarget
    setRollingBack(true)
    try {
      const headers = await authHeaders(tenantId)
      const res = await fetch(`/api/admin/loto/audit/${runId}/rollback`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ snapshot_id: snapshot.id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const regen = body.placards_regenerated as { ok: number; failed: number }
      toast.success(`Rolled back to the ${formatReason(snapshot.reason)} snapshot. Placards: ${regen.ok} rebuilt${regen.failed ? `, ${regen.failed} failed` : ''}.`)
      closeRollback()
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rollback failed.')
    } finally {
      setRollingBack(false)
    }
  }

  function closeRollback() {
    setRollbackTarget(null)
    setRollbackPhrase('')
  }

  // Group the change-set by equipment so the admin reviews one machine at a
  // time, mirroring how the reviewer surface presents it.
  const changesByEquipment = useMemo(() => groupByEquipment(changes ?? []), [changes])

  if (authLoading) {
    return <main className="mx-auto max-w-5xl px-4 py-12"><Loader2 className="size-4 animate-spin" /></main>
  }
  if (!profile?.is_admin) {
    return <main className="mx-auto max-w-5xl px-4 py-12 text-sm text-slate-500">Admins only.</main>
  }

  const run = summary?.run
  const pending = summary?.change_counts.by_status.pending ?? 0
  const approved = summary?.change_counts.by_status.approved ?? 0
  const canApply = run?.status === 'awaiting_review' && approved > 0

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/admin/loto/audit" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy dark:hover:text-brand-yellow">
        <ArrowLeft className="h-3.5 w-3.5" />
        Audits
      </Link>

      <header className="mt-3 mb-6 flex items-start gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow">
          <Sparkles className="size-5" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">LOTO audit</p>
          <h1 className="text-2xl font-black text-slate-950 dark:text-slate-50">Audit run</h1>
          {run && (
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
              Started {new Date(run.started_at).toLocaleString()}
              {run.finished_at && ` · finished ${new Date(run.finished_at).toLocaleString()}`}
            </p>
          )}
        </div>
      </header>

      {loadError && (
        <p className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{loadError}</p>
      )}

      {!summary ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Loading…</div>
      ) : (
        <div className="space-y-6">
          <ProgressCard run={summary.run} counts={summary.change_counts} />

          {run?.error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{run.error}</p>
          )}

          {/* ── Reviewer link + apply ─────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Reviewer link &amp; apply</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Mint a link so a reviewer can approve or reject each staged change. Once they&apos;ve decided, apply the approved set — it snapshots first, then writes to your live placards.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void mintReviewLink()}
                disabled={minting}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {minting ? <Loader2 className="size-4 animate-spin" /> : <LinkIcon className="size-4" />}
                Mint review link
              </button>

              <button
                type="button"
                onClick={() => setApplyOpen(true)}
                disabled={!canApply || applying}
                title={canApply ? undefined : 'Available once a reviewer has approved changes (status: awaiting review).'}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-brand-navy/90 dark:bg-brand-yellow dark:text-slate-950 dark:hover:bg-brand-yellow/90"
              >
                {applying ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Apply {approved > 0 ? `${approved} approved` : 'approved'} change{approved === 1 ? '' : 's'}
              </button>
            </div>

            {reviewUrl && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
                <code className="flex-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300">{reviewUrl}</code>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(reviewUrl); toast.success('Review URL copied to clipboard.') }}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Copy className="size-3" /> Copy
                </button>
              </div>
            )}
          </section>

          {/* ── Change-set grouped by equipment ───────────────────────── */}
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Staged changes</h2>
              <span className="text-xs text-slate-500">{pending} pending · {approved} approved · {summary.change_counts.total} total</span>
            </div>

            {changes === null ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Loading changes…</div>
            ) : changes.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
                <Sparkles className="mx-auto size-8 text-slate-300 dark:text-slate-600" />
                <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-300">No changes staged</p>
                <p className="mt-1 text-xs text-slate-500">
                  {run?.status === 'running' ? 'The agents are still working — staged changes will appear here as they finish.' : 'The agents found nothing to change for this scope.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {changesByEquipment.map(([equipmentId, rows]) => (
                  <article key={equipmentId} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <Link
                        href={`/equipment/${encodeURIComponent(equipmentId)}`}
                        className="font-mono text-sm font-bold text-brand-navy hover:underline dark:text-brand-yellow"
                      >
                        {equipmentId}
                      </Link>
                      <span className="text-xs text-slate-500">{rows.length} change{rows.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="space-y-3">
                      {rows.map(change => <ChangeRow key={change.id} change={change} />)}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* ── Emergency rollback ────────────────────────────────────── */}
          {summary.snapshots.length > 0 && (
            <section className="rounded-xl border border-rose-200 bg-rose-50/40 p-5 dark:border-rose-900 dark:bg-rose-950/20">
              <div className="flex items-start gap-2">
                <History className="mt-0.5 size-5 text-rose-700 dark:text-rose-300" />
                <div>
                  <h2 className="text-base font-bold text-rose-900 dark:text-rose-200">Emergency rollback</h2>
                  <p className="mt-0.5 text-xs text-rose-800 dark:text-rose-300/90">
                    Restores the equipment + energy steps captured in a snapshot, then rebuilds the affected placards. Last resort — it overwrites the current live data.
                  </p>
                </div>
              </div>

              <ul className="mt-4 space-y-2">
                {summary.snapshots.map(snap => (
                  <li key={snap.id} className="flex items-center justify-between gap-3 rounded-md border border-rose-200 bg-white px-3 py-2 dark:border-rose-900 dark:bg-slate-900">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{formatReason(snap.reason)}</p>
                      <p className="text-[11px] text-slate-500">
                        {new Date(snap.captured_at).toLocaleString()} · {snap.equipment_count} equipment · {snap.step_count} steps
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setRollbackTarget(snap); setRollbackPhrase('') }}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
                    >
                      <RotateCcw className="size-3" /> Roll back
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Apply confirmation. */}
      <AlertDialog open={applyOpen} onOpenChange={setApplyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply approved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This snapshots the current data, writes the {approved} approved change{approved === 1 ? '' : 's'} to your live LOTO tables, then regenerates the affected placards. You can roll back to the snapshot afterward if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void applyApproved()} disabled={applying}>
              {applying ? <Loader2 className="size-4 animate-spin" /> : 'Apply changes'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rollback confirmation — typed phrase gate. */}
      <AlertDialog open={rollbackTarget !== null} onOpenChange={open => { if (!open) closeRollback() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Roll back to this snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              {rollbackTarget && (
                <>This overwrites the current equipment + energy steps with the {formatReason(rollbackTarget.reason)} snapshot from {new Date(rollbackTarget.captured_at).toLocaleString()} ({rollbackTarget.equipment_count} equipment, {rollbackTarget.step_count} steps) and rebuilds their placards. This cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Type <span className="font-mono font-bold">{ROLLBACK_CONFIRM_PHRASE}</span> to confirm
            </span>
            <input
              type="text"
              value={rollbackPhrase}
              onChange={e => setRollbackPhrase(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void rollback()}
              disabled={rollbackPhrase.trim() !== ROLLBACK_CONFIRM_PHRASE || rollingBack}
            >
              {rollingBack ? <Loader2 className="size-4 animate-spin" /> : 'Roll back'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

function ProgressCard({
  run, counts,
}: { run: LotoAuditRun; counts: RunSummary['change_counts'] }) {
  const pct = run.total_equipment > 0 ? Math.round((run.processed_equipment / run.total_equipment) * 100) : 0
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase ${STATUS_BADGE[run.status]}`}>
          {run.status === 'running' && <Loader2 className="size-3 animate-spin" />}
          {STATUS_LABEL[run.status]}
        </span>
        <span className="text-sm tabular-nums text-slate-600 dark:text-slate-300">
          {run.processed_equipment}/{run.total_equipment || '—'} equipment processed
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-brand-navy transition-[width] duration-500 dark:bg-brand-yellow"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 sm:max-w-md">
        <Counter label="Pending"  value={counts.by_status.pending ?? 0} />
        <Counter label="Approved" value={counts.by_status.approved ?? 0} />
        <Counter label="Total"    value={counts.total} />
      </div>

      {Object.keys(counts.by_severity).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(['critical', 'high', 'medium', 'low', 'info'] as AuditSeverity[])
            .filter(sev => counts.by_severity[sev])
            .map(sev => (
              <span key={sev} className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_BADGE[sev]}`}>
                {counts.by_severity[sev]} {sev}
              </span>
            ))}
        </div>
      )}
    </section>
  )
}

function ChangeRow({ change }: { change: LotoAuditChange }) {
  const decided = change.status === 'approved' || change.status === 'rejected'
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {CHANGE_KIND_LABEL[change.change_kind]}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${AGENT_BADGE[change.agent]}`}>
          {AGENT_LABEL[change.agent]}
        </span>
        {change.severity && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_BADGE[change.severity]}`}>
            {change.severity}
          </span>
        )}
        {change.target_column && (
          <span className="font-mono text-[11px] text-slate-500">{change.target_column}</span>
        )}
        <span className="ml-auto">
          <StatusPill status={change.status} />
        </span>
      </div>

      {change.change_kind === 'placeholder_photo' ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <PhotoTile label="Current" url={typeof change.old_value === 'string' ? change.old_value : null} />
          <PhotoTile label="Proposed" url={change.staged_photo_url} />
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ValueBlock label="Old" value={formatChangeValue(change.old_value)} tone="old" />
          <ValueBlock label="New" value={formatChangeValue(change.new_value)} tone="new" />
        </div>
      )}

      {change.rationale && (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{change.rationale}</p>
      )}
      {decided && (
        <p className="mt-1 text-[11px] text-slate-500">
          {change.status === 'approved' ? 'Approved' : 'Rejected'}
          {change.decided_by && ` by ${change.decided_by}`}
          {change.decided_note && ` — ${change.decided_note}`}
        </p>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: LotoAuditChange['status'] }) {
  const cls: Record<LotoAuditChange['status'], string> = {
    pending:    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    approved:   'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
    rejected:   'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
    applied:    'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
    superseded: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  }
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls[status]}`}>{status}</span>
}

function ValueBlock({ label, value, tone }: { label: string; value: string; tone: 'old' | 'new' }) {
  return (
    <div className={`rounded-md px-2.5 py-1.5 ${tone === 'old' ? 'bg-rose-50 dark:bg-rose-950/20' : 'bg-emerald-50 dark:bg-emerald-950/20'}`}>
      <p className={`text-[10px] font-bold uppercase ${tone === 'old' ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-800 dark:text-slate-200">{value}</p>
    </div>
  )
}

function PhotoTile({ label, url }: { label: string; url: string | null }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">{label}</p>
      {url ? (
        // Staged audit photos and live equipment photos both live in the
        // public loto-photos bucket — a plain <img> is enough and avoids
        // next/image host config for the staged-URL variants.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="aspect-[4/3] w-full rounded-md object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-[11px] text-slate-400 dark:border-slate-700 dark:bg-slate-800">
          No photo
        </div>
      )}
    </div>
  )
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
    </div>
  )
}

function groupByEquipment(changes: LotoAuditChange[]): Array<[string, LotoAuditChange[]]> {
  const groups = new Map<string, LotoAuditChange[]>()
  for (const change of changes) {
    const list = groups.get(change.equipment_id) ?? []
    list.push(change)
    groups.set(change.equipment_id, list)
  }
  return [...groups.entries()]
}

function formatReason(reason: string): string {
  return reason.replace(/_/g, ' ')
}
