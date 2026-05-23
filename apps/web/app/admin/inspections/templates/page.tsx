'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardList, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'

interface Template {
  id: string; name: string; category: string; version: number; active: boolean; updated_at: string
}

async function authedHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'content-type': 'application/json',
    'x-active-tenant': tenantId,
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

export default function InspectionTemplatesPage() {
  const { tenantId } = useTenant()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/inspections/templates', { headers: await authedHeaders(tenantId) })
      if (!res.ok) throw new Error(`Failed to load (${res.status})`)
      setTemplates((await res.json()).templates ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates')
    } finally { setLoading(false) }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  async function disable(id: string) {
    if (!tenantId) return
    try {
      const res = await fetch(`/api/inspections/templates/${id}`, { method: 'DELETE', headers: await authedHeaders(tenantId) })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to disable template') }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Inspections</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ClipboardList className="h-5 w-5" /> Inspection templates
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Build reusable checklists; field users run them from Inspections.</p>
        </div>
        <Link href="/admin/inspections/templates/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:opacity-90">
          <Plus className="h-4 w-4" /> New template
        </Link>
      </header>

      {error && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">{error}</p>}

      {loading ? (
        <div className="mt-6 space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-14 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
      ) : templates.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">No templates yet. Create one to get started.</p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
          {templates.map(t => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{t.name}</span>
                <span className="ml-2 text-xs text-slate-500">{t.category} · v{t.version}{t.active ? '' : ' · disabled'}</span>
              </div>
              {t.active && (
                <button onClick={() => disable(t.id)} aria-label="Disable template"
                  className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-400 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
