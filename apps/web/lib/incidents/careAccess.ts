import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, type TenantGate } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Who may touch an incident's care record.
//
// Care data is PHI-adjacent (diagnosis, restrictions, drug-test status), so
// access is narrower than the rest of the incident module: admins and owners
// always, plus the two people actually working the case — the assigned
// investigator and the case manager.
//
// This is the authorization *decision* only. Reads of the care row itself go
// through the caller's RLS-scoped client so migration 201's can_view_care_phi()
// policy still applies; this helper deliberately does not hand back care data
// fetched with the service role.

type TenantGateOk = Extract<TenantGate, { ok: true }>

export type CareAccess =
  | { ok: true; gate: TenantGateOk; isPriv: boolean; careCaseId: string | null }
  | { ok: false; status: number; message: string }

export async function loadCareAccess(req: Request, incidentId: string): Promise<CareAccess> {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return { ok: false, status: gate.status, message: gate.message }

  const admin = supabaseAdmin()

  // Independent lookups — the care case is keyed by incident_id, not by
  // anything the incident row returns.
  const [incidentResult, caseResult] = await Promise.all([
    admin
      .from('incidents')
      .select('id, assigned_investigator')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle(),
    admin
      .from('incident_care_cases')
      .select('id, case_manager_user_id')
      .eq('incident_id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle(),
  ])

  // Surface read failures instead of letting them fall through. A dropped
  // error here reads as "no row": the incident lookup would answer 404 for an
  // incident that exists, and the care lookup would leave isPriv false and
  // deny the case manager access to their own case.
  for (const [stage, result] of [
    ['incident', incidentResult] as const,
    ['care_case', caseResult] as const,
  ]) {
    if (result.error) {
      Sentry.captureException(result.error, { tags: { helper: 'loadCareAccess', stage } })
      return { ok: false, status: 500, message: result.error.message }
    }
  }

  const incident = incidentResult.data
  if (!incident) return { ok: false, status: 404, message: 'Incident not found' }

  const existingCase = caseResult.data as { id: string; case_manager_user_id: string | null } | null

  const isPriv =
    gate.role === 'owner' || gate.role === 'admin' || gate.role === 'superadmin'
    || incident.assigned_investigator === gate.userId
    || existingCase?.case_manager_user_id === gate.userId

  return { ok: true, gate, isPriv, careCaseId: existingCase?.id ?? null }
}
