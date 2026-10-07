import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { badId, invalid, readJson, refused, UUID_RE } from '@/lib/environmental/http'
import { parseSubmitBody, submitChecklist } from '@/lib/environmental/checklistRuns'
import { supabaseRunStore } from '@/lib/environmental/checklistStore'

// Submit a checklist: record the answers, raise findings for failures, complete
// the deadline it satisfies, and sign. Safe to repeat after a failure: nothing is
// raised or advanced twice (see checklistRuns).

export const runtime = 'nodejs'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantModuleMember(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  const body = await readJson(req)
  if (!body.ok) return body.response
  const input = parseSubmitBody(body.body, g.tenantId)
  if (!input.ok) return invalid(input.errors)

  try {
    const outcome = await submitChecklist(
      supabaseRunStore(g.authedClient, { tenantId: g.tenantId, userId: g.userId }),
      { userId: g.userId, now: new Date() }, id, input.input,
    )
    if (!outcome.ok) {
      return Response.json({ error: outcome.error, ...(outcome.missing ? { items: outcome.missing } : {}) }, { status: outcome.status })
    }
    const { ok: _ok, ...result } = outcome
    return Response.json(result)
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/checklists/[id]/submit')
  }
}
