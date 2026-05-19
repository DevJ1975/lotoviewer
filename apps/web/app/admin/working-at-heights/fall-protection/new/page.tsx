'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HardHat } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { FormShell, Field, TextInput, NumberInput, DateInput, TextArea, Select, TwoCol } from '../../_components/FormShell'

interface MemberOpt { id: string; display_name: string }

const TYPE_OPTS = [
  { value: 'harness',                label: 'Harness' },
  { value: 'shock_lanyard',          label: 'Shock-absorbing lanyard' },
  { value: 'positioning_lanyard',    label: 'Positioning lanyard' },
  { value: 'restraint_lanyard',      label: 'Restraint lanyard' },
  { value: 'srl_class1',             label: 'SRL — Class 1 (overhead)' },
  { value: 'srl_class2',             label: 'SRL — Class 2 (leading edge)' },
  { value: 'anchor_connector',       label: 'Anchor connector' },
  { value: 'rope_grab',              label: 'Rope grab' },
  { value: 'trauma_strap',           label: 'Suspension trauma strap' },
  { value: 'rescue_descent_device',  label: 'Rescue descent device' },
]

const STATUS_OPTS = [
  { value: 'in_service',      label: 'In service' },
  { value: 'quarantined',     label: 'Quarantined' },
  { value: 'condemned',       label: 'Condemned' },
  { value: 'in_rescue_cache', label: 'In rescue cache' },
  { value: 'pending_recert',  label: 'Pending recert' },
]

export default function NewComponentPage() {
  const router = useRouter()
  const { tenantId } = useTenant()
  const [members, setMembers] = useState<MemberOpt[]>([])

  const [type, setType]                 = useState('harness')
  const [manufacturer, setManufacturer] = useState('')
  const [model, setModel]               = useState('')
  const [serial, setSerial]             = useState('')
  const [mfgDate, setMfgDate]           = useState('')
  const [firstUsed, setFirstUsed]       = useState('')
  const [serviceLife, setServiceLife]   = useState('5')
  const [serviceExpiresAt, setServiceExpiresAt] = useState('')
  const [assignedTo, setAssignedTo]     = useState('')
  const [storage, setStorage]           = useState('')
  const [status, setStatus]             = useState('in_service')
  const [notes, setNotes]               = useState('')

  useEffect(() => {
    if (!tenantId) return
    supabase.from('members').select('id, display_name').eq('tenant_id', tenantId).order('display_name')
      .then(({ data }) => setMembers((data ?? []) as MemberOpt[]))
  }, [tenantId])

  const canSubmit = !!tenantId && !!manufacturer.trim() && !!serial.trim()

  async function submit() {
    if (!tenantId) return
    const { error } = await supabase.from('wah_components').insert({
      tenant_id: tenantId,
      type,
      manufacturer:        manufacturer.trim(),
      model:               model.trim() || null,
      serial:              serial.trim(),
      mfg_date:            mfgDate || null,
      first_used_date:     firstUsed || null,
      service_life_years:  serviceLife ? Number(serviceLife) : null,
      service_expires_at:  serviceExpiresAt || null,
      assigned_to_member_id: assignedTo || null,
      storage_location:    storage.trim() || null,
      status,
      notes:               notes.trim() || null,
    })
    if (error) throw new Error(error.message)
    router.push('/admin/working-at-heights/fall-protection')
  }

  return (
    <FormShell
      title="New fall-protection component"
      description="Every harness, lanyard, SRL, and anchor connector is its own row keyed by serial."
      Icon={HardHat}
      backHref="/admin/working-at-heights/fall-protection"
      onSubmit={submit}
      canSubmit={canSubmit}
    >
      <Field label="Type" required>
        <Select value={type} onChange={e => setType(e.target.value)} options={TYPE_OPTS} />
      </Field>
      <TwoCol>
        <Field label="Manufacturer" required><TextInput value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="Capital Safety" /></Field>
        <Field label="Model"><TextInput value={model} onChange={e => setModel(e.target.value)} placeholder="ExoFit NEX" /></Field>
      </TwoCol>
      <Field label="Serial" required hint="Unique within (tenant, type).">
        <TextInput value={serial} onChange={e => setSerial(e.target.value)} placeholder="CS-EXO-001" />
      </Field>
      <TwoCol>
        <Field label="Manufacture date"><DateInput value={mfgDate} onChange={e => setMfgDate(e.target.value)} /></Field>
        <Field label="First used date"><DateInput value={firstUsed} onChange={e => setFirstUsed(e.target.value)} /></Field>
      </TwoCol>
      <TwoCol>
        <Field label="Service life (years)" hint="Manufacturer service life from first use, typically 5–10."><NumberInput value={serviceLife} min={1} max={20} onChange={e => setServiceLife(e.target.value)} /></Field>
        <Field label="Service expires" hint="When this component must come out of service."><DateInput value={serviceExpiresAt} onChange={e => setServiceExpiresAt(e.target.value)} /></Field>
      </TwoCol>
      <TwoCol>
        <Field label="Assigned to">
          <Select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
            options={[{ value: '', label: 'Pool / unassigned' }, ...members.map(m => ({ value: m.id, label: m.display_name }))]} />
        </Field>
        <Field label="Storage location"><TextInput value={storage} onChange={e => setStorage(e.target.value)} placeholder="Locker A-12" /></Field>
      </TwoCol>
      <Field label="Status"><Select value={status} onChange={e => setStatus(e.target.value)} options={STATUS_OPTS} /></Field>
      <Field label="Notes"><TextArea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </FormShell>
  )
}
