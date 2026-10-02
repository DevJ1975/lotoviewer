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
import { PERMIT_COLUMNS } from '@/lib/environmental/permits'

// POST /api/environmental/permits/[id]/retire   { retired_reason }   Retire a permit that no
//   longer applies: surrendered, terminated, replaced, or entered in error. Admins only. A
//   permit is never deleted; it stays in history and leaves every countdown.

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const reason = text(body.retired_reason)
  const errors = validateRetirementReason(reason)
  if (errors.length > 0) return invalidInput(errors)

  const { data, error } = await gate.authedClient
    .from('environmental_permits')
    .update({ retired_at: new Date().toISOString(), retired_reason: reason, updated_by: gate.userId })
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .is('retired_at', null)
    .select(PERMIT_COLUMNS)
    .maybeSingle()
  if (error) return sanitizeError(error, 'environmental/permits/[id]/retire/POST')
  if (data) return NextResponse.json({ permit: data })

  // Nothing matched: no such permit here, or it was already retired.
  const { data: existing, error: readError } = await gate.authedClient
    .from('environmental_permits')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/permits/[id]/retire/POST read')
  if (!existing) return notFound()
  return NextResponse.json({ error: 'This permit is already retired.' }, { status: 409 })
}
