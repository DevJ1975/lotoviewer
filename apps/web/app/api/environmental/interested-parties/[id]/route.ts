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
import { interestedPartyInputFrom, retirementFrom, unknownObligation } from '@/lib/environmental/contextRegisters'

// PATCH /api/environmental/interested-parties/[id]   Edit a party, retire it
//   (retired_reason: "why"), or reinstate it (retired_reason: null). Admins only.

const EDITABLE = {
  discipline:         'discipline',
  name:               'name',
  needs_expectations: 'needsExpectations',
  becomes_obligation: 'becomesObligation',
  obligation_id:      'obligationId',
} as const

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const { data: current, error: readError } = await gate.authedClient
    .from('ms_interested_parties')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/interested-parties/[id]/PATCH read')
  if (!current) return notFound()

  const edits = (Object.keys(EDITABLE) as (keyof typeof EDITABLE)[]).filter(column => column in body)
  if (edits.length === 0 && !('retired_reason' in body)) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  }
  const parsed = interestedPartyInputFrom({ ...current, ...body })
  if (!parsed.ok) return invalidInput(parsed.errors)

  const patch: Record<string, unknown> = { updated_by: gate.userId }
  for (const column of edits) patch[column] = parsed.input[EDITABLE[column]]
  if ('retired_reason' in body) {
    const retirement = retirementFrom(body.retired_reason, current)
    if (!retirement.ok) return invalidInput(retirement.errors)
    Object.assign(patch, retirement.input)
  }

  const { data, error } = await gate.authedClient
    .from('ms_interested_parties')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*')
    .maybeSingle()
  if (error?.code === '23503') return unknownObligation()
  if (error) return sanitizeError(error, 'environmental/interested-parties/[id]/PATCH')
  if (!data) return notFound()
  return NextResponse.json({ party: data })
}
