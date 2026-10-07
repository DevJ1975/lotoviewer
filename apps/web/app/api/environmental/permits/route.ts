import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { permitHealth, toPermitRow, validatePermit } from '@soteria/core/environmental/permits'
import { badId, invalid, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { syncPermitRenewal, type SyncablePermit } from '@/lib/environmental/permitSync'

// Environmental permits: list (members) and create (tenant admins).
// The active site scopes the list; with no active site it is the roll-up.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  const requested = new URL(req.url).searchParams.get('facility_id')
  if (requested && !UUID_RE.test(requested)) return badId()
  const facilityId = requested || g.facilityId

  try {
    let query = g.authedClient.from('environmental_permits').select('*').eq('tenant_id', g.tenantId)
    if (facilityId) query = query.eq('facility_id', facilityId)
    const { data, error } = await query.order('expiration_date', { ascending: true, nullsFirst: false })
    if (error) return sanitizeError(error, 'GET /api/environmental/permits')

    const now = new Date()
    const permits = (data ?? []).map(p => ({
      ...p,
      health: permitHealth({ status: p.status, expirationDate: p.expiration_date, renewalLeadDays: p.renewal_lead_days }, now),
    }))
    return Response.json({ permits })
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/permits')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const raw = typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body) ? parsed.body : {}

  // The active site is the default, so a form on a site page need not repeat it.
  const result = validatePermit({ facility_id: g.facilityId, ...raw }, { documentPathPrefix: `${g.tenantId}/` })
  if (!result.ok) return invalid(result.errors)

  try {
    const { data, error } = await g.authedClient.from('environmental_permits')
      .insert({ tenant_id: g.tenantId, created_by: g.userId, updated_by: g.userId, ...toPermitRow(result.permit) })
      .select('*').single()
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return Response.json({ error: 'duplicate_permit_number', details: ['This site already has a permit with that number for this program.'] }, { status: 409 })
    }
    if (error?.code === PG_FOREIGN_KEY_VIOLATION) return Response.json({ error: 'facility_not_found' }, { status: 404 })
    if (error) return sanitizeError(error, 'POST /api/environmental/permits')

    await syncPermitRenewal(g.authedClient, { tenantId: g.tenantId, userId: g.userId }, data as SyncablePermit)
    return Response.json({ permit: data }, { status: 201 })
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/permits')
  }
}
