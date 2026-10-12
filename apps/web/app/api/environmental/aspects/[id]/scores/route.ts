import { NextResponse } from 'next/server'
import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  ENVIRONMENTAL_MODULE,
  UUID_RE,
  gateFailure,
  invalidInput,
  invalidJson,
  notFound,
  readJsonObject,
  type RouteContext,
} from '@/lib/environmental/registerApi'
import { aspectScoreInputFrom, defaultScoringMethod } from '@/lib/environmental/aspects'

// POST /api/environmental/aspects/[id]/scores   Score one operating condition of an aspect
//   under the tenant's default method: { operating_condition, severity, likelihood, rationale }.
//   Admins only. Scores are history: this adds a row and never changes one. The score and
//   its significance come back from environmental_aspect_score_history, never from the client.

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const { data: aspect, error: aspectError } = await gate.authedClient
    .from('environmental_aspects')
    .select('id, obsolete_at')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (aspectError) return sanitizeError(aspectError, 'environmental/aspects/[id]/scores/POST aspect')
  if (!aspect) return notFound()
  if ((aspect as { obsolete_at: string | null }).obsolete_at) {
    return NextResponse.json({ error: 'This aspect is obsolete; it can no longer be scored.' }, { status: 409 })
  }

  const { method, error: methodError } = await defaultScoringMethod(gate.authedClient, gate.tenantId)
  if (methodError) return sanitizeError(methodError, 'environmental/aspects/[id]/scores/POST method')

  const parsed = aspectScoreInputFrom(body, method!.definition)
  if (!parsed.ok) return invalidInput(parsed.errors)
  const score = parsed.input

  const { data: inserted, error } = await gate.authedClient
    .from('environmental_aspect_scores')
    .insert({
      tenant_id:           gate.tenantId,
      aspect_id:           id,
      operating_condition: score.operatingCondition,
      severity:            score.severity,
      likelihood:          score.likelihood,
      method_id:           method!.id,
      rationale:           score.rationale,
      scored_by:           gate.userId,
    })
    .select('id')
    .single()
  if (error) return sanitizeError(error, 'environmental/aspects/[id]/scores/POST')

  const { data: scored, error: readError } = await gate.authedClient
    .from('environmental_aspect_score_history')
    .select('*')
    .eq('id', (inserted as { id: string }).id)
    .eq('tenant_id', gate.tenantId)
    .single()
  if (readError) return sanitizeError(readError, 'environmental/aspects/[id]/scores/POST read')
  return NextResponse.json({ score: scored }, { status: 201 })
}
