import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { normalizeStateCode } from '@soteria/core/environmental/jurisdiction'
import { toProfileRow, validateSiteProfile } from '@soteria/core/environmental/siteProfile'
import { badId, invalid, notFound, PG_UNIQUE_VIOLATION, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { loadSiteContext } from '@/lib/environmental/siteContext'
import { siteDetail } from '@/lib/environmental/siteView'

// One site's environmental profile: its state, which programs apply to it, and
// how the library resolves for it.
//
// The state is the facility's own `state` column, shared with the rest of the
// product (it also decides the OSHA reporting jurisdiction), so the response says
// when a save changed it. The rest is the profile row.

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ facilityId: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)
  const { facilityId } = await ctx.params
  if (!UUID_RE.test(facilityId)) return badId()

  try {
    const site = await loadSiteContext(g.authedClient, facilityId)
    if (!site) return notFound()
    return Response.json(siteDetail(site))
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/sites/[facilityId]/profile')
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { facilityId } = await ctx.params
  if (!UUID_RE.test(facilityId)) return badId()

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  if (typeof parsed.body !== 'object' || parsed.body === null || Array.isArray(parsed.body)) return invalid(['Expected an object.'])
  const body = parsed.body as Record<string, unknown>

  try {
    const site = await loadSiteContext(g.authedClient, facilityId)
    if (!site) return notFound()

    let state = site.facility.state
    if ('state' in body) {
      if (body.state === null || body.state === '') state = null
      else {
        const normalized = typeof body.state === 'string' ? normalizeStateCode(body.state) : null
        if (normalized === null) return invalid(['state must be a two-letter US state code, such as "CA" or "TX".'])
        state = normalized
      }
    }

    const validated = validateSiteProfile(body, site.profile)
    if (!validated.ok) return invalid(validated.errors)

    const row = toProfileRow(validated.profile)
    const changed = JSON.stringify(row) !== JSON.stringify(toProfileRow(site.profile))
    const now = new Date().toISOString()
    // A confirmation vouches for the content it was given on. Editing the answers without
    // confirming again withdraws it, so "confirmed" never describes something nobody reviewed.
    const confirmation = body.confirm === true ? { confirmed_at: now, confirmed_by: g.userId }
      : changed ? { confirmed_at: null, confirmed_by: null } : {}

    // State first: it is the shared, consequential fact. Both writes are safe to repeat.
    const stateChanged = state !== site.facility.state
    if (stateChanged) {
      const { data: updated, error } = await g.authedClient.from('facilities').update({ state })
        .eq('tenant_id', g.tenantId).eq('id', facilityId).select('id')
      if (error) return sanitizeError(error, 'PUT /api/environmental/sites/[facilityId]/profile')
      if (!updated || updated.length === 0) {
        return Response.json({ error: 'facility_update_refused', details: ['You do not have permission to change this site\'s state.'] }, { status: 403 })
      }
    }

    if (changed || body.confirm === true || site.profileRow === null) {
      const write = site.profileRow
        ? g.authedClient.from('environmental_site_profiles').update({ ...row, ...confirmation, updated_by: g.userId, updated_at: now })
            .eq('tenant_id', g.tenantId).eq('facility_id', facilityId)
        : g.authedClient.from('environmental_site_profiles')
            .insert({ tenant_id: g.tenantId, facility_id: facilityId, ...row, ...confirmation, created_by: g.userId, updated_by: g.userId })
      const { error } = await write
      if (error?.code === PG_UNIQUE_VIOLATION) return Response.json({ error: 'conflict', details: ['Someone saved this profile at the same moment. Reload and try again.'] }, { status: 409 })
      if (error) return sanitizeError(error, 'PUT /api/environmental/sites/[facilityId]/profile')
    }

    const saved = await loadSiteContext(g.authedClient, facilityId)
    if (!saved) return notFound()
    return Response.json({ ...siteDetail(saved), state_changed: stateChanged })
  } catch (e) {
    return sanitizeError(e, 'PUT /api/environmental/sites/[facilityId]/profile')
  }
}
