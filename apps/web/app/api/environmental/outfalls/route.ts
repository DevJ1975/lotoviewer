import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { toOutfallRow, validateOutfall } from '@soteria/core/environmental/outfalls'
import { badId, invalid, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { offSiteReferenceErrors, PARTNER_AT_SITE, PERMIT_AT_SITE } from '@/lib/environmental/outfallReferences'

// Stormwater outfalls: list (members) and create (tenant admins).
// The active site scopes the list; with no active site it is the roll-up.

export const runtime = 'nodejs'

// Three ids can point at nothing, and Postgres names the constraint that failed
// (<table>_<column>_fkey), so the caller hears which one instead of a blanket
// "site not found". The permit and partner were just read, so reaching these two
// means the row was deleted in between.
function foreignKeyFailure(databaseMessage: string): Response {
  if (databaseMessage.includes('permit_id')) return invalid([PERMIT_AT_SITE])
  if (databaseMessage.includes('substantially_identical_to')) return invalid([PARTNER_AT_SITE])
  if (databaseMessage.includes('facility_id')) return Response.json({ error: 'facility_not_found' }, { status: 404 })
  return Response.json({
    error: 'invalid_reference',
    details: ['facility_id, permit_id or substantially_identical_to points at something that does not exist.'],
  }, { status: 400 })
}

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  const requested = new URL(req.url).searchParams.get('facility_id')
  if (requested && !UUID_RE.test(requested)) return badId()
  const facilityId = requested || g.facilityId

  try {
    let query = g.authedClient.from('stormwater_outfalls').select('*').eq('tenant_id', g.tenantId)
    if (facilityId) query = query.eq('facility_id', facilityId)
    const { data, error } = await query.order('code', { ascending: true })
    if (error) return sanitizeError(error, 'GET /api/environmental/outfalls')
    return Response.json({ outfalls: data ?? [] })
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/outfalls')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const raw = typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body) ? parsed.body : {}

  // The active site is the default, so a form on a site page need not repeat it.
  const result = validateOutfall({ facility_id: g.facilityId, ...raw }, { photoPathPrefix: `${g.tenantId}/` })
  if (!result.ok) return invalid(result.errors)

  try {
    const offSite = await offSiteReferenceErrors(g.authedClient, g.tenantId, result.outfall)
    if (offSite.length > 0) return invalid(offSite)

    const { data, error } = await g.authedClient.from('stormwater_outfalls')
      .insert({ tenant_id: g.tenantId, created_by: g.userId, updated_by: g.userId, ...toOutfallRow(result.outfall) })
      .select('*').single()
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return Response.json({ error: 'duplicate_outfall_code', details: ['This site already has an outfall with that code.'] }, { status: 409 })
    }
    if (error?.code === PG_FOREIGN_KEY_VIOLATION) return foreignKeyFailure(error.message)
    if (error) return sanitizeError(error, 'POST /api/environmental/outfalls')

    return Response.json({ outfall: data }, { status: 201 })
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/outfalls')
  }
}
