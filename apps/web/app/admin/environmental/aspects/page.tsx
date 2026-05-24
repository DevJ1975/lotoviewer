'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Mountain, Loader2, Trash2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import {
  aspectSignificanceBand,
  ASPECT_LIFE_CYCLE_STAGES,
  ASPECT_OPERATING_CONDITIONS,
  ASPECT_STATUSES,
  type AspectLifeCycleStage,
  type AspectOperatingCondition,
  type AspectFlow,
  type AspectStatus,
  type AspectSignificanceBand,
} from '@soteria/core/environmentalAspect'

// /admin/environmental/aspects — ISO 14001:2015 clause 6.1.2 register.
//
// Lists the environmental aspects & impacts with their significance
// rating (severity × likelihood; significant at ≥ 12). Admins add rows
// and the DB derives significance_score / is_significant.

interface AspectRow {
  id:                  string
  activity:            string
  aspect:              string
  impact:              string
  life_cycle_stage:    AspectLifeCycleStage
  operating_condition: AspectOperatingCondition
  flow:                AspectFlow | null
  severity:            number
  likelihood:          number
  significance_score:  number
  is_significant:      boolean
  controls:            string | null
  status:              AspectStatus
  source_reference:    string | null
  notes:               string | null
  created_at:          string
}

const BAND_BADGE: Record<AspectSignificanceBand, string> = {
  low:      'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  moderate: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200',
  extreme:  'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
}

const RATING_SCALE = [1, 2, 3, 4, 5] as const

export default function EnvironmentalAspectsPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [rows, setRows]           = useState<AspectRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [significantOnly, setSignificantOnly] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [showForm, setShowForm]   = useState(false)

  // New-aspect form.
  const [activity, setActivity]               = useState('')
  const [aspect, setAspect]                   = useState('')
  const [impact, setImpact]                   = useState('')
  const [lifeCycleStage, setLifeCycleStage]   = useState<AspectLifeCycleStage>('operation')
  const [operatingCondition, setOperatingCondition] = useState<AspectOperatingCondition>('normal')
  const [flow, setFlow]                       = useState<'' | AspectFlow>('')
  const [severity, setSeverity]               = useState(1)
  const [likelihood, setLikelihood]           = useState(1)
  const [controls, setControls]               = useState('')
  const [status, setStatus]                   = useState<AspectStatus>('identified')

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const { data, error } = await supabase
        .from('environmental_aspects')
        .select('id, activity, aspect, impact, life_cycle_stage, operating_condition, flow, severity, likelihood, significance_score, is_significant, controls, status, source_reference, notes, created_at')
        .eq('tenant_id', tenantId)
        .order('significance_score', { ascending: false })
        .limit(1000)
      if (error) throw new Error(formatSupabaseError(error, 'load aspects'))
      setRows((data ?? []) as AspectRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the aspects register.')
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void load()
  }, [authLoading, profile, load])

  const visible = useMemo(
    () => (rows ?? []).filter(r => !significantOnly || r.is_significant),
    [rows, significantOnly],
  )
  const significantCount = useMemo(() => (rows ?? []).filter(r => r.is_significant).length, [rows])

  function resetForm() {
    setActivity(''); setAspect(''); setImpact('')
    setLifeCycleStage('operation'); setOperatingCondition('normal'); setFlow('')
    setSeverity(1); setLikelihood(1); setControls(''); setStatus('identified')
  }

  async function addAspect() {
    if (!tenantId || !activity.trim() || !aspect.trim() || !impact.trim()) return
    setSaving(true)
    setLoadError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('environmental_aspects').insert({
        tenant_id:           tenantId,
        activity:            activity.trim(),
        aspect:              aspect.trim(),
        impact:              impact.trim(),
        life_cycle_stage:    lifeCycleStage,
        operating_condition: operatingCondition,
        flow:                flow || null,
        severity,
        likelihood,
        controls:            controls.trim() || null,
        status,
        created_by:          user?.id ?? null,
        updated_by:          user?.id ?? null,
      })
      if (error) throw new Error(formatSupabaseError(error, 'add aspect'))
      resetForm(); setShowForm(false)
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not add the aspect.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!tenantId) return
    if (!confirm('Delete this environmental aspect?')) return
    setSaving(true)
    setLoadError(null)
    try {
      const { error } = await supabase
        .from('environmental_aspects')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) throw new Error(formatSupabaseError(error, 'delete aspect'))
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not delete the aspect.')
    } finally {
      setSaving(false)
    }
  }

  const previewBand = aspectSignificanceBand(severity * likelihood)

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
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Mountain className="h-6 w-6 text-brand-navy" />
          Environmental aspects &amp; impacts
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          ISO 14001:2015 clause 6.1.2. Significance = severity × likelihood (1-5 each); an aspect is
          <span className="font-semibold"> significant</span> at a score of 12 or higher.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={significantOnly}
            onChange={e => setSignificantOnly(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-600"
          />
          Significant only ({significantCount})
        </label>
        <button
          type="button"
          onClick={() => setShowForm(v => !v)}
          className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold hover:bg-brand-navy/90"
        >
          {showForm ? 'Cancel' : 'New aspect'}
        </button>
      </div>

      {showForm && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block sm:col-span-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Activity / product / service</span>
              <input type="text" value={activity} onChange={e => setActivity(e.target.value)}
                placeholder="e.g. Parts-washer solvent use"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>
            <label className="block sm:col-span-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Environmental aspect</span>
              <input type="text" value={aspect} onChange={e => setAspect(e.target.value)}
                placeholder="e.g. VOC emission to air"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>
            <label className="block sm:col-span-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Environmental impact</span>
              <input type="text" value={impact} onChange={e => setImpact(e.target.value)}
                placeholder="e.g. Air-quality degradation"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Life-cycle stage</span>
              <select value={lifeCycleStage} onChange={e => setLifeCycleStage(e.target.value as AspectLifeCycleStage)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                {ASPECT_LIFE_CYCLE_STAGES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Operating condition</span>
              <select value={operatingCondition} onChange={e => setOperatingCondition(e.target.value as AspectOperatingCondition)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                {ASPECT_OPERATING_CONDITIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Flow (optional)</span>
              <select value={flow} onChange={e => setFlow(e.target.value as '' | AspectFlow)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                <option value="">—</option>
                <option value="input">Input (resource use)</option>
                <option value="output">Output (emission / discharge / waste)</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Severity (1-5)</span>
              <select value={severity} onChange={e => setSeverity(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                {RATING_SCALE.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Likelihood (1-5)</span>
              <select value={likelihood} onChange={e => setLikelihood(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                {RATING_SCALE.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="flex items-end">
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${BAND_BADGE[previewBand]}`}>
                Score {severity * likelihood} · {previewBand}
              </span>
            </div>

            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Existing / planned controls (optional)</span>
              <input type="text" value={controls} onChange={e => setControls(e.target.value)}
                placeholder="e.g. Closed-loop solvent recovery; secondary containment"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Status</span>
              <select value={status} onChange={e => setStatus(e.target.value as AspectStatus)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                {ASPECT_STATUSES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void addAspect()}
              disabled={saving || !activity.trim() || !aspect.trim() || !impact.trim()}
              className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90"
            >
              {saving ? 'Saving…' : 'Add aspect'}
            </button>
          </div>
        </section>
      )}

      <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        {rows === null ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400 italic">
            {significantOnly ? 'No significant aspects.' : 'No aspects yet — add the first one above.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Activity</th>
                <th className="text-left px-4 py-2">Aspect → impact</th>
                <th className="text-left px-4 py-2 w-28">Life cycle</th>
                <th className="text-left px-4 py-2 w-24">Condition</th>
                <th className="text-left px-4 py-2 w-32">Significance</th>
                <th className="text-left px-4 py-2 w-24">Status</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visible.map(row => {
                const band = aspectSignificanceBand(row.significance_score)
                return (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 align-top">
                    <td className="px-4 py-2 text-slate-900 dark:text-slate-100">{row.activity}</td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                      <span className="font-medium">{row.aspect}</span>
                      <span className="text-slate-400"> → </span>
                      <span>{row.impact}</span>
                      {row.controls && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 italic">Controls: {row.controls}</p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                      {row.life_cycle_stage.replace(/_/g, ' ')}
                      {row.flow ? ` · ${row.flow}` : ''}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">{row.operating_condition}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${BAND_BADGE[band]}`}>
                        {row.significance_score} · {band}
                      </span>
                      {row.is_significant && (
                        <span className="ml-1 text-[10px] font-bold uppercase text-rose-600 dark:text-rose-300">significant</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">{row.status}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void remove(row.id)}
                        disabled={saving}
                        className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
