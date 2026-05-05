'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import { readRiskConfig, DEFAULT_ACCEPTANCE_THRESHOLD, type BandScheme } from '@soteria/core/risk'

// /admin/risk-settings — tenant-admin UI for the two risk-config
// keys that previously required a SQL update:
//   - risk_band_scheme       3-band | 4-band
//   - risk_acceptance_threshold  integer 1..25
//
// Both live inside `tenants.settings` jsonb, read by every risk
// surface via readRiskConfig() in @soteria/core/risk.

export default function RiskSettingsPage() {
  const { tenant, loading: tenantLoading, refresh } = useTenant()
  const { profile, loading: authLoading } = useAuth()
  const canEdit = !!profile?.is_admin || !!profile?.is_superadmin

  const [scheme,    setScheme]    = useState<BandScheme>('4-band')
  const [threshold, setThreshold] = useState<number>(DEFAULT_ACCEPTANCE_THRESHOLD)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [savedAt,   setSavedAt]   = useState<number | null>(null)

  // Hydrate from the tenant once it loads.
  useEffect(() => {
    if (!tenant) return
    const cfg = readRiskConfig(tenant.settings ?? null)
    setScheme(cfg.bandScheme)
    setThreshold(cfg.acceptanceThreshold)
  }, [tenant])

  if (authLoading || tenantLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!canEdit) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500">Admins only.</div>
  }

  const dirty = !tenant
    ? false
    : (() => {
        const cfg = readRiskConfig(tenant.settings ?? null)
        return cfg.bandScheme !== scheme || cfg.acceptanceThreshold !== threshold
      })()

  async function save() {
    if (!tenant?.id) return
    setSaving(true); setError(null); setSavedAt(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch('/api/admin/tenant-settings/risk', {
        method: 'PATCH', headers,
        body: JSON.stringify({
          risk_band_scheme:          scheme,
          risk_acceptance_threshold: threshold,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setSavedAt(Date.now())
      // Refresh the tenant context so other pages pick up the change
      // immediately. TenantProvider exposes `refresh()` for this.
      await refresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Control Center
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Risk Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Tenant-level configuration for the Risk Assessment module. Applies to every risk in this tenant.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Band scheme</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            How risks are color-coded. PDD §18 recommends 4-band; 3-band collapses high + extreme into a single tier.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(['4-band', '3-band'] as const).map(s => (
            <label
              key={s}
              className={
                'flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ' +
                (scheme === s
                  ? 'border-brand-navy bg-brand-navy/5 dark:bg-brand-navy/20'
                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400')
              }
            >
              <input type="radio" name="scheme" value={s} checked={scheme === s} onChange={() => setScheme(s)} className="mt-1" />
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{s}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {s === '4-band'
                    ? 'Low / Moderate / High / Extreme — ISO 45001 default.'
                    : 'Low / Moderate / High — extreme rolls into high.'}
                </p>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Acceptance threshold</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Residual score (severity × likelihood) at or below which a risk can be marked Closed without exception. PDD §4.6 recommends 6.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={25}
            value={threshold}
            onChange={e => setThreshold(parseInt(e.target.value, 10) || 1)}
            className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm tabular-nums"
          />
          <span className="text-xs text-slate-500 dark:text-slate-400">
            (1–25; default {DEFAULT_ACCEPTANCE_THRESHOLD})
          </span>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3 pt-2">
        {savedAt && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            Saved
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-5 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save settings
        </button>
      </div>
    </div>
  )
}
