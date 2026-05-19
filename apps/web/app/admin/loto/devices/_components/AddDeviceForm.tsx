'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { LotoDeviceKind } from '@soteria/core/types'

const KIND_LABELS: Record<LotoDeviceKind, string> = {
  padlock:   'Padlock',
  cable:     'Cable lock',
  hasp:      'Hasp',
  group_box: 'Group lockout box',
  other:     'Other',
}

// Inline form for adding a single device to inventory. Bigger bulk-import
// flow can come later via CSV — keeping this scope to "the admin gets a
// new lock and types its label in".

export function AddDeviceForm({ onAdded }: { onAdded: () => void }) {
  const [label, setLabel]             = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind]               = useState<LotoDeviceKind>('padlock')
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) { setError('Label is required.'); return }
    setBusy(true); setError(null)
    const { error: err } = await supabase
      .from('loto_devices')
      .insert({
        device_label: label.trim(),
        description:  description.trim() || null,
        kind,
        status:       'available',
      })
    setBusy(false)
    if (err) {
      // Unique-violation for duplicate labels gets a friendlier error.
      if (err.message.includes('duplicate key') || err.message.includes('unique')) {
        setError(`A device with label "${label.trim()}" already exists.`)
      } else {
        setError(formatSupabaseError(err, 'add device'))
      }
      return
    }
    setLabel(''); setDescription(''); setKind('padlock')
    onAdded()
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Add a device</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block space-y-1.5 sm:col-span-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Label <span className="text-rose-500">*</span>
          </span>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="MNT-014"
            disabled={busy}
            maxLength={64}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
          />
        </label>
        <label className="block space-y-1.5 sm:col-span-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Kind</span>
          <select
            value={kind}
            onChange={e => setKind(e.target.value as LotoDeviceKind)}
            disabled={busy}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
          >
            {Object.entries(KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5 sm:col-span-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</span>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional"
            disabled={busy}
            maxLength={200}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
          />
        </label>
      </div>
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || !label.trim()}
          className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" />
          {busy ? 'Adding…' : 'Add device'}
        </button>
      </div>
    </form>
  )
}
