'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, Loader2, Play, Sparkles } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { toast } from '@/components/ui/sonner'
import type { AuditRunStatus, LotoAuditRun } from '@/lib/loto/audit/schemas'
import { authHeaders } from './_lib/authHeaders'

// /admin/loto/audit — the multi-agent LOTO audit. Lists the tenant's audit
// runs (newest first) and starts new ones. Starting a run kicks the engine in
// the background (202) and returns a run_id; the detail page polls progress.
//
// One row per run. "Open" jumps to the run detail page where the admin reviews
// the change-set, mints a reviewer link, applies approved changes, or rolls
// back. The list is owner/admin only and tenant-scoped at the API.

// The list endpoint returns only the columns it selected — a narrow projection
// of LotoAuditRun. Type the row to exactly that subset so we don't pretend to
// have fields (models, created_by, …) the GET never sends.
type RunRow = Pick<
  LotoAuditRun,
  'id' | 'status' | 'scope' | 'total_equipment' | 'processed_equipment'
  | 'review_link_id' | 'started_at' | 'finished_at' | 'error'
>

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

export default function AuditListPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [runs, setRuns]         = useState<RunRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [department, setDepartment] = useState('')
  const [limit, setLimit]       = useState('')
  const [equipmentIds, setEquipmentIds] = useState('')
  const [starting, setStarting] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const headers = await authHeaders(tenantId)
      const res = await fetch('/api/admin/loto/audit', { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setRuns((body.runs ?? []) as RunRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load audit runs.')
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void load()
  }, [authLoading, profile, load])

  async function startRun() {
    if (!tenantId) return
    setStarting(true)
    try {
      const headers = await authHeaders(tenantId)
      const parsedLimit = Number.parseInt(limit, 10)
      // Accept comma- OR whitespace/newline-separated ids so a pasted list
      // (e.g. the audit's worst-offenders) works however it's formatted.
      const ids = equipmentIds.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
      const res = await fetch('/api/admin/loto/audit', {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          department:    department.trim() || undefined,
          limit:         Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
          equipment_ids: ids.length > 0 ? ids : undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      toast.success('Audit started — the agents are working through your equipment.')
      setDepartment('')
      setLimit('')
      setEquipmentIds('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the audit.')
    } finally {
      setStarting(false)
    }
  }

  if (authLoading) {
    return <main className="mx-auto max-w-5xl px-4 py-12"><Loader2 className="size-4 animate-spin" /></main>
  }
  if (!profile?.is_admin) {
    return <main className="mx-auto max-w-5xl px-4 py-12 text-sm text-slate-500">Admins only.</main>
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/admin" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy dark:hover:text-brand-yellow">
        <ArrowLeft className="h-3.5 w-3.5" />
        Admin
      </Link>

      <header className="mt-3 mb-6 flex items-start gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow">
          <Sparkles className="size-5" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">LOTO</p>
          <h1 className="text-2xl font-black text-slate-950 dark:text-slate-50">Multi-agent audit</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Three specialist agents review your LOTO equipment — photos, energy-step consistency, and Cal/OSHA compliance — and stage fixes for your approval. Nothing is written to live placards until you apply the approved changes.
          </p>
        </div>
      </header>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Start an audit</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Leave all fields blank to sweep every active piece of equipment, or scope it to a department, a batch limit, or a specific list of equipment IDs.
        </p>
        <label className="mt-4 block">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Equipment IDs <span className="font-normal text-slate-400">(optional — comma or space separated; takes precedence over department)</span></span>
          <textarea
            value={equipmentIds}
            onChange={e => setEquipmentIds(e.target.value)}
            rows={2}
            placeholder="e.g. BGGN-036, SKT1-280, 302-MX-1"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Department <span className="font-normal text-slate-400">(optional)</span></span>
            <input
              type="text"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              placeholder="e.g. Packaging"
              className="mt-1 w-56 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Limit <span className="font-normal text-slate-400">(optional)</span></span>
            <input
              type="number"
              min={1}
              value={limit}
              onChange={e => setLimit(e.target.value)}
              placeholder="e.g. 25"
              className="mt-1 w-32 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void startRun()}
            disabled={starting}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-brand-navy/90 dark:bg-brand-yellow dark:text-slate-950 dark:hover:bg-brand-yellow/90"
          >
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Start audit
          </button>
        </div>
      </section>

      {loadError && (
        <p className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{loadError}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {runs === null ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="p-10 text-center">
            <Sparkles className="mx-auto size-8 text-slate-300 dark:text-slate-600" />
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-300">No audits yet</p>
            <p className="mt-1 text-xs text-slate-500">Start one above to have the agents review your LOTO equipment.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Scope</th>
                <th className="px-4 py-2 text-left">Progress</th>
                <th className="px-4 py-2 text-left">Started</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[run.status]}`}>
                      {STATUS_LABEL[run.status]}
                    </span>
                    {run.error && (
                      <p className="mt-1 max-w-xs truncate text-[11px] text-rose-600" title={run.error}>{run.error}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700 dark:text-slate-300">{scopeLabel(run.scope)}</td>
                  <td className="px-4 py-3 align-top tabular-nums text-slate-700 dark:text-slate-300">
                    {run.processed_equipment}/{run.total_equipment || '—'}
                    {run.status === 'running' && <Loader2 className="ml-2 inline size-3 animate-spin text-sky-600" />}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="text-slate-700 dark:text-slate-300">{formatRelative(run.started_at)}</p>
                    <p className="text-[11px] text-slate-500">{new Date(run.started_at).toLocaleString()}</p>
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <Link
                      href={`/admin/loto/audit/${run.id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Open
                      <ChevronRight className="size-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}

function scopeLabel(scope: LotoAuditRun['scope']): string {
  if (scope.equipment_ids?.length) return `${scope.equipment_ids.length} equipment`
  const parts: string[] = []
  parts.push(scope.department ? scope.department : 'All departments')
  if (scope.only_active === false) parts.push('incl. inactive')
  if (scope.limit) parts.push(`limit ${scope.limit}`)
  return parts.join(' · ')
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return '—'
  const diffMs = Date.now() - then
  const mins = Math.round(diffMs / 60_000)
  if (mins < 60)  return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
