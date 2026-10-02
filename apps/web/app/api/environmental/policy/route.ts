import { NextResponse } from 'next/server'
import {
  policyIsComplete,
  policySignatoryStale,
  requiredCommitments,
} from '@soteria/core/managementSystem'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  ENVIRONMENTAL_MODULE,
  emsDisciplineParam,
  gateFailure,
  invalidInput,
  invalidJson,
  nextVersion,
  readJsonObject,
  versionConflict,
} from '@/lib/environmental/registerApi'
import { policyInputFrom } from '@/lib/environmental/contextRegisters'

// GET  /api/environmental/policy?discipline=ems   The policy in force, its earlier versions,
//                                                 the commitments it must state, and whether a
//                                                 change of legal entity left it signed by a prior owner.
// POST /api/environmental/policy                  Save a new version. Admins only. 422 unless it
//                                                 states every commitment its standard requires (clause 5.2).

interface PolicyRow {
  commitments:    Record<string, boolean>
  signatory_name: string
  signed_at:      string
}

interface ScopeRow {
  version:        number
  legal_entity:   string
  effective_from: string
}

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const discipline = emsDisciplineParam(new URL(req.url).searchParams.get('discipline'))
  if (!discipline) return NextResponse.json({ error: 'discipline must be ems or integrated' }, { status: 400 })

  const [policies, scopes] = await Promise.all([
    gate.authedClient
      .from('ms_policies')
      .select('*')
      .eq('tenant_id', gate.tenantId)
      .eq('discipline', discipline)
      .order('version', { ascending: false }),
    gate.authedClient
      .from('ms_scope_statements')
      .select('version, legal_entity, effective_from')
      .eq('tenant_id', gate.tenantId)
      .eq('discipline', discipline),
  ])
  if (policies.error) return sanitizeError(policies.error, 'environmental/policy/GET')
  if (scopes.error) return sanitizeError(scopes.error, 'environmental/policy/GET scopes')

  const versions = policies.data ?? []
  const current = (versions[0] ?? null) as PolicyRow | null
  return NextResponse.json({
    current,
    versions,
    requiredCommitments: requiredCommitments(discipline),
    complete: current !== null && policyIsComplete({
      commitments:   current.commitments,
      signatoryName: current.signatory_name,
      signedAt:      current.signed_at,
    }, discipline),
    signatoryStale: current !== null && policySignatoryStale(
      { signedAt: current.signed_at },
      ((scopes.data ?? []) as ScopeRow[]).map(s => ({
        version: s.version, legalEntity: s.legal_entity, effectiveFrom: s.effective_from,
      })),
    ),
  })
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const parsed = policyInputFrom({ ...body, discipline: body.discipline ?? 'ems' })
  if (!parsed.ok) return invalidInput(parsed.errors)
  const policy = parsed.input

  if (!policyIsComplete(policy, policy.discipline)) {
    const missingCommitments = requiredCommitments(policy.discipline).filter(c => policy.commitments[c.key] !== true)
    return NextResponse.json({
      error: 'The policy must state every commitment its standard requires.',
      missingCommitments,
    }, { status: 422 })
  }

  const next = await nextVersion(gate.authedClient, 'ms_policies', gate.tenantId, policy.discipline)
  if (next.error) return sanitizeError(next.error, 'environmental/policy/POST version')

  const { data, error } = await gate.authedClient
    .from('ms_policies')
    .insert({
      tenant_id:       gate.tenantId,
      discipline:      policy.discipline,
      version:         next.version,
      body:            policy.body,
      commitments:     policy.commitments,
      signatory_name:  policy.signatoryName,
      signatory_title: policy.signatoryTitle,
      signed_at:       policy.signedAt,
      created_by:      gate.userId,
    })
    .select('*')
    .single()
  if (error?.code === '23505') return versionConflict()
  if (error) return sanitizeError(error, 'environmental/policy/POST')
  return NextResponse.json({ policy: data }, { status: 201 })
}
