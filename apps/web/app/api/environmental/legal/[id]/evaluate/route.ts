import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { validateEvaluation, validateEvidencePath } from '@soteria/core/environmental/legalRegister'
import { badId, invalid, notFound, readJson, refused, UUID_RE } from '@/lib/environmental/http'

// Record an evaluation of one register entry (tenant admins): does it apply to
// us, and are we meeting it. Who evaluated and when are set here, never taken
// from the body. The note belongs to the evaluation, so a new evaluation
// replaces the old note.

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  const parsed = await readJson(req)
  if (!parsed.ok) return parsed.response
  const raw = (typeof parsed.body === 'object' && parsed.body !== null && !Array.isArray(parsed.body) ? parsed.body : {}) as Record<string, unknown>

  const evaluation = validateEvaluation(raw)
  // Evidence is optional: left out, the entry keeps the evidence it has.
  const evidence = 'evidence_path' in raw ? validateEvidencePath(raw.evidence_path, `${g.tenantId}/`) : null
  const errors = [
    ...(evaluation.ok ? [] : evaluation.errors),
    ...(evidence && !evidence.ok ? [evidence.error] : []),
  ]
  if (!evaluation.ok || errors.length > 0) return invalid(errors)
  const { applicability, complianceStatus, note } = evaluation.evaluation

  try {
    const { data, error } = await g.authedClient.from('legal_register')
      .update({
        applicability,
        compliance_status: complianceStatus,
        evaluation_note:   note,
        last_evaluated_at: new Date().toISOString(),
        last_evaluated_by: g.userId,
        ...(evidence?.ok ? { evidence_path: evidence.path } : {}),
      })
      .eq('tenant_id', g.tenantId).eq('id', id).select('*').maybeSingle()
    if (error) return sanitizeError(error, 'POST /api/environmental/legal/[id]/evaluate')
    if (!data) return notFound()

    return Response.json({ entry: data })
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/legal/[id]/evaluate')
  }
}
