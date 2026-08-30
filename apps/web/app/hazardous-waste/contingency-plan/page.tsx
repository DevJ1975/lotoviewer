'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { useFacility } from '@/components/FacilityProvider'
import { supabase } from '@/lib/supabase'
import { parseFacilityProfile } from '@soteria/core/hazardousWaste'
import {
  buildQuickReferenceGuide,
  contingencyPlanStatus,
  type EmergencyCoordinator,
  type EmergencyEquipmentItem,
  type HazardousWasteContingencyPlanInput,
} from '@soteria/core/contingencyPlan'

// /hazardous-waste/contingency-plan — the facility's LQG contingency plan and
// Quick Reference Guide (40 CFR 262 Subpart M). One plan per facility.

const EMPTY: HazardousWasteContingencyPlanInput = {
  plan_document_url:      null,
  max_waste_quantity:     null,
  evacuation_plan:        null,
  emergency_coordinators: [],
  emergency_equipment:    [],
  qrg_submitted_at:       null,
  qrg_submitted_to:       null,
  last_amended_at:        null,
  review_due_date:        null,
  notes:                  null,
}

const today = () => new Date().toISOString().slice(0, 10)

export default function ContingencyPlanPage() {
  const { tenant } = useTenant()
  const { profile: authProfile } = useAuth()
  const { facilityId, facility } = useFacility()
  const canEdit = !!authProfile?.is_admin || !!authProfile?.is_superadmin

  const [plan,   setPlan]   = useState<HazardousWasteContingencyPlanInput>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const [saved,  setSaved]  = useState(false)
  const [busy,   setBusy]   = useState(false)

  const headers = useCallback(async (json = false) => {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (facilityId) h['x-active-facility'] = facilityId
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    if (json) h['content-type'] = 'application/json'
    return h
  }, [tenant?.id, facilityId])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null); setLoaded(false)
    try {
      const res = await fetch('/api/hazardous-waste/contingency-plan', { headers: await headers() })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setPlan(json.plan ? { ...EMPTY, ...json.plan } : EMPTY)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [tenant?.id, headers])

  useEffect(() => { void load() }, [load])

  async function save(next: HazardousWasteContingencyPlanInput = plan) {
    setBusy(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/hazardous-waste/contingency-plan', {
        method: 'PUT', headers: await headers(true), body: JSON.stringify(next),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setPlan({ ...EMPTY, ...json.plan })
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const status = contingencyPlanStatus(plan, new Date())
  const epaId = facility ? parseFacilityProfile(facility.settings).epa_id_number : null
  const qrg = buildQuickReferenceGuide(plan, { facilityName: facility?.name ?? null, epaIdNumber: epaId }, today())

  const set = <K extends keyof HazardousWasteContingencyPlanInput>(k: K, v: HazardousWasteContingencyPlanInput[K]) =>
    setPlan(p => ({ ...p, [k]: v }))

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/hazardous-waste" className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Hazardous Waste
        </Link>
      </div>

      <header className="flex items-start gap-3">
        <span className="rounded-md bg-rose-100 p-2 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Contingency plan &amp; Quick Reference Guide</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Required for large quantity generators (40 CFR 262 Subpart M). Submit the Quick Reference
            Guide to local emergency responders and re-submit it whenever the plan is amended.
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">{error}</div>
      )}

      {!facilityId && loaded && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          You&apos;re viewing all facilities. Pick a single facility in the header to view or edit its plan.
        </div>
      )}

      {!loaded ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : facilityId ? (
        <>
          {/* QRG status */}
          <div
            className={`rounded-md p-3 text-sm ${
              status.qrgOutstanding
                ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                : status.hasPlan
                  ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                  : 'bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300'
            }`}
          >
            {!status.hasPlan ? (
              <span>No plan yet — add at least one emergency coordinator to begin.</span>
            ) : status.qrgOutstanding ? (
              <span className="font-semibold">Quick Reference Guide submission outstanding — submit (or re-submit after amendment) to local responders.</span>
            ) : (
              <span className="font-semibold">Quick Reference Guide submitted{plan.qrg_submitted_at ? ` · ${plan.qrg_submitted_at}` : ''}.</span>
            )}
            {status.reviewDue && <span className="ml-2">· Plan review is due.</span>}
            {canEdit && status.hasPlan && status.qrgOutstanding && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void save({ ...plan, qrg_submitted_at: today() })}
                className="ml-3 inline-flex items-center gap-1 rounded bg-brand-navy px-2 py-1 text-xs font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60"
              >
                Mark QRG submitted today
              </button>
            )}
          </div>

          <form
            onSubmit={e => { e.preventDefault(); void save() }}
            className="space-y-5 rounded-lg border border-slate-200 dark:border-slate-800 p-5"
          >
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Facility: <span className="font-semibold text-slate-700 dark:text-slate-200">{facility?.name ?? '—'}</span>
              {epaId && <> · EPA ID {epaId}</>}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Estimated max waste on site" hint="e.g. 5,000 kg">
                <input value={plan.max_waste_quantity ?? ''} onChange={e => set('max_waste_quantity', e.target.value || null)} maxLength={200} disabled={!canEdit} className={inputCls} />
              </Field>
              <Field label="Plan document URL" hint="Link to the full contingency plan (optional)">
                <input value={plan.plan_document_url ?? ''} onChange={e => set('plan_document_url', e.target.value || null)} maxLength={2000} disabled={!canEdit} className={inputCls} />
              </Field>
            </div>

            {/* Emergency coordinators */}
            <ListEditor<EmergencyCoordinator>
              title="Emergency coordinators"
              items={plan.emergency_coordinators}
              canEdit={canEdit}
              blank={{ name: '', phone: '', role: '' }}
              onChange={items => set('emergency_coordinators', items)}
              fields={[
                { key: 'name', placeholder: 'Name' },
                { key: 'phone', placeholder: 'Phone' },
                { key: 'role', placeholder: 'Role' },
              ]}
            />

            {/* Emergency equipment */}
            <ListEditor<EmergencyEquipmentItem>
              title="Emergency equipment"
              items={plan.emergency_equipment}
              canEdit={canEdit}
              blank={{ name: '', location: '', capabilities: '' }}
              onChange={items => set('emergency_equipment', items)}
              fields={[
                { key: 'name', placeholder: 'Equipment' },
                { key: 'location', placeholder: 'Location' },
                { key: 'capabilities', placeholder: 'Capabilities' },
              ]}
            />

            <Field label="Evacuation plan">
              <textarea value={plan.evacuation_plan ?? ''} onChange={e => set('evacuation_plan', e.target.value || null)} rows={3} maxLength={4000} disabled={!canEdit} className={inputCls} />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="QRG submitted to" hint="Local fire dept / LEPC">
                <input value={plan.qrg_submitted_to ?? ''} onChange={e => set('qrg_submitted_to', e.target.value || null)} maxLength={300} disabled={!canEdit} className={inputCls} />
              </Field>
              <Field label="QRG submitted on">
                <input type="date" value={plan.qrg_submitted_at ?? ''} onChange={e => set('qrg_submitted_at', e.target.value || null)} disabled={!canEdit} className={inputCls} />
              </Field>
              <Field label="Plan last amended" hint="Re-submit the QRG after any amendment">
                <input type="date" value={plan.last_amended_at ?? ''} onChange={e => set('last_amended_at', e.target.value || null)} disabled={!canEdit} className={inputCls} />
              </Field>
              <Field label="Next review due">
                <input type="date" value={plan.review_due_date ?? ''} onChange={e => set('review_due_date', e.target.value || null)} disabled={!canEdit} className={inputCls} />
              </Field>
            </div>

            <Field label="Notes">
              <textarea value={plan.notes ?? ''} onChange={e => set('notes', e.target.value || null)} rows={2} maxLength={4000} disabled={!canEdit} className={inputCls} />
            </Field>

            {canEdit ? (
              <div className="flex items-center gap-3">
                <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save plan
                </button>
                {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Only a tenant admin can edit this plan.</p>
            )}
          </form>

          {/* QRG preview */}
          {status.hasPlan && (
            <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-5 space-y-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Quick Reference Guide preview</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <Detail label="Facility" value={qrg.facilityName ?? '—'} />
                <Detail label="EPA ID" value={qrg.epaIdNumber ?? '(set on the facility profile)'} />
                <Detail label="Max waste on site" value={qrg.maxWasteQuantity ?? '—'} />
                <Detail label="Prepared" value={qrg.preparedDate} />
              </dl>
              {qrg.emergencyCoordinators.length > 0 && (
                <div className="text-xs">
                  <p className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Coordinators</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {qrg.emergencyCoordinators.map((c, i) => (
                      <li key={i}>{[c.name, c.role, c.phone].filter(Boolean).join(' · ')}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[11px] italic text-slate-500 dark:text-slate-400">{qrg.note}</p>
            </section>
          )}
        </>
      ) : null}
    </main>
  )
}

interface ListField<T> { key: keyof T; placeholder: string }

function ListEditor<T extends object>({
  title, items, canEdit, blank, fields, onChange,
}: {
  title: string
  items: T[]
  canEdit: boolean
  blank: T
  fields: ListField<T>[]
  onChange: (items: T[]) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{title}</span>
        {canEdit && (
          <button type="button" onClick={() => onChange([...items, { ...blank }])} className="inline-flex items-center gap-1 text-xs text-brand-navy hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        )}
      </div>
      {items.length === 0 && <p className="text-xs text-slate-400">None added.</p>}
      {items.map((item, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          {fields.map(f => (
            <input
              key={String(f.key)}
              value={String(item[f.key] ?? '')}
              placeholder={f.placeholder}
              disabled={!canEdit}
              onChange={e => onChange(items.map((it, j) => j === i ? ({ ...it, [f.key]: e.target.value } as T) : it))}
              className="flex-1 min-w-[7rem] rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm disabled:opacity-60"
            />
          ))}
          {canEdit && (
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove" className="text-slate-400 hover:text-rose-600">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/60 disabled:opacity-60'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-slate-800 dark:text-slate-200">{value}</dd>
    </div>
  )
}
