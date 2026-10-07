import type { SupabaseClient } from '@supabase/supabase-js'
import { librarySystemKey } from '@soteria/core/environmental/calendarPlan'
import {
  decideRenewalAction, planPermitRenewal, type PermitProgram, type RenewalAction,
} from '@soteria/core/environmental/permits'

// Keep a permit's renewal deadline on the compliance calendar in step with the
// permit. The decision (create, move, dismiss, leave alone) is pure and lives in
// core; this is only the reading and writing around it.

export interface SyncablePermit {
  id:                string
  facility_id:       string
  program:           PermitProgram
  permit_type:       string
  permit_number:     string | null
  status:            string
  expiration_date:   string | null
  renewal_lead_days: number
}

export const renewalLibraryKey = (permitId: string) => `permit-renewal:${permitId}`

export async function syncPermitRenewal(
  client: SupabaseClient, actor: { tenantId: string; userId: string }, permit: SyncablePermit,
): Promise<RenewalAction['type']> {
  const planned = planPermitRenewal({
    id: permit.id, facilityId: permit.facility_id, program: permit.program, permitType: permit.permit_type,
    permitNumber: permit.permit_number, status: permit.status, expirationDate: permit.expiration_date,
    renewalLeadDays: permit.renewal_lead_days,
  })
  const systemKey = librarySystemKey(renewalLibraryKey(permit.id), permit.facility_id)

  const { data: found, error: readError } = await client.from('compliance_calendar_obligations')
    .select('id, status, next_due_at, title').eq('tenant_id', actor.tenantId).eq('system_key', systemKey).maybeSingle()
  if (readError) throw new Error(readError.message)

  const action = decideRenewalAction(planned, found
    ? { id: found.id as string, status: found.status as 'open' | 'completed' | 'dismissed', nextDueAt: found.next_due_at as string, title: found.title as string }
    : null)

  if (action.type === 'create') {
    const o = action.planned
    const { error } = await client.from('compliance_calendar_obligations').insert({
      tenant_id: actor.tenantId, facility_id: o.facility_id, title: o.title, description: o.description,
      regulatory_ref: o.regulatory_ref, category: o.category, cadence: o.cadence, cadence_days: o.cadence_days,
      next_due_at: o.next_due_at, source: 'library', system_key: o.system_key, status: 'open',
      program: o.program, library_key: o.library_key, jurisdiction: o.jurisdiction, due_anchor: o.due_anchor,
      lead_days: o.lead_days, created_by: actor.userId,
    })
    if (error) throw new Error(error.message)
  } else if (action.type === 'update') {
    const o = action.planned
    const { error } = await client.from('compliance_calendar_obligations')
      .update({ title: o.title, description: o.description, regulatory_ref: o.regulatory_ref, next_due_at: o.next_due_at, updated_at: new Date().toISOString() })
      .eq('tenant_id', actor.tenantId).eq('id', action.id)
    if (error) throw new Error(error.message)
  } else if (action.type === 'dismiss') {
    const { error } = await client.from('compliance_calendar_obligations')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('tenant_id', actor.tenantId).eq('id', action.id)
    if (error) throw new Error(error.message)
  }
  return action.type
}

/** A deleted permit has no renewal to track. */
export async function dismissPermitRenewal(
  client: SupabaseClient, actor: { tenantId: string }, permit: { id: string; facility_id: string },
): Promise<void> {
  const { error } = await client.from('compliance_calendar_obligations')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('tenant_id', actor.tenantId).eq('system_key', librarySystemKey(renewalLibraryKey(permit.id), permit.facility_id)).eq('status', 'open')
  if (error) throw new Error(error.message)
}
