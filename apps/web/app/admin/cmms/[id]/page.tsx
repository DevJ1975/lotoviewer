'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Cable, Eye, EyeOff, Loader2, RefreshCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'

// /admin/cmms/[id] — integration detail.
// Shows the integration metadata + the last 100 sync events. Failed
// events can be flipped back to pending so the cron picks them up on
// the next pass.

type CmmsSystem = 'maximo' | 'sap_pm' | 'emaint' | 'generic'

interface IntegrationDetail {
  id:             string
  tenant_id:      string
  name:           string
  system:         CmmsSystem
  base_url:       string | null
  webhook_secret: string
  enabled:        boolean
  last_sync_at:   string | null
  created_at:     string
}

interface SyncEvent {
  id:             string
  direction:      'inbound' | 'outbound'
  event_type:     string
  status:         'pending' | 'delivered' | 'failed'
  attempts:       number
  error_message:  string | null
  created_at:     string
  processed_at:   string | null
}

const STATUS_PILL: Record<SyncEvent['status'], string> = {
  pending:   'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  failed:    'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
}

export default function CmmsIntegrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [row, setRow]         = useState<IntegrationDetail | null>(null)
  const [events, setEvents]   = useState<SyncEvent[]>([])
  const [error, setError]     = useState<string | null>(null)
  const [retrying, setRetry]  = useState(false)
  const [secretVisible, setSecretVisible] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const [intRes, evRes] = await Promise.all([
      supabase
        .from('cmms_integrations')
        .select('id, tenant_id, name, system, base_url, webhook_secret, enabled, last_sync_at, created_at')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('cmms_sync_events')
        .select('id, direction, event_type, status, attempts, error_message, created_at, processed_at')
        .eq('tenant_id', tenantId)
        .eq('integration_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    if (intRes.error) { setError(formatSupabaseError(intRes.error, 'load integration')); return }
    if (evRes.error)  { setError(formatSupabaseError(evRes.error,  'load events'));      return }
    setRow((intRes.data as IntegrationDetail | null) ?? null)
    setEvents((evRes.data ?? []) as SyncEvent[])
  }, [tenantId, id])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  async function retryFailed() {
    if (!tenantId || !row) return
    setRetry(true)
    setError(null)
    const { error: err } = await supabase
      .from('cmms_sync_events')
      .update({ status: 'pending', error_message: null })
      .eq('tenant_id', tenantId)
      .eq('integration_id', row.id)
      .eq('status', 'failed')
    setRetry(false)
    if (err) { setError(formatSupabaseError(err, 'retry failed events')); return }
    await load()
  }

  async function toggleEnabled() {
    if (!tenantId || !row) return
    const { error: err } = await supabase
      .from('cmms_integrations')
      .update({ enabled: !row.enabled })
      .eq('id', row.id)
    if (err) { setError(formatSupabaseError(err, 'toggle integration')); return }
    await load()
  }

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }
  if (!row && !error) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!row) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Link href="/admin/cmms" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <ArrowLeft className="h-3 w-3" /> Back to CMMS list
        </Link>
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {error ?? 'Integration not found.'}
        </div>
      </div>
    )
  }

  const failedCount = events.filter(e => e.status === 'failed').length
  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/cmms/${row.id}/webhook`
    : `/api/cmms/${row.id}/webhook`

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/cmms" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to CMMS list
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Cable className="h-6 w-6 text-brand-navy" />
          {row.name}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {row.system.toUpperCase()} · {row.enabled ? 'enabled' : 'disabled'} ·
          {row.last_sync_at ? ` last sync ${new Date(row.last_sync_at).toLocaleString()}` : ' no syncs yet'}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Webhook setup</h2>
          <button
            type="button"
            onClick={toggleEnabled}
            className="text-xs font-semibold text-brand-navy hover:underline"
          >
            {row.enabled ? 'Disable integration' : 'Enable integration'}
          </button>
        </header>
        <div className="space-y-2">
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Inbound URL</span>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 px-3 py-2 font-mono text-xs break-all">{webhookUrl}</div>
          </div>
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
              HMAC secret
              <button type="button" onClick={() => setSecretVisible(s => !s)} className="text-slate-400 hover:text-brand-navy">
                {secretVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </span>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 px-3 py-2 font-mono text-xs break-all">
              {secretVisible ? row.webhook_secret : '•'.repeat(Math.max(8, row.webhook_secret.length))}
            </div>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Sign each request with HMAC-SHA256(body, secret) and send the lowercase hex as{' '}
            <span className="font-mono">X-Soteria-Signature: sha256=&lt;hex&gt;</span>.
          </p>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <header className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Recent events</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{events.length} shown · {failedCount} failed</p>
          </div>
          <button
            type="button"
            onClick={retryFailed}
            disabled={retrying || failedCount === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {retrying ? 'Queuing…' : `Retry failed (${failedCount})`}
          </button>
        </header>
        {events.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No events yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {events.map(e => (
              <li key={e.id} className="px-5 py-2.5 flex items-start gap-3">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${STATUS_PILL[e.status]}`}>{e.status}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-slate-900 dark:text-slate-100">{e.event_type} · {e.direction}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {new Date(e.created_at).toLocaleString()} · {e.attempts} attempt(s)
                  </p>
                  {e.error_message && (
                    <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-0.5">{e.error_message}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
