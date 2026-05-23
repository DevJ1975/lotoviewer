import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  scoreInspection,
  evaluateNumeric,
  type InspectionItemType,
  type ResponseResult,
  type ScoreItem,
  type ScoreResponse,
} from '@soteria/core/inspectionScoring'

// Submit an inspection: persist responses, score it, and close it out.
// Failed items flagged fail_creates_action are returned as actionItemIds so
// the UI can surface required corrective actions (formal CAPA queueing is a
// follow-up pending the cross-module action model).

export const runtime = 'nodejs'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface IncomingResponse {
  item_id?: unknown; value?: unknown; result?: unknown; evidence_id?: unknown; note?: unknown
}

function coerceResult(v: unknown): ResponseResult | null {
  return v === 'pass' || v === 'fail' || v === 'na' ? v : null
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantModuleMember(req, 'inspections')
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid_id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }
  const incoming = Array.isArray(body.responses) ? (body.responses as IncomingResponse[]) : []

  try {
    const { data: inspection, error: insErr } = await g.authedClient
      .from('inspections').select('id, template_id, status').eq('id', id).maybeSingle()
    if (insErr) return sanitizeError(insErr, 'POST /api/inspections/[id]/submit')
    if (!inspection) return Response.json({ error: 'not_found' }, { status: 404 })
    if (inspection.status === 'submitted') return Response.json({ error: 'already_submitted' }, { status: 409 })

    const { data: items, error: iErr } = await g.authedClient
      .from('inspection_template_items')
      .select('id, item_type, weight, fail_creates_action, config')
      .eq('template_id', inspection.template_id as string)
    if (iErr) return sanitizeError(iErr, 'POST /api/inspections/[id]/submit')
    const itemById = new Map((items ?? []).map(it => [it.id as string, it]))

    // Resolve each response's result (numeric items derive pass/fail from
    // their tolerance when not explicitly provided), then persist.
    const responseRows = incoming
      .filter(r => typeof r.item_id === 'string' && itemById.has(r.item_id))
      .map(r => {
        const item = itemById.get(r.item_id as string)!
        let result = coerceResult(r.result)
        if (result === null && item.item_type === 'numeric' && typeof r.value === 'number') {
          const cfg = (item.config ?? {}) as { min?: number; max?: number }
          result = evaluateNumeric(r.value, cfg.min ?? null, cfg.max ?? null)
        }
        return {
          tenant_id:     g.tenantId,
          inspection_id: id,
          item_id:       r.item_id as string,
          value:         r.value ?? null,
          result,
          evidence_id:   typeof r.evidence_id === 'string' ? r.evidence_id : null,
          note:          typeof r.note === 'string' ? r.note : null,
        }
      })

    if (responseRows.length > 0) {
      const { error: upErr } = await g.authedClient
        .from('inspection_responses')
        .upsert(responseRows, { onConflict: 'inspection_id,item_id' })
      if (upErr) return sanitizeError(upErr, 'POST /api/inspections/[id]/submit')
    }

    const scoreItems: ScoreItem[] = (items ?? []).map(it => ({
      id: it.id as string,
      type: it.item_type as InspectionItemType,
      weight: typeof it.weight === 'number' ? it.weight : Number(it.weight ?? 1),
      failCreatesAction: it.fail_creates_action === true,
    }))
    const scoreResponses: ScoreResponse[] = responseRows.map(r => ({ itemId: r.item_id, result: r.result }))
    const scored = scoreInspection(scoreItems, scoreResponses)

    const { data: updated, error: uErr } = await g.authedClient
      .from('inspections')
      .update({
        status:       'submitted',
        score:        scored.score,
        max_score:    scored.maxScore,
        result:       scored.result,
        submitted_at: new Date().toISOString(),
        submitted_by: g.userId,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()
    if (uErr) return sanitizeError(uErr, 'POST /api/inspections/[id]/submit')

    return Response.json({
      inspection:    updated,
      score:         scored,
      actionItemIds: scored.actionItemIds,
    })
  } catch (e) {
    return sanitizeError(e, 'POST /api/inspections/[id]/submit')
  }
}
