import { NextResponse } from 'next/server'
import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  EMS_DISCIPLINES,
  ENVIRONMENTAL_MODULE,
  UUID_RE,
  gateFailure,
  invalidInput,
  invalidJson,
  notFound,
  readJsonObject,
} from '@/lib/environmental/registerApi'
import { policyCommunicationInputFrom } from '@/lib/environmental/contextRegisters'

// POST /api/environmental/policy/communications   Record that a policy version reached people
//   (clause 5.2): { policy_id, audience: internal | external, method, communicated_on? }.
//   Admins only. Communications are never edited or deleted, like the policy they record;
//   a mistaken one is corrected by recording the right one.

export async function POST(req: Request) {
  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const policyId = typeof body.policy_id === 'string' ? body.policy_id : ''
  if (!UUID_RE.test(policyId)) return invalidInput([{ field: 'policyId', message: 'must be a policy id' }])

  const { data, error: policyError } = await gate.authedClient
    .from('ms_policies')
    .select('id, discipline, signed_at')
    .eq('id', policyId)
    .eq('tenant_id', gate.tenantId)
    .in('discipline', EMS_DISCIPLINES)
    .maybeSingle()
  if (policyError) return sanitizeError(policyError, 'environmental/policy/communications/POST policy')
  if (!data) return notFound()
  const policy = data as { discipline: string; signed_at: string }

  const parsed = policyCommunicationInputFrom(body, policy.signed_at)
  if (!parsed.ok) return invalidInput(parsed.errors)
  const communication = parsed.input

  const { data: saved, error } = await gate.authedClient
    .from('ms_policy_communications')
    .insert({
      tenant_id:       gate.tenantId,
      discipline:      policy.discipline,
      policy_id:       policyId,
      audience:        communication.audience,
      method:          communication.method,
      communicated_on: communication.communicatedOn,
      recorded_by:     gate.userId,
    })
    .select('*')
    .single()
  if (error) return sanitizeError(error, 'environmental/policy/communications/POST')
  return NextResponse.json({ communication: saved }, { status: 201 })
}
