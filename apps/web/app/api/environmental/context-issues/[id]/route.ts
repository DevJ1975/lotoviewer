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
import { contextIssueInputFrom, retirementFrom } from '@/lib/environmental/contextRegisters'

// PATCH /api/environmental/context-issues/[id]   Edit an issue, retire it
//   (retired_reason: "why"), or reinstate it (retired_reason: null). Admins only.

const EDITABLE = ['discipline', 'kind', 'description', 'relevance', 'effect'] as const

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const { data: current, error: readError } = await gate.authedClient
    .from('ms_context_issues')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/context-issues/[id]/PATCH read')
  if (!current) return notFound()

  const edits = EDITABLE.filter(field => field in body)
  if (edits.length === 0 && !('retired_reason' in body)) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  }
  const parsed = contextIssueInputFrom({ ...current, ...body })
  if (!parsed.ok) return invalidInput(parsed.errors)

  const patch: Record<string, unknown> = { updated_by: gate.userId }
  for (const field of edits) patch[field] = parsed.input[field]
  if ('retired_reason' in body) {
    const retirement = retirementFrom(body.retired_reason, current)
    if (!retirement.ok) return invalidInput(retirement.errors)
    Object.assign(patch, retirement.input)
  }

  const { data, error } = await gate.authedClient
    .from('ms_context_issues')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*')
    .maybeSingle()
  if (error) return sanitizeError(error, 'environmental/context-issues/[id]/PATCH')
  if (!data) return notFound()
  return NextResponse.json({ issue: data })
}
