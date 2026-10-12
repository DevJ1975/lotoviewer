import { NextResponse } from 'next/server'
import { validateRetirementReason } from '@soteria/core/managementSystem'
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
  text,
  type RouteContext,
} from '@/lib/environmental/registerApi'

// POST /api/environmental/aspects/[id]/obsolete   Retire an aspect: { reason }. Admins only.
//   An obsolete aspect leaves the active register but keeps its scores and history;
//   aspects are never deleted (Lesson L4).

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const reason = text(body.reason)
  const errors = validateRetirementReason(reason, 'reason')
  if (errors.length > 0) return invalidInput(errors)

  const { data, error } = await gate.authedClient
    .from('environmental_aspects')
    .update({ obsolete_at: new Date().toISOString(), obsolete_reason: reason, updated_by: gate.userId })
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .is('obsolete_at', null)
    .select('*')
    .maybeSingle()
  if (error) return sanitizeError(error, 'environmental/aspects/[id]/obsolete/POST')
  if (data) return NextResponse.json({ aspect: data })

  // Nothing updated: either no such aspect here, or it was already obsolete.
  const { data: existing, error: readError } = await gate.authedClient
    .from('environmental_aspects')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/aspects/[id]/obsolete/POST read')
  if (!existing) return notFound()
  return NextResponse.json({ error: 'This aspect is already obsolete.' }, { status: 409 })
}
