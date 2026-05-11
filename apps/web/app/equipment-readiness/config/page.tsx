'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Save, Search, Trash2, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import {
  EQUIPMENT_FAMILIES,
  EQUIPMENT_FAMILY_LABEL,
  type EquipmentFamily,
} from '@soteria/core/equipmentReadiness'

interface EquipmentRow {
  id: string
  equipment_id: string
  description: string | null
  department: string | null
  equipment_family: EquipmentFamily
}

interface StrikeModuleRow {
  id: string
  title: string
}

interface ScheduleRow {
  id: string
  equipment_family: string | null
  department: string | null
  shift_label: string
  due_time_local: string
  grace_minutes: number
  active: boolean
}

interface StrikeRequirementRow {
  id: string
  module_id: string
  hazard_category: string | null
  required_before_start: boolean
  notes: string | null
  active: boolean
  created_at: string
}

export default function EquipmentReadinessConfigPage() {
  const { tenant, role } = useTenant()
  const tenantId = tenant?.id ?? null
  const canAdmin = role === 'owner' || role === 'admin'
  const [equipment, setEquipment] = useState<EquipmentRow[]>([])
  const [modules, setModules] = useState<StrikeModuleRow[]>([])
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [requirements, setRequirements] = useState<StrikeRequirementRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [familyReq, setFamilyReq] = useState<EquipmentFamily>('forklift_electric')
  const [moduleId, setModuleId] = useState('')
  const [scheduleFamily, setScheduleFamily] = useState<EquipmentFamily>('forklift_electric')
  const [shiftLabel, setShiftLabel] = useState('daily')
  const [dueTime, setDueTime] = useState('08:00')
  const [grace, setGrace] = useState('60')
  const [equipmentSearch, setEquipmentSearch] = useState('')
  const [savingScheduleId, setSavingScheduleId] = useState<string | null>(null)
  const [savingRequirementId, setSavingRequirementId] = useState<string | null>(null)

  const departments = useMemo(() => [...new Set(equipment.map(row => row.department).filter(Boolean) as string[])].sort(), [equipment])
  const modulesById = useMemo(() => new Map(modules.map(module => [module.id, module.title])), [modules])
  const visibleEquipment = useMemo(() => {
    const q = equipmentSearch.trim().toLowerCase()
    if (!q) return equipment
    return equipment.filter(row => [
      row.equipment_id,
      row.description ?? '',
      row.department ?? '',
      EQUIPMENT_FAMILY_LABEL[row.equipment_family],
    ].some(value => value.toLowerCase().includes(q)))
  }, [equipment, equipmentSearch])

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    setError(null)
    try {
      const [
        { data: equipmentRows, error: equipmentErr },
        { data: moduleRows, error: moduleErr },
        { data: scheduleRows, error: scheduleErr },
        { data: requirementRows, error: requirementErr },
      ] = await Promise.all([
        supabase
          .from('loto_equipment')
          .select('id,equipment_id,description,department,equipment_family')
          .eq('tenant_id', tenantId)
          .eq('decommissioned', false)
          .order('equipment_id', { ascending: true }),
        supabase
          .from('strike_modules')
          .select('id,title')
          .eq('status', 'published')
          .order('title', { ascending: true }),
        supabase
          .from('equipment_missed_inspection_rules')
          .select('id,equipment_family,department,shift_label,due_time_local,grace_minutes,active')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false }),
        supabase
          .from('strike_training_requirements')
          .select('id,module_id,hazard_category,required_before_start,notes,active,created_at')
          .eq('tenant_id', tenantId)
          .eq('source_type', 'equipment_readiness')
          .eq('active', true)
          .order('created_at', { ascending: false }),
      ])
      if (equipmentErr) throw equipmentErr
      if (moduleErr) throw moduleErr
      if (scheduleErr) throw scheduleErr
      if (requirementErr) throw requirementErr
      setEquipment((equipmentRows ?? []) as EquipmentRow[])
      setModules((moduleRows ?? []) as StrikeModuleRow[])
      setSchedules((scheduleRows ?? []) as ScheduleRow[])
      setRequirements((requirementRows ?? []) as StrikeRequirementRow[])
      setModuleId((moduleRows?.[0]?.id as string | undefined) ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  async function updateFamily(row: EquipmentRow, family: EquipmentFamily) {
    setError(null)
    const { error } = await supabase
      .from('loto_equipment')
      .update({ equipment_family: family, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('tenant_id', tenant?.id)
    if (error) {
      setError(error.message)
      return
    }
    setEquipment(prev => prev.map(item => item.id === row.id ? { ...item, equipment_family: family } : item))
  }

  async function addStrikeRequirement() {
    if (!tenant?.id || !moduleId) return
    setError(null); setNotice(null)
    const { error } = await supabase.from('strike_training_requirements').insert({
      tenant_id: tenant.id,
      module_id: moduleId,
      source_type: 'equipment_readiness',
      source_id: null,
      hazard_category: familyReq,
      required_before_start: true,
      active: true,
      notes: `Required before operating ${EQUIPMENT_FAMILY_LABEL[familyReq]}`,
    })
    if (error) setError(error.message)
    else {
      setNotice('STRIKE requirement added.')
      await load()
    }
  }

  async function addSchedule() {
    if (!tenant?.id) return
    setError(null); setNotice(null)
    const { error } = await supabase.from('equipment_missed_inspection_rules').insert({
      tenant_id: tenant.id,
      equipment_family: scheduleFamily,
      shift_label: shiftLabel.trim() || 'daily',
      due_time_local: dueTime,
      grace_minutes: Number(grace) || 60,
      active: true,
    })
    if (error) setError(error.message)
    else {
      setNotice('Inspection schedule added.')
      await load()
    }
  }

  async function updateSchedule(row: ScheduleRow) {
    if (!tenant?.id) return
    setSavingScheduleId(row.id)
    setError(null); setNotice(null)
    const { error } = await supabase
      .from('equipment_missed_inspection_rules')
      .update({
        equipment_family: row.equipment_family,
        department: row.department,
        shift_label: row.shift_label.trim() || 'daily',
        due_time_local: row.due_time_local,
        grace_minutes: Number(row.grace_minutes) || 60,
        active: row.active,
      })
      .eq('tenant_id', tenant.id)
      .eq('id', row.id)
    if (error) setError(error.message)
    else setNotice('Inspection schedule updated.')
    setSavingScheduleId(null)
  }

  async function deleteSchedule(id: string) {
    if (!tenant?.id) return
    setSavingScheduleId(id)
    setError(null); setNotice(null)
    const { error } = await supabase
      .from('equipment_missed_inspection_rules')
      .delete()
      .eq('tenant_id', tenant.id)
      .eq('id', id)
    if (error) setError(error.message)
    else {
      setNotice('Inspection schedule deleted.')
      setSchedules(prev => prev.filter(row => row.id !== id))
    }
    setSavingScheduleId(null)
  }

  async function deactivateRequirement(id: string) {
    if (!tenant?.id) return
    setSavingRequirementId(id)
    setError(null); setNotice(null)
    const { error } = await supabase
      .from('strike_training_requirements')
      .update({ active: false })
      .eq('tenant_id', tenant.id)
      .eq('id', id)
    if (error) setError(error.message)
    else {
      setNotice('STRIKE requirement deactivated.')
      setRequirements(prev => prev.filter(row => row.id !== id))
    }
    setSavingRequirementId(null)
  }

  function patchSchedule(id: string, patch: Partial<ScheduleRow>) {
    setSchedules(prev => prev.map(row => row.id === id ? { ...row, ...patch } : row))
  }

  if (!canAdmin) {
    return <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-slate-500">Tenant admin or owner access required.</main>
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950 dark:text-slate-50">Equipment Readiness Configuration</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Assign equipment families, schedules, and STRIKE requirements.</p>
        </div>
        <Link href="/equipment-readiness" className="text-sm font-semibold text-teal-700 hover:underline">Back to readiness</Link>
      </header>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">STRIKE requirement by equipment family</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <select value={familyReq} onChange={e => setFamilyReq(e.target.value as EquipmentFamily)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              {EQUIPMENT_FAMILIES.map(family => <option key={family} value={family}>{EQUIPMENT_FAMILY_LABEL[family]}</option>)}
            </select>
            <select value={moduleId} onChange={e => setModuleId(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              {modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}
            </select>
          </div>
          <button onClick={() => void addStrikeRequirement()} className="mt-3 inline-flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">
            <Save className="h-4 w-4" /> Add requirement
          </button>
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            {requirements.map(row => (
              <div key={row.id} className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{modulesById.get(row.module_id) ?? 'Unknown STRIKE module'}</p>
                  <p className="text-xs text-slate-500">
                    {familyLabel(row.hazard_category)} · {row.required_before_start ? 'Required before operation' : 'Recommended'} · {row.notes ?? 'No notes'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void deactivateRequirement(row.id)}
                  disabled={savingRequirementId === row.id}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  {savingRequirementId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  Deactivate
                </button>
              </div>
            ))}
            {requirements.length === 0 && <p className="text-xs text-slate-500">No active STRIKE gates configured for equipment readiness.</p>}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Inspection schedule</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <select value={scheduleFamily} onChange={e => setScheduleFamily(e.target.value as EquipmentFamily)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              {EQUIPMENT_FAMILIES.map(family => <option key={family} value={family}>{EQUIPMENT_FAMILY_LABEL[family]}</option>)}
            </select>
            <input value={shiftLabel} onChange={e => setShiftLabel(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
            <input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
            <input value={grace} onChange={e => setGrace(e.target.value)} inputMode="numeric" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </div>
          <button onClick={() => void addSchedule()} className="mt-3 inline-flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">
            <Save className="h-4 w-4" /> Add schedule
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Equipment families</h2>
          <label className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={equipmentSearch}
              onChange={e => setEquipmentSearch(e.target.value)}
              placeholder="Search equipment"
              className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
        </div>
        {loading && <p className="p-4 text-sm text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</p>}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {visibleEquipment.map(row => (
            <div key={row.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_260px] sm:items-center">
              <div>
                <p className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{row.equipment_id}</p>
                <p className="text-xs text-slate-500">{row.description ?? 'No description'} · {row.department ?? 'No department'}</p>
              </div>
              <select value={row.equipment_family} onChange={e => void updateFamily(row, e.target.value as EquipmentFamily)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                {EQUIPMENT_FAMILIES.map(family => <option key={family} value={family}>{EQUIPMENT_FAMILY_LABEL[family]}</option>)}
              </select>
            </div>
          ))}
          {!loading && visibleEquipment.length === 0 && <p className="p-4 text-sm text-slate-500">No equipment matches this search.</p>}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Active schedules</h2>
        <div className="mt-3 space-y-3 text-sm text-slate-600 dark:text-slate-300">
          {schedules.map(row => (
            <div key={row.id} className="grid gap-2 rounded-md border border-slate-200 p-3 dark:border-slate-800 lg:grid-cols-[1.2fr_1fr_140px_120px_100px_90px] lg:items-center">
              <select value={row.equipment_family ?? ''} onChange={e => patchSchedule(row.id, { equipment_family: e.target.value || null })} className="rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <option value="">Any family</option>
                {EQUIPMENT_FAMILIES.map(family => <option key={family} value={family}>{EQUIPMENT_FAMILY_LABEL[family]}</option>)}
              </select>
              <input value={row.shift_label} onChange={e => patchSchedule(row.id, { shift_label: e.target.value })} className="rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              <input type="time" value={row.due_time_local.slice(0, 5)} onChange={e => patchSchedule(row.id, { due_time_local: e.target.value })} className="rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              <input value={row.grace_minutes} onChange={e => patchSchedule(row.id, { grace_minutes: Number(e.target.value) || 0 })} inputMode="numeric" className="rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={row.active} onChange={e => patchSchedule(row.id, { active: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-teal-700" />
                Active
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => void updateSchedule(row)} disabled={savingScheduleId === row.id} className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-60" aria-label="Save schedule">
                  {savingScheduleId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </button>
                <button type="button" onClick={() => void deleteSchedule(row.id)} disabled={savingScheduleId === row.id} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900" aria-label="Delete schedule">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {schedules.length === 0 && <p>No schedules configured.</p>}
        </div>
        {departments.length > 0 && <p className="mt-3 text-xs text-slate-500">Departments detected: {departments.join(', ')}</p>}
      </section>
    </main>
  )
}

function familyLabel(value: string | null) {
  if (!value) return 'Any equipment family'
  return EQUIPMENT_FAMILY_LABEL[value as EquipmentFamily] ?? value.replaceAll('_', ' ')
}
