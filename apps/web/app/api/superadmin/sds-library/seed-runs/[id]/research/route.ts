import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { aiErrorToResponse, AnthropicNotConfiguredError } from '@/lib/ai/client'
import { MalformedTenantKeyError } from '@/lib/ai/getTenantApiKey'
import { researchSeedBatch } from '@/lib/sdsLibrarySeed'

// POST /api/superadmin/sds-library/seed-runs/[id]/research   { max?: number }
//
// Process the next batch of APPROVED items for this run: discover each one's
// SDS and write the global library row. Operator-driven (the same engine the
// seed-drip cron calls). Throttled by `max` — call repeatedly to drain a run.

export const runtime = 'nodejs'
// Each item runs a multi-round web_search; keep the batch small so the
// function stays inside its time budget.
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_MAX = 25
const MAX_BATCH   = 100

interface Ctx { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })

  let body: Record<string, unknown> = {}
  try { body = (await req.json()) as Record<string, unknown> }
  catch { /* default max */ }
  const maxRaw = typeof body.max === 'number' ? Math.floor(body.max) : DEFAULT_MAX
  const max = Math.min(MAX_BATCH, Math.max(1, Number.isFinite(maxRaw) ? maxRaw : DEFAULT_MAX))

  try {
    const result = await researchSeedBatch({ seedRunId: id, max })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AnthropicNotConfiguredError || err instanceof MalformedTenantKeyError) {
      const mapped = aiErrorToResponse(err, 'discover-sds')
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Seed run not found') {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    Sentry.captureException(err, { tags: { route: '/api/superadmin/sds-library/seed-runs/research' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
