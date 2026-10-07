import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { badId, notFound, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { executeApply, planApply, summarizePlan } from '@/lib/environmental/applyLibrary'
import { readApplyState, supabaseLibraryStore } from '@/lib/environmental/libraryStore'
import { loadSiteContext } from '@/lib/environmental/siteContext'

// Apply the jurisdiction library to one site: the legal register entries,
// checklist templates and calendar deadlines it should have.
//
// A dry run is the default and writes nothing: it returns the plan so a person can
// see what will be added before agreeing. Only `dry_run: false` writes. Whatever the
// site already has is left alone, so applying again only fills gaps.

export const runtime = 'nodejs'

export async function POST(req: Request, ctx: { params: Promise<{ facilityId: string }> }) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { facilityId } = await ctx.params
  if (!UUID_RE.test(facilityId)) return badId()

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const dryRun = !(typeof parsed.body === 'object' && parsed.body !== null && (parsed.body as Record<string, unknown>).dry_run === false)

  try {
    const site = await loadSiteContext(g.authedClient, facilityId)
    if (!site) return notFound()

    const state = await readApplyState(g.authedClient, { tenantId: g.tenantId, facilityId })
    const plan = planApply(site, state, new Date())
    const packs = site.library.packs.map(p => ({ jurisdiction: p.jurisdiction, version: p.version, status: p.status, last_verified: p.lastVerified }))
    const summary = summarizePlan(plan)

    if (dryRun) return Response.json({ dry_run: true, plan: summary, packs })

    const result = await executeApply(
      supabaseLibraryStore(g.authedClient, { tenantId: g.tenantId, facilityId, userId: g.userId }), plan, state,
    )
    return Response.json({ dry_run: false, result, plan: summary, packs })
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/sites/[facilityId]/apply-library')
  }
}
