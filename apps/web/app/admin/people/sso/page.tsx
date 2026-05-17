'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'

// /admin/people/sso — per-tenant SAML / OIDC configuration.
//
// Persists the tenant-side IdP metadata in tenant_sso_configurations.
// Actual Supabase SAML enablement requires a separate superadmin call
// (it's a managed Supabase Auth feature) — the page makes that next
// step explicit so the admin doesn't think saving here is sufficient.

type Provider = 'saml' | 'oidc'

interface SsoConfig {
  tenant_id:        string
  provider:         Provider
  idp_metadata_url: string | null
  idp_metadata_xml: string | null
  sp_entity_id:     string
  sp_acs_url:       string
  enabled:          boolean
  updated_at:       string
}

function defaultSpValues(tenantId: string | null): { entity: string; acs: string } {
  // The SP values are derived from the public app URL + tenant id so
  // the IdP can be configured before our backend even sees the row.
  // The exact strings here are advisory — Supabase's SAML IdP uses
  // its own ACS, surfaced to the superadmin once they enable SAML.
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  const id = tenantId ?? ''
  return {
    entity: `${base}/sso/${id}`,
    acs:    `${base}/api/auth/saml/callback`,
  }
}

export default function SsoPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [config, setConfig]      = useState<SsoConfig | null>(null)
  const [provider, setProvider]  = useState<Provider>('saml')
  const [metadataUrl, setUrl]    = useState('')
  const [metadataXml, setXml]    = useState('')
  const [spEntityId, setEntity]  = useState('')
  const [spAcsUrl,   setAcs]     = useState('')
  const [enabled,    setEnabled] = useState(false)
  const [loadError,  setLoadError] = useState<string | null>(null)
  const [saveError,  setSaveError] = useState<string | null>(null)
  const [saving,     setSaving]    = useState(false)
  const [savedAt,    setSavedAt]   = useState<number | null>(null)
  const [loaded,     setLoaded]    = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    const { data, error } = await supabase
      .from('tenant_sso_configurations')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (error) {
      setLoadError(formatSupabaseError(error, 'load SSO configuration'))
      setLoaded(true)
      return
    }
    const row = (data as SsoConfig | null) ?? null
    const fallback = defaultSpValues(tenantId)
    setConfig(row)
    setProvider(row?.provider ?? 'saml')
    setUrl(row?.idp_metadata_url ?? '')
    setXml(row?.idp_metadata_xml ?? '')
    setEntity(row?.sp_entity_id ?? fallback.entity)
    setAcs(row?.sp_acs_url      ?? fallback.acs)
    setEnabled(row?.enabled ?? false)
    setLoaded(true)
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  const dirty = useMemo(() => {
    if (!config) {
      // Treat unsaved-yet rows as dirty so the Save button is live.
      return metadataUrl !== '' || metadataXml !== '' || spEntityId !== '' || spAcsUrl !== '' || enabled
    }
    return (
      provider          !== config.provider
      || metadataUrl    !== (config.idp_metadata_url ?? '')
      || metadataXml    !== (config.idp_metadata_xml ?? '')
      || spEntityId     !== config.sp_entity_id
      || spAcsUrl       !== config.sp_acs_url
      || enabled        !== config.enabled
    )
  }, [config, provider, metadataUrl, metadataXml, spEntityId, spAcsUrl, enabled])

  async function save() {
    if (!tenantId) return
    setSaveError(null)
    if (!spEntityId.trim()) { setSaveError('SP Entity ID is required.'); return }
    if (!/^https?:\/\//.test(spAcsUrl.trim())) {
      setSaveError('SP ACS URL must be a full http(s) URL.')
      return
    }
    if (enabled && !metadataUrl.trim() && !metadataXml.trim()) {
      setSaveError('Provide either an IdP metadata URL or pasted XML before enabling.')
      return
    }
    setSaving(true)
    const payload = {
      tenant_id:        tenantId,
      provider,
      idp_metadata_url: metadataUrl.trim() || null,
      idp_metadata_xml: metadataXml.trim() || null,
      sp_entity_id:     spEntityId.trim(),
      sp_acs_url:       spAcsUrl.trim(),
      enabled,
    }
    const { data, error } = await supabase
      .from('tenant_sso_configurations')
      .upsert(payload, { onConflict: 'tenant_id' })
      .select('*')
      .single()
    setSaving(false)
    if (error || !data) {
      setSaveError(formatSupabaseError(error, 'save SSO configuration'))
      return
    }
    setConfig(data as SsoConfig)
    setSavedAt(Date.now())
  }

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-brand-navy" />
          Single sign-on (SSO)
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Federate login with your IdP via SAML 2.0 or OIDC. This page persists the tenant-side
          configuration; the final activation step is a managed Supabase change handled by a
          platform superadmin.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{loadError}</div>
      )}

      {!loaded ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : (
        <>
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
            <header>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Protocol</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                SAML covers Okta, Azure AD, Ping, ADFS. OIDC covers Google Workspace, Auth0, Entra.
              </p>
            </header>
            <div className="flex gap-3">
              {(['saml', 'oidc'] as Provider[]).map(p => (
                <label key={p} className={`flex-1 cursor-pointer rounded-lg border px-4 py-3 ${
                  provider === p
                    ? 'border-brand-navy bg-brand-navy/5'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40'
                }`}>
                  <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => setProvider(p)} className="sr-only" />
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase">{p}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
            <header>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">IdP metadata</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Provide either the IdP metadata URL or paste the raw XML. URL takes precedence if both are set.
              </p>
            </header>
            <Field label="Metadata URL">
              <input
                type="url"
                value={metadataUrl}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://login.acme.example/saml/metadata"
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              />
            </Field>
            <Field label="Metadata XML (paste)">
              <textarea
                value={metadataXml}
                onChange={e => setXml(e.target.value)}
                rows={5}
                placeholder="<EntityDescriptor xmlns=...> ... </EntityDescriptor>"
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              />
            </Field>
          </section>

          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
            <header>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Service-provider values</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Copy these into your IdP configuration. We pre-fill sensible defaults from your tenant ID.
              </p>
            </header>
            <Field label="SP Entity ID">
              <input
                type="text"
                value={spEntityId}
                onChange={e => setEntity(e.target.value)}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              />
            </Field>
            <Field label="SP ACS URL (callback)">
              <input
                type="url"
                value={spAcsUrl}
                onChange={e => setAcs(e.target.value)}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              />
            </Field>
          </section>

          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy"
              />
              <span className="text-sm text-slate-900 dark:text-slate-100">
                <span className="font-semibold">Mark SSO ready for activation</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Saving with this enabled tells the superadmin team this tenant is ready
                  for the final Supabase-side enablement step.
                </span>
              </span>
            </label>
          </section>

          {enabled && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 flex items-start gap-2">
              <KeyRound className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Next step: superadmin activation</p>
                <p className="mt-0.5">
                  Saving this configuration does not yet route logins through your IdP.
                  Contact the Soteria support team to finalize the Supabase-side enablement —
                  they will review this config and run the managed-auth API call.
                </p>
              </div>
            </div>
          )}

          {saveError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{saveError}</div>
          )}

          <div className="flex items-center justify-end gap-3">
            {savedAt && Date.now() - savedAt < 5000 && (
              <span className="text-[11px] text-emerald-700 dark:text-emerald-300">Saved.</span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
            >
              {saving ? 'Saving…' : 'Save configuration'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}
