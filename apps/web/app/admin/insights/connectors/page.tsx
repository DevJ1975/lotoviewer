'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Cable, AlertCircle, CheckCircle2, KeyRound, Plug } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'

// /admin/insights/connectors
//
// Status + sync surface for external historical-data connectors that feed the
// year-over-year scorecard (osha_annual_summaries). The Intelex connector is
// scaffolded but BLOCKED on the client's credentials + field mapping, so it
// reports "Awaiting credentials" and a sync attempt returns the exact next
// step. The plumbing (validation + upsert) is live, so the adapter drops in
// later with no UI change.

type ConnectorStatus = 'awaiting_credentials' | 'awaiting_mapping' | 'ready'

interface ConnectorRow {
  id:           string
  label:        string
  configured:   boolean
  status:       ConnectorStatus
  requirements: string[]
}

const STATUS_META: Record<ConnectorStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  awaiting_credentials: { label: 'Awaiting credentials', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300', icon: KeyRound },
  awaiting_mapping:     { label: 'Awaiting field mapping', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',   icon: Plug },
  ready:                { label: 'Ready', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',        icon: CheckCircle2 },
}

export default function DataConnectorsPage() {
  const { tenant, loading: tenantLoading } = useTenant()
  const { profile, loading: authLoading } = useAuth()
  const canView = !!profile?.is_admin || !!profile?.is_superadmin

  const [connectors, setConnectors] = useState<ConnectorRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [syncing, setSyncing]       = useState<string | null>(null)
  const [syncMsg, setSyncMsg]       = useState<{ id: string; ok: boolean; text: string } | null>(null)

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    return h
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/history-connectors', { headers: await headers() })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Failed to load (${res.status})`)
      setConnectors((j.connectors ?? []) as ConnectorRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [tenant, headers])

  useEffect(() => { if (canView) void load() }, [canView, load])

  async function onSync(id: string) {
    setSyncing(id); setSyncMsg(null)
    try {
      const res = await fetch(`/api/admin/history-connectors/${id}/sync`, {
        method: 'POST',
        headers: { ...(await headers()), 'content-type': 'application/json' },
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSyncMsg({ id, ok: false, text: j.error ?? `Sync failed (${res.status})` })
        return
      }
      setSyncMsg({ id, ok: true, text: `Imported ${j.imported ?? 0} year(s).` })
      void load()
    } finally {
      setSyncing(null)
    }
  }

  if (authLoading || tenantLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!canView) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500">Admins only.</div>
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Cable className="h-5 w-5" /> Data connectors
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Pull historical EHS metrics from external systems into the year-over-year scorecard. Imported numbers go through
          the same validation as a manual OSHA 300A upload.
        </p>
      </header>

      {loading && <p className="text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin mr-1" /> Loading…</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="space-y-4">
        {connectors.map(c => {
          const meta = STATUS_META[c.status]
          const StatusIcon = meta.icon
          return (
            <section key={c.id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{c.label}</h2>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium uppercase rounded ${meta.cls}`}>
                  <StatusIcon className="h-3 w-3" /> {meta.label}
                </span>
              </div>

              {!c.configured && c.requirements.length > 0 && (
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  Set these in the deployment environment to configure:
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {c.requirements.map(r => (
                      <li key={r} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px]">{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {syncMsg?.id === c.id && (
                <div className={`flex items-start gap-2 text-xs ${syncMsg.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}`}>
                  {syncMsg.ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                  <span>{syncMsg.text}</span>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={() => void onSync(c.id)}
                  disabled={syncing === c.id}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                >
                  {syncing === c.id && <Loader2 className="h-4 w-4 animate-spin" />}
                  Sync now
                </button>
              </div>
            </section>
          )
        })}
        {!loading && !error && connectors.length === 0 && (
          <p className="text-sm text-slate-500">No connectors available.</p>
        )}
      </div>
    </div>
  )
}
