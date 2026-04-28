'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Flame, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import type {
  ConfinedSpacePermit,
  Equipment,
  HotWorkPreChecks,
  HotWorkType,
} from '@/lib/types'
import {
  HOT_WORK_TYPE_LABELS,
} from '@/lib/types'
import { FIRE_EXTINGUISHER_TYPES } from '@/lib/hotWorkChecklist'

// New Hot Work Permit form. Creates a row in pending_signature state —
// the actual sign happens on the detail page once the PAI has reviewed
// everything. This form's job is just to gather the inputs without
// blocking on training-records / multi-party-sign business rules
// (that's the detail page's responsibility).
//
// Default duration: 4 hours. Max: 8 hours (matches the CS permit cap
// and the schema CHECK constraint from migration 019). The form
// clamps client-side so the user gets a friendly error rather than a
// 400 from Postgres.

const MAX_HOURS = 8
const DEFAULT_HOURS = 4

const ALL_WORK_TYPES: HotWorkType[] = [
  'welding', 'cutting', 'grinding', 'soldering', 'brazing', 'torch_roof', 'other',
]

function defaultExpiresAt(): string {
  const d = new Date(Date.now() + DEFAULT_HOURS * 3600_000)
  // Local-time YYYY-MM-DDTHH:MM for <input type="datetime-local">.
  // Using toISOString() would lose the user's timezone preview.
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function NewHotWorkPermitPage() {
  const { profile, loading: authLoading } = useAuth()
  const router = useRouter()

  // ── Core fields ────────────────────────────────────────────────────────
  const [workLocation, setWorkLocation]       = useState('')
  const [workDescription, setWorkDescription] = useState('')
  const [workTypes, setWorkTypes]             = useState<Set<HotWorkType>>(new Set())
  const [expiresAt, setExpiresAt]             = useState<string>(() => defaultExpiresAt())

  // Personnel rosters (newline-separated text fields; same shape as CS)
  const [operators, setOperators]   = useState('')
  const [watchers, setWatchers]     = useState('')

  // Cross-references
  const [associatedCsPermitId, setAssociatedCsPermitId] = useState<string>('')
  const [equipmentId, setEquipmentId]                   = useState('')
  const [workOrderRef, setWorkOrderRef]                 = useState('')

  // Post-watch duration override (NFPA 51B floor is 60)
  const [postWatchMinutes, setPostWatchMinutes] = useState(60)

  // Notes
  const [notes, setNotes] = useState('')

  // ── Pre-work checklist state ───────────────────────────────────────────
  const [checks, setChecks] = useState<HotWorkPreChecks>({})

  // ── Submission state ───────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // ── CS permit picker — only loaded when checklist flags confined_space ─
  const [activeCsPermits, setActiveCsPermits] = useState<ConfinedSpacePermit[]>([])
  const [csLoading, setCsLoading] = useState(false)
  const loadActiveCsPermits = useCallback(async () => {
    setCsLoading(true)
    const { data } = await supabase
      .from('loto_confined_space_permits')
      .select('*')
      .is('canceled_at', null)
      .not('entry_supervisor_signature_at', 'is', null)
      .order('expires_at', { ascending: true })
      .limit(50)
    setActiveCsPermits((data ?? []) as ConfinedSpacePermit[])
    setCsLoading(false)
  }, [])
  useEffect(() => {
    if (checks.confined_space) loadActiveCsPermits()
  }, [checks.confined_space, loadActiveCsPermits])

  // ── Equipment picker — equipment_id is a real FK into loto_equipment.
  //    Earlier versions used a free-text input which produced an opaque
  //    Postgres FK violation when the typed value didn't match any row.
  //    Loaded once on mount; non-decommissioned only.
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([])
  const [equipmentLoading, setEquipmentLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('loto_equipment')
        .select('equipment_id, description, department, decommissioned')
        .eq('decommissioned', false)
        .order('equipment_id', { ascending: true })
        .limit(500)
      if (!cancelled) {
        setEquipmentList((data ?? []) as Equipment[])
        setEquipmentLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Sign in to issue a permit.</div>
  }

  function toggleWorkType(t: HotWorkType) {
    const next = new Set(workTypes)
    if (next.has(t)) next.delete(t); else next.add(t)
    setWorkTypes(next)
  }

  function setCheck<K extends keyof HotWorkPreChecks>(k: K, v: HotWorkPreChecks[K]) {
    setChecks(prev => ({ ...prev, [k]: v }))
  }

  // Form-level validation that matters at INSERT time. The detail-page
  // sign gate enforces compliance — this gate just stops the user from
  // submitting an obviously-incomplete row.
  const expiresMs = new Date(expiresAt).getTime()
  const validExpiry = !Number.isNaN(expiresMs) && expiresMs > Date.now()
  const exceedsMax = validExpiry && (expiresMs - Date.now()) > MAX_HOURS * 3600_000
  const submitErrors: string[] = []
  if (!workLocation.trim())     submitErrors.push('Work location is required.')
  if (!workDescription.trim())  submitErrors.push('Work description is required.')
  if (workTypes.size === 0)     submitErrors.push('Pick at least one work type.')
  if (!validExpiry)             submitErrors.push('Expiry must be in the future.')
  if (exceedsMax)               submitErrors.push(`Permit duration cannot exceed ${MAX_HOURS} hours.`)
  if (postWatchMinutes < 1 || postWatchMinutes > 240) submitErrors.push('Post-watch must be 1–240 minutes.')

  async function handleSubmit() {
    if (submitErrors.length > 0 || !profile?.id) return
    setSubmitting(true)
    setServerError(null)
    const payload = {
      work_location:           workLocation.trim(),
      work_description:        workDescription.trim(),
      work_types:              [...workTypes],
      expires_at:              new Date(expiresAt).toISOString(),
      pai_id:                  profile.id,
      hot_work_operators:      splitLines(operators),
      fire_watch_personnel:    splitLines(watchers),
      pre_work_checks:         checks,
      associated_cs_permit_id: associatedCsPermitId || null,
      equipment_id:            equipmentId.trim() || null,
      work_order_ref:          workOrderRef.trim() || null,
      post_watch_minutes:      postWatchMinutes,
      notes:                   notes.trim() || null,
    }
    const { data, error } = await supabase
      .from('loto_hot_work_permits')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data) {
      setServerError(error?.message ?? 'Could not create permit.')
      setSubmitting(false)
      return
    }
    router.push(`/hot-work/${data.id}`)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center justify-between gap-3">
        <Link href="/hot-work" className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to permits
        </Link>
      </header>

      <div className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Flame className="h-5 w-5 text-rose-600" />
          New Hot Work Permit
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Fill the form, save, then sign on the detail page. Duration capped at {MAX_HOURS} hours per Cal/OSHA §6777.
        </p>
      </div>

      <Section title="Scope">
        <Field label="Work location" hint="e.g. 'Bay 4 south wall, near drum filler'">
          <input
            type="text"
            value={workLocation}
            onChange={e => setWorkLocation(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
        <Field label="Work description" hint="Scope of the work — prints on the permit">
          <textarea
            rows={2}
            value={workDescription}
            onChange={e => setWorkDescription(e.target.value)}
            placeholder="Repair handrail mount; weld new bracket onto frame"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
        <Field label="Work types" hint="Multi-select">
          <div className="flex flex-wrap gap-1.5">
            {ALL_WORK_TYPES.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => toggleWorkType(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  workTypes.has(t)
                    ? 'bg-brand-navy text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {HOT_WORK_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Expires at" hint={`Max ${MAX_HOURS} h from now`}>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>
          <Field label="Post-watch minutes" hint="NFPA 51B floor is 60; some sites bump to 120">
            <input
              type="number"
              min={1}
              max={240}
              value={postWatchMinutes}
              onChange={e => setPostWatchMinutes(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>
        </div>
      </Section>

      <Section title="Personnel">
        <Field label="Hot work operators" hint="One per line — welders, cutters, grinders, etc.">
          <textarea
            rows={3}
            value={operators}
            onChange={e => setOperators(e.target.value)}
            placeholder={'Maria Lopez\nJose García'}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
        <Field label="Fire watch personnel" hint="One per line — must NOT also be operating per Cal/OSHA §6777">
          <textarea
            rows={2}
            value={watchers}
            onChange={e => setWatchers(e.target.value)}
            placeholder="Tomás Reyes"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
      </Section>

      <Section title="Pre-work checklist (FM Global 7-40 / Cal/OSHA §§4848-4853)">
        <CheckRow label="Combustibles cleared or shielded within 35 ft (§4848)"
          value={checks.combustibles_cleared_35ft} onChange={v => setCheck('combustibles_cleared_35ft', v)} />
        <CheckRow label="Floor swept clean for 35 ft radius"
          value={checks.floor_swept} onChange={v => setCheck('floor_swept', v)} />
        <CheckRow label="Floor openings within 35 ft protected"
          value={checks.floor_openings_protected} onChange={v => setCheck('floor_openings_protected', v)} />
        <CheckRow label="Wall openings within 35 ft protected"
          value={checks.wall_openings_protected} onChange={v => setCheck('wall_openings_protected', v)} />
        <CheckRow label="Sprinklers operational (NFPA 51B §6.4.2.1)"
          value={checks.sprinklers_operational} onChange={v => setCheck('sprinklers_operational', v)} />
        {checks.sprinklers_operational === false && (
          <Field label="Alternate protection (sprinklers OUT)" hint="Required when sprinklers are out of service">
            <input
              type="text"
              value={checks.alternate_protection_if_no_spr ?? ''}
              onChange={e => setCheck('alternate_protection_if_no_spr', e.target.value)}
              placeholder="Two ABC extinguishers staged at corners; dedicated watcher."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>
        )}
        <CheckRow label="Ventilation adequate"
          value={checks.ventilation_adequate} onChange={v => setCheck('ventilation_adequate', v)} />
        <CheckRow label="Fire extinguisher present within reach"
          value={checks.fire_extinguisher_present} onChange={v => setCheck('fire_extinguisher_present', v)} />
        {checks.fire_extinguisher_present === true && (
          <Field label="Extinguisher type">
            <select
              value={checks.fire_extinguisher_type ?? ''}
              onChange={e => setCheck('fire_extinguisher_type', e.target.value || null)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            >
              <option value="">— Select —</option>
              {FIRE_EXTINGUISHER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        )}
        <CheckRow label="Fire-resistant curtains / shields in place where needed"
          value={checks.curtains_or_shields_in_place} onChange={v => setCheck('curtains_or_shields_in_place', v)} />
        <CheckRow label="Adjacent areas notified before work begins"
          value={checks.adjacent_areas_notified} onChange={v => setCheck('adjacent_areas_notified', v)} />
        <TriStateRow label="Gas lines isolated (or N/A)"
          value={checks.gas_lines_isolated ?? null}
          onChange={v => setCheck('gas_lines_isolated', v)} />
        <CheckRow label="Hot work is performed inside a confined space"
          value={checks.confined_space} onChange={v => setCheck('confined_space', v)} />
        <CheckRow label="Elevated work (>4 ft / fall-protection required)"
          value={checks.elevated_work} onChange={v => setCheck('elevated_work', v)} />
      </Section>

      {checks.confined_space && (
        <Section title="Linked confined-space permit" hint="§1910.146(f)(15) — required when work is inside a CS">
          {csLoading ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">Loading active CS permits…</p>
          ) : activeCsPermits.length === 0 ? (
            <p className="text-xs text-rose-700 dark:text-rose-300">
              No active confined-space permits found. Create the CS permit first; you can come back here once it's signed.
            </p>
          ) : (
            <select
              value={associatedCsPermitId}
              onChange={e => setAssociatedCsPermitId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            >
              <option value="">— Select an active CS permit —</option>
              {activeCsPermits.map(p => (
                <option key={p.id} value={p.id}>
                  {p.serial} — {p.space_id} (expires {new Date(p.expires_at).toLocaleString()})
                </option>
              ))}
            </select>
          )}
        </Section>
      )}

      <Section title="Optional cross-references">
        <Field label="Equipment" hint="If the work is on a specific machine — surfaces the LOTO procedure">
          {equipmentLoading ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-3 py-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg">Loading equipment…</p>
          ) : equipmentList.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-3 py-2 bg-slate-50 dark:bg-slate-900/40 rounded-lg">
              No active equipment registered. Add equipment in the LOTO module before linking it here.
            </p>
          ) : (
            <select
              value={equipmentId}
              onChange={e => setEquipmentId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy bg-white dark:bg-slate-900"
            >
              <option value="">— No specific equipment —</option>
              {equipmentList.map(eq => (
                <option key={eq.equipment_id} value={eq.equipment_id}>
                  {eq.equipment_id} — {eq.description}
                  {eq.department ? ` (${eq.department})` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Work order ref" hint="CMMS reference — renders as a link if your org has a URL template">
          <input
            type="text"
            value={workOrderRef}
            onChange={e => setWorkOrderRef(e.target.value)}
            placeholder="WO-2026-04-1234"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
        <Field label="Notes (optional)">
          <textarea
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
      </Section>

      {submitErrors.length > 0 && (
        <ul className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 dark:text-amber-100 space-y-0.5">
          {submitErrors.map(e => <li key={e}>• {e}</li>)}
        </ul>
      )}
      {serverError && (
        <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{serverError}</p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link href="/hot-work" className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200">
          Cancel
        </Link>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitErrors.length > 0 || submitting}
          className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
        >
          {submitting ? 'Saving…' : 'Save permit'}
        </button>
      </div>
    </div>
  )
}

// ── Layout helpers ─────────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <header>
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h2>
        {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        {label}
        {hint && <span className="text-slate-400 dark:text-slate-500 font-normal ml-1.5">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

// Tri-state checkbox row used for required boolean checks. undefined =
// not yet answered (empty), true / false = explicit answer. The form
// uses two radio-like buttons so the user has to actively pick one
// rather than missing a checkbox they meant to flip.
function CheckRow({ label, value, onChange }: {
  label:    string
  value:    boolean | undefined
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-t border-slate-100 dark:border-slate-800 first:border-t-0">
      <p className="text-xs text-slate-700 dark:text-slate-300 flex-1">{label}</p>
      <div className="flex items-center gap-1 shrink-0">
        <ChoiceButton active={value === true}  onClick={() => onChange(true)}  label="Yes" tone="emerald" />
        <ChoiceButton active={value === false} onClick={() => onChange(false)} label="No"  tone="rose" />
      </div>
    </div>
  )
}

function TriStateRow({ label, value, onChange }: {
  label:    string
  value:    boolean | null
  onChange: (v: boolean | null) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-t border-slate-100 dark:border-slate-800 first:border-t-0">
      <p className="text-xs text-slate-700 dark:text-slate-300 flex-1">{label}</p>
      <div className="flex items-center gap-1 shrink-0">
        <ChoiceButton active={value === true}  onClick={() => onChange(true)}  label="Yes" tone="emerald" />
        <ChoiceButton active={value === false} onClick={() => onChange(false)} label="No"  tone="rose" />
        <ChoiceButton active={value === null}  onClick={() => onChange(null)}  label="N/A" tone="slate" />
      </div>
    </div>
  )
}

function ChoiceButton({ active, onClick, label, tone }: {
  active:  boolean
  onClick: () => void
  label:   string
  tone:    'emerald' | 'rose' | 'slate'
}) {
  const cls = active
    ? tone === 'emerald' ? 'bg-emerald-600 text-white'
    : tone === 'rose'    ? 'bg-rose-600 text-white'
    :                      'bg-slate-700 text-white'
    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${cls}`}
    >
      {label}
    </button>
  )
}

function splitLines(s: string): string[] {
  return s.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}
