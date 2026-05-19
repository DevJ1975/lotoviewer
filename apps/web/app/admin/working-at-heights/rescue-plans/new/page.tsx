'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LifeBuoy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { FormShell, Field, TextInput, DateInput, TextArea, Select, TwoCol } from '../../_components/FormShell'

interface MemberOpt { id: string; display_name: string }

export default function NewRescuePlanPage() {
  const router = useRouter()
  const { tenantId } = useTenant()
  const [members, setMembers] = useState<MemberOpt[]>([])

  const [locationLabel, setLocationLabel] = useState('')
  const [primaryId, setPrimaryId]         = useState('')
  const [backupId, setBackupId]           = useState('')
  const [contactProtocol, setContactProtocol] = useState('')
  const [lastDrilled, setLastDrilled]     = useState('')
  const [nextDrill, setNextDrill]         = useState('')
  const [notes, setNotes]                 = useState('')

  useEffect(() => {
    if (!tenantId) return
    supabase.from('members').select('id, display_name').eq('tenant_id', tenantId).order('display_name')
      .then(({ data }) => setMembers((data ?? []) as MemberOpt[]))
  }, [tenantId])

  const canSubmit = !!tenantId && !!locationLabel.trim()

  async function submit() {
    if (!tenantId) return
    const { error } = await supabase.from('wah_rescue_plans').insert({
      tenant_id:                  tenantId,
      location_label:             locationLabel.trim(),
      primary_rescuer_id:         primaryId || null,
      backup_rescuer_id:          backupId  || null,
      equipment_cache:            [],
      contact_911_protocol:       contactProtocol.trim() || null,
      last_drilled_at:            lastDrilled || null,
      next_drill_due:             nextDrill   || null,
      notes:                      notes.trim() || null,
    })
    if (error) throw new Error(error.message)
    router.push('/admin/working-at-heights/rescue-plans')
  }

  const memberOptions = [{ value: '', label: 'Not assigned' }, ...members.map(m => ({ value: m.id, label: m.display_name }))]

  return (
    <FormShell
      title="New rescue plan"
      description="29 CFR 1926.502(d)(20). Suspension trauma starts in 6–15 minutes; the plan must be self-sufficient."
      Icon={LifeBuoy}
      backHref="/admin/working-at-heights/rescue-plans"
      onSubmit={submit}
      canSubmit={canSubmit}
    >
      <Field label="Location" required><TextInput value={locationLabel} onChange={e => setLocationLabel(e.target.value)} placeholder="Roof North — HVAC service zone" /></Field>
      <TwoCol>
        <Field label="Primary rescuer"><Select value={primaryId} onChange={e => setPrimaryId(e.target.value)} options={memberOptions} /></Field>
        <Field label="Backup rescuer"><Select value={backupId}  onChange={e => setBackupId(e.target.value)}  options={memberOptions} /></Field>
      </TwoCol>
      <Field label="911 / EMS protocol" hint="Who calls 911, where EMS stages, how access is unlocked.">
        <TextArea value={contactProtocol} onChange={e => setContactProtocol(e.target.value)} rows={3} />
      </Field>
      <TwoCol>
        <Field label="Last drilled at"><DateInput value={lastDrilled} onChange={e => setLastDrilled(e.target.value)} /></Field>
        <Field label="Next drill due"  hint="Quarterly cadence recommended."><DateInput value={nextDrill} onChange={e => setNextDrill(e.target.value)} /></Field>
      </TwoCol>
      <Field label="Notes"><TextArea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </FormShell>
  )
}
