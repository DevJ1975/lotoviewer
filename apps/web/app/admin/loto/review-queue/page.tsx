'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, Loader2, ExternalLink, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'

// /admin/loto/review-queue — equipment flagged for closer admin
// inspection via the public supervisor link (or by an admin manually).
//
// One row per flagged equipment. "Clear" zeros the flag columns; "Open"
// jumps to the equipment detail page where the admin fixes the
// underlying issue. The queue is RLS-scoped to the active tenant; the
// API gates writes to admin/owner roles.

interface FlaggedRow {
  equipment_id:            string
  description:             string | null
  department:              string | null
  decommissioned:          boolean
  flagged_for_review_at:   string
  flagged_for_review_by:   string | null
  flagged_for_review_via:  'public-link' | 'admin' | null
  flagged_for_review_note: string | null
}

const VIA_LABEL: Record<string, string> = {
  'public-link': 'Public link',
  'admin':       'Admin',
}

const VIA_BADGE: Record<string, string> = {
  'public-link': 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  'admin':       'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
}

export default function ReviewQueuePage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [rows, setRows]           = useState<FlaggedRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clearingId, setClearingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const { data, error } = await supabase
        .from('loto_equipment')
        .select('equipment_id, description, department, decommissioned, flagged_for_review_at, flagged_for_review_by, flagged_for_review_via, flagged_for_review_note')
        .eq('tenant_id', tenantId)
        .not('flagged_for_review_at', 'is', null)
        .order('flagged_for_review_at', { ascending: false })
      if (error) throw new Error(formatSupabaseError(error, 'load review queue'))
      setRows((data ?? []) as FlaggedRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the review queue.')
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) load()
  }, [authLoading, profile, load])

  async function clearFlag(equipmentId: string) {
    if (!tenantId) return
    setClearingId(equipmentId)
    setActionError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Sign-in expired — refresh the page and try again.')
      const res = await fetch('/api/admin/loto/review-queue', {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'Authorization':   `Bearer ${token}`,
          'x-active-tenant': tenantId,
        },
        body: JSON.stringify({ equipment_id: equipmentId, action: 'clear' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setRows(prev => (prev ?? []).filter(r => r.equipment_id !== equipmentId))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Clear failed.')
    } finally {
      setClearingId(null)
    }
  }

  const totals = useMemo(() => {
    if (!rows) return { total: 0, fromPublic: 0, fromAdmin: 0 }
    return {
      total:      rows.length,
      fromPublic: rows.filter(r => r.flagged_for_review_via === 'public-link').length,
      fromAdmin:  rows.filter(r => r.flagged_for_review_via === 'admin').length,
    }
  }, [rows])

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
          <ClipboardCheck className="size-5" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">LOTO</p>
          <h1 className="text-2xl font-black text-slate-950 dark:text-slate-50">Equipment review queue</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Equipment a supervisor flagged for closer admin review during a public-link floor walk, plus anything admins flagged themselves. Clearing a row removes it from the queue.
          </p>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-3 gap-3 sm:max-w-md">
        <Counter label="Total"        value={totals.total} />
        <Counter label="From public"  value={totals.fromPublic} />
        <Counter label="From admin"   value={totals.fromAdmin} />
      </div>

      {loadError && (
        <p className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{loadError}</p>
      )}
      {actionError && (
        <p className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{actionError}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {rows === null ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <ClipboardCheck className="mx-auto size-8 text-slate-300 dark:text-slate-600" />
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-300">No equipment in the queue</p>
            <p className="mt-1 text-xs text-slate-500">When a supervisor flags a placard via the public review link, it lands here for you to act on.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">Equipment</th>
                <th className="px-4 py-2 text-left">Department</th>
                <th className="px-4 py-2 text-left">Flagged</th>
                <th className="px-4 py-2 text-left">By</th>
                <th className="px-4 py-2 text-left">Note</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.equipment_id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/equipment/${encodeURIComponent(r.equipment_id)}`}
                      className="inline-flex items-center gap-1 font-mono text-xs font-bold text-brand-navy hover:underline dark:text-brand-yellow"
                    >
                      {r.equipment_id}
                      <ExternalLink className="size-3" />
                    </Link>
                    {r.description && (
                      <p className="mt-0.5 max-w-md truncate text-xs text-slate-500" title={r.description}>{r.description}</p>
                    )}
                    {r.decommissioned && (
                      <span className="mt-1 inline-block rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        decommissioned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700 dark:text-slate-300">
                    {r.department ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="text-slate-700 dark:text-slate-300">{formatRelative(r.flagged_for_review_at)}</p>
                    <p className="text-[11px] text-slate-500">{new Date(r.flagged_for_review_at).toLocaleString()}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="text-slate-700 dark:text-slate-300">{r.flagged_for_review_by ?? <span className="text-slate-400">—</span>}</p>
                    {r.flagged_for_review_via && (
                      <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${VIA_BADGE[r.flagged_for_review_via] ?? ''}`}>
                        {VIA_LABEL[r.flagged_for_review_via] ?? r.flagged_for_review_via}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {r.flagged_for_review_note
                      ? <p className="max-w-md whitespace-pre-wrap text-slate-700 dark:text-slate-300">{r.flagged_for_review_note}</p>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <button
                      type="button"
                      onClick={() => clearFlag(r.equipment_id)}
                      disabled={clearingId === r.equipment_id}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {clearingId === r.equipment_id ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
                      Clear
                    </button>
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

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
    </div>
  )
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return '—'
  const diffMs = Date.now() - then
  const mins = Math.round(diffMs / 60_000)
  if (mins < 60)        return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48)       return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
