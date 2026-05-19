'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, ShieldAlert, FileWarning, ClipboardCheck, MapPin, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'

// /admin/chemicals/prop65 — Compliance dashboard.
//
// Reads the security-invoker rollup view prop65_compliance_status
// (migration 177). Surfaces per-site gap count, recent warnings, and
// the next annual-review due date. Drilldowns navigate into the
// per-site, exposure-assessment, and warning surfaces.

interface ComplianceRow {
  site_id:                   string
  site_name:                 string
  public_slug:               string
  confirmed_links_count:     number
  signed_assessments_count:  number
  active_warnings_count:     number
  gap_count:                 number
  latest_review_at:          string | null
  annual_review_due_at:      string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString() } catch { return iso }
}

function reviewStatus(due: string | null): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (!due) return { label: 'Never reviewed', tone: 'bad' }
  const dueMs = Date.parse(due)
  if (!Number.isFinite(dueMs)) return { label: 'Never reviewed', tone: 'bad' }
  const days = Math.round((dueMs - Date.now()) / 86_400_000)
  if (days < 0)  return { label: `Overdue ${-days}d`,  tone: 'bad' }
  if (days < 30) return { label: `Due in ${days}d`,    tone: 'warn' }
  return { label: `Next review ${formatDate(due)}`, tone: 'ok' }
}

export default function Prop65DashboardPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [rows, setRows]   = useState<ComplianceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const { data, error: err } = await supabase
      .from('prop65_compliance_status')
      .select('site_id, site_name, public_slug, confirmed_links_count, signed_assessments_count, active_warnings_count, gap_count, latest_review_at, annual_review_due_at')
      .eq('tenant_id', tenantId)
      .order('site_name', { ascending: true })
    if (err) { setError(formatSupabaseError(err, 'load Prop 65 status')); return }
    setRows((data ?? []) as ComplianceRow[])
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  const totalGaps = rows?.reduce((acc, r) => acc + r.gap_count, 0) ?? 0
  const review = rows && rows[0] ? reviewStatus(rows[0].annual_review_due_at) : { label: 'No sites yet', tone: 'warn' as const }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-brand-navy" />
          Proposition 65 / Title 8 §5194
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Per-site Prop 65 warning posture, exposure assessments, and the §25249.5 annual review.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <FileWarning className="h-3.5 w-3.5" /> Open gaps
          </div>
          <div className="text-3xl font-bold mt-1 text-slate-900 dark:text-slate-100 tabular-nums">{totalGaps}</div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Above safe-harbor assessments without an active warning.</p>
        </div>
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <ClipboardCheck className="h-3.5 w-3.5" /> Annual review
          </div>
          <div className={`text-base font-semibold mt-1 ${
            review.tone === 'bad' ? 'text-rose-700 dark:text-rose-300'
            : review.tone === 'warn' ? 'text-amber-700 dark:text-amber-300'
            : 'text-emerald-700 dark:text-emerald-300'
          }`}>{review.label}</div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            <Link href="/admin/chemicals/prop65/annual-review" className="hover:underline">Record review →</Link>
          </p>
        </div>
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <MapPin className="h-3.5 w-3.5" /> Sites
          </div>
          <div className="text-3xl font-bold mt-1 text-slate-900 dark:text-slate-100 tabular-nums">{rows?.length ?? 0}</div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            <Link href="/admin/chemicals/prop65/sites" className="hover:underline">Manage →</Link>
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Sites</h2>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/admin/chemicals/prop65/chemicals" className="text-brand-navy hover:underline">Chemicals</Link>
            <Link href="/admin/chemicals/prop65/sites" className="inline-flex items-center gap-1 text-brand-navy hover:underline">
              <Plus className="h-3 w-3" /> Add site
            </Link>
          </div>
        </div>
        {rows === null ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No California sites yet. <Link href="/admin/chemicals/prop65/sites" className="text-brand-navy hover:underline">Add one</Link> to begin.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Site</th>
                <th className="text-right px-4 py-2">Linked chems</th>
                <th className="text-right px-4 py-2">Signed assessments</th>
                <th className="text-right px-4 py-2">Active warnings</th>
                <th className="text-right px-4 py-2">Gaps</th>
                <th className="text-right px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(r => (
                <tr key={r.site_id}>
                  <td className="px-4 py-2">
                    <Link href={`/admin/chemicals/prop65/sites/${r.site_id}`} className="text-brand-navy hover:underline font-medium">{r.site_name}</Link>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">/prop65/{r.public_slug}</div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.confirmed_links_count}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.signed_assessments_count}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.active_warnings_count}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${r.gap_count > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {r.gap_count}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/chemicals/prop65/sites/${r.site_id}`} className="text-[11px] text-brand-navy hover:underline">Open →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
