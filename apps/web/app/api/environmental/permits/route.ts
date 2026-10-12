import { NextResponse } from 'next/server'
import { PERMIT_PROGRAMS, type PermitStanding } from '@soteria/core/environmentalPermit'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  ENVIRONMENTAL_MODULE,
  gateFailure,
  invalidInput,
  invalidJson,
  isCurrentMember,
  notAMember,
  readJsonObject,
  todayUtc,
} from '@/lib/environmental/registerApi'
import {
  PERMIT_COLUMNS,
  conditionCountsByPermit,
  describePermit,
  ownerFrom,
  permitInputFrom,
  type PermitRow,
} from '@/lib/environmental/permits'

// GET  /api/environmental/permits   The permit vault: every permit at the active site (every
//                                   site when none is selected), each with its standing, its
//                                   renewal countdown, the holder-of-record check against the
//                                   scope in force, and its open and overdue conditions.
//   ?status=active (default) | retired | all   ?program=<program>   ?business_critical=true
//   ?holder_mismatch=true   ?standing=<standing>
// POST /api/environmental/permits   Record a permit at the active site. Admins only.

/** A site holds tens of permits, so the vault is read whole: the screens group and count it. */
const MAX_PERMITS = 1000
const STATUSES = ['active', 'retired', 'all'] as const
const STANDINGS: readonly PermitStanding[] = [
  'retired', 'no_expiry', 'current', 'renewal_due', 'renewal_submitted', 'expired', 'expired_renewal_pending',
]

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const params = new URL(req.url).searchParams
  const status = params.get('status') ?? 'active'
  if (!(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'status must be active, retired, or all' }, { status: 400 })
  }
  const program = params.get('program')
  if (program !== null && !(PERMIT_PROGRAMS as readonly string[]).includes(program)) {
    return NextResponse.json({ error: `program must be one of ${PERMIT_PROGRAMS.join(', ')}` }, { status: 400 })
  }
  const standing = params.get('standing')
  if (standing !== null && !(STANDINGS as readonly string[]).includes(standing)) {
    return NextResponse.json({ error: `standing must be one of ${STANDINGS.join(', ')}` }, { status: 400 })
  }
  for (const flag of ['business_critical', 'holder_mismatch'] as const) {
    const value = params.get(flag)
    if (value !== null && value !== 'true') return NextResponse.json({ error: `${flag} must be true` }, { status: 400 })
  }

  let permits = gate.authedClient.from('environmental_permits').select(PERMIT_COLUMNS).eq('tenant_id', gate.tenantId)
  if (status === 'active')  permits = permits.is('retired_at', null)
  if (status === 'retired') permits = permits.not('retired_at', 'is', null)
  if (program)              permits = permits.eq('program', program)
  if (params.get('business_critical') === 'true') permits = permits.eq('business_critical', true)

  const [permitRows, scope, conditions] = await Promise.all([
    permits.order('title').order('id').limit(MAX_PERMITS),
    gate.authedClient.from('ms_scope_statements').select('legal_entity')
      .eq('tenant_id', gate.tenantId).eq('discipline', 'ems')
      .order('version', { ascending: false }).limit(1).maybeSingle(),
    gate.authedClient.from('compliance_calendar_obligations').select('permit_id, status, next_due_at')
      .eq('tenant_id', gate.tenantId).not('permit_id', 'is', null).eq('status', 'open').limit(10_000),
  ])
  const failed = permitRows.error ?? scope.error ?? conditions.error
  if (failed) return sanitizeError(failed, 'environmental/permits/GET')

  const today = todayUtc()
  const legalEntityInForce = (scope.data as { legal_entity: string } | null)?.legal_entity ?? null
  const counts = conditionCountsByPermit(
    (conditions.data ?? []) as { permit_id: string | null; status: string; next_due_at: string }[], today)
  let described = ((permitRows.data ?? []) as unknown as PermitRow[])
    .map(row => describePermit(row, legalEntityInForce, today, counts.get(row.id)))
  if (standing) described = described.filter(permit => permit.standing === standing)
  if (params.get('holder_mismatch') === 'true') described = described.filter(permit => permit.holder_mismatch === true)

  return NextResponse.json({ permits: described, legalEntityInForce, asOf: today })
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)
  if (!gate.facilityId) {
    return NextResponse.json({ error: 'Select a facility: a permit is issued to a site.' }, { status: 400 })
  }

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const parsed = permitInputFrom(body)
  const owner = ownerFrom(body)
  const errors = [...(parsed.ok ? [] : parsed.errors), ...(owner.ok ? [] : owner.errors)]
  if (!parsed.ok || !owner.ok || errors.length > 0) return invalidInput(errors)
  const permit = parsed.input
  const ownerUserId = owner.input ?? null

  if (ownerUserId !== null) {
    const { member, error } = await isCurrentMember(gate.tenantId, ownerUserId)
    if (error) return sanitizeError(error, 'environmental/permits/POST owner')
    if (!member) return notAMember()
  }

  const { data, error } = await gate.authedClient
    .from('environmental_permits')
    .insert({
      tenant_id:                  gate.tenantId,
      facility_id:                gate.facilityId,
      program:                    permit.program,
      instrument:                 permit.instrument,
      title:                      permit.title,
      agency:                     permit.agency,
      permit_number:              permit.permitNumber,
      jurisdiction:               permit.jurisdiction,
      holder_of_record:           permit.holderOfRecord,
      issued_on:                  permit.issuedOn,
      expires_on:                 permit.expiresOn,
      renewal_application_due_on: permit.renewalApplicationDueOn,
      business_critical:          permit.businessCritical,
      owner_user_id:              ownerUserId,
      notes:                      permit.notes,
      created_by:                 gate.userId,
      updated_by:                 gate.userId,
    })
    .select(PERMIT_COLUMNS)
    .single()
  const code = (error as { code?: string } | null)?.code
  if (code === '23505') {
    return NextResponse.json({ error: 'A permit with this agency and number is already in the vault.' }, { status: 409 })
  }
  // The membership can go between the check above and the write; the foreign key then refuses it.
  if (code === '23503' && ownerUserId !== null) return notAMember()
  if (error) return sanitizeError(error, 'environmental/permits/POST')
  return NextResponse.json({ permit: data }, { status: 201 })
}
