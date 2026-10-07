import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { applies } from '@soteria/core/environmental/applicability'
import { buildTemplateRows, checklistDueStatus } from '@soteria/core/environmental/checklists'
import { facilityRequired, invalid, notFound, readJson, refused, UUID_RE, badId } from '@/lib/environmental/http'
import { startChecklist } from '@/lib/environmental/checklistRuns'
import { supabaseRunStore } from '@/lib/environmental/checklistStore'
import { libraryVersionLabel, oldestVerification } from '@/lib/environmental/applyLibrary'
import { loadSiteContext } from '@/lib/environmental/siteContext'

// Environmental checklists for one site: what can be run (GET) and starting a run (POST).
//
// Checklists depend on a site's profile, so both need a site: the active one, or
// ?facility_id=. Anyone on the team may run a checklist; only the template
// library and the deadlines it satisfies are admin matters.

export const runtime = 'nodejs'

// Enough history to find the last completion of every template and list recent runs.
const HISTORY_LIMIT = 200
const RECENT_RUNS = 25

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  const requested = new URL(req.url).searchParams.get('facility_id')
  if (requested && !UUID_RE.test(requested)) return badId()
  const facilityId = requested || g.facilityId
  if (!facilityId) return facilityRequired()

  try {
    const site = await loadSiteContext(g.authedClient, facilityId)
    if (!site) return notFound()

    const [companions, runs] = await Promise.all([
      g.authedClient.from('environmental_checklist_templates').select('template_id, library_key, jurisdiction_key').eq('tenant_id', g.tenantId),
      g.authedClient.from('inspections')
        .select('id, title, status, result, score, max_score, started_at, submitted_at, template_id, subject_type, subject_id')
        .eq('tenant_id', g.tenantId).eq('facility_id', facilityId).eq('domain', 'environmental')
        .order('started_at', { ascending: false }).limit(HISTORY_LIMIT),
    ])
    if (companions.error) return sanitizeError(companions.error, 'GET /api/environmental/checklists')
    if (runs.error) return sanitizeError(runs.error, 'GET /api/environmental/checklists')

    const templateIdByInstance = new Map((companions.data ?? []).map(c => [`${c.library_key}|${c.jurisdiction_key}`, c.template_id as string]))
    const lastSubmittedByTemplate = new Map<string, string>()
    for (const run of runs.data ?? []) {
      if (run.status !== 'submitted' || !run.submitted_at) continue
      const when = (run.submitted_at as string).slice(0, 10)
      const seen = lastSubmittedByTemplate.get(run.template_id as string)
      if (!seen || when > seen) lastSubmittedByTemplate.set(run.template_id as string, when)
    }

    const version = { libraryVersion: libraryVersionLabel(site.library), lastVerified: oldestVerification(site.library) }
    const now = new Date()
    const templates = site.library.checklists
      .filter(t => applies(t.appliesWhen, site.applicability))
      .map(t => {
        const rows = buildTemplateRows(t, site.applicability, site.jurisdiction.chain, version)
        const templateId = templateIdByInstance.get(`${t.id}|${rows.companion.jurisdiction_key}`) ?? null
        // An interval hint only: the compliance calendar knows the regulatory period and is the authority.
        const due = checklistDueStatus(templateId ? lastSubmittedByTemplate.get(templateId) ?? null : null, t.cadence, t.cadenceDays ?? null, now)
        return {
          library_key: t.id, name: t.name, description: t.description, program: t.program, subject_type: t.subjectType,
          cadence: t.cadence, item_count: rows.items.length, source: t.source,
          template_id: templateId, last_completed_on: templateId ? lastSubmittedByTemplate.get(templateId) ?? null : null,
          due_status: due.status, due_on: due.dueOn,
        }
      })
      .filter(t => t.item_count > 0)

    return Response.json({ templates, runs: (runs.data ?? []).slice(0, RECENT_RUNS) })
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/checklists')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body) ? parsed.body : {}) as Record<string, unknown>

  const problems: string[] = []
  const text = (key: string): string | null => {
    const v = body[key]
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'string') { problems.push(`${key} must be text.`); return null }
    return v
  }
  const libraryKey = text('library_key')
  if (!libraryKey) problems.push('library_key is required: which checklist to run.')
  const subjectId = text('subject_id')
  const obligationId = text('obligation_id')
  const occurrenceAt = text('occurrence_at')
  const facilityId = text('facility_id') ?? g.facilityId
  if (facilityId && !UUID_RE.test(facilityId)) problems.push('facility_id must be an id.')
  if (obligationId && !UUID_RE.test(obligationId)) problems.push('obligation_id must be an id.')
  if (problems.length > 0) return invalid(problems)
  if (!facilityId) return facilityRequired()

  try {
    const site = await loadSiteContext(g.authedClient, facilityId)
    if (!site) return notFound()

    const outcome = await startChecklist(
      supabaseRunStore(g.authedClient, { tenantId: g.tenantId, userId: g.userId }),
      site, g.userId, { libraryKey: libraryKey!, subjectId, obligationId, occurrenceAt },
    )
    if (!outcome.ok) {
      return Response.json({ error: outcome.error, ...(outcome.detail ? { details: [outcome.detail] } : {}) }, { status: outcome.status })
    }
    return Response.json({ inspection_id: outcome.inspectionId, resumed: outcome.resumed }, { status: outcome.resumed ? 200 : 201 })
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/checklists')
  }
}
