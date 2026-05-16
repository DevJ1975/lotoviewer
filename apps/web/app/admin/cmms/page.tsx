'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Cable, Loader2, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'

// /admin/cmms — list + add CMMS integrations. Each row drills into
// /admin/cmms/[id] for detail (recent events, retry button).

type CmmsSystem = 'maximo' | 'sap_pm' | 'emaint' | 'generic'

interface CmmsIntegrationRow {
  id:           string
  name:         string
  system:       CmmsSystem
  base_url:     string | null
  enabled:      boolean
  last_sync_at: string | null
  created_at:   string
}

const SYSTEM_LABEL: Record<CmmsSystem, string> = {
  maximo:  'IBM Maximo',
  sap_pm:  'SAP PM',
  emaint:  'eMaint',
  generic: 'Generic',
}

function randomSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  // base64url so the value is safe to paste into IdP / CMMS config
  // boxes without escaping.
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export default function CmmsPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [rows, setRows]     = useState<CmmsIntegrationRow[] | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const { data, error: err } = await supabase
      .from('cmms_integrations')
      .select('id, name, system, base_url, enabled, last_sync_at, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    if (err) {
      setError(formatSupabaseError(err, 'load CMMS integrations'))
      return
    }
    setRows((data ?? []) as CmmsIntegrationRow[])
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
            <ArrowLeft className="h-3 w-3" /> Back
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Cable className="h-6 w-6 text-brand-navy" />
            CMMS integrations
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Wire your maintenance system (Maximo, SAP PM, eMaint, or any system with a webhook) to push
            work-order events into Soteria. Each integration carries its own HMAC secret.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add integration
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      {rows === null ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No CMMS integrations yet.</p>
        </div>
      ) : (
        <ul className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {rows.map(r => (
            <li key={r.id} className="px-4 py-3">
              <Link href={`/admin/cmms/${r.id}`} className="block hover:bg-slate-50 dark:hover:bg-slate-900/40 -mx-4 -my-3 px-4 py-3 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{r.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {SYSTEM_LABEL[r.system]} · {r.base_url ?? 'inbound only'}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {r.last_sync_at ? `Last sync ${new Date(r.last_sync_at).toLocaleString()}` : 'No syncs yet'}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    r.enabled
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    {r.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {addOpen && tenantId && (
        <AddIntegrationDialog
          tenantId={tenantId}
          onClose={() => setAddOpen(false)}
          onAdded={async () => { setAddOpen(false); await load() }}
        />
      )}
    </div>
  )
}

function AddIntegrationDialog({ tenantId, onClose, onAdded }: {
  tenantId: string
  onClose: () => void
  onAdded: () => void
}) {
  const [name, setName]       = useState('')
  const [system, setSystem]   = useState<CmmsSystem>('maximo')
  const [baseUrl, setBaseUrl] = useState('')
  const [secret, setSecret]   = useState(() => randomSecret())
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setErr(null)
    if (!name.trim()) { setErr('Name is required.'); return }
    if (secret.length < 16) { setErr('Webhook secret must be at least 16 characters.'); return }
    setSubmitting(true)
    const { error } = await supabase
      .from('cmms_integrations')
      .insert({
        tenant_id:      tenantId,
        name:           name.trim(),
        system,
        base_url:       baseUrl.trim() || null,
        webhook_secret: secret,
      })
    setSubmitting(false)
    if (error) { setErr(formatSupabaseError(error, 'add integration')); return }
    onAdded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Add CMMS integration</h2>
          <button type="button" onClick={onClose} disabled={submitting} className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-lg leading-none px-1">×</button>
        </header>
        <div className="space-y-3">
          <Field label="Name">
            <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={submitting} placeholder="Plant 1 Maximo" className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
          </Field>
          <Field label="System">
            <select value={system} onChange={e => setSystem(e.target.value as CmmsSystem)} disabled={submitting} className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20">
              <option value="maximo">{SYSTEM_LABEL.maximo}</option>
              <option value="sap_pm">{SYSTEM_LABEL.sap_pm}</option>
              <option value="emaint">{SYSTEM_LABEL.emaint}</option>
              <option value="generic">{SYSTEM_LABEL.generic}</option>
            </select>
          </Field>
          <Field label="Base URL" hint="Optional — leave blank for inbound-only">
            <input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} disabled={submitting} placeholder="https://maximo.example.com/api" className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
          </Field>
          <Field label="Webhook secret" hint="Paste this into your CMMS webhook config">
            <div className="flex gap-2">
              <input type="text" value={secret} onChange={e => setSecret(e.target.value)} disabled={submitting} className="flex-1 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
              <button type="button" onClick={() => setSecret(randomSecret())} disabled={submitting} className="px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/40">Regenerate</button>
            </div>
          </Field>
        </div>
        {err && <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300">Cancel</button>
          <button type="button" onClick={submit} disabled={submitting} className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40">
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        {label}
        {hint && <span className="text-slate-400 dark:text-slate-500 font-normal ml-1.5">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
