'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Anchor } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { FormShell, Field, TextInput, NumberInput, DateInput, TextArea, Select, TwoCol } from '../../_components/FormShell'

const KIND_OPTS = [
  { value: 'engineered_permanent', label: 'Engineered (permanent)' },
  { value: 'engineered_portable',  label: 'Engineered (portable)' },
  { value: 'horizontal_lifeline',  label: 'Horizontal lifeline' },
  { value: 'improvised',           label: 'Improvised (CP-chosen)' },
]
const STATUS_OPTS = [
  { value: 'in_service',     label: 'In service' },
  { value: 'quarantined',    label: 'Quarantined' },
  { value: 'condemned',      label: 'Condemned' },
  { value: 'pending_recert', label: 'Pending recert' },
]

export default function NewAnchorPage() {
  const router = useRouter()
  const { tenantId } = useTenant()

  const [assetTag, setAssetTag]   = useState('')
  const [locationLabel, setLocationLabel] = useState('')
  const [kind, setKind]           = useState('engineered_permanent')
  const [capacity, setCapacity]   = useState('5000')
  const [workers, setWorkers]     = useState('1')
  const [qpName, setQpName]       = useState('')
  const [qpLicense, setQpLicense] = useState('')
  const [qpCertAt, setQpCertAt]   = useState('')
  const [recert, setRecert]       = useState('')
  const [drawing, setDrawing]     = useState('')
  const [install, setInstall]     = useState('')
  const [status, setStatus]       = useState('in_service')
  const [notes, setNotes]         = useState('')

  const canSubmit = !!tenantId && !!locationLabel.trim() && !!capacity && !!workers

  async function submit() {
    if (!tenantId) return
    const { error } = await supabase.from('wah_anchors').insert({
      tenant_id:              tenantId,
      asset_tag:              assetTag.trim() || null,
      location_label:         locationLabel.trim(),
      kind,
      rated_capacity_lbf:     Number(capacity),
      workers_max:            Number(workers),
      qp_name:                qpName.trim() || null,
      qp_pe_license:          qpLicense.trim() || null,
      qp_certified_at:        qpCertAt || null,
      recertification_due_at: recert || null,
      drawing_ref:            drawing.trim() || null,
      installation_date:      install || null,
      status,
      notes:                  notes.trim() || null,
    })
    if (error) throw new Error(error.message)
    router.push('/admin/working-at-heights/anchors')
  }

  return (
    <FormShell
      title="New anchor point"
      description="5,000 lbf per worker (default) OR engineered with a 2:1 safety factor under a Qualified Person."
      Icon={Anchor}
      backHref="/admin/working-at-heights/anchors"
      onSubmit={submit}
      canSubmit={canSubmit}
    >
      <Field label="Asset tag"><TextInput value={assetTag} onChange={e => setAssetTag(e.target.value)} placeholder="WLS-ANC-006" /></Field>
      <Field label="Location" required><TextInput value={locationLabel} onChange={e => setLocationLabel(e.target.value)} placeholder="Roof Davit — South" /></Field>
      <TwoCol>
        <Field label="Type" required><Select value={kind} onChange={e => setKind(e.target.value)} options={KIND_OPTS} /></Field>
        <Field label="Status"><Select value={status} onChange={e => setStatus(e.target.value)} options={STATUS_OPTS} /></Field>
      </TwoCol>
      <TwoCol>
        <Field label="Rated capacity (lbf)" required hint="Default OSHA minimum is 5,000 lbf per worker."><NumberInput value={capacity} step={100} onChange={e => setCapacity(e.target.value)} /></Field>
        <Field label="Workers (max)" required><NumberInput value={workers} min={1} max={8} onChange={e => setWorkers(e.target.value)} /></Field>
      </TwoCol>
      <TwoCol>
        <Field label="QP name"><TextInput value={qpName} onChange={e => setQpName(e.target.value)} placeholder="Jon Neubauer, PE" /></Field>
        <Field label="PE license"><TextInput value={qpLicense} onChange={e => setQpLicense(e.target.value)} placeholder="CA PE C-12345" /></Field>
      </TwoCol>
      <TwoCol>
        <Field label="QP certified at"><DateInput value={qpCertAt} onChange={e => setQpCertAt(e.target.value)} /></Field>
        <Field label="Recertification due" hint="Typical engineered anchor recerts on a 5-year cycle."><DateInput value={recert} onChange={e => setRecert(e.target.value)} /></Field>
      </TwoCol>
      <TwoCol>
        <Field label="Drawing reference"><TextInput value={drawing} onChange={e => setDrawing(e.target.value)} placeholder="DWG-ROOF-DAV-S" /></Field>
        <Field label="Installation date"><DateInput value={install} onChange={e => setInstall(e.target.value)} /></Field>
      </TwoCol>
      <Field label="Notes"><TextArea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </FormShell>
  )
}
