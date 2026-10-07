import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { badId, notFound, refused, UUID_RE } from '@/lib/environmental/http'
import { supabaseRunStore } from '@/lib/environmental/checklistStore'

// One checklist run, shaped for the runner screen: the questions in order, each
// with its guidance and citations, and the answers given so far.

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  try {
    const run = await supabaseRunStore(g.authedClient, { tenantId: g.tenantId, userId: g.userId }).loadRun(id)
    // An inspection that is not an environmental checklist is reported as absent.
    if (!run || run.inspection.domain !== 'environmental' || !run.run) return notFound()

    return Response.json({
      inspection:    run.inspection,
      run:           run.run,
      template_name: run.templateName,
      subject_label: run.subjectLabel,
      items: [...run.items].sort((a, b) => a.sort_order - b.sort_order).map(item => ({
        id: item.id, section: item.section, prompt: item.prompt, item_type: item.item_type, required: item.required,
        critical:   item.config.critical === true,
        guidance:   typeof item.config.guidance === 'string' ? item.config.guidance : null,
        citations:  Array.isArray(item.config.citations) ? item.config.citations : [],
        clause_ref: typeof item.config.clause_ref === 'string' ? item.config.clause_ref : null,
        unit:       typeof item.config.unit === 'string' ? item.config.unit : null,
        min:        typeof item.config.min === 'number' ? item.config.min : null,
        max:        typeof item.config.max === 'number' ? item.config.max : null,
      })),
      responses: run.responses,
    })
  } catch (e) {
    return sanitizeError(e, 'GET /api/environmental/checklists/[id]')
  }
}
