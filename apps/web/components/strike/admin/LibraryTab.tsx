'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { BookOpen, Clock, Globe2, Repeat, Search, Building2, Target } from 'lucide-react'
import { parseRecurrenceRule, STRIKE_RECURRENCE_LABELS } from '@soteria/core/strikeSchedule'
import { AssignForm } from './AssignForm'
import type { AdminModule, StrikeAdminData } from './useStrikeAdminData'

interface LibraryTabProps {
  tenantId: string
  userId: string | null
  data: StrikeAdminData
  onChanged: () => void
}

export function LibraryTab({ tenantId, userId, data, onChanged }: LibraryTabProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [assigning, setAssigning] = useState<AdminModule | null>(null)

  const categories = useMemo(() => [...new Set(data.modules.map(m => m.category).filter(Boolean) as string[])].sort(), [data.modules])
  const visible = data.modules.filter(m => {
    const q = query.trim().toLowerCase()
    const matchesQuery = !q || [m.title, m.description, ...m.tags].some(v => v?.toLowerCase().includes(q))
    return matchesQuery && (!category || m.category === category)
  })
  const assignmentsByModule = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of data.assignments) if (a.status === 'active') map.set(a.moduleId, (map.get(a.moduleId) ?? 0) + 1)
    return map
  }, [data.assignments])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the library" aria-label="Search the library"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
        </label>
        <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
          <option value="">All topics</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
          <BookOpen className="mx-auto mb-2 h-6 w-6" aria-hidden />
          No published modules match. New library modules appear here once a superadmin publishes them.
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map(module => (
            <li key={module.id} className="placard-surface flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {module.library_scope === 'global' ? <Globe2 className="h-3 w-3" aria-hidden /> : <Building2 className="h-3 w-3" aria-hidden />}
                  {module.library_scope === 'global' ? 'General industry' : 'Your site'}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" aria-hidden /> {module.estimated_minutes} min</span>
              </div>
              <h3 className="stencil-title mt-2 text-lg text-slate-900 dark:text-slate-100">{module.title}</h3>
              <p className="mt-1 line-clamp-3 flex-1 text-sm text-slate-600 dark:text-slate-300">{module.description}</p>
              <p className="mt-2 text-xs text-slate-500">{assignmentsByModule.get(module.id) ?? 0} active assignment(s)</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setAssigning(module)}
                  className="motion-press inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white">
                  <Target className="h-4 w-4" aria-hidden /> Assign
                </button>
                <Link href={`/strike/${module.slug}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200">
                  Preview
                </Link>
              </div>
              {assigning?.id === module.id && (
                <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                  <AssignForm
                    tenantId={tenantId}
                    userId={userId}
                    module={module}
                    members={data.members}
                    onCancel={() => setAssigning(null)}
                    onDone={() => { setAssigning(null); onChanged() }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ActiveAssignments data={data} />
    </div>
  )
}

function ActiveAssignments({ data }: { data: StrikeAdminData }) {
  const titles = new Map(data.modules.map(m => [m.id, m.title]))
  const active = data.assignments.filter(a => a.status === 'active' && !a.curriculumId)
  if (active.length === 0) return null
  return (
    <section aria-labelledby="active-assignments" className="placard-surface p-4">
      <h3 id="active-assignments" className="text-sm font-black uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">Active assignments</h3>
      <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {active.map(a => {
          const rule = parseRecurrenceRule(a.recurrenceRule)
          return (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{titles.get(a.moduleId) ?? 'Module'}</span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{a.targetType === 'tenant' ? 'Everyone' : `${a.targetType}: ${a.targetType === 'user' ? 'one person' : a.targetId}`}</span>
                {a.startsAt && new Date(a.startsAt) > new Date() && <span>releases {new Date(a.startsAt).toLocaleDateString()}</span>}
                {a.dueAt && <span>due {new Date(a.dueAt).toLocaleDateString()}</span>}
                {rule && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" aria-hidden />{rule.freq === 'interval' ? `every ${rule.intervalDays} days` : STRIKE_RECURRENCE_LABELS[rule.freq].toLowerCase()}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
