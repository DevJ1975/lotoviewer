'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Settings } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { formatWorkOrderUrl } from '@/lib/orgConfig'
import type { OrgConfig } from '@/lib/types'

// Org-level configuration. Today: just the work-order URL template that
// turns a free-text ref on a permit into a clickable hyperlink.
// Future config keys land here without a route change.

export default function ConfigurationPage() {
  const { profile, loading: authLoading } = useAuth()
  const [config, setConfig]               = useState<OrgConfig | null>(null)
  const [template, setTemplate]           = useState('')
  const [loading, setLoading]             = useState(true)
  const [saving, setSaving]               = useState(false)
  const [loadError, setLoadError]         = useState<string | null>(null)
  const [saveError, setSaveError]         = useState<string | null>(null)
  const [savedAt, setSavedAt]             = useState<number | null>(null)

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
          setConfig(data as OrgConfig)
          setTemplate((data as OrgConfig).work_order_url_template ?? '')
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [authLoading, profile])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500">Admins only.</div>
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    const trimmed = template.trim()
    const { data, error } = await supabase
      .from('loto_org_config')
      .update({
        work_order_url_template: trimmed || null,
        updated_at:              new Date().toISOString(),
        updated_by:              profile?.id ?? null,
      })
      .eq('id', 1)
      .select('*')
      .single()
    setSaving(false)
    if (error || !data) { setSaveError(error?.message ?? 'Could not save.'); return }
    setConfig(data as OrgConfig)
    setSavedAt(Date.now())
  }

  // Live preview of the rendered URL with a sample ref. Helps the admin
  // confirm the {ref} placeholder is in the right spot before saving.
  const preview = formatWorkOrderUrl(template.trim() || null, 'WO-2026-0001')

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 hover:text-brand-navy" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Settings className="h-5 w-5 text-slate-500" />
            Configuration
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Org-level settings shared across all users.
          </p>
        </div>
      </header>

      {loadError && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">{loadError}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <header>
            <h2 className="text-sm font-bold text-slate-900">Work-order URL template</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Turns a free-text work-order ref on a permit into a clickable link. Use{' '}
              <span className="font-mono">{'{ref}'}</span> as the placeholder. Leave blank to render refs as plain text.
            </p>
          </header>
          <input
            type="url"
            value={template}
            onChange={e => setTemplate(e.target.value)}
            placeholder="https://maintainx.com/wo/{ref}"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
          <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-[11px]">
            <p className="font-bold text-slate-600 mb-1">Preview (sample ref WO-2026-0001):</p>
            {preview ? (
              <a href={preview} target="_blank" rel="noopener noreferrer" className="font-mono text-brand-navy break-all hover:underline">
                {preview}
              </a>
            ) : (
              <p className="text-slate-400 italic">
                {template.trim() === ''
                  ? 'No template — refs render as plain text.'
                  : !template.includes('{ref}')
                  ? 'Template missing {ref} placeholder — every link would point to the same URL.'
                  : '—'}
              </p>
            )}
          </div>

          {saveError && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">{saveError}</p>
          )}

          <div className="flex items-center justify-end gap-3">
            {savedAt && Date.now() - savedAt < 5000 && (
              <span className="text-[11px] text-emerald-700">Saved.</span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || (template.trim() === (config?.work_order_url_template ?? ''))}
              className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
