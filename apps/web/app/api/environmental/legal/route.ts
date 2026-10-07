import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { LEGAL_APPLICABILITY, LEGAL_COMPLIANCE, reviewState, toLegalRow, validateLegalEntry } from '@soteria/core/environmental/legalRegister'
import { ENV_PROGRAMS } from '@soteria/core/environmental/siteProfile'
import { badId, invalid, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { isActiveMember, OWNER_NOT_MEMBER } from '@/lib/environmental/members'

// The environmental legal register: list (members) and add a custom entry
// (tenant admins). A site's list also carries the requirements that cover every
// site; with no active site it is the roll-up. Library entries arrive through
// apply-library.

export const runtime = 'nodejs'

// The filters a list accepts, named for the column they match, with the values each may take.
const FILTERS: Readonly<Record<'program' | 'compliance_status' | 'applicability', readonly string[]>> = {
  program:           ENV_PROGRAMS,
  compliance_status: LEGAL_COMPLIANCE,
  applicability:     LEGAL_APPLICABILITY,
}

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  const query = new URL(req.url).searchParams
  const requested = query.get('facility_id')
  if (requested && !UUID_RE.test(requested)) return badId()
  const facilityId = requested || g.facilityId

  const filters: Array<[column: string, value: string]> = []
  const problems: string[] = []
  for (const [column, allowed] of Object.entries(FILTERS)) {
    const value = query.get(column)
    if (!value) continue
    if (allowed.includes(value)) filters.push([column, value])
    else problems.push(`${column} must be one of: ${allowed.join(', ')}.`)
  }
  if (problems.length > 0) return invalid(problems)

  try {
    let q = g.authedClient.from('legal_register').select('*').eq('tenant_id', g.tenantId)
    // The id is a validated uuid (from the query string or the gate), so it is safe inside the filter text.
    if (facilityId) q = q.or(`facility_id.eq.${facilityId},facility_id.is.null`)
    for (const [column, value] of filters) q = q.eq(column, value)
    const { data, error } = await q.order('program', { ascending: true, nullsFirst: false }).order('title', { ascending: true })
    if (error) return sanitizeError(error, 'GET /api/environmental/legal')

    const now = new Date()
    const entries = (data ?? []).map(e => ({
      ...e,
      review: reviewState({ lastReviewedAt: e.last_reviewed_at, nextReviewDue: e.next_review_due }, now),
    }))
    return Response.json({ entries })
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/legal')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const raw = typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body) ? parsed.body : {}

  // The active site is the default; an explicit null makes it a requirement for every site.
  const result = validateLegalEntry({ facility_id: g.facilityId, ...raw }, { evidencePathPrefix: `${g.tenantId}/` })
  if (!result.ok) return invalid(result.errors)

  try {
    if (result.entry.ownerUserId && !(await isActiveMember(g.tenantId, result.entry.ownerUserId))) return invalid([OWNER_NOT_MEMBER])

    const { data, error } = await g.authedClient.from('legal_register')
      .insert({ ...toLegalRow(result.entry), tenant_id: g.tenantId, source: 'tenant', created_by: g.userId })
      .select('*').single()
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return Response.json({ error: 'duplicate_entry', details: ['This requirement is already in the register for that site.'] }, { status: 409 })
    }
    // Both the site and the owner are references; either may name something outside this account.
    if (error?.code === PG_FOREIGN_KEY_VIOLATION) {
      return Response.json({ error: 'reference_not_found', details: ['The site or owner you chose is not part of this account.'] }, { status: 404 })
    }
    if (error) return sanitizeError(error, 'POST /api/environmental/legal')

    return Response.json({ entry: data }, { status: 201 })
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/legal')
  }
}
