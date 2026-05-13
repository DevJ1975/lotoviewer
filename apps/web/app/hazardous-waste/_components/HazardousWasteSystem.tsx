'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  BookOpen,
  Barrel,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Loader2,
  Plus,
  Recycle,
  RefreshCw,
  Truck,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  computeHazardousWasteInspectionResult,
  getChecksForArea,
  HAZARDOUS_WASTE_ACTION_PRIORITY_LABEL,
  HAZARDOUS_WASTE_AREA_LABEL,
  HAZARDOUS_WASTE_CALENDAR,
  HAZARDOUS_WASTE_CONTAINER_STATUS_LABEL,
  HAZARDOUS_WASTE_DETERMINATION_STATUS_LABEL,
  HAZARDOUS_WASTE_FIELD_CHECKS,
  HAZARDOUS_WASTE_GENERATOR_CATEGORY_LABEL,
  HAZARDOUS_WASTE_INSPECTION_RESULT_LABEL,
  HAZARDOUS_WASTE_PHYSICAL_STATE_LABEL,
  HAZARDOUS_WASTE_SHIPMENT_STATUS_LABEL,
  isHazardousWasteAreaInspectionDue,
  parseHazardousWasteDelimitedList,
  type HazardousWasteActionPriority,
  type HazardousWasteActionStatus,
  type HazardousWasteAreaType,
  type HazardousWasteContainerStatus,
  type HazardousWasteDeterminationStatus,
  type HazardousWasteGeneratorCategory,
  type HazardousWasteInspectionResult,
  type HazardousWastePhysicalState,
  type HazardousWasteShipmentStatus,
} from '@soteria/core/hazardousWaste'

const AREA_TYPES: HazardousWasteAreaType[] = [
  'satellite_accumulation',
  'central_accumulation',
  'universal_waste',
  'used_oil',
  'inspection_only',
]

const GENERATOR_CATEGORIES: HazardousWasteGeneratorCategory[] = ['unknown', 'vsqg', 'sqg', 'lqg']
const PHYSICAL_STATES: HazardousWastePhysicalState[] = ['unknown', 'solid', 'liquid', 'sludge', 'gas', 'mixed']
const STREAM_STATUSES: HazardousWasteDeterminationStatus[] = ['draft', 'pending_review', 'approved', 'archived']
const CONTAINER_STATUSES: HazardousWasteContainerStatus[] = ['accumulating', 'ready_for_pickup', 'shipped', 'closed', 'archived']
const SHIPMENT_STATUSES: HazardousWasteShipmentStatus[] = ['planned', 'shipped', 'return_copy_due', 'closed', 'cancelled']

interface FacilityProfile {
  id: string
  tenant_id: string
  facility_name: string
  epa_id: string | null
  state_generator_id: string | null
  generator_category: HazardousWasteGeneratorCategory
  emergency_phone: string | null
  emergency_coordinator: string | null
  cupa_agency: string | null
  notes: string | null
}

interface WasteStream {
  id: string
  tenant_id: string
  name: string
  generating_process: string | null
  physical_state: HazardousWastePhysicalState
  hazards: string[]
  waste_codes: string[]
  determination_basis: string | null
  determination_status: HazardousWasteDeterminationStatus
  reviewed_by_name: string | null
  reviewed_at: string | null
  next_review_date: string | null
  updated_at: string
}

interface AccumulationArea {
  id: string
  tenant_id: string
  name: string
  area_type: HazardousWasteAreaType
  location_details: string | null
  owner_name: string | null
  backup_owner_name: string | null
  inspection_cadence_days: number
  site_notes: string | null
  active: boolean
  last_inspected_at: string | null
  updated_at: string
}

interface WasteContainer {
  id: string
  tenant_id: string
  area_id: string
  waste_stream_id: string | null
  label_id: string
  waste_description: string | null
  container_type: string | null
  capacity: number | null
  capacity_unit: string | null
  accumulation_start_date: string | null
  status: HazardousWasteContainerStatus
  hazard_flags: string[]
  last_inspected_at: string | null
  notes: string | null
  updated_at: string
}

interface WasteInspection {
  id: string
  tenant_id: string
  area_id: string
  container_id: string | null
  inspector_id: string | null
  inspected_at: string
  result: HazardousWasteInspectionResult
  checked_ids: string[]
  flagged_ids: string[]
  observations: string | null
  follow_up_notes: string | null
}

interface CorrectiveAction {
  id: string
  tenant_id: string
  inspection_id: string | null
  area_id: string | null
  container_id: string | null
  title: string
  description: string | null
  priority: HazardousWasteActionPriority
  status: HazardousWasteActionStatus
  due_at: string | null
  assigned_to_name: string | null
  resolved_at: string | null
  updated_at: string
}

interface Shipment {
  id: string
  tenant_id: string
  shipment_number: string
  manifest_tracking_number: string | null
  transporter_name: string | null
  tsdf_name: string | null
  shipped_at: string | null
  expected_return_copy_due_at: string | null
  returned_copy_received_at: string | null
  status: HazardousWasteShipmentStatus
  notes: string | null
  updated_at: string
}

interface HazardousWasteState {
  profile: FacilityProfile | null
  streams: WasteStream[]
  areas: AccumulationArea[]
  containers: WasteContainer[]
  inspections: WasteInspection[]
  actions: CorrectiveAction[]
  shipments: Shipment[]
}

const EMPTY_STATE: HazardousWasteState = {
  profile: null,
  streams: [],
  areas: [],
  containers: [],
  inspections: [],
  actions: [],
  shipments: [],
}

export default function HazardousWasteSystem() {
  const { tenant } = useTenant()
  const { userId } = useAuth()
  const tenantId = tenant?.id ?? null

  const [state, setState] = useState<HazardousWasteState>(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inspectionAreaId, setInspectionAreaId] = useState('')

  const load = useCallback(async () => {
    if (!tenantId) {
      setState(EMPTY_STATE)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [
        profileRes,
        streamRes,
        areaRes,
        containerRes,
        inspectionRes,
        actionRes,
        shipmentRes,
      ] = await Promise.all([
        supabase
          .from('hazardous_waste_facility_profiles')
          .select('*')
          .eq('tenant_id', tenantId)
          .maybeSingle(),
        supabase
          .from('hazardous_waste_streams')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('updated_at', { ascending: false })
          .limit(100),
        supabase
          .from('hazardous_waste_accumulation_areas')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('active', { ascending: false })
          .order('name', { ascending: true })
          .limit(100),
        supabase
          .from('hazardous_waste_containers')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('updated_at', { ascending: false })
          .limit(150),
        supabase
          .from('hazardous_waste_inspections')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('inspected_at', { ascending: false })
          .limit(30),
        supabase
          .from('hazardous_waste_corrective_actions')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('updated_at', { ascending: false })
          .limit(60),
        supabase
          .from('hazardous_waste_shipments')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('updated_at', { ascending: false })
          .limit(50),
      ])

      const queryError =
        profileRes.error ||
        streamRes.error ||
        areaRes.error ||
        containerRes.error ||
        inspectionRes.error ||
        actionRes.error ||
        shipmentRes.error
      if (queryError) throw queryError

      setState({
        profile: (profileRes.data ?? null) as FacilityProfile | null,
        streams: (streamRes.data ?? []) as WasteStream[],
        areas: (areaRes.data ?? []) as AccumulationArea[],
        containers: (containerRes.data ?? []) as WasteContainer[],
        inspections: (inspectionRes.data ?? []) as WasteInspection[],
        actions: (actionRes.data ?? []) as CorrectiveAction[],
        shipments: (shipmentRes.data ?? []) as Shipment[],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState(EMPTY_STATE)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  const areaById = useMemo(() => new Map(state.areas.map(area => [area.id, area])), [state.areas])
  const streamById = useMemo(() => new Map(state.streams.map(stream => [stream.id, stream])), [state.streams])

  const metrics = useMemo(() => {
    const activeContainers = state.containers.filter(container =>
      container.status === 'accumulating' || container.status === 'ready_for_pickup',
    ).length
    const overdueAreas = state.areas.filter(area => isHazardousWasteAreaInspectionDue({
      active: area.active,
      inspectionCadenceDays: area.inspection_cadence_days,
      lastInspectedAt: area.last_inspected_at,
    })).length
    const openActions = state.actions.filter(action => action.status === 'open' || action.status === 'in_progress').length
    const manifestExceptions = state.shipments.filter(shipment => shipment.status === 'return_copy_due').length
    return {
      activeContainers,
      overdueAreas,
      openActions,
      approvedStreams: state.streams.filter(stream => stream.determination_status === 'approved').length,
      recentInspections: state.inspections.length,
      manifestExceptions,
    }
  }, [state.actions, state.areas, state.containers, state.inspections.length, state.shipments, state.streams])

  function requireTenant(): string {
    if (!tenantId) throw new Error('Select an active tenant before changing hazardous waste records.')
    return tenantId
  }

  async function runMutation(name: string, work: () => Promise<void>) {
    setSaving(name)
    setError(null)
    try {
      await work()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  async function saveFacilityProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await runMutation('facility', async () => {
      const activeTenantId = requireTenant()
      const facilityName = getRequired(form, 'facility_name')
      const payload = {
        tenant_id: activeTenantId,
        facility_name: facilityName,
        epa_id: getOptional(form, 'epa_id'),
        state_generator_id: getOptional(form, 'state_generator_id'),
        generator_category: form.get('generator_category') as HazardousWasteGeneratorCategory,
        emergency_phone: getOptional(form, 'emergency_phone'),
        emergency_coordinator: getOptional(form, 'emergency_coordinator'),
        cupa_agency: getOptional(form, 'cupa_agency'),
        notes: getOptional(form, 'notes'),
        updated_by: userId,
        created_by: state.profile?.id ? undefined : userId,
      }
      const { error: upsertError } = await supabase
        .from('hazardous_waste_facility_profiles')
        .upsert(payload, { onConflict: 'tenant_id' })
      if (upsertError) throw upsertError
    })
  }

  async function addWasteStream(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(target)
    await runMutation('stream', async () => {
      const activeTenantId = requireTenant()
      const { error: insertError } = await supabase.from('hazardous_waste_streams').insert({
        tenant_id: activeTenantId,
        name: getRequired(form, 'name'),
        generating_process: getOptional(form, 'generating_process'),
        physical_state: form.get('physical_state') as HazardousWastePhysicalState,
        hazards: parseHazardousWasteDelimitedList(getOptional(form, 'hazards') ?? ''),
        waste_codes: parseHazardousWasteDelimitedList(getOptional(form, 'waste_codes') ?? ''),
        determination_basis: getOptional(form, 'determination_basis'),
        determination_status: form.get('determination_status') as HazardousWasteDeterminationStatus,
        next_review_date: getOptional(form, 'next_review_date'),
        created_by: userId,
        updated_by: userId,
      })
      if (insertError) throw insertError
      target.reset()
    })
  }

  async function addArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(target)
    await runMutation('area', async () => {
      const activeTenantId = requireTenant()
      const cadence = Number(form.get('inspection_cadence_days') ?? 7)
      const { error: insertError } = await supabase.from('hazardous_waste_accumulation_areas').insert({
        tenant_id: activeTenantId,
        name: getRequired(form, 'name'),
        area_type: form.get('area_type') as HazardousWasteAreaType,
        location_details: getOptional(form, 'location_details'),
        owner_name: getOptional(form, 'owner_name'),
        backup_owner_name: getOptional(form, 'backup_owner_name'),
        inspection_cadence_days: Number.isFinite(cadence) ? cadence : 7,
        site_notes: getOptional(form, 'site_notes'),
        created_by: userId,
        updated_by: userId,
      })
      if (insertError) throw insertError
      target.reset()
    })
  }

  async function addContainer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(target)
    await runMutation('container', async () => {
      const activeTenantId = requireTenant()
      const areaId = getRequired(form, 'area_id')
      const capacityValue = Number(form.get('capacity') ?? '')
      const { error: insertError } = await supabase.from('hazardous_waste_containers').insert({
        tenant_id: activeTenantId,
        area_id: areaId,
        waste_stream_id: getOptional(form, 'waste_stream_id'),
        label_id: getRequired(form, 'label_id'),
        waste_description: getOptional(form, 'waste_description'),
        container_type: getOptional(form, 'container_type'),
        capacity: Number.isFinite(capacityValue) ? capacityValue : null,
        capacity_unit: getOptional(form, 'capacity_unit'),
        accumulation_start_date: getOptional(form, 'accumulation_start_date'),
        status: form.get('status') as HazardousWasteContainerStatus,
        hazard_flags: parseHazardousWasteDelimitedList(getOptional(form, 'hazard_flags') ?? ''),
        notes: getOptional(form, 'notes'),
        created_by: userId,
        updated_by: userId,
      })
      if (insertError) throw insertError
      target.reset()
    })
  }

  async function submitInspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(target)
    await runMutation('inspection', async () => {
      const activeTenantId = requireTenant()
      const areaId = getRequired(form, 'area_id')
      const area = areaById.get(areaId)
      if (!area) throw new Error('Select a valid accumulation area.')

      const checkedIds = form.getAll('checked_ids').map(String)
      const flaggedIds = form.getAll('flagged_ids').map(String)
      const summary = computeHazardousWasteInspectionResult({
        areaType: area.area_type,
        checkedIds,
        flaggedIds,
      })
      const containerId = getOptional(form, 'container_id')
      const observations = getOptional(form, 'observations')
      const followUp = getOptional(form, 'follow_up_notes')
      const inspectedAt = new Date().toISOString()

      const { data: inspection, error: inspectionError } = await supabase
        .from('hazardous_waste_inspections')
        .insert({
          tenant_id: activeTenantId,
          area_id: areaId,
          container_id: containerId,
          inspector_id: userId,
          inspected_at: inspectedAt,
          result: summary.result,
          checked_ids: checkedIds,
          flagged_ids: flaggedIds,
          observations,
          follow_up_notes: followUp,
        })
        .select('id')
        .single()
      if (inspectionError) throw inspectionError

      const { error: areaError } = await supabase
        .from('hazardous_waste_accumulation_areas')
        .update({ last_inspected_at: inspectedAt, updated_by: userId })
        .eq('id', areaId)
        .eq('tenant_id', activeTenantId)
      if (areaError) throw areaError

      if (containerId) {
        const { error: containerError } = await supabase
          .from('hazardous_waste_containers')
          .update({ last_inspected_at: inspectedAt, updated_by: userId })
          .eq('id', containerId)
          .eq('tenant_id', activeTenantId)
        if (containerError) throw containerError
      }

      if (summary.result !== 'pass') {
        const priority: HazardousWasteActionPriority = summary.flaggedCritical > 0 ? 'critical' : 'high'
        const title = summary.flaggedCritical > 0
          ? 'Critical hazardous waste inspection finding'
          : 'Hazardous waste inspection follow-up'
        const { error: actionError } = await supabase.from('hazardous_waste_corrective_actions').insert({
          tenant_id: activeTenantId,
          inspection_id: (inspection as { id: string }).id,
          area_id: areaId,
          container_id: containerId,
          title,
          description: followUp ?? observations ?? `${summary.flagged} item(s) flagged during inspection.`,
          priority,
          status: 'open',
          created_by: userId,
          updated_by: userId,
        })
        if (actionError) throw actionError
      }

      target.reset()
    })
  }

  async function addShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(target)
    await runMutation('shipment', async () => {
      const activeTenantId = requireTenant()
      const { error: insertError } = await supabase.from('hazardous_waste_shipments').insert({
        tenant_id: activeTenantId,
        shipment_number: getRequired(form, 'shipment_number'),
        manifest_tracking_number: getOptional(form, 'manifest_tracking_number'),
        transporter_name: getOptional(form, 'transporter_name'),
        tsdf_name: getOptional(form, 'tsdf_name'),
        shipped_at: getOptional(form, 'shipped_at'),
        expected_return_copy_due_at: getOptional(form, 'expected_return_copy_due_at'),
        returned_copy_received_at: getOptional(form, 'returned_copy_received_at'),
        status: form.get('status') as HazardousWasteShipmentStatus,
        notes: getOptional(form, 'notes'),
        created_by: userId,
        updated_by: userId,
      })
      if (insertError) throw insertError
      target.reset()
    })
  }

  async function resolveAction(actionId: string) {
    await runMutation(`action-${actionId}`, async () => {
      const activeTenantId = requireTenant()
      const { error: updateError } = await supabase
        .from('hazardous_waste_corrective_actions')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq('tenant_id', activeTenantId)
        .eq('id', actionId)
      if (updateError) throw updateError
    })
  }

  const activeAreas = state.areas.filter(area => area.active)
  const activeContainers = state.containers.filter(container =>
    container.status === 'accumulating' || container.status === 'ready_for_pickup',
  )
  const selectedInspectionArea =
    activeAreas.find(area => area.id === inspectionAreaId) ?? activeAreas[0]
  const defaultInspectionChecks = selectedInspectionArea ? getChecksForArea(selectedInspectionArea.area_type) : HAZARDOUS_WASTE_FIELD_CHECKS

  useEffect(() => {
    if (!selectedInspectionArea) {
      setInspectionAreaId('')
      return
    }
    if (inspectionAreaId !== selectedInspectionArea.id) {
      setInspectionAreaId(selectedInspectionArea.id)
    }
  }, [inspectionAreaId, selectedInspectionArea])

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Hazardous Waste</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Waste determinations, accumulation areas, containers, inspections, corrective actions, and manifest tracking.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <Link
            href="/manuals/hazardous-waste"
            className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90"
          >
            <BookOpen className="h-4 w-4" />
            Open manual
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 p-6 text-sm text-slate-500 dark:border-slate-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading hazardous waste records...
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Metric icon={Barrel} label="Active containers" value={metrics.activeContainers} tone="amber" />
            <Metric icon={AlertTriangle} label="Overdue areas" value={metrics.overdueAreas} tone={metrics.overdueAreas > 0 ? 'red' : 'green'} />
            <Metric icon={ClipboardCheck} label="Recent inspections" value={metrics.recentInspections} tone="blue" />
            <Metric icon={CheckCircle2} label="Approved streams" value={metrics.approvedStreams} tone="green" />
            <Metric icon={FileText} label="Open actions" value={metrics.openActions} tone={metrics.openActions > 0 ? 'red' : 'slate'} />
            <Metric icon={Truck} label="Manifest exceptions" value={metrics.manifestExceptions} tone={metrics.manifestExceptions > 0 ? 'red' : 'slate'} />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Panel title="Facility Profile" subtitle="Reusable generator data for packets and inspections.">
              <form onSubmit={saveFacilityProfile} className="grid gap-3 sm:grid-cols-2">
                <Field label="Facility name" required>
                  <input name="facility_name" required defaultValue={state.profile?.facility_name ?? tenant?.name ?? ''} className={inputClass} />
                </Field>
                <Field label="Generator category">
                  <select name="generator_category" defaultValue={state.profile?.generator_category ?? 'unknown'} className={inputClass}>
                    {GENERATOR_CATEGORIES.map(category => (
                      <option key={category} value={category}>{HAZARDOUS_WASTE_GENERATOR_CATEGORY_LABEL[category]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="EPA ID">
                  <input name="epa_id" defaultValue={state.profile?.epa_id ?? ''} className={inputClass} />
                </Field>
                <Field label="State generator ID">
                  <input name="state_generator_id" defaultValue={state.profile?.state_generator_id ?? ''} className={inputClass} />
                </Field>
                <Field label="Emergency phone">
                  <input name="emergency_phone" defaultValue={state.profile?.emergency_phone ?? ''} className={inputClass} />
                </Field>
                <Field label="Emergency coordinator">
                  <input name="emergency_coordinator" defaultValue={state.profile?.emergency_coordinator ?? ''} className={inputClass} />
                </Field>
                <Field label="CUPA/local agency">
                  <input name="cupa_agency" defaultValue={state.profile?.cupa_agency ?? ''} className={inputClass} />
                </Field>
                <Field label="Notes">
                  <input name="notes" defaultValue={state.profile?.notes ?? ''} className={inputClass} />
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton saving={saving === 'facility'} label="Save profile" />
                </div>
              </form>
            </Panel>

            <Panel title="Compliance Calendar" subtitle="Static rules until tenant-specific reminders are configured.">
              <div className="space-y-2">
                {HAZARDOUS_WASTE_CALENDAR.slice(0, 4).map(item => (
                  <div key={item.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex items-start gap-2">
                      <CalendarClock className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-300" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{item.dueRule}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Panel title="Waste Streams" subtitle="Determinations and waste codes.">
              <form onSubmit={addWasteStream} className="space-y-3">
                <Field label="Stream name" required>
                  <input name="name" required placeholder="Spent solvent from Line 2" className={inputClass} />
                </Field>
                <Field label="Generating process">
                  <input name="generating_process" placeholder="Cleaning, lab prep, maintenance..." className={inputClass} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Physical state">
                    <select name="physical_state" className={inputClass} defaultValue="unknown">
                      {PHYSICAL_STATES.map(stateValue => (
                        <option key={stateValue} value={stateValue}>{HAZARDOUS_WASTE_PHYSICAL_STATE_LABEL[stateValue]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select name="determination_status" className={inputClass} defaultValue="draft">
                      {STREAM_STATUSES.map(status => (
                        <option key={status} value={status}>{HAZARDOUS_WASTE_DETERMINATION_STATUS_LABEL[status]}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Hazards">
                  <input name="hazards" placeholder="flammable, corrosive" className={inputClass} />
                </Field>
                <Field label="Waste codes">
                  <input name="waste_codes" placeholder="D001, D002" className={inputClass} />
                </Field>
                <Field label="Determination basis">
                  <textarea name="determination_basis" rows={3} className={inputClass} />
                </Field>
                <Field label="Next review date">
                  <input name="next_review_date" type="date" className={inputClass} />
                </Field>
                <SubmitButton saving={saving === 'stream'} label="Add stream" icon={Plus} />
              </form>
            </Panel>

            <Panel title="Accumulation Areas" subtitle="Locations and inspection cadence.">
              <form onSubmit={addArea} className="space-y-3">
                <Field label="Area name" required>
                  <input name="name" required placeholder="Line 2 satellite drum" className={inputClass} />
                </Field>
                <Field label="Area type">
                  <select name="area_type" className={inputClass} defaultValue="satellite_accumulation">
                    {AREA_TYPES.map(areaType => (
                      <option key={areaType} value={areaType}>{HAZARDOUS_WASTE_AREA_LABEL[areaType]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Location details">
                  <input name="location_details" placeholder="Building, room, line, yard..." className={inputClass} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Owner">
                    <input name="owner_name" className={inputClass} />
                  </Field>
                  <Field label="Cadence days">
                    <input name="inspection_cadence_days" type="number" min={1} max={366} defaultValue={7} className={inputClass} />
                  </Field>
                </div>
                <Field label="Backup owner">
                  <input name="backup_owner_name" className={inputClass} />
                </Field>
                <Field label="Site notes">
                  <textarea name="site_notes" rows={3} className={inputClass} />
                </Field>
                <SubmitButton saving={saving === 'area'} label="Add area" icon={Plus} />
              </form>
            </Panel>

            <Panel title="Containers" subtitle="Physical drums, totes, bottles, and used-oil units.">
              <form onSubmit={addContainer} className="space-y-3">
                <Field label="Area" required>
                  <select name="area_id" required className={inputClass} defaultValue="">
                    <option value="" disabled>Select area</option>
                    {activeAreas.map(area => (
                      <option key={area.id} value={area.id}>{area.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Waste stream">
                  <select name="waste_stream_id" className={inputClass} defaultValue="">
                    <option value="">Unassigned</option>
                    {state.streams.map(stream => (
                      <option key={stream.id} value={stream.id}>{stream.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Label or container ID" required>
                  <input name="label_id" required placeholder="HW-DRUM-001" className={inputClass} />
                </Field>
                <Field label="Waste description">
                  <input name="waste_description" className={inputClass} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Type">
                    <input name="container_type" placeholder="55 gal drum" className={inputClass} />
                  </Field>
                  <Field label="Capacity">
                    <input name="capacity" type="number" min={0} step="0.01" className={inputClass} />
                  </Field>
                  <Field label="Unit">
                    <select name="capacity_unit" className={inputClass} defaultValue="">
                      <option value="">Unit</option>
                      {['gal', 'L', 'mL', 'kg', 'g', 'lb', 'oz', 'yd3', 'ea', 'other'].map(unit => (
                        <option key={unit} value={unit}>{unit}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Accumulation start">
                    <input name="accumulation_start_date" type="date" className={inputClass} />
                  </Field>
                  <Field label="Status">
                    <select name="status" className={inputClass} defaultValue="accumulating">
                      {CONTAINER_STATUSES.map(status => (
                        <option key={status} value={status}>{HAZARDOUS_WASTE_CONTAINER_STATUS_LABEL[status]}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Hazard flags">
                  <input name="hazard_flags" placeholder="flammable, toxic" className={inputClass} />
                </Field>
                <Field label="Notes">
                  <textarea name="notes" rows={3} className={inputClass} />
                </Field>
                <SubmitButton saving={saving === 'container'} label="Add container" icon={Plus} />
              </form>
            </Panel>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Panel title="Submit Inspection" subtitle="Writes an official inspection record and opens an action for findings.">
              {activeAreas.length === 0 ? (
                <EmptyText>Add an accumulation area before submitting inspections.</EmptyText>
              ) : (
                <form onSubmit={submitInspection} className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Area" required>
                      <select
                        name="area_id"
                        required
                        className={inputClass}
                        value={selectedInspectionArea?.id ?? ''}
                        onChange={event => setInspectionAreaId(event.target.value)}
                      >
                        {activeAreas.map(area => (
                          <option key={area.id} value={area.id}>{area.name} - {HAZARDOUS_WASTE_AREA_LABEL[area.area_type]}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Container">
                      <select name="container_id" className={inputClass} defaultValue="">
                        <option value="">Area-level inspection</option>
                        {activeContainers.map(container => (
                          <option key={container.id} value={container.id}>{container.label_id}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="space-y-2">
                    {defaultInspectionChecks.map(check => (
                      <div key={check.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{check.label}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{check.detail}</p>
                          </div>
                          <div className="flex shrink-0 gap-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
                            <label className="inline-flex items-center gap-1">
                              <input type="checkbox" name="checked_ids" value={check.id} className="rounded" />
                              Checked
                            </label>
                            <label className="inline-flex items-center gap-1">
                              <input type="checkbox" name="flagged_ids" value={check.id} className="rounded" />
                              {check.critical ? 'Critical flag' : 'Flag'}
                            </label>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Field label="Observations">
                    <textarea name="observations" rows={3} className={inputClass} />
                  </Field>
                  <Field label="Follow-up notes">
                    <textarea name="follow_up_notes" rows={3} placeholder="What must happen next?" className={inputClass} />
                  </Field>
                  <SubmitButton saving={saving === 'inspection'} label="Submit inspection" icon={ClipboardCheck} />
                </form>
              )}
            </Panel>

            <Panel title="Open Corrective Actions" subtitle="Critical findings stay visible until resolved.">
              <div className="space-y-2">
                {state.actions.filter(action => action.status === 'open' || action.status === 'in_progress').length === 0 && (
                  <EmptyText>No open hazardous waste actions.</EmptyText>
                )}
                {state.actions
                  .filter(action => action.status === 'open' || action.status === 'in_progress')
                  .slice(0, 8)
                  .map(action => (
                    <div key={action.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{action.title}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {HAZARDOUS_WASTE_ACTION_PRIORITY_LABEL[action.priority]} priority
                            {action.area_id && areaById.get(action.area_id) ? ` - ${areaById.get(action.area_id)?.name}` : ''}
                          </p>
                          {action.description && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{action.description}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => void resolveAction(action.id)}
                          disabled={saving === `action-${action.id}`}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                        >
                          Resolve
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </Panel>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <Panel title="Active Records" subtitle="Current areas, containers, and waste streams.">
              <div className="space-y-4">
                <RecordList
                  title="Areas"
                  empty="No accumulation areas yet."
                  rows={state.areas.slice(0, 8).map(area => ({
                    id: area.id,
                    title: area.name,
                    meta: `${HAZARDOUS_WASTE_AREA_LABEL[area.area_type]} - ${area.inspection_cadence_days} day cadence`,
                    badge: isHazardousWasteAreaInspectionDue({
                      active: area.active,
                      inspectionCadenceDays: area.inspection_cadence_days,
                      lastInspectedAt: area.last_inspected_at,
                    }) ? 'Due' : 'Current',
                  }))}
                />
                <RecordList
                  title="Containers"
                  empty="No containers yet."
                  rows={state.containers.slice(0, 8).map(container => ({
                    id: container.id,
                    title: container.label_id,
                    meta: `${areaById.get(container.area_id)?.name ?? 'Unknown area'} - ${streamById.get(container.waste_stream_id ?? '')?.name ?? container.waste_description ?? 'No stream assigned'}`,
                    badge: HAZARDOUS_WASTE_CONTAINER_STATUS_LABEL[container.status],
                  }))}
                />
                <RecordList
                  title="Waste streams"
                  empty="No waste streams yet."
                  rows={state.streams.slice(0, 8).map(stream => ({
                    id: stream.id,
                    title: stream.name,
                    meta: [stream.waste_codes.join(', '), stream.hazards.join(', ')].filter(Boolean).join(' - ') || 'No codes or hazards recorded',
                    badge: HAZARDOUS_WASTE_DETERMINATION_STATUS_LABEL[stream.determination_status],
                  }))}
                />
              </div>
            </Panel>

            <Panel title="Shipments & Manifests" subtitle="Preparation and return-copy tracking foundation.">
              <form onSubmit={addShipment} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Shipment number" required>
                    <input name="shipment_number" required placeholder="HW-2026-001" className={inputClass} />
                  </Field>
                  <Field label="Status">
                    <select name="status" className={inputClass} defaultValue="planned">
                      {SHIPMENT_STATUSES.map(status => (
                        <option key={status} value={status}>{HAZARDOUS_WASTE_SHIPMENT_STATUS_LABEL[status]}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Manifest tracking number">
                  <input name="manifest_tracking_number" className={inputClass} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Transporter">
                    <input name="transporter_name" className={inputClass} />
                  </Field>
                  <Field label="TSDF">
                    <input name="tsdf_name" className={inputClass} />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Shipped">
                    <input name="shipped_at" type="date" className={inputClass} />
                  </Field>
                  <Field label="Return due">
                    <input name="expected_return_copy_due_at" type="date" className={inputClass} />
                  </Field>
                  <Field label="Return received">
                    <input name="returned_copy_received_at" type="date" className={inputClass} />
                  </Field>
                </div>
                <Field label="Notes">
                  <textarea name="notes" rows={3} className={inputClass} />
                </Field>
                <SubmitButton saving={saving === 'shipment'} label="Add shipment" icon={Truck} />
              </form>
              <div className="mt-4 space-y-2">
                {state.shipments.length === 0 && <EmptyText>No shipment records yet.</EmptyText>}
                {state.shipments.slice(0, 5).map(shipment => (
                  <div key={shipment.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{shipment.shipment_number}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {HAZARDOUS_WASTE_SHIPMENT_STATUS_LABEL[shipment.status]}
                      {shipment.manifest_tracking_number ? ` - ${shipment.manifest_tracking_number}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </Panel>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent Inspections</h2>
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {state.inspections.length === 0 && <EmptyText>No submitted inspections yet.</EmptyText>}
              {state.inspections.map(inspection => (
                <div key={inspection.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {areaById.get(inspection.area_id)?.name ?? 'Unknown area'}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {new Date(inspection.inspected_at).toLocaleString()} - {inspection.checked_ids.length} checked - {inspection.flagged_ids.length} flagged
                    </p>
                  </div>
                  <ResultPill result={inspection.result} />
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

function getRequired(form: FormData, key: string): string {
  const value = String(form.get(key) ?? '').trim()
  if (!value) throw new Error(`${key.replaceAll('_', ' ')} is required.`)
  return value
}

function getOptional(form: FormData, key: string): string | null {
  const value = String(form.get(key) ?? '').trim()
  return value || null
}

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}{required ? ' *' : ''}
      </span>
      {children}
    </label>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      {children}
    </section>
  )
}

function SubmitButton({ saving, label, icon: Icon = Recycle }: { saving: boolean; label: string; icon?: LucideIcon }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="inline-flex items-center justify-center gap-2 rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
    </button>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: number
  tone: 'slate' | 'green' | 'blue' | 'amber' | 'red'
}) {
  const toneClass = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
    blue: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
    red: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  }[tone]

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-md ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-semibold text-slate-950 dark:text-slate-50">{value}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  )
}

function EmptyText({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-slate-500 dark:text-slate-400">{children}</p>
}

function ResultPill({ result }: { result: HazardousWasteInspectionResult }) {
  const cls = result === 'pass'
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
    : result === 'issues_found'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>
      {HAZARDOUS_WASTE_INSPECTION_RESULT_LABEL[result]}
    </span>
  )
}

function RecordList({
  title,
  empty,
  rows,
}: {
  title: string
  empty: string
  rows: Array<{ id: string; title: string; meta: string; badge: string }>
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      <div className="space-y-2">
        {rows.length === 0 && <EmptyText>{empty}</EmptyText>}
        {rows.map(row => (
          <div key={row.id} className="flex items-start justify-between gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{row.title}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{row.meta}</p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {row.badge}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
