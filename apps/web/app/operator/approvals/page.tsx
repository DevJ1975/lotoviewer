'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck, Check, X, Undo2, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { authHeaders } from '@/app/admin/loto/multi-agent-audit/_lib/authHeaders'
import { CARVE_OUT_ACTIONS, type CarveOutAction } from '@soteria/core/operatorActions'

// Operator Console — the approval inbox. The companion to /operator: when the
// agent stages a regulated, life-safety carve-out (a hot-work or confined-space
// authorization, etc.), it lands here for a qualified human (admin/owner) to
// apply with one tap or reject. An applied, reversible action can be rolled back
// from the Recent list. All decisions re-prove the actor's authorizing role
// server-side; the role gate here only governs which controls are shown.

interface PendingAction {
  id:              string
  action:          CarveOutAction
  authorizingRole: 'admin' | 'owner'
  reversible:      boolean
  summary:         string
  requestedAt:     string
}

interface DecidedAction {
  id:         string
  action:     CarveOutAction
  status:     'applied' | 'rejected' | 'rolled_back'
  reversible: boolean
  summary:    string
  decidedAt:  string | null
  outcome:    string | null
}

const actionLabel = (a: CarveOutAction): string => CARVE_OUT_ACTIONS[a]?.label ?? a

function fmt(ts: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ')
}

const STATUS_STYLE: Record<DecidedAction['status'], string> = {
  applied:     'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  rejected:    'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  rolled_back: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
}

export default function OperatorApprovalsPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId, role, loading: tenantLoading } = useTenant()

  const [pending, setPending]           = useState<PendingAction[] | null>(null)
  const [recent, setRecent]             = useState<DecidedAction[]>([])
  const [error, setError]               = useState<string | null>(null)
  const [busyId, setBusyId]             = useState<string | null>(null)
  const [rejecting, setRejecting]       = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // UX gate only — the server re-proves the action-specific role on every act.
  const canApprove = role === 'admin' || role === 'owner' || profile?.is_superadmin === true

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    try {
      const res = await fetch('/api/operator/approvals', { headers: await authHeaders(tenantId) })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? `HTTP ${res.status}`); setPending([]); return }
      setPending(body.pending ?? [])
      setRecent(body.recent ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the approval queue.')
      setPending([])
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && !tenantLoading && tenantId) void load()
  }, [authLoading, tenantLoading, tenantId, load])

  const act = useCallback(async (id: string, path: 'approve' | 'rollback') => {
    if (!tenantId) return
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/operator/approvals/${id}/${path}`, { method: 'POST', headers: await authHeaders(tenantId) })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }, [tenantId, load])

  const reject = useCallback(async (id: string) => {
    if (!tenantId) return
    if (!rejectReason.trim()) { setError('A rejection reason is required.'); return }
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/operator/approvals/${id}/reject`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders(tenantId)) },
        body:    JSON.stringify({ reason: rejectReason.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setRejecting(null)
      setRejectReason('')
      await load()
    } finally {
      setBusyId(null)
    }
  }, [tenantId, rejectReason, load])

  if (authLoading || tenantLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!profile) {
    return <main className="mx-auto max-w-3xl px-4 py-10"><p className="text-sm text-slate-500">Please sign in to review approvals.</p></main>
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-5">
      <div>
        <Link href="/operator" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Operator Console
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
          <ShieldCheck className="h-6 w-6 text-brand-navy" /> Approval Inbox
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Regulated, life-safety actions the agent staged for sign-off. {canApprove
            ? 'Approve to apply immediately, or reject with a reason.'
            : 'A tenant admin or owner must approve these.'}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          {error}
        </div>
      )}

      {/* ── Pending ─────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Awaiting approval</h2>
        {pending === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : pending.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-800">
            Nothing is awaiting approval.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {pending.map(item => (
              <li key={item.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-brand-navy/10 px-1.5 py-0.5 text-[11px] font-medium text-brand-navy dark:bg-brand-navy/20">
                    {actionLabel(item.action)}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">staged {fmt(item.requestedAt)}</span>
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-100">{item.summary}</p>

                {!canApprove ? (
                  <p className="text-xs text-slate-500">Requires a tenant {item.authorizingRole} to approve.</p>
                ) : rejecting === item.id ? (
                  <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                    <label className="block min-w-[240px] flex-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Rejection reason</span>
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Why is this being declined?"
                        className="mt-1 w-full rounded border border-rose-300 bg-white px-2 py-1.5 text-sm dark:border-rose-800 dark:bg-slate-900"
                      />
                    </label>
                    <button
                      onClick={() => { setRejecting(null); setRejectReason('') }}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
                    >Cancel</button>
                    <button
                      onClick={() => void reject(item.id)}
                      disabled={busyId === item.id || !rejectReason.trim()}
                      className="inline-flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                    >
                      {busyId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />} Reject
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                    <button
                      onClick={() => setRejecting(item.id)}
                      disabled={busyId === item.id}
                      className="inline-flex items-center gap-1 rounded border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30"
                    >
                      <X className="h-3 w-3" /> Reject
                    </button>
                    <button
                      onClick={() => void act(item.id, 'approve')}
                      disabled={busyId === item.id}
                      className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {busyId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve &amp; apply
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Recent ──────────────────────────────────────────────────────── */}
      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Recent</h2>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {recent.map(item => (
              <li key={item.id} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[item.status]}`}>
                    {item.status.replace('_', ' ')}
                  </span>
                  <span className="text-[11px] text-slate-500">{actionLabel(item.action)}</span>
                  <span className="ml-auto text-xs text-slate-400">{fmt(item.decidedAt)}</span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-200">{item.outcome ?? item.summary}</p>
                {canApprove && item.status === 'applied' && item.reversible && (
                  <button
                    onClick={() => void act(item.id, 'rollback')}
                    disabled={busyId === item.id}
                    className="inline-flex items-center gap-1 rounded border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/30"
                  >
                    {busyId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Roll back
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
