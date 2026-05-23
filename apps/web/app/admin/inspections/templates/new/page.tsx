'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import type { InspectionItemType } from '@soteria/core/inspectionScoring'

const ITEM_TYPES: { value: InspectionItemType; label: string }[] = [
  { value: 'pass_fail_na', label: 'Pass / Fail / N/A' },
  { value: 'numeric',      label: 'Numeric' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'text',         label: 'Text' },
  { value: 'photo',        label: 'Photo' },
  { value: 'signature',    label: 'Signature' },
]

interface DraftItem {
  section: string; item_type: InspectionItemType; prompt: string
  weight: number; required: boolean; fail_creates_action: boolean
}

const blankItem = (): DraftItem => ({ section: 'General', item_type: 'pass_fail_na', prompt: '', weight: 1, required: false, fail_creates_action: false })

async function authedHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'content-type': 'application/json',
    'x-active-tenant': tenantId,
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

export default function NewInspectionTemplatePage() {
  const { tenantId } = useTenant()
  const router = useRouter()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('general')
  const [items, setItems] = useState<DraftItem[]>([blankItem()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateItem(i: number, patch: Partial<DraftItem>) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenantId) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/inspections/templates', {
        method: 'POST',
        headers: await authedHeaders(tenantId),
        body: JSON.stringify({ name, category, items: items.filter(it => it.prompt.trim()) }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ? `Could not save: ${j.error}` : `Could not save (${res.status})`)
      }
      router.push('/admin/inspections/templates')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save template')
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">New inspection template</h1>
      {error && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">{error}</p>}

      <form onSubmit={submit} className="mt-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Name</span>
            <input required value={name} onChange={e => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Category</span>
            <input value={category} onChange={e => setCategory(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">Items</h2>
            <button type="button" onClick={() => setItems(prev => [...prev, blankItem()])}
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-navy dark:text-brand-yellow">
              <Plus className="h-4 w-4" /> Add item
            </button>
          </div>
          <ul className="mt-2 space-y-3">
            {items.map((it, i) => (
              <li key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-start gap-2">
                  <input value={it.prompt} onChange={e => updateItem(i, { prompt: e.target.value })} placeholder="Question / prompt"
                    className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
                  <button type="button" onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove item" className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-400 hover:text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <select value={it.item_type} onChange={e => updateItem(i, { item_type: e.target.value as InspectionItemType })}
                    className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1">
                    {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <input value={it.section} onChange={e => updateItem(i, { section: e.target.value })} placeholder="Section"
                    className="w-28 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1" />
                  <label className="flex items-center gap-1">weight
                    <input type="number" min={0} step={0.5} value={it.weight} onChange={e => updateItem(i, { weight: Number(e.target.value) })}
                      className="w-16 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1" />
                  </label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={it.required} onChange={e => updateItem(i, { required: e.target.checked })} /> required</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={it.fail_creates_action} onChange={e => updateItem(i, { fail_creates_action: e.target.checked })} /> fail → action</label>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <button type="submit" disabled={saving}
          className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save template'}
        </button>
      </form>
    </div>
  )
}
