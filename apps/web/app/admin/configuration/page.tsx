'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Settings } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { formatWorkOrderUrl } from '@/lib/orgConfig'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { OrgConfig } from '@/lib/types'

// Org-level configuration. Two sections:
//   - Work-order URL template (migration 014) — turns a free-text ref
//     on a permit into a clickable link.
//   - Push auto-dispatch (migration 018) — URL + secret matching the
//     INTERNAL_PUSH_SECRET env var on the API. Both must be set for
//     the Postgres trigger to actually fire pushes; either null and
//     the trigger silently no-ops.

export default function ConfigurationPage() {
  const { profile, loading: authLoading } = useAuth()
  const [config, setConfig] = useState<OrgConfig | null>(null)
  const [template, setTemplate] = useState('')
  const [pushUrl, setPushUrl]       = useState('')
  const [pushSecret, setPushSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [loadError, setLoadError]   = useState<string | null>(null)
  const [saveError, setSaveError]   = useState<string | null>(null)
  const [savedAt, setSavedAt]       = useState<number | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!profile?.is_admin) return
    let cancelled = false
    supabase
      .from('loto_org_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setLoadError(error.message)
        if (data) {
          const cfg = data as OrgConfig
          setConfig(cfg)
          setTemplate(cfg.work_order_url_template ?? '')
          setPushUrl(cfg.push_dispatch_url ?? '')
          setPushSecret(cfg.push_dispatch_secret ?? '')
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [authLoading, profile])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  const dirty =
    template.trim()    !== (config?.work_order_url_template ?? '')
    || pushUrl.trim()  !== (config?.push_dispatch_url       ?? '')
    || pushSecret      !== (config?.push_dispatch_secret    ?? '')

  async function save() {
    setSaving(true)
    setSaveError(null)
    const { data, error } = await supabase
      .from('loto_org_config')
      .update({
        work_order_url_template: template.trim()     || null,
        push_dispatch_url:       pushUrl.trim()      || null,
        push_dispatch_secret:    pushSecret.trim()   || null,
        updated_at:              new Date().toISOString(),
        updated_by:              profile?.id ?? null,
      })
      .eq('id', 1)
      .select('*')
      .single()
    setSaving(false)
    if (error || !data) { setSaveError(formatSupabaseError(error, 'save')); return }
    setConfig(data as OrgConfig)
    setSavedAt(Date.now())
  }

  const woPreview = formatWorkOrderUrl(template.trim() || null, 'WO-2026-0001')

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Settings className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            Configuration
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Org-level settings shared across all users.
          </p>
        </div>
      </header>

      {loadError && (
        <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{loadError}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : (
        <>
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
            <header>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Work-order URL template</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Turns a free-text work-order ref on a permit into a clickable link. Use{' '}
                <span className="font-mono">{'{ref}'}</span> as the placeholder. Leave blank to render refs as plain text.
              </p>
            </header>
            <input
              type="url"
              value={template}
              onChange={e => setTemplate(e.target.value)}
              placeholder="https://maintainx.com/wo/{ref}"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
            <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 px-3 py-2 text-[11px]">
              <p className="font-bold text-slate-600 dark:text-slate-300 mb-1">Preview (sample ref WO-2026-0001):</p>
              {woPreview ? (
                <a href={woPreview} target="_blank" rel="noopener noreferrer" className="font-mono text-brand-navy break-all hover:underline">
                  {woPreview}
                </a>
              ) : (
                <p className="text-slate-400 dark:text-slate-500 italic">
                  {template.trim() === ''
                    ? 'No template — refs render as plain text.'
                    : !template.includes('{ref}')
                    ? 'Template missing {ref} placeholder — every link would point to the same URL.'
                    : '—'}
                </p>
              )}
            </div>
          </section>

          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
            <header>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Push auto-dispatch</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Both URL and secret must be set for atmospheric-fail and prohibited-cancel pushes
                to fire. The secret has to match the <span className="font-mono">INTERNAL_PUSH_SECRET</span>
                {' '}env var on the API. Either field blank → the Postgres trigger silently no-ops.
              </p>
            </header>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Dispatch URL
              </span>
              <input
                type="url"
                value={pushUrl}
                onChange={e => setPushUrl(e.target.value)}
                placeholder="https://soteria-app.vercel.app/api/push/dispatch"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                Internal secret
                <button
                  type="button"
                  onClick={() => setShowSecret(s => !s)}
                  className="text-[10px] font-semibold text-brand-navy hover:underline"
                >
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </span>
              <input
                type={showSecret ? 'text' : 'password'}
                value={pushSecret}
                onChange={e => setPushSecret(e.target.value)}
                placeholder="generate a random string and paste it here AND into INTERNAL_PUSH_SECRET"
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </label>
          </section>

          {saveError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{saveError}</p>
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
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
