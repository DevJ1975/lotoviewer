'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, ClipboardCheck, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  HAZARDOUS_WASTE_AREA_LABEL,
  getChecksForArea,
  type HazardousWasteAreaRow,
  type HazardousWasteAreaType,
  type HazardousWasteFindingStatus,
  type HazardousWasteInspectionFinding,
} from '@soteria/core/hazardousWaste'

// /hazardous-waste/inspections/new — submit a walk-through for one
// accumulation area. Mirrors the offline Expo screen's surface but
// posts straight to /api/hazardous-waste/inspections.

type FindingDraft = Pick<HazardousWasteInspectionFinding, 'check_id'> & {
  status: HazardousWasteFindingStatus | null
  note:   string
}

export default function NewHazardousWasteInspectionPage() {
  const { tenant } = useTenant()
  const router = useRouter()
  const search = useSearchParams()
  const initialAreaId = search.get('area') ?? ''

  const [areas,      setAreas]      = useState<HazardousWasteAreaRow[] | null>(null)
  const [loadError,  setLoadError]  = useState<string | null>(null)
  const [areaId,     setAreaId]     = useState<string>(initialAreaId)
  const [containerLabel,   setContainerLabel]   = useState('')
  const [wasteDescription, setWasteDescription] = useState('')
  const [observations,     setObservations]     = useState('')
  const [findings,   setFindings]   = useState<Record<string, FindingDraft>>({})
  const [busy,       setBusy]       = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const loadAreas = useCallback(async () => {
    if (!tenant?.id) return
    setLoadError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch('/api/hazardous-waste/areas', { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setAreas((body.areas ?? []) as HazardousWasteAreaRow[])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant?.id])

  useEffect(() => { void loadAreas() }, [loadAreas])

  // If the URL pointed at an area, but it's not in the returned list
  // (archived / cross-tenant / typo), drop the preselection so the
  // <select> falls back to the placeholder.
  useEffect(() => {
    if (areas === null) return
    if (!areaId) return
    if (!areas.some(a => a.id === areaId && !a.archived_at)) setAreaId('')
  }, [areas, areaId])

  const area: HazardousWasteAreaRow | null = useMemo(() => {
    if (!areaId || !areas) return null
    return areas.find(a => a.id === areaId) ?? null
  }, [areaId, areas])

  const checks = useMemo(() => area ? getChecksForArea(area.area_type) : [], [area])

  // Whenever the area changes, prime the findings draft so every check
  // for that area_type has a row. Skipping this means the UI can't show
  // "you haven't answered X" because there's no draft entry for X.
  useEffect(() => {
    if (!area) { setFindings({}); return }
    setFindings(prev => {
      const next: Record<string, FindingDraft> = {}
      for (const check of getChecksForArea(area.area_type)) {
        next[check.id] = prev[check.id] ?? { check_id: check.id, status: null, note: '' }
      }
      return next
    })
  }, [area])

  const unanswered = checks.filter(c => findings[c.id]?.status == null).length
  const criticalFails = checks.filter(c =>
    c.critical && findings[c.id]?.status === 'fail',
  ).length
  const totalFails = checks.filter(c => findings[c.id]?.status === 'fail').length
  const passes = checks.filter(c => findings[c.id]?.status === 'pass').length

  function setStatus(checkId: string, status: HazardousWasteFindingStatus | null) {
    setFindings(prev => ({
      ...prev,
      [checkId]: {
        check_id: checkId,
        status,
        note:     prev[checkId]?.note ?? '',
      },
    }))
  }
  function setNote(checkId: string, note: string) {
    setFindings(prev => ({
      ...prev,
      [checkId]: {
        check_id: checkId,
        status:   prev[checkId]?.status ?? null,
        note,
      },
    }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id || !area || busy) return
    if (unanswered > 0) {
      setSubmitError(`Answer every check before submitting (${unanswered} remaining).`)
      return
    }
    setBusy(true)
    setSubmitError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const payload = {
        area_id:           area.id,
        container_label:   containerLabel.trim() || null,
        waste_description: wasteDescription.trim() || null,
        observations:      observations.trim() || null,
        findings: checks.map(c => ({
          check_id: c.id,
          status:   findings[c.id]?.status ?? 'na',
          note:     findings[c.id]?.note.trim() || null,
        })),
        status: 'submitted',
      }
      const res = await fetch('/api/hazardous-waste/inspections', {
        method: 'POST', headers, body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.push('/hazardous-waste')
      router.refresh()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (areas === null) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      </main>
    )
  }

  const activeAreas = areas.filter(a => !a.archived_at)

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex items-center gap-2">
        <Link
          href="/hazardous-waste"
          aria-label="Back to Hazardous Waste hub"
          className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />
            New inspection
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Mark each check pass, fail, or N/A. Notes are optional unless your tenant requires them.
          </p>
        </div>
      </header>

      {loadError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {loadError}
        </div>
      )}

      {activeAreas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No active accumulation areas to inspect.{' '}
          <Link href="/hazardous-waste/areas" className="font-semibold text-brand-navy hover:underline">
            Add one first.
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Area</span>
              <select
                value={areaId}
                onChange={e => setAreaId(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="">Select an area…</option>
                {activeAreas.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {HAZARDOUS_WASTE_AREA_LABEL[a.area_type as HazardousWasteAreaType]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Container label (optional)</span>
                <input
                  type="text"
                  value={containerLabel}
                  onChange={e => setContainerLabel(e.target.value)}
                  maxLength={200}
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Waste description (optional)</span>
                <input
                  type="text"
                  value={wasteDescription}
                  onChange={e => setWasteDescription(e.target.value)}
                  maxLength={500}
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </section>

          {area && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {checks.length} check{checks.length === 1 ? '' : 's'} for{' '}
                {HAZARDOUS_WASTE_AREA_LABEL[area.area_type as HazardousWasteAreaType]}
              </h2>
              <ul className="space-y-3">
                {checks.map(check => {
                  const draft = findings[check.id]
                  const status = draft?.status ?? null
                  return (
                    <li
                      key={check.id}
                      className={
                        'rounded-lg border p-4 space-y-2 ' +
                        (status === 'fail' && check.critical
                          ? 'border-rose-300 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/40'
                          : 'border-slate-200 dark:border-slate-800')
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {check.label}
                            {check.critical && (
                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                Critical
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{check.detail}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <StatusButton current={status} value="pass" onClick={() => setStatus(check.id, 'pass')} />
                          <StatusButton current={status} value="fail" onClick={() => setStatus(check.id, 'fail')} />
                          <StatusButton current={status} value="na"   onClick={() => setStatus(check.id, 'na')} />
                        </div>
                      </div>
                      {(status === 'fail' || draft?.note) && (
                        <textarea
                          value={draft?.note ?? ''}
                          onChange={e => setNote(check.id, e.target.value)}
                          rows={2}
                          placeholder={status === 'fail' ? 'Describe what was wrong and what was done about it' : 'Add a note'}
                          maxLength={1000}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {area && (
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Overall observations (optional)</span>
                <textarea
                  value={observations}
                  onChange={e => setObservations(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Anything the binder reviewer should see at the top of this inspection."
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />{passes} pass</span>
                  <span>{totalFails} fail</span>
                  {criticalFails > 0 && (
                    <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300 font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5" /> {criticalFails} critical
                    </span>
                  )}
                  <span>{unanswered} unanswered</span>
                </div>
                <button
                  type="submit"
                  disabled={busy || unanswered > 0 || !area}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-brand-navy/90"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Submit inspection
                </button>
              </div>
              {submitError && (
                <p className="text-sm text-rose-700 dark:text-rose-300">{submitError}</p>
              )}
            </section>
          )}
        </form>
      )}
    </main>
  )
}

function StatusButton({
  current, value, onClick,
}: {
  current: HazardousWasteFindingStatus | null
  value:   HazardousWasteFindingStatus
  onClick: () => void
}) {
  const active = current === value
  const labels: Record<HazardousWasteFindingStatus, string> = { pass: 'Pass', fail: 'Fail', na: 'N/A' }
  const tones: Record<HazardousWasteFindingStatus, { on: string; off: string }> = {
    pass: {
      on:  'bg-emerald-600 text-white border-emerald-600',
      off: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-300 dark:hover:bg-emerald-950/30',
    },
    fail: {
      on:  'bg-rose-600 text-white border-rose-600',
      off: 'border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30',
    },
    na: {
      on:  'bg-slate-600 text-white border-slate-600',
      off: 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
    },
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-semibold rounded-md border px-3 py-1.5 min-w-[3rem] transition-colors ${active ? tones[value].on : tones[value].off}`}
      aria-pressed={active}
    >
      {labels[value]}
    </button>
  )
}
