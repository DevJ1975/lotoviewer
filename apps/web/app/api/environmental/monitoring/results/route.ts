import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { isRealDate } from '@soteria/core/environmental/validation'
import { toResultRow, validateMonitoringResult } from '@soteria/core/environmental/monitoring'
import { badId, invalid, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { databaseFailure } from '@/lib/environmental/monitoringHttp'
import { offSiteMonitoringReferences } from '@/lib/environmental/monitoringReferences'
import { parseResultsQuery } from '@/lib/environmental/monitoringResultsQuery'

// Sample results: list (members, newest first, a page at a time) and record one (members).
// A result is recorded as the person who sends it; only tenant admins change or remove one
// afterwards (see [id]). The active site scopes the list; with no active site it is the roll-up.

export const runtime = 'nodejs'

const DAY_MS = 24 * 60 * 60 * 1000

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  const query = parseResultsQuery(new URL(req.url).searchParams)
  if (!query.ok) return invalid(query.errors)
  const { outfallId, parameter, from, to, pageSize, cursor } = query
  const facilityId = query.facilityId ?? g.facilityId

  try {
    let read = g.authedClient.from('monitoring_results').select('*').eq('tenant_id', g.tenantId)
    if (facilityId) read = read.eq('facility_id', facilityId)
    if (outfallId) read = read.eq('outfall_id', outfallId)
    if (parameter) read = read.eq('parameter', parameter)
    if (from) read = read.gte('sampled_at', `${from}T00:00:00.000Z`)
    if (to) read = read.lt('sampled_at', new Date(Date.parse(`${to}T00:00:00.000Z`) + DAY_MS).toISOString())
    // Strictly after the last row of the previous page in (sampled_at, id) order, so a result
    // recorded meanwhile moves no row from one page to another.
    if (cursor) read = read.or(`sampled_at.lt.${cursor.sampledAt},and(sampled_at.eq.${cursor.sampledAt},id.lt.${cursor.id})`)

    const { data, error } = await read
      .order('sampled_at', { ascending: false }).order('id', { ascending: false })
      .limit(pageSize + 1)
    if (error) return sanitizeError(error, 'GET /api/environmental/monitoring/results')

    const rows = data ?? []
    const page = rows.slice(0, pageSize)
    const last = page[page.length - 1]
    return Response.json({
      results: page,
      next_cursor: rows.length > pageSize && last ? `${last.sampled_at}|${last.id}` : null,
    })
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/monitoring/results')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const raw = typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body) ? parsed.body : {}

  // The active site is the default, so a form on a site page need not repeat it.
  const result = validateMonitoringResult({ facility_id: g.facilityId, ...raw }, { nowMs: Date.now(), evidencePathPrefix: `${g.tenantId}/` })
  if (!result.ok) return invalid(result.errors)

  try {
    const offSite = await offSiteMonitoringReferences(g.authedClient, g.tenantId, result.result)
    if (offSite.length > 0) return invalid(offSite)

    const { data, error } = await g.authedClient.from('monitoring_results')
      .insert({ tenant_id: g.tenantId, sampled_by: g.userId, ...toResultRow(result.result) })
      .select('*').single()
    if (error) return databaseFailure(error, 'POST /api/environmental/monitoring/results')

    return Response.json({ result: data }, { status: 201 })
  } catch (e) {
    return databaseFailure(e, 'POST /api/environmental/monitoring/results')
  }
}

// Kept for the shape checks the list shares with the other routes.
void badId
void isRealDate
void UUID_RE
