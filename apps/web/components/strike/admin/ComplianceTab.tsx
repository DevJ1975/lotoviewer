'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import {
  buildComplianceCells,
  complianceCsv,
  complianceTotals,
  missedQuestionStats,
  type ComplianceCell,
  type MissedQuestionStat,
} from '@soteria/core/strikeCompliance'
import type { StrikeAssignmentStanding } from '@soteria/core/strikeSchedule'
import { supabase } from '@/lib/supabase'
import type { StrikeAdminData } from './useStrikeAdminData'

const STANDING_STYLE: Record<StrikeAssignmentStanding, { label: string; className: string }> = {
  complete: { label: 'Current', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200' },
  open: { label: 'Open', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
  due_soon: { label: 'Due soon', className: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200' },
  overdue: { label: 'Overdue', className: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200' },
  upcoming: { label: 'Upcoming', className: 'bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200' },
}

export function ComplianceTab({ tenantId, data }: { tenantId: string; data: StrikeAdminData }) {
  const [filter, setFilter] = useState<'all' | StrikeAssignmentStanding>('all')
  const [now] = useState(() => new Date())
  const cells = useMemo(() => buildComplianceCells({
    members: data.members,
    assignments: data.assignments.filter(a => a.status === 'active'),
    completions: data.completions,
    lineageByModule: data.lineageByModule,
    now,
  }), [data, now])
  const totals = complianceTotals(cells)
  const memberNames = useMemo(() => new Map(data.members.map(m => [m.id, m.displayName])), [data.members])
  const moduleTitles = useMemo(() => new Map(data.modules.map(m => [m.id, m.title])), [data.modules])
  const moduleIds = [...new Set(cells.map(c => c.moduleId))]
  const byMember = useMemo(() => {
    const map = new Map<string, Map<string, ComplianceCell>>()
    for (const cell of cells) {
      const row = map.get(cell.memberId) ?? new Map<string, ComplianceCell>()
      row.set(cell.moduleId, cell)
      map.set(cell.memberId, row)
    }
    return map
  }, [cells])
  const rows = [...byMember.entries()]
    .filter(([, row]) => filter === 'all' || [...row.values()].some(c => c.standing === filter))
    .sort(([a], [b]) => (memberNames.get(a) ?? '').localeCompare(memberNames.get(b) ?? ''))

  function exportCsv() {
    const blob = new Blob([complianceCsv(cells, memberNames, moduleTitles)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `strike-compliance-${now.toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Complete" value={`${totals.percentComplete}%`} sub={`${totals.complete} of ${totals.assigned}`} />
        <Stat label="Overdue" value={String(totals.overdue)} tone={totals.overdue > 0 ? 'bad' : undefined} />
        <Stat label="Due in 3 days" value={String(totals.dueSoon)} tone={totals.dueSoon > 0 ? 'warn' : undefined} />
        <Stat label="Scheduled" value={String(totals.upcoming)} sub="not yet released" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter">
          {(['all', 'overdue', 'due_soon', 'open', 'complete', 'upcoming'] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === f ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
              {f === 'all' ? 'Everyone' : STANDING_STYLE[f].label}
            </button>
          ))}
        </div>
        <button type="button" onClick={exportCsv} disabled={cells.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">
          <Download className="h-4 w-4" aria-hidden /> Export CSV
        </button>
      </div>

      {cells.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          Nothing assigned yet. Assign a module from the Library tab to start tracking.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr>
                <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 dark:bg-slate-900">Worker</th>
                {moduleIds.map(id => <th key={id} scope="col" className="px-3 py-2">{moduleTitles.get(id) ?? 'Module'}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">
              {rows.map(([memberId, row]) => (
                <tr key={memberId}>
                  <th scope="row" className="sticky left-0 bg-white px-3 py-2 text-left font-semibold text-slate-900 dark:bg-slate-950 dark:text-slate-100">{memberNames.get(memberId)}</th>
                  {moduleIds.map(moduleId => {
                    const cell = row.get(moduleId)
                    if (!cell) return <td key={moduleId} className="px-3 py-2 text-slate-300">—</td>
                    const style = STANDING_STYLE[cell.standing]
                    return (
                      <td key={moduleId} className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.className}`}>{style.label}</span>
                        {cell.dueAt && cell.standing !== 'complete' && <span className="ml-1 text-xs text-slate-500">{new Date(cell.dueAt).toLocaleDateString()}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MostMissed tenantId={tenantId} />
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`placard-surface p-3 ${tone === 'bad' ? 'border-rose-300' : tone === 'warn' ? 'border-amber-300' : ''}`}>
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`placard-numeric mt-1 text-2xl font-bold ${tone === 'bad' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900 dark:text-slate-100'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

// Item analysis over the last 90 days of submitted attempts.
function MostMissed({ tenantId }: { tenantId: string }) {
  const [stats, setStats] = useState<(MissedQuestionStat & { prompt: string })[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
      const { data: attempts } = await supabase
        .from('strike_attempts')
        .select('module_version_id,client_context')
        .eq('tenant_id', tenantId)
        .not('submitted_at', 'is', null)
        .gte('submitted_at', since)
        .limit(5000)
      const versionIds = [...new Set((attempts ?? []).map(a => a.module_version_id as string))]
      if (versionIds.length === 0) { if (!cancelled) setStats([]); return }
      const { data: questions } = await supabase
        .from('strike_quiz_questions')
        .select('id,module_version_id,prompt')
        .in('module_version_id', versionIds)
        .eq('graded', true)
      const questionsByVersion = new Map<string, string[]>()
      for (const q of questions ?? []) {
        const list = questionsByVersion.get(q.module_version_id) ?? []
        list.push(q.id)
        questionsByVersion.set(q.module_version_id, list)
      }
      const prompts = new Map((questions ?? []).map(q => [q.id as string, q.prompt as string]))
      const computed = missedQuestionStats((attempts ?? []).map(a => ({
        questionIds: questionsByVersion.get(a.module_version_id) ?? [],
        missedQuestionIds: Array.isArray((a.client_context as { missed_question_ids?: unknown })?.missed_question_ids)
          ? (a.client_context as { missed_question_ids: string[] }).missed_question_ids
          : [],
      })))
      if (!cancelled) setStats(computed.filter(s => s.missRate > 0).slice(0, 5).map(s => ({ ...s, prompt: prompts.get(s.questionId) ?? '' })))
    }
    void load()
    return () => { cancelled = true }
  }, [tenantId])

  if (!stats || stats.length === 0) return null
  return (
    <section aria-labelledby="most-missed" className="placard-surface p-4">
      <h3 id="most-missed" className="text-sm font-black uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">Most-missed questions · last 90 days</h3>
      <p className="mt-1 text-xs text-slate-500">A question most people miss usually means the module didn&apos;t teach it clearly. Use this to improve content, not to rank people.</p>
      <ol className="mt-3 space-y-2">
        {stats.map(s => (
          <li key={s.questionId} className="flex items-start justify-between gap-3 text-sm">
            <span className="text-slate-800 dark:text-slate-100">{s.prompt}</span>
            <span className="shrink-0 font-semibold tabular-nums text-rose-700 dark:text-rose-300">{s.missRate}% missed</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
