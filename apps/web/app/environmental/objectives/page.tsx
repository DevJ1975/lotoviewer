'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Mountain, Loader2, Trash2, LineChart } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import {
  objectiveProgressPct,
  isObjectiveAchieved,
  OBJECTIVE_STATUSES,
  IMPROVEMENT_DIRECTIONS,
  type ObjectiveStatus,
  type ImprovementDirection,
} from '@soteria/core/environmentalObjective'

// /environmental/objectives — ISO 14001:2015 clause 6.2 + 9.1.1.
//
// Environmental objectives with a baseline → target and an append-only
// reading trail. Progress + "achieved?" come from the shared helper so
// the rule matches everywhere.

interface ObjectiveRow {
  id:                    string
  title:                 string
  related_aspect_id:     string | null
  indicator:             string | null
  unit:                  string | null
  baseline_value:        number | null
  baseline_label:        string | null
  target_value:          number | null
  target_date:           string | null
  improvement_direction: ImprovementDirection
  status:                ObjectiveStatus
  evaluation_method:     string | null
}

interface ReadingRow {
  objective_id: string
  reading_date: string
  value:        number
}

interface AspectOption {
  id:             string
  activity:       string
  aspect:         string
  is_significant: boolean
}

const STATUS_BADGE: Record<ObjectiveStatus, string> = {
  planned:     'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
  achieved:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  missed:      'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  cancelled:   'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

function numOrNull(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export default function EnvironmentalObjectivesPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [rows, setRows]             = useState<ObjectiveRow[] | null>(null)
  const [readings, setReadings]     = useState<ReadingRow[]>([])
  const [aspects, setAspects]       = useState<AspectOption[]>([])
  const [loadError, setLoadError]   = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [showForm, setShowForm]     = useState(false)

  // New-objective form.
  const [title, setTitle]                 = useState('')
  const [relatedAspectId, setRelatedAspectId] = useState('')
  const [indicator, setIndicator]         = useState('')
  const [unit, setUnit]                   = useState('')
  const [baselineValue, setBaselineValue] = useState('')
  const [targetValue, setTargetValue]     = useState('')
  const [targetDate, setTargetDate]       = useState('')
  const [direction, setDirection]         = useState<ImprovementDirection>('decrease')
  const [status, setStatus]               = useState<ObjectiveStatus>('planned')
  const [evaluationMethod, setEvaluationMethod] = useState('')

  // Per-row reading entry.
  const [readingFor, setReadingFor]       = useState<string | null>(null)
  const [readingValue, setReadingValue]   = useState('')
  const [readingDate, setReadingDate]     = useState('')

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const [obj, rd, asp] = await Promise.all([
        supabase
          .from('environmental_objectives')
          .select('id, title, related_aspect_id, indicator, unit, baseline_value, baseline_label, target_value, target_date, improvement_direction, status, evaluation_method')
          .eq('tenant_id', tenantId)
          .order('target_date', { ascending: true, nullsFirst: false })
          .limit(1000),
        supabase
          .from('environmental_objective_readings')
          .select('objective_id, reading_date, value')
          .eq('tenant_id', tenantId)
          .order('reading_date', { ascending: false })
          .limit(5000),
        supabase
          .from('environmental_aspects')
          .select('id, activity, aspect, is_significant')
          .eq('tenant_id', tenantId)
          .order('significance_score', { ascending: false })
          .limit(1000),
      ])
      if (obj.error) throw new Error(formatSupabaseError(obj.error, 'load objectives'))
      if (rd.error)  throw new Error(formatSupabaseError(rd.error, 'load readings'))
      if (asp.error) throw new Error(formatSupabaseError(asp.error, 'load aspects'))
      setRows((obj.data ?? []) as ObjectiveRow[])
      setReadings((rd.data ?? []) as ReadingRow[])
      setAspects((asp.data ?? []) as AspectOption[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load objectives.')
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void load()
  }, [authLoading, profile, load])

  // Latest reading per objective (readings already sorted date desc).
  const latestByObjective = useMemo(() => {
    const m = new Map<string, ReadingRow>()
    for (const r of readings) if (!m.has(r.objective_id)) m.set(r.objective_id, r)
    return m
  }, [readings])

  const aspectLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of aspects) m.set(a.id, `${a.activity} — ${a.aspect}`)
    return m
  }, [aspects])

  function resetForm() {
    setTitle(''); setRelatedAspectId(''); setIndicator(''); setUnit('')
    setBaselineValue(''); setTargetValue(''); setTargetDate('')
    setDirection('decrease'); setStatus('planned'); setEvaluationMethod('')
  }

  async function addObjective() {
    if (!tenantId || !title.trim()) return
    setSaving(true)
    setLoadError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('environmental_objectives').insert({
        tenant_id:             tenantId,
        title:                 title.trim(),
        related_aspect_id:     relatedAspectId || null,
        indicator:             indicator.trim() || null,
        unit:                  unit.trim() || null,
        baseline_value:        numOrNull(baselineValue),
        target_value:          numOrNull(targetValue),
        target_date:           targetDate || null,
        improvement_direction: direction,
        status,
        evaluation_method:     evaluationMethod.trim() || null,
        created_by:            user?.id ?? null,
        updated_by:            user?.id ?? null,
      })
      if (error) throw new Error(formatSupabaseError(error, 'add objective'))
      resetForm(); setShowForm(false)
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not add the objective.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!tenantId) return
    if (!confirm('Delete this objective and its readings?')) return
    setSaving(true)
    setLoadError(null)
    try {
      const { error } = await supabase
        .from('environmental_objectives')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) throw new Error(formatSupabaseError(error, 'delete objective'))
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not delete the objective.')
    } finally {
      setSaving(false)
    }
  }

  function openReading(objectiveId: string) {
    setReadingFor(objectiveId)
    setReadingValue('')
    setReadingDate('')
  }

  async function logReading() {
    const value = numOrNull(readingValue)
    if (!tenantId || !readingFor || value === null) return
    setSaving(true)
    setLoadError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('environmental_objective_readings').insert({
        tenant_id:    tenantId,
        objective_id: readingFor,
        value,
        reading_date: readingDate || undefined,
        recorded_by:  user?.id ?? null,
      })
      if (error) throw new Error(formatSupabaseError(error, 'log reading'))
      setReadingFor(null); setReadingValue(''); setReadingDate('')
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not log the reading.')
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }
  if (!profile?.is_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">
        Admins only.
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/environmental" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Mountain className="h-6 w-6 text-brand-navy" />
          Environmental objectives
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          ISO 14001:2015 clauses 6.2 &amp; 9.1.1 — measurable targets against significant aspects, tracked by periodic readings.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowForm(v => !v)}
          className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold hover:bg-brand-navy/90"
        >
          {showForm ? 'Cancel' : 'New objective'}
        </button>
      </div>

      {showForm && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Objective</span>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Cut solvent VOC emissions 30% by 2027"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Related significant aspect (optional)</span>
              <select value={relatedAspectId} onChange={e => setRelatedAspectId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                <option value="">—</option>
                {aspects.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.is_significant ? '★ ' : ''}{a.activity} — {a.aspect}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Indicator (optional)</span>
              <input type="text" value={indicator} onChange={e => setIndicator(e.target.value)}
                placeholder="e.g. VOC emissions"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Unit (optional)</span>
              <input type="text" value={unit} onChange={e => setUnit(e.target.value)}
                placeholder="e.g. kg/yr"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Direction</span>
              <select value={direction} onChange={e => setDirection(e.target.value as ImprovementDirection)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                {IMPROVEMENT_DIRECTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Baseline (optional)</span>
              <input type="number" value={baselineValue} onChange={e => setBaselineValue(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Target (optional)</span>
              <input type="number" value={targetValue} onChange={e => setTargetValue(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Target date (optional)</span>
              <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Evaluation method (optional)</span>
              <input type="text" value={evaluationMethod} onChange={e => setEvaluationMethod(e.target.value)}
                placeholder="e.g. Quarterly stack-test average vs. permit limit"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Status</span>
              <select value={status} onChange={e => setStatus(e.target.value as ObjectiveStatus)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                {OBJECTIVE_STATUSES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void addObjective()}
              disabled={saving || !title.trim()}
              className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90"
            >
              {saving ? 'Saving…' : 'Add objective'}
            </button>
          </div>
        </section>
      )}

      <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        {rows === null ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400 italic">
            No objectives yet — add the first one above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Objective</th>
                <th className="text-left px-4 py-2 w-36">Target</th>
                <th className="text-left px-4 py-2 w-32">Latest</th>
                <th className="text-left px-4 py-2 w-40">Progress</th>
                <th className="text-left px-4 py-2 w-24">Status</th>
                <th className="px-4 py-2 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(row => {
                const latest = latestByObjective.get(row.id) ?? null
                const latestVal = latest ? latest.value : null
                const pct = objectiveProgressPct(row.baseline_value, row.target_value, latestVal, row.improvement_direction)
                const achieved = isObjectiveAchieved(row.target_value, latestVal, row.improvement_direction)
                const unit = row.unit ? ` ${row.unit}` : ''
                return (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 align-top">
                    <td className="px-4 py-2 text-slate-900 dark:text-slate-100">
                      <div className="font-medium">{row.title}</div>
                      {row.indicator && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{row.indicator}</div>
                      )}
                      {row.related_aspect_id && aspectLabel.get(row.related_aspect_id) && (
                        <div className="text-[11px] text-slate-400 italic">↳ {aspectLabel.get(row.related_aspect_id)}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[12px] text-slate-700 dark:text-slate-300 tabular-nums">
                      {row.target_value !== null ? `${row.target_value}${unit}` : '—'}
                      {row.target_date && (
                        <div className="text-[10px] text-slate-400">by {new Date(row.target_date).toLocaleDateString()}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[12px] tabular-nums">
                      {latest ? (
                        <>
                          <span className={achieved ? 'text-emerald-600 dark:text-emerald-300 font-semibold' : 'text-slate-700 dark:text-slate-300'}>
                            {latest.value}{unit}
                          </span>
                          <div className="text-[10px] text-slate-400">{new Date(latest.reading_date).toLocaleDateString()}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">no reading</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {pct === null ? (
                        <span className="text-[11px] text-slate-400">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full ${achieved ? 'bg-emerald-500' : 'bg-brand-navy'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400 w-9 text-right">{pct}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_BADGE[row.status]}`}>
                        {row.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openReading(row.id)}
                        disabled={saving}
                        title="Log a reading"
                        className="text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md p-1"
                      >
                        <LineChart className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(row.id)}
                        disabled={saving}
                        className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md p-1 ml-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      {readingFor === row.id && (
                        <div className="mt-2 flex items-center gap-1 justify-end">
                          <input
                            type="number"
                            value={readingValue}
                            onChange={e => setReadingValue(e.target.value)}
                            placeholder="value"
                            className="w-20 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                          />
                          <input
                            type="date"
                            value={readingDate}
                            onChange={e => setReadingDate(e.target.value)}
                            className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => void logReading()}
                            disabled={saving || numOrNull(readingValue) === null}
                            className="px-2 py-1 rounded-md bg-brand-navy text-white text-[11px] font-semibold disabled:opacity-40"
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
