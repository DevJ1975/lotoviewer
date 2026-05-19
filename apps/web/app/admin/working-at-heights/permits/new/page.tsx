'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ScrollText, AlertTriangle, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import {
  FormShell, Field, TextInput, NumberInput, TextArea, Select, TwoCol,
} from '../../_components/FormShell'
import { calculateRequiredClearance, type ClearanceInputs } from '@soteria/core/workingAtHeights'

// Permit issuance form. Gates an at-height task with pre-conditions
// the manual describes:
//   1. Worker holds a current Authorized-Person designation.
//   2. CP holds a current Competent-Person designation.
//   3. Anchor is in_service and (if set) recertification not lapsed.
//   4. Selected components are in_service AND service-life not expired.
//   5. A rescue plan is associated with the work location.
//   6. Clearance calculation produces a SAFE verdict for the chosen
//      system + available clearance.
//   7. Weather check (wind / lightning / cold / heat) is acceptable.
//
// All seven evaluate live as the form is filled; the Save button is
// disabled until every required check passes. The clearance snapshot
// is persisted as JSON on the permit row so a future auditor can see
// the math at issue time.

interface MemberOpt { id: string; display_name: string }
interface AnchorOpt {
  id: string
  asset_tag: string | null
  location_label: string
  status: string
  rated_capacity_lbf: number
  recertification_due_at: string | null
}
interface ComponentOpt {
  id: string
  type: string
  manufacturer: string
  model: string | null
  serial: string
  status: string
  service_expires_at: string | null
}
interface RescuePlanOpt { id: string; location_label: string }
interface AuthRow {
  member_id: string
  role: 'authorized' | 'competent' | 'qualified'
  valid_from: string
  valid_until: string
}

type ClearanceSystem = ClearanceInputs['system']

const SYSTEM_OPTIONS: Array<{ value: ClearanceSystem; label: string }> = [
  { value: 'shock_lanyard', label: 'Shock-absorbing lanyard' },
  { value: 'srl_class1',    label: 'SRL — Class 1 (overhead)' },
  { value: 'srl_class2',    label: 'SRL — Class 2 (leading edge)' },
  { value: 'restraint',     label: 'Restraint (no fall possible)' },
]

// Default permit duration — one shift. The manual recommends explicit
// re-issuance per shift, so 12 hours is the upper bound an issuer should
// pick without justification.
const DEFAULT_DURATION_HOURS = 12

export default function NewPermitPage() {
  const router = useRouter()
  const { tenantId } = useTenant()
  const { profile } = useAuth()

  const [members,    setMembers]    = useState<MemberOpt[]>([])
  const [anchors,    setAnchors]    = useState<AnchorOpt[]>([])
  const [components, setComponents] = useState<ComponentOpt[]>([])
  const [rescuePlans, setRescuePlans] = useState<RescuePlanOpt[]>([])
  const [auths,      setAuths]      = useState<AuthRow[]>([])
  const [loading,    setLoading]    = useState(true)

  // Form fields
  const [workLocation,  setWorkLocation]  = useState('')
  const [taskDesc,      setTaskDesc]      = useState('')
  const [workerId,      setWorkerId]      = useState('')
  const [cpId,          setCpId]          = useState('')
  const [anchorId,      setAnchorId]      = useState('')
  const [componentIds,  setComponentIds]  = useState<string[]>([])
  const [rescuePlanId,  setRescuePlanId]  = useState('')
  const [validHours,    setValidHours]    = useState(DEFAULT_DURATION_HOURS)
  const [notes,         setNotes]         = useState('')

  // Clearance inputs
  const [system,        setSystem]        = useState<ClearanceSystem>('shock_lanyard')
  const [lanyardLength, setLanyardLength] = useState(6)
  const [availableClearance, setAvailableClearance] = useState(20)
  const [swingOffset,   setSwingOffset]   = useState(0)

  // Weather inputs
  const [windMph,       setWindMph]       = useState(8)
  const [lightning,     setLightning]     = useState(false)
  const [tempF,         setTempF]         = useState(70)

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    ;(async () => {
      const [m, a, c, rp, au] = await Promise.all([
        supabase.from('members').select('id, display_name').eq('tenant_id', tenantId).order('display_name'),
        supabase.from('wah_anchors').select('id, asset_tag, location_label, status, rated_capacity_lbf, recertification_due_at').eq('tenant_id', tenantId).order('location_label'),
        supabase.from('wah_components').select('id, type, manufacturer, model, serial, status, service_expires_at').eq('tenant_id', tenantId).order('type'),
        supabase.from('wah_rescue_plans').select('id, location_label').eq('tenant_id', tenantId).order('location_label'),
        supabase.from('wah_authorizations').select('member_id, role, valid_from, valid_until').eq('tenant_id', tenantId),
      ])
      if (cancelled) return
      setMembers((m.data ?? []) as MemberOpt[])
      setAnchors((a.data ?? []) as AnchorOpt[])
      setComponents((c.data ?? []) as ComponentOpt[])
      setRescuePlans((rp.data ?? []) as RescuePlanOpt[])
      setAuths((au.data ?? []) as AuthRow[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [tenantId])

  // ─── Pre-condition evaluation ───────────────────────────────────────────
  // Each check returns a tri-state: ok | warn | fail. `fail` blocks issue;
  // `warn` informs the issuer but doesn't block. The list below is the
  // single source of truth for the badge column and the Save gate.

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  function authValid(memberId: string, role: 'authorized' | 'competent'): boolean {
    return auths.some(a =>
      a.member_id === memberId
      && a.role === role
      && a.valid_from <= today
      && a.valid_until >= today,
    )
  }

  const workerAuthOk = !!workerId && authValid(workerId, 'authorized')
  const cpAuthOk     = !!cpId     && authValid(cpId, 'competent')

  const selectedAnchor = anchors.find(a => a.id === anchorId) ?? null
  const anchorOk = !!selectedAnchor
    && selectedAnchor.status === 'in_service'
    && (!selectedAnchor.recertification_due_at || selectedAnchor.recertification_due_at >= today)

  const selectedComponents = components.filter(c => componentIds.includes(c.id))
  const componentsOk = selectedComponents.length > 0
    && selectedComponents.every(c =>
      c.status === 'in_service'
      && (!c.service_expires_at || c.service_expires_at >= today))

  const rescuePlanOk = !!rescuePlanId

  const clearance = useMemo(() => calculateRequiredClearance({
    system,
    lanyardLengthFt: lanyardLength,
    swingFallOffsetFt: swingOffset,
  }), [system, lanyardLength, swingOffset])

  const clearanceOk = availableClearance >= clearance.requiredClearanceFt

  // Weather gate — explicit go/no-go thresholds the manual cites:
  // sustained wind > 30 mph, any lightning within 10 mi, temp < 0°F or
  // > 110°F. Borderline values warn but don't block.
  const weatherFail = lightning || windMph > 30 || tempF < 0 || tempF > 110
  const weatherWarn = !weatherFail && (windMph > 20 || tempF < 20 || tempF > 95)

  const allChecksOk = workerAuthOk && cpAuthOk && anchorOk && componentsOk
    && rescuePlanOk && clearanceOk && !weatherFail

  const canSubmit = !!tenantId && !!workLocation.trim() && allChecksOk

  function toggleComponent(id: string) {
    setComponentIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function submit() {
    if (!tenantId) return
    const now = new Date()
    const validUntil = new Date(now.getTime() + validHours * 3600 * 1000)
    const permitNumber = `WAH-${now.getFullYear()}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`
    const { error } = await supabase.from('wah_permits').insert({
      tenant_id:             tenantId,
      permit_number:         permitNumber,
      work_location:         workLocation.trim(),
      task_description:      taskDesc.trim() || null,
      worker_id:             workerId,
      cp_id:                 cpId,
      anchor_id:             anchorId  || null,
      components_used:       componentIds,
      rescue_plan_id:        rescuePlanId || null,
      clearance_calculation: {
        system,
        lanyard_length_ft:        lanyardLength,
        swing_offset_ft:          swingOffset,
        available_clearance_ft:   availableClearance,
        required_clearance_ft:    clearance.requiredClearanceFt,
        breakdown:                clearance.breakdown,
        verdict:                  clearanceOk ? 'safe' : 'unsafe',
      },
      weather_check: {
        wind_mph:  windMph,
        lightning,
        temp_f:    tempF,
        verdict:   weatherFail ? 'no_go' : weatherWarn ? 'caution' : 'go',
      },
      valid_from:    now.toISOString(),
      valid_until:   validUntil.toISOString(),
      status:        'active',
      notes:         notes.trim() || null,
      created_by:    profile?.id ?? null,
    })
    if (error) throw new Error(error.message)
    router.push('/admin/working-at-heights/permits')
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" />
          Loading inventory…
        </div>
      </main>
    )
  }

  const memberOptions = [{ value: '', label: '— select —' }, ...members.map(m => ({ value: m.id, label: m.display_name }))]
  const anchorOptions = [
    { value: '', label: '— select —' },
    ...anchors.map(a => ({
      value: a.id,
      label: `${a.location_label}${a.asset_tag ? ` (${a.asset_tag})` : ''} · ${a.rated_capacity_lbf} lbf · ${a.status}`,
    })),
  ]
  const rescueOptions = [
    { value: '', label: '— select —' },
    ...rescuePlans.map(r => ({ value: r.id, label: r.location_label })),
  ]

  return (
    <FormShell
      title="Issue Working-at-Heights Permit"
      description="Pre-condition checklist + clearance snapshot + named CP sign-off before any at-height task."
      Icon={ScrollText}
      backHref="/admin/working-at-heights/permits"
      onSubmit={submit}
      canSubmit={canSubmit}
    >
      <Field label="Work location" required>
        <TextInput value={workLocation} onChange={e => setWorkLocation(e.target.value)} placeholder="Roof North — HVAC unit #4" />
      </Field>
      <Field label="Task description">
        <TextArea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} placeholder="Coil cleaning at the outboard edge — 22 ft above grade, ~3 ft horizontal offset from anchor." />
      </Field>

      <TwoCol>
        <Field label="Worker" required hint="Must hold a current Authorized-Person designation.">
          <Select value={workerId} onChange={e => setWorkerId(e.target.value)} options={memberOptions} />
        </Field>
        <Field label="Competent Person (CP)" required hint="Signs off the permit; supervises the task.">
          <Select value={cpId} onChange={e => setCpId(e.target.value)} options={memberOptions} />
        </Field>
      </TwoCol>

      <Field label="Anchor point" required hint="Engineered or QP-certified anchor; must be in service.">
        <Select value={anchorId} onChange={e => setAnchorId(e.target.value)} options={anchorOptions} />
      </Field>

      <Field label="Components in use" required hint="Tick every harness, lanyard, SRL, or connector on the worker.">
        <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950">
          {components.length === 0 ? (
            <p className="px-2 py-1 text-xs text-slate-500">No components in inventory yet.</p>
          ) : components.map(c => {
            const expired = !!c.service_expires_at && c.service_expires_at < today
            const usable = c.status === 'in_service' && !expired
            return (
              <label key={c.id} className="flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-900">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={componentIds.includes(c.id)}
                  onChange={() => toggleComponent(c.id)}
                />
                <span className="flex-1">
                  <span className="font-medium text-slate-800 dark:text-slate-200">{c.type}</span>
                  <span className="ml-2 font-mono text-xs text-slate-500">{c.serial}</span>
                  <span className="ml-2 text-xs text-slate-500">{c.manufacturer}{c.model ? ` · ${c.model}` : ''}</span>
                  {!usable && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">
                      {expired ? 'expired' : c.status}
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
      </Field>

      <Field label="Rescue plan" required hint="The most-cited fall violation when missing — required by 29 CFR 1926.502(d)(20).">
        <Select value={rescuePlanId} onChange={e => setRescuePlanId(e.target.value)} options={rescueOptions} />
      </Field>

      <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Fall clearance</legend>
        <TwoCol>
          <Field label="System">
            <Select value={system} onChange={e => setSystem(e.target.value as ClearanceSystem)} options={SYSTEM_OPTIONS} />
          </Field>
          <Field label="Available clearance (ft)" hint="Anchor height above next walking surface.">
            <NumberInput min={0} step={0.5} value={availableClearance} onChange={e => setAvailableClearance(Number(e.target.value))} />
          </Field>
        </TwoCol>
        {system === 'shock_lanyard' && (
          <TwoCol>
            <Field label="Lanyard length (ft)">
              <NumberInput min={1} max={12} step={0.5} value={lanyardLength} onChange={e => setLanyardLength(Number(e.target.value))} />
            </Field>
            <Field label="Swing-fall offset (ft)" hint="Horizontal distance from worker to a point under the anchor.">
              <NumberInput min={0} step={0.5} value={swingOffset} onChange={e => setSwingOffset(Number(e.target.value))} />
            </Field>
          </TwoCol>
        )}
        <div className={`mt-3 rounded-md border-l-4 px-3 py-2 text-sm ${clearanceOk ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' : 'border-rose-500 bg-rose-50 dark:bg-rose-950/30'}`}>
          <p className="font-bold">
            {clearanceOk ? 'SAFE — clearance is sufficient.' : 'UNSAFE — insufficient clearance.'}
          </p>
          <p className="mt-0.5 text-xs">
            Required {clearance.requiredClearanceFt.toFixed(1)} ft · available {availableClearance.toFixed(1)} ft
          </p>
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Weather check</legend>
        <TwoCol>
          <Field label="Sustained wind (mph)" hint="No-go above 30 mph.">
            <NumberInput min={0} max={120} value={windMph} onChange={e => setWindMph(Number(e.target.value))} />
          </Field>
          <Field label="Air temperature (°F)" hint="No-go below 0 or above 110.">
            <NumberInput min={-40} max={130} value={tempF} onChange={e => setTempF(Number(e.target.value))} />
          </Field>
        </TwoCol>
        <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input type="checkbox" className="h-4 w-4" checked={lightning} onChange={e => setLightning(e.target.checked)} />
          Lightning detected within 10 mi (auto-halt)
        </label>
        {weatherFail && (
          <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
            <strong>No-go</strong> — weather conditions exceed permit thresholds.
          </p>
        )}
        {weatherWarn && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <strong>Caution</strong> — conditions approaching limits; brief the crew.
          </p>
        )}
      </fieldset>

      <Field label="Permit duration (hours)" hint="One-shift authorisation. Re-issue for each new shift.">
        <NumberInput min={1} max={24} value={validHours} onChange={e => setValidHours(Number(e.target.value))} />
      </Field>
      <Field label="Notes">
        <TextArea value={notes} onChange={e => setNotes(e.target.value)} />
      </Field>

      <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Pre-condition checklist</legend>
        <ul className="space-y-1.5 text-sm">
          <CheckRow ok={workerAuthOk}      label="Worker holds current Authorized-Person designation" />
          <CheckRow ok={cpAuthOk}          label="CP holds current Competent-Person designation" />
          <CheckRow ok={anchorOk}          label="Anchor in service + recertification not lapsed" />
          <CheckRow ok={componentsOk}      label="Components in service + service life not expired" />
          <CheckRow ok={rescuePlanOk}      label="Rescue plan associated" />
          <CheckRow ok={clearanceOk}       label="Clearance verdict is SAFE" />
          <CheckRow ok={!weatherFail}      label="Weather check clears" warn={weatherWarn} />
        </ul>
        {!allChecksOk && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            All checks must pass before the permit can be issued. The form gates this automatically.
          </p>
        )}
      </fieldset>
    </FormShell>
  )
}

function CheckRow({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${warn ? 'text-amber-500' : 'text-emerald-600'}`} />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />
      )}
      <span className={ok ? 'text-slate-700 dark:text-slate-300' : 'text-rose-700 dark:text-rose-300'}>
        {label}
      </span>
    </li>
  )
}
