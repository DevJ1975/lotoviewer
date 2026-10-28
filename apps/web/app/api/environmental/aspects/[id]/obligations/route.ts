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

// PUT /api/environmental/aspects/[id]/obligations   Replace the set of compliance obligations
//   an aspect is subject to: { obligation_ids: [...] }. Admins only.
//
// New links are inserted before old ones are removed. The insert is one statement, so an
// unknown obligation changes nothing; if the removal then fails, the aspect keeps a superset
// of the requested links and a retry finishes the job.

const MAX_LINKS = 200

export async function PUT(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const raw = body.obligation_ids
  if (!Array.isArray(raw) || raw.length > MAX_LINKS || !raw.every(v => typeof v === 'string' && UUID_RE.test(v))) {
    return invalidInput([{ field: 'obligationIds', message: `must be a list of up to ${MAX_LINKS} obligation ids` }])
  }
  const requested = [...new Set(raw as string[])]

  const { data: aspect, error: aspectError } = await gate.authedClient
    .from('environmental_aspects')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (aspectError) return sanitizeError(aspectError, 'environmental/aspects/[id]/obligations/PUT aspect')
  if (!aspect) return notFound()

  const { data: links, error: linksError } = await gate.authedClient
    .from('environmental_aspect_obligations')
    .select('obligation_id')
    .eq('aspect_id', id)
    .eq('tenant_id', gate.tenantId)
  if (linksError) return sanitizeError(linksError, 'environmental/aspects/[id]/obligations/PUT links')
  const linked = new Set((links ?? []).map(link => (link as { obligation_id: string }).obligation_id))

  const toAdd = requested.filter(obligationId => !linked.has(obligationId))
  const toRemove = [...linked].filter(obligationId => !requested.includes(obligationId))

  if (toAdd.length > 0) {
    const { error } = await gate.authedClient
      .from('environmental_aspect_obligations')
      .insert(toAdd.map(obligationId => ({
        tenant_id: gate.tenantId, aspect_id: id, obligation_id: obligationId, created_by: gate.userId,
      })))
    if ((error as { code?: string } | null)?.code === '23503') {
      return invalidInput([{ field: 'obligationIds', message: 'includes an obligation that is not in this organization' }])
    }
    if (error) return sanitizeError(error, 'environmental/aspects/[id]/obligations/PUT insert')
  }
  if (toRemove.length > 0) {
    const { error } = await gate.authedClient
      .from('environmental_aspect_obligations')
      .delete()
      .eq('aspect_id', id)
      .eq('tenant_id', gate.tenantId)
      .in('obligation_id', toRemove)
    if (error) return sanitizeError(error, 'environmental/aspects/[id]/obligations/PUT delete')
  }

  return NextResponse.json({ obligationIds: requested.sort() })
}
