import { NextResponse } from 'next/server'
import { requireTenantModuleAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
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
import { ASPECT_EDITABLE, aspectInputFrom } from '@/lib/environmental/aspects'

// GET   /api/environmental/aspects/[id]   One aspect: its register row, every score it
//                                         has had (newest first), and its linked obligations.
// PATCH /api/environmental/aspects/[id]   Edit the aspect's description. Admins only.
//                                         Scores change only by adding a new score.

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const [aspect, history, links] = await Promise.all([
    gate.authedClient.from('environmental_aspect_register').select('*')
      .eq('id', id).eq('tenant_id', gate.tenantId).maybeSingle(),
    gate.authedClient.from('environmental_aspect_score_history').select('*')
      .eq('aspect_id', id).eq('tenant_id', gate.tenantId)
      .order('scored_at', { ascending: false }).order('id', { ascending: false }),
    gate.authedClient.from('environmental_aspect_obligations').select('obligation_id')
      .eq('aspect_id', id).eq('tenant_id', gate.tenantId),
  ])
  const failed = aspect.error ?? history.error ?? links.error
  if (failed) return sanitizeError(failed, 'environmental/aspects/[id]/GET')
  if (!aspect.data) return notFound()

  return NextResponse.json({
    aspect:        aspect.data,
    history:       history.data ?? [],
    obligationIds: (links.data ?? []).map(link => (link as { obligation_id: string }).obligation_id),
  })
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const edits = (Object.keys(ASPECT_EDITABLE) as (keyof typeof ASPECT_EDITABLE)[]).filter(column => column in body)
  if (edits.length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

  const { data: current, error: readError } = await gate.authedClient
    .from('environmental_aspects')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/aspects/[id]/PATCH read')
  if (!current) return notFound()

  const parsed = aspectInputFrom({ ...current, ...body })
  if (!parsed.ok) return invalidInput(parsed.errors)

  const patch: Record<string, unknown> = { updated_by: gate.userId }
  for (const column of edits) patch[column] = parsed.input[ASPECT_EDITABLE[column]]

  const { data, error } = await gate.authedClient
    .from('environmental_aspects')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*')
    .maybeSingle()
  if (error) return sanitizeError(error, 'environmental/aspects/[id]/PATCH')
  if (!data) return notFound()
  return NextResponse.json({ aspect: data })
}
