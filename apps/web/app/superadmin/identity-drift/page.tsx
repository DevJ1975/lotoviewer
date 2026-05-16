'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

interface DriftFinding {
  id:              string
  tenant_id:       string
  finding_type:    'missing_in_members' | 'field_mismatch' | 'orphan_profile_id'
  surface:         'profiles' | 'loto_workers'
  surface_row_pk:  string
  member_id:       string | null
  details:         Record<string, unknown>
  detected_at:     string
  reconciled_at:   string | null
}

interface DriftResponse {
  findings: DriftFinding[]
  count:    number | null
  limit:    number
  offset:   number
}

export default function SuperadminIdentityDriftPage() {
  const [data, setData]     = useState<DriftResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reconciling, setReconciling] = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/members/drift?limit=100', {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setData(await res.json() as DriftResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load drift findings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const onReconcile = useCallback(async (tenantId: string) => {
    setReconciling(tenantId)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/members/drift', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ tenantId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconcile failed')
    } finally {
      setReconciling(null)
    }
  }, [load])

  const open = (data?.findings ?? []).filter(f => f.reconciled_at === null)
  const closed = (data?.findings ?? []).filter(f => f.reconciled_at !== null)

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 space-y-5">
      <header>
        <Link href="/superadmin" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Superadmin
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-950 dark:text-slate-50">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            Identity drift
          </h1>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          Profiles or LOTO workers that diverged from the canonical members roster.
          The daily 03:00 UTC audit (pg_cron) populates this list; clicking Reconcile
          replays the backfill for that tenant and re-runs the audit.
        </p>
      </header>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
          {error}
        </p>
      )}

      <Section title={`Open (${open.length})`} icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}>
        {open.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">No open drift findings — the roster is clean.</p>
        ) : (
          <DriftTable rows={open} reconcilingTenantId={reconciling} onReconcile={onReconcile} />
        )}
      </Section>

      <Section title={`Resolved (${closed.length})`} icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}>
        {closed.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">No resolved drift findings in this page.</p>
        ) : (
          <DriftTable rows={closed} reconcilingTenantId={null} onReconcile={null} />
        )}
      </Section>
    </main>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 text-sm font-bold text-slate-800 dark:border-slate-800 dark:text-slate-100">
        {icon}
        {title}
      </header>
      {children}
    </section>
  )
}

function DriftTable({
  rows, reconcilingTenantId, onReconcile,
}: {
  rows: DriftFinding[]
  reconcilingTenantId: string | null
  onReconcile: ((tenantId: string) => void) | null
}) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map(r => (
        <li key={r.id} className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[1fr_1fr_auto] lg:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{r.finding_type.replaceAll('_', ' ')}</p>
            <p className="mt-1 text-sm">
              Tenant <code className="text-xs">{r.tenant_id.slice(0, 8)}…</code>
              {' · '}Surface <code className="text-xs">{r.surface}</code>
              {' · '}Row <code className="text-xs">{r.surface_row_pk.slice(0, 8)}…</code>
            </p>
            {r.member_id && (
              <p className="mt-0.5 text-xs text-slate-500">
                Member <code>{r.member_id.slice(0, 8)}…</code>
              </p>
            )}
            <p className="mt-0.5 text-xs text-slate-500">
              Detected {new Date(r.detected_at).toLocaleString()}
              {r.reconciled_at && ` · Resolved ${new Date(r.reconciled_at).toLocaleString()}`}
            </p>
          </div>
          <div>
            <pre className="overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700 dark:bg-slate-950 dark:text-slate-300">
{JSON.stringify(r.details, null, 2)}
            </pre>
          </div>
          {onReconcile && (
            <div className="flex items-start">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onReconcile(r.tenant_id)}
                disabled={reconcilingTenantId === r.tenant_id}
              >
                {reconcilingTenantId === r.tenant_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Reconcile tenant
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
