'use client'

import { useState } from 'react'
import { Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { StrikeAdminData } from './useStrikeAdminData'

interface TriggersTabProps {
  tenantId: string
  userId: string | null
  data: StrikeAdminData
  onChanged: () => void
}

// What each work trigger requires. A row here with "required before work"
// is what the permit training gate enforces in the database.
const SOURCES = [
  { value: 'confined_space', label: 'Confined-space entry permit' },
  { value: 'hot_work', label: 'Hot-work permit' },
  { value: 'working_at_heights', label: 'Working-at-heights permit' },
  { value: 'loto', label: 'LOTO group permit' },
  { value: 'pre_job', label: 'Pre-job briefing (non-routine work)' },
] as const

const RECENCY = [
  { value: 'valid', label: 'Any current pass', days: null },
  { value: 'per_job', label: 'Fresh for each job (within 24 hours)', days: 1 },
  { value: 'quarter', label: 'Within the last 90 days', days: 90 },
  { value: 'year', label: 'Within the last year', days: 365 },
] as const

const input = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900'

export function TriggersTab({ tenantId, userId, data, onChanged }: TriggersTabProps) {
  const [source, setSource] = useState<string>(SOURCES[0].value)
  const [moduleId, setModuleId] = useState('')
  const [recency, setRecency] = useState<string>('valid')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titles = new Map(data.modules.map(m => [m.id, m.title]))
  const sourceLabel = new Map<string, string>(SOURCES.map(s => [s.value, s.label]))

  async function add() {
    if (!moduleId) return
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('strike_training_requirements').insert({
      tenant_id: tenantId,
      module_id: moduleId,
      source_type: source,
      required_before_start: true,
      expires_after_days: RECENCY.find(r => r.value === recency)?.days ?? null,
      created_by: userId,
    })
    setBusy(false)
    if (insertError) { setError(insertError.message); return }
    setModuleId('')
    onChanged()
  }

  async function setActive(id: string, active: boolean) {
    const { error: updateError } = await supabase.from('strike_training_requirements').update({ active }).eq('id', id)
    if (updateError) setError(updateError.message)
    else onChanged()
  }

  const gating = data.requirements.filter(r => r.required_before_start && SOURCES.some(s => s.value === r.source_type))

  return (
    <div className="space-y-4">
      <div className="placard-surface space-y-3 p-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Choose what training a job requires. Permits of that type <strong>cannot be issued</strong> until every worker on them
          has passed. Workers can complete it on the spot with Train now.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={source} onChange={e => setSource(e.target.value)} aria-label="When" className={input}>
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={moduleId} onChange={e => setModuleId(e.target.value)} aria-label="Module" className={input}>
            <option value="">Requires module…</option>
            {data.modules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <select value={recency} onChange={e => setRecency(e.target.value)} aria-label="How recent" className={input}>
            {RECENCY.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={add} disabled={busy || !moduleId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />} Require before work
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      </div>

      {gating.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No permit requires training yet, so permits issue as before.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {gating.map(r => (
            <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${r.active ? '' : 'opacity-50'}`}>
              <span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{sourceLabel.get(r.source_type) ?? r.source_type}</span>
                <span className="text-slate-500"> requires </span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{titles.get(r.module_id) ?? 'an unpublished module'}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {r.expires_after_days == null ? 'any current pass' : r.expires_after_days === 1 ? 'fresh for each job' : `within ${r.expires_after_days} days`}
                </span>
                {!titles.has(r.module_id) && <span className="ml-2 text-xs font-semibold text-amber-700">Not published — nobody can satisfy this</span>}
              </span>
              <span className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={r.active} onChange={e => setActive(r.id, e.target.checked)} className="h-4 w-4 accent-brand-navy" />
                  Enforced
                </label>
                {!r.active && (
                  <button type="button" aria-label="Delete requirement" className="rounded p-1 text-rose-500"
                    onClick={async () => {
                      const { error: deleteError } = await supabase.from('strike_training_requirements').delete().eq('id', r.id)
                      if (deleteError) setError(deleteError.message)
                      else onChanged()
                    }}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
