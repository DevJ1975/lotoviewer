import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { runDriftCheck } from '@/lib/chemicalSdsDrift'
import { checkAiRateLimit } from '@/lib/ai/rateLimit'

// POST /api/chemicals/products/[id]/check-revision
//
// On-demand drift check. Reuses the cron pipeline so the manual path
// and scheduled path produce identical chemical_sds_revision_checks
// rows. Subject to the same parse-sds rate limit as the full parse,
// since a manual storm could otherwise burn through Anthropic spend.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const limit = await checkAiRateLimit({
    userId:   gate.userId,
    tenantId: gate.tenantId,
    surface:  'parse-sds',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  try {
    const admin = supabaseAdmin()
    const { data: product, error: pErr } = await admin
      .from('chemical_products')
      .select('id, tenant_id, active_sds_id, sds_source_url, sds_revision_date, archived_at')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (pErr)     return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    if (product.archived_at) {
      return NextResponse.json({ error: 'Cannot drift-check an archived chemical.' }, { status: 409 })
    }
    if (!product.sds_source_url) {
      return NextResponse.json({
        error: 'No manufacturer SDS source URL set on this chemical.',
      }, { status: 409 })
    }

    const result = await runDriftCheck({
      product:     {
        id:                product.id,
        tenant_id:         product.tenant_id,
        active_sds_id:     product.active_sds_id,
        source_url:        product.sds_source_url,
        sds_revision_date: product.sds_revision_date,
      },
      trigger:     'manual',
      triggeredBy: gate.userId,
    })
    return NextResponse.json({ result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
