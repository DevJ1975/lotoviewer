'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Triangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { FormShell, Field, TextInput, NumberInput, DateInput, TextArea, Select, TwoCol } from '../../_components/FormShell'

const TYPE_OPTS = [
  { value: 'extension',   label: 'Extension' },
  { value: 'step',        label: 'Step' },
  { value: 'articulated', label: 'Articulated / multi-position' },
  { value: 'mobile',      label: 'Mobile / rolling' },
]
const MATERIAL_OPTS = [
  { value: 'aluminum',   label: 'Aluminum' },
  { value: 'fiberglass', label: 'Fiberglass (non-conductive)' },
  { value: 'wood',       label: 'Wood' },
  { value: 'composite',  label: 'Composite' },
]
const DUTY_OPTS = [
  { value: 'IAA', label: 'IAA — Special Duty (375 lbf)' },
  { value: 'IA',  label: 'IA — Extra Heavy Duty (300 lbf)' },
  { value: 'I',   label: 'I — Heavy Duty (250 lbf)' },
  { value: 'II',  label: 'II — Medium Duty (225 lbf) — not for industrial' },
  { value: 'III', label: 'III — Light Duty (200 lbf) — household only' },
]
const STATUS_OPTS = [
  { value: 'in_service',  label: 'In service' },
  { value: 'quarantined', label: 'Quarantined' },
  { value: 'condemned',   label: 'Condemned' },
]
const DUTY_CAPACITY: Record<string, number> = { IAA: 375, IA: 300, I: 250, II: 225, III: 200 }

export default function NewLadderPortablePage() {
  const router = useRouter()
  const { tenantId } = useTenant()

  const [assetTag, setAssetTag]     = useState('')
  const [ladderType, setLadderType] = useState('extension')
  const [material, setMaterial]     = useState('aluminum')
  const [duty, setDuty]             = useState('IA')
  const [manufacturer, setManufacturer] = useState('')
  const [model, setModel]           = useState('')
  const [heightFt, setHeightFt]     = useState('')
  const [purchase, setPurchase]     = useState('')
  const [storage, setStorage]       = useState('')
  const [status, setStatus]         = useState('in_service')
  const [notes, setNotes]           = useState('')

  const canSubmit = !!tenantId && !!ladderType && !!material && !!duty

  async function submit() {
    if (!tenantId) return
    const { error } = await supabase.from('wah_ladders_portable').insert({
      tenant_id:        tenantId,
      asset_tag:        assetTag.trim() || null,
      ladder_type:      ladderType,
      material,
      duty_rating:      duty,
      max_capacity_lbf: DUTY_CAPACITY[duty] ?? null,
      manufacturer:     manufacturer.trim() || null,
      model:            model.trim() || null,
      height_ft:        heightFt ? Number(heightFt) : null,
      purchase_date:    purchase || null,
      storage_location: storage.trim() || null,
      status,
      notes:            notes.trim() || null,
    })
    if (error) throw new Error(error.message)
    router.push('/admin/working-at-heights/ladders-portable')
  }

  return (
    <FormShell
      title="New portable ladder"
      description="ANSI A14-rated portable. Industrial sites default to IA or IAA (≥300 lbf)."
      Icon={Triangle}
      backHref="/admin/working-at-heights/ladders-portable"
      onSubmit={submit}
      canSubmit={canSubmit}
    >
      <Field label="Asset tag" hint="On-site label. Unique within the tenant.">
        <TextInput value={assetTag} onChange={e => setAssetTag(e.target.value)} placeholder="WLS-LAD-006" />
      </Field>
      <TwoCol>
        <Field label="Ladder type" required><Select value={ladderType} onChange={e => setLadderType(e.target.value)} options={TYPE_OPTS} /></Field>
        <Field label="Material" required><Select value={material} onChange={e => setMaterial(e.target.value)} options={MATERIAL_OPTS} /></Field>
      </TwoCol>
      <Field label="Duty rating" required hint={`Auto-fills max capacity: ${DUTY_CAPACITY[duty]} lbf.`}>
        <Select value={duty} onChange={e => setDuty(e.target.value)} options={DUTY_OPTS} />
      </Field>
      <TwoCol>
        <Field label="Manufacturer"><TextInput value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="Werner" /></Field>
        <Field label="Model"><TextInput value={model} onChange={e => setModel(e.target.value)} placeholder="D6224-2" /></Field>
      </TwoCol>
      <TwoCol>
        <Field label="Height (ft)"><NumberInput value={heightFt} step={0.5} onChange={e => setHeightFt(e.target.value)} /></Field>
        <Field label="Purchase date"><DateInput value={purchase} onChange={e => setPurchase(e.target.value)} /></Field>
      </TwoCol>
      <Field label="Storage location"><TextInput value={storage} onChange={e => setStorage(e.target.value)} placeholder="Maintenance shop" /></Field>
      <Field label="Status"><Select value={status} onChange={e => setStatus(e.target.value)} options={STATUS_OPTS} /></Field>
      <Field label="Notes"><TextArea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </FormShell>
  )
}
