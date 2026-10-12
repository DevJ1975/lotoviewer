import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { parseReviewFrequency, planReview } from '@soteria/core/environmental/legalRegister'
import { badId, notFound, refused, UUID_RE } from '@/lib/environmental/http'

// Record that one register entry was reviewed today (tenant admins), and when
// the next review falls due. The body is not read: a review is dated by the
// server, so it cannot be back-dated or set into the future.

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleAdmin(req, 'environmental')
  if (!g.ok) return refused(g)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return badId()

  try {
    const { data: existing, error: readError } = await g.authedClient.from('legal_register')
      .select('id, review_frequency').eq('tenant_id', g.tenantId).eq('id', id).maybeSingle()
    if (readError) return sanitizeError(readError, 'POST /api/environmental/legal/[id]/review')
    if (!existing) return notFound()

    const { data, error } = await g.authedClient.from('legal_register')
      .update(planReview(new Date().toISOString(), parseReviewFrequency(existing.review_frequency)))
      .eq('tenant_id', g.tenantId).eq('id', id).select('*').single()
    if (error) return sanitizeError(error, 'POST /api/environmental/legal/[id]/review')

    return Response.json({ entry: data })
  } catch (e) {
    return sanitizeError(e, 'POST /api/environmental/legal/[id]/review')
  }
}
