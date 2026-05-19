'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { IdCard } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { FormShell, Field, TextInput, DateInput, TextArea, Select, TwoCol } from '../../_components/FormShell'

interface MemberOpt { id: string; display_name: string }

export default function NewAuthorizationPage() {
  const router = useRouter()
  const { tenantId } = useTenant()
  const [members, setMembers] = useState<MemberOpt[]>([])
  const [memberId, setMemberId]   = useState('')
  const [role, setRole]           = useState<'authorized'|'competent'|'qualified'>('authorized')
  const [scope, setScope]         = useState('')
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [validUntil, setValidUntil] = useState('')
  const [peLicense, setPeLicense] = useState('')
  const [notes, setNotes]         = useState('')

  useEffect(() => {
    if (!tenantId) return
    supabase.from('members').select('id, display_name').eq('tenant_id', tenantId).order('display_name')
      .then(({ data }) => setMembers((data ?? []) as MemberOpt[]))
  }, [tenantId])

  const canSubmit = !!tenantId && !!memberId && !!validFrom && !!validUntil

  async function submit() {
    if (!tenantId) return
    const { error } = await supabase.from('wah_authorizations').insert({
      tenant_id: tenantId,
      member_id: memberId,
      role,
      scope:          scope.trim() || null,
      qp_pe_license:  role === 'qualified' ? (peLicense.trim() || null) : null,
      valid_from:     validFrom,
      valid_until:    validUntil,
      notes:          notes.trim() || null,
    })
    if (error) throw new Error(error.message)
    router.push('/admin/working-at-heights/authorizations')
  }

  return (
    <FormShell
      title="New authorization"
      description="Designate an Authorized / Competent / Qualified Person."
      Icon={IdCard}
      backHref="/admin/working-at-heights/authorizations"
      onSubmit={submit}
      canSubmit={canSubmit}
    >
      <Field label="Member" required>
        <Select value={memberId} onChange={e => setMemberId(e.target.value)}
          options={[{ value: '', label: 'Select member…' }, ...members.map(m => ({ value: m.id, label: m.display_name }))]} />
      </Field>
      <Field label="Role" required>
        <Select value={role} onChange={e => setRole(e.target.value as 'authorized'|'competent'|'qualified')}
          options={[
            { value: 'authorized', label: 'Authorized Person (worker)' },
            { value: 'competent',  label: 'Competent Person (inspector/issuer)' },
            { value: 'qualified',  label: 'Qualified Person (engineer/PE)' },
          ]} />
      </Field>
      <Field label="Scope" hint="What this designation covers — e.g. 'general industry fall protection' or 'engineered anchorage design'">
        <TextInput value={scope} onChange={e => setScope(e.target.value)} placeholder="General industry fall protection" />
      </Field>
      <TwoCol>
        <Field label="Valid from" required><DateInput value={validFrom} onChange={e => setValidFrom(e.target.value)} /></Field>
        <Field label="Valid until" required><DateInput value={validUntil} onChange={e => setValidUntil(e.target.value)} /></Field>
      </TwoCol>
      {role === 'qualified' && (
        <Field label="PE license" hint="License number on file for the Qualified Person of record.">
          <TextInput value={peLicense} onChange={e => setPeLicense(e.target.value)} placeholder="CA PE C-12345" />
        </Field>
      )}
      <Field label="Notes"><TextArea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </FormShell>
  )
}
