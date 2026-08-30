import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'
import { discoverSds } from '@/lib/ai/discoverSds'

// POST /api/chemicals/products/[id]/sds/discover
//
// Uses Claude's web_search tool to PROPOSE candidate manufacturer SDS PDF
// URLs for this product. It only proposes — it does not fetch or persist
// anything. A human picks a candidate, which the sibling /fetch route then
// downloads (SSRF-guarded) and the existing parse→review pipeline handles.
// Same auth / rate-limit / logging shape as the parse route.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL   = MODEL_BY_SURFACE['discover-sds']

interface Ctx { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { tenantId, userId } = gate

  const { id: productId } = await ctx.params
  if (!UUID_RE.test(productId)) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })

  const limit = await checkAiRateLimit({ userId, tenantId, surface: 'discover-sds' })
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
      .select('name, manufacturer, product_code')
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (pErr)     return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    let client: Anthropic
    try {
      client = await getAnthropic(tenantId)
    } catch (err) {
      const mapped = aiErrorToResponse(err, 'discover-sds')
      Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/chemicals/products/sds/discover' } })
      return NextResponse.json(mapped.body, { status: mapped.status })
    }

    const { candidates, usage } = await discoverSds(client, {
      productName:  product.name,
      manufacturer: product.manufacturer,
      productCode:  product.product_code,
    })

    await logAiInvocation({
      userId, tenantId, surface: 'discover-sds', model: MODEL, status: 'success',
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, context: productId,
    })

    return NextResponse.json({ candidates })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/chemicals/sds/discover' } })
    await logAiInvocation({ userId, tenantId, surface: 'discover-sds', model: MODEL, status: 'error', context: productId })
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'AI is rate-limited. Retry in a minute.' }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI error ${err.status}: ${err.message}` }, { status: 502 })
    }
    return NextResponse.json({ error: 'SDS discovery failed.' }, { status: 500 })
  }
}
