'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { Equipment, LotoEnergyStep, LotoWorker } from '@soteria/core/types'
import {
  classifyPeriodic,
  computeNextDueAt,
  type PeriodicInspectionRow,
  type AuthorizedEmployeeObserved,
} from '@soteria/core/lotoPeriodicInspection'
import { LOTO_STEP_TYPE_LABELS } from '@soteria/core/lotoProcedureValidation'

// /equipment/[id]/periodic-inspection — single-equipment §147(c)(6)
// inspection form. The admin records:
//   - inspector name (defaults to their profile)
//   - authorized employees observed using the procedure
//   - per-step deviations (which energy-isolation step drifted)
//   - corrective actions
//   - signature
//
// Saving in two phases:
//   1. Draft save (signed=false) — lets the inspector pause + come back.
//   2. Sign + finalize (signed=true) — denormalizes next_due onto the
//      loto_equipment row via the migration 141 trigger.

export default function PeriodicInspectionFormPage() {
  return (
    <Suspense fallback={<Loader />}>
      <PeriodicInspectionForm />
    </Suspense>
  )
}

function Loader() {
  return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
}

function PeriodicInspectionForm() {
  const { id } = useParams<{ id: string }>()
  const equipmentId = decodeURIComponent(id)
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [equipment, setEquipment] = useState<Equipment | null>(null)
  const [steps, setSteps] = useState<LotoEnergyStep[]>([])
  const [workers, setWorkers] = useState<LotoWorker[]>([])
  const [history, setHistory] = useState<PeriodicInspectionRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Form state
  const [inspectorName, setInspectorName] = useState('')
  const [observedIds, setObservedIds] = useState<Set<string>>(new Set())
  const [stepDeviations, setStepDeviations] = useState<Record<string, string>>({})
  const [generalDeviations, setGeneralDeviations] = useState('')
  const [correctiveActions, setCorrectiveActions] = useState('')
  const [signedName, setSignedName] = useState('')

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const [eqResult, stepsResult, workersResult, histResult] = await Promise.all([
        supabase
          .from('loto_equipment').select('*').eq('tenant_id', tenantId).eq('equipment_id', equipmentId).single(),
        supabase
          .from('loto_energy_steps').select('*').eq('tenant_id', tenantId).eq('equipment_id', equipmentId).order('sequence_order', { ascending: true }),
        supabase
          .from('loto_workers').select('*').eq('tenant_id', tenantId).eq('active', true).order('full_name', { ascending: true }),
        supabase
          .from('loto_periodic_inspections').select('*').eq('tenant_id', tenantId).eq('equipment_id', equipmentId).order('inspected_at', { ascending: false }),
      ])
      if (eqResult.error)      throw new Error(formatSupabaseError(eqResult.error,      'load equipment'))
      if (stepsResult.error)   throw new Error(formatSupabaseError(stepsResult.error,   'load energy steps'))
      if (workersResult.error) throw new Error(formatSupabaseError(workersResult.error, 'load workers'))
      if (histResult.error)    throw new Error(formatSupabaseError(histResult.error,    'load inspection history'))

      setEquipment(eqResult.data as Equipment)
      setSteps((stepsResult.data ?? []) as LotoEnergyStep[])
      setWorkers((workersResult.data ?? []) as LotoWorker[])
      setHistory((histResult.data ?? []) as PeriodicInspectionRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load inspection.')
    }
  }, [tenantId, equipmentId])

  useEffect(() => { if (!authLoading && profile?.is_admin) load() }, [authLoading, profile, load])

  // Default the inspector name to the signed-in admin's profile name on
  // first paint. Field stays editable for the case where an admin
  // records on behalf of another inspector.
  useEffect(() => {
    if (!inspectorName && profile?.full_name) setInspectorName(profile.full_name)
  }, [profile, inspectorName])

  const previewedNextDue = useMemo(() => computeNextDueAt(new Date()), [])
  const dueAt = equipment?.next_periodic_review_due_at ?? null
  const status = useMemo(
    () => classifyPeriodic(dueAt, new Date()),
    [dueAt],
  )

  if (authLoading) return <Loader />
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }
  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      </div>
    )
  }
  if (!equipment) return <Loader />

  function toggleWorker(workerId: string) {
    setObservedIds(prev => {
      const next = new Set(prev)
      if (next.has(workerId)) next.delete(workerId)
      else next.add(workerId)
      return next
    })
  }

  function patchStepDeviation(stepId: string, text: string) {
    setStepDeviations(prev => ({ ...prev, [stepId]: text }))
  }

  // Build the deviations text payload that the database stores. Joins
  // per-step deviation paragraphs (with their phase label for the
  // auditor) and the general deviation note into one canonical block.
  function composeDeviations(): string | null {
    const parts: string[] = []
    for (const step of steps) {
      const txt = stepDeviations[step.id]?.trim()
      if (!txt) continue
      const phase = LOTO_STEP_TYPE_LABELS[step.step_type]
      parts.push(`[${phase} · Step ${step.step_number}, ${step.energy_type}] ${txt}`)
    }
    const general = generalDeviations.trim()
    if (general) parts.push(`[General] ${general}`)
    return parts.length === 0 ? null : parts.join('\n\n')
  }

  // The migration-142 trigger reads deviations + observed roster off
  // this insert to auto-create retraining triggers for each worker.
  // We only need to write the row.
  async function saveAndSign() {
    if (!tenantId || !profile) return
    if (!inspectorName.trim()) { setLoadError('Inspector name is required.'); return }
    if (!signedName.trim()) { setLoadError('Type your name to certify the inspection.'); return }

    setLoadError(null)
    setBusy(true)
    try {
      const observed: AuthorizedEmployeeObserved[] = workers
        .filter(w => observedIds.has(w.id))
        .map(w => ({ worker_id: w.id, full_name: w.full_name }))

      const { error } = await supabase
        .from('loto_periodic_inspections')
        .insert({
          tenant_id:                     tenantId,
          equipment_id:                  equipmentId,
          inspector_user_id:             profile.id,
          inspector_name:                inspectorName.trim(),
          authorized_employees_observed: observed,
          deviations:                    composeDeviations(),
          corrective_actions:            correctiveActions.trim() || null,
          signed:                        true,
          signed_name:                   signedName.trim(),
          signature:                     null,
          signed_at:                     new Date().toISOString(),
          ip:                            null,
          user_agent:                    typeof navigator !== 'undefined' ? navigator.userAgent : null,
          next_due_at:                   previewedNextDue.toISOString(),
        })
      if (error) throw new Error(formatSupabaseError(error, 'record inspection'))

      // Reset the form and reload so the new row appears in history +
      // the page's status pill updates.
      setObservedIds(new Set())
      setStepDeviations({})
      setGeneralDeviations('')
      setCorrectiveActions('')
      setSignedName('')
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not record inspection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/periodic-inspections" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to periodic inspections
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-brand-navy" />
          Periodic inspection · {equipment.equipment_id}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {equipment.description} · {equipment.department}
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          Current status:{' '}
          <span className="font-semibold text-slate-700 dark:text-slate-300">{status}</span>
          {dueAt && (
            <> · next due {new Date(dueAt).toLocaleDateString()}</>
          )}
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Record a new inspection</h2>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Inspector</span>
          <input
            type="text"
            value={inspectorName}
            onChange={e => setInspectorName(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            §147(c)(6)(i) — must NOT be a worker using this procedure today.
          </p>
        </label>

        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Authorized employees observed
          </span>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            §147(c)(6)(ii) — at least one authorized employee under each procedure.
          </p>
          {workers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 italic">
              No workers in the LOTO roster yet. <Link href="/admin/workers" className="underline">Add some.</Link>
            </p>
          ) : (
            <ul className="mt-2 max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-100 dark:divide-slate-800">
              {workers.map(w => (
                <li key={w.id} className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={observedIds.has(w.id)}
                    onChange={() => toggleWorker(w.id)}
                    disabled={busy}
                    className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy/30"
                    id={`worker-${w.id}`}
                  />
                  <label htmlFor={`worker-${w.id}`} className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                    {w.full_name}
                    {w.employee_id && <span className="ml-1 text-[11px] text-slate-500 dark:text-slate-400">· {w.employee_id}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Per-step deviations
          </span>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            §147(c)(6)(i)(C) — note any step where the procedure was not followed.
          </p>
          {steps.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 italic">
              No energy-isolation steps on file for this equipment.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {steps.map(step => (
                <li key={step.id} className="rounded-md border border-slate-100 dark:border-slate-800 p-3">
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    [{LOTO_STEP_TYPE_LABELS[step.step_type]}] Step {step.step_number} · {step.energy_type}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {step.tag_description || '—'}
                  </p>
                  <textarea
                    value={stepDeviations[step.id] ?? ''}
                    onChange={e => patchStepDeviation(step.id, e.target.value)}
                    disabled={busy}
                    placeholder="Deviation observed (leave blank if none)"
                    rows={2}
                    className="mt-2 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">General deviations</span>
          <textarea
            value={generalDeviations}
            onChange={e => setGeneralDeviations(e.target.value)}
            disabled={busy}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Corrective actions</span>
          <textarea
            value={correctiveActions}
            onChange={e => setCorrectiveActions(e.target.value)}
            disabled={busy}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </label>

        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-2">
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            By certifying, you affirm the inspection meets §147(c)(6).{' '}
            Next inspection due:{' '}
            <span className="font-semibold">{previewedNextDue.toLocaleDateString()}</span>
          </p>
          <input
            type="text"
            value={signedName}
            onChange={e => setSignedName(e.target.value)}
            placeholder="Type your name to sign"
            disabled={busy}
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </div>

        <button
          type="button"
          onClick={saveAndSign}
          disabled={busy}
          className="w-full rounded-lg bg-brand-navy text-white text-sm font-semibold py-2.5 disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
        >
          {busy ? 'Saving…' : 'Sign & record inspection'}
        </button>
      </section>

      <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Inspection history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">No prior inspections.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.map(row => (
              <li key={row.id} className="py-3">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {new Date(row.inspected_at).toLocaleDateString()} · {row.inspector_name}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {row.authorized_employees_observed.length} employee
                  {row.authorized_employees_observed.length === 1 ? '' : 's'} observed
                  {row.deviations && ' · deviations recorded'}
                  {' · next due '}{new Date(row.next_due_at).toLocaleDateString()}
                </p>
                {row.deviations && (
                  <p className="mt-1 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{row.deviations}</p>
                )}
                {row.corrective_actions && (
                  <p className="mt-1 text-[11px] text-slate-700 dark:text-slate-300">
                    <span className="font-semibold">Corrective actions:</span> {row.corrective_actions}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
