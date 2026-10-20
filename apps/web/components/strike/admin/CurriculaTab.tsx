'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { curriculumSchedule } from '@soteria/core/strikeSchedule'
import { supabase } from '@/lib/supabase'
import type { AdminCurriculum, StrikeAdminData } from './useStrikeAdminData'

interface CurriculaTabProps {
  tenantId: string
  userId: string | null
  data: StrikeAdminData
  onChanged: () => void
}

const input = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900'

// A curriculum is the admin-controlled drip schedule: an ordered list of
// modules, each released N days after enrollment with its own due window.
// Enrolling a group writes one scheduled assignment per module, so learners
// see each module only on its release date.
export function CurriculaTab({ tenantId, userId, data, onChanged }: CurriculaTabProps) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('strike_curricula').insert({ tenant_id: tenantId, name: name.trim(), created_by: userId })
    setBusy(false)
    if (insertError) { setError(insertError.message); return }
    setName('')
    onChanged()
  }

  return (
    <div className="space-y-4">
      <div className="placard-surface flex flex-wrap items-end gap-2 p-4">
        <label className="min-w-56 flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          New curriculum
          <input value={name} onChange={e => setName(e.target.value)} placeholder="New-hire safety onboarding" className={`mt-1 w-full ${input}`} />
        </label>
        <button type="button" onClick={create} disabled={busy || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Create
        </button>
        {error && <p className="w-full text-sm text-rose-600">{error}</p>}
      </div>

      {data.curricula.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No curricula yet. Create one to release modules on a schedule, such as LOTO 101 now and Confined Space 30 days later.
        </p>
      )}
      {data.curricula.map(c => <CurriculumCard key={c.id} curriculum={c} tenantId={tenantId} userId={userId} data={data} onChanged={onChanged} />)}
    </div>
  )
}

function CurriculumCard({ curriculum, tenantId, userId, data, onChanged }: { curriculum: AdminCurriculum } & CurriculaTabProps) {
  const titles = new Map(data.modules.map(m => [m.id, m.title]))
  const available = data.modules.filter(m => !curriculum.items.some(i => i.module_id === m.id))
  const [addModuleId, setAddModuleId] = useState('')
  const [offset, setOffset] = useState(0)
  const [dueAfter, setDueAfter] = useState(14)
  const [enrollTarget, setEnrollTarget] = useState('tenant')
  const [enrollStart, setEnrollStart] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const departments = useMemo(() => [...new Set(data.members.map(m => m.department?.trim()).filter(Boolean) as string[])].sort(), [data.members])
  const enrolled = data.assignments.filter(a => a.curriculumId === curriculum.id && a.status === 'active')

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setError(null)
    const { error: actionError } = await action()
    setBusy(false)
    if (actionError) setError(actionError.message)
    else onChanged()
  }

  const addItem = () => addModuleId && run(() => supabase.from('strike_curriculum_items').insert({
    tenant_id: tenantId,
    curriculum_id: curriculum.id,
    module_id: addModuleId,
    sort_order: curriculum.items.length,
    release_offset_days: offset,
    due_after_days: dueAfter,
  }))

  const removeItem = (id: string) => run(() => supabase.from('strike_curriculum_items').delete().eq('id', id))

  async function move(index: number, delta: number) {
    const a = curriculum.items[index]
    const b = curriculum.items[index + delta]
    if (!a || !b) return
    await run(async () => {
      const first = await supabase.from('strike_curriculum_items').update({ sort_order: b.sort_order }).eq('id', a.id)
      if (first.error) return first
      return supabase.from('strike_curriculum_items').update({ sort_order: a.sort_order }).eq('id', b.id)
    })
  }

  function enroll() {
    const start = new Date(`${enrollStart}T08:00:00`)
    const schedule = curriculumSchedule(curriculum.items.map(i => ({
      moduleId: i.module_id, sortOrder: i.sort_order, releaseOffsetDays: i.release_offset_days, dueAfterDays: i.due_after_days,
    })), start)
    const [targetType, targetId] = enrollTarget === 'tenant' ? ['tenant', null] : ['department', enrollTarget.slice('department:'.length)]
    return run(() => supabase.from('strike_assignments').insert(schedule.map(s => ({
      tenant_id: tenantId,
      module_id: s.moduleId,
      target_type: targetType,
      target_id: targetId,
      assigned_by: userId,
      starts_at: s.startsAt.toISOString(),
      due_at: s.dueAt.toISOString(),
      trigger_kind: 'schedule',
      curriculum_id: curriculum.id,
      reason: curriculum.name,
    }))))
  }

  return (
    <section aria-labelledby={`curriculum-${curriculum.id}`} className="placard-surface space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`curriculum-${curriculum.id}`} className="stencil-title flex items-center gap-2 text-lg text-slate-900 dark:text-slate-100">
          <CalendarClock className="h-5 w-5 text-brand-navy" aria-hidden /> {curriculum.name}
        </h3>
        <span className="text-xs text-slate-500">{enrolled.length} scheduled assignment(s)</span>
      </div>

      <ol className="space-y-1.5">
        {curriculum.items.map((item, index) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-yellow text-xs font-black text-slate-950">{index + 1}</span>
            <span className="min-w-0 flex-1 font-semibold text-slate-900 dark:text-slate-100">{titles.get(item.module_id) ?? 'Module'}</span>
            <span className="text-xs text-slate-500">day {item.release_offset_days} · due in {item.due_after_days}d</span>
            <button type="button" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label="Move up" className="rounded p-1.5 text-slate-500 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
            <button type="button" onClick={() => move(index, 1)} disabled={busy || index === curriculum.items.length - 1} aria-label="Move down" className="rounded p-1.5 text-slate-500 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
            <button type="button" onClick={() => removeItem(item.id)} disabled={busy} aria-label="Remove module" className="rounded p-1.5 text-rose-500"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ol>

      {available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <select value={addModuleId} onChange={e => setAddModuleId(e.target.value)} aria-label="Module to add" className={`min-w-48 flex-1 ${input}`}>
            <option value="">Add a module…</option>
            {available.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <label className="text-xs text-slate-500">Release day
            <input type="number" min={0} value={offset} onChange={e => setOffset(Math.max(0, Number(e.target.value)))} className={`ml-1 w-20 ${input}`} />
          </label>
          <label className="text-xs text-slate-500">Due after (days)
            <input type="number" min={1} value={dueAfter} onChange={e => setDueAfter(Math.max(1, Number(e.target.value)))} className={`ml-1 w-20 ${input}`} />
          </label>
          <button type="button" onClick={addItem} disabled={busy || !addModuleId} className="rounded-lg border border-brand-navy px-3 py-2 text-sm font-semibold text-brand-navy disabled:opacity-40">Add</button>
        </div>
      )}

      {curriculum.items.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Enroll
            <select value={enrollTarget} onChange={e => setEnrollTarget(e.target.value)} className={`mt-1 block ${input}`}>
              <option value="tenant">Everyone</option>
              {departments.map(d => <option key={d} value={`department:${d}`}>{d}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Starting
            <input type="date" value={enrollStart} onChange={e => setEnrollStart(e.target.value)} className={`mt-1 block ${input}`} />
          </label>
          <button type="button" onClick={enroll} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Schedule {curriculum.items.length} module(s)
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    </section>
  )
}
