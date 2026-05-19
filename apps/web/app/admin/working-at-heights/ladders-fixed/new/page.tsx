'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Triangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { FormShell, Field, TextInput, NumberInput, DateInput, TextArea, Select, Checkbox, TwoCol } from '../../_components/FormShell'

const STATUS_OPTS = [
  { value: 'in_service',     label: 'In service' },
  { value: 'quarantined',    label: 'Quarantined' },
  { value: 'condemned',      label: 'Condemned' },
  { value: 'pending_recert', label: 'Pending recert' },
]

export default function NewLadderFixedPage() {
  const router = useRouter()
  const { tenantId } = useTenant()

  const [assetTag, setAssetTag]   = useState('')
  const [locationLabel, setLocationLabel] = useState('')
  const [drawing, setDrawing]     = useState('')
  const [heightFt, setHeightFt]   = useState('')
  const [hasCage, setHasCage]     = useState(false)
  const [hasLSS, setHasLSS]       = useState(false)
  const [lssSerial, setLssSerial] = useState('')
  const [retrofit, setRetrofit]   = useState('')
  const [status, setStatus]       = useState('in_service')
  const [notes, setNotes]         = useState('')

  const canSubmit = !!tenantId && !!locationLabel.trim() && !!heightFt
  // 1910.28(b)(9): ladders ≥24 ft installed before Nov 18 2018 must
  // have a ladder safety system OR PFAS by Nov 18 2036. Auto-suggest
  // the deadline so the operator doesn't have to remember it.
  const needsRetrofit = !!heightFt && Number(heightFt) >= 24 && !hasLSS

  async function submit() {
    if (!tenantId) return
    const { error } = await supabase.from('wah_ladders_fixed').insert({
      tenant_id:                   tenantId,
      asset_tag:                   assetTag.trim() || null,
      location_label:              locationLabel.trim(),
      drawing_ref:                 drawing.trim() || null,
      height_ft:                   Number(heightFt),
      has_cage:                    hasCage,
      has_ladder_safety_system:    hasLSS,
      ladder_safety_system_serial: hasLSS ? (lssSerial.trim() || null) : null,
      retrofit_target_date:        (needsRetrofit && retrofit) ? retrofit : (needsRetrofit ? '2036-11-18' : null),
      status,
      notes:                       notes.trim() || null,
    })
    if (error) throw new Error(error.message)
    router.push('/admin/working-at-heights/ladders-fixed')
  }

  return (
    <FormShell
      title="New fixed ladder"
      description="1910.28(b)(9) inventory. Ladders ≥24 ft must have a safety system or PFAS by Nov 18 2036."
      Icon={Triangle}
      backHref="/admin/working-at-heights/ladders-fixed"
      onSubmit={submit}
      canSubmit={canSubmit}
    >
      <Field label="Asset tag"><TextInput value={assetTag} onChange={e => setAssetTag(e.target.value)} placeholder="WLS-FXD-005" /></Field>
      <Field label="Location" required><TextInput value={locationLabel} onChange={e => setLocationLabel(e.target.value)} placeholder="Roof Hatch — South" /></Field>
      <TwoCol>
        <Field label="Drawing reference"><TextInput value={drawing} onChange={e => setDrawing(e.target.value)} placeholder="DWG-ARCH-R-202" /></Field>
        <Field label="Height (ft)" required><NumberInput value={heightFt} step={0.5} onChange={e => setHeightFt(e.target.value)} /></Field>
      </TwoCol>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox label="Has cage"                  checked={hasCage}  onChange={e => setHasCage(e.target.checked)} />
        <Checkbox label="Has ladder safety system"  checked={hasLSS}   onChange={e => setHasLSS(e.target.checked)} />
      </div>
      {hasLSS && (
        <Field label="Safety system serial"><TextInput value={lssSerial} onChange={e => setLssSerial(e.target.value)} placeholder="DBI-LS-CT-22-001" /></Field>
      )}
      {needsRetrofit && (
        <Field label="Retrofit target date" hint="Defaults to Nov 18 2036 — the OSHA deadline for cage-only retrofits.">
          <DateInput value={retrofit} onChange={e => setRetrofit(e.target.value)} placeholder="2036-11-18" />
        </Field>
      )}
      <Field label="Status"><Select value={status} onChange={e => setStatus(e.target.value)} options={STATUS_OPTS} /></Field>
      <Field label="Notes"><TextArea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </FormShell>
  )
}
