import * as Sentry from '@sentry/nextjs'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  summarizeHazardHuntMetrics,
  type HazardHuntFindingInput,
} from '@soteria/core/hazardHuntMetrics'
import { getAnthropic } from '@/lib/ai/client'
import { checkTenantBudget, checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { runDsTrendsAgent } from '@/lib/hazardHunt/agents/ds'
import type { DsTrendsResult } from '@/lib/hazardHunt/agents/schemas'

// GET /api/hazard-hunt/analytics[?narrate=1]
// Deterministic hazard-finding metrics for the dashboard (computed by the pure
// core aggregator — never an LLM). With ?narrate=1 it also runs the Data
// Scientist agent to narrate the trend (best-effort, rate-limited).

export const runtime = 'nodejs'
const WINDOW_DAYS = 90
const SURFACE = 'hazard-hunt-ds' as const
const DAY = 86_400_000

export async function GET(req: Request) {
  const g = await requireTenantModuleMember(req, 'inspections')
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  const narrate = new URL(req.url).searchParams.get('narrate') === '1'
  const recentYmd = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString().slice(0, 10)

  try {
    const [findRes, insRes] = await Promise.all([
      g.authedClient
        .from('hazard_hunt_findings')
        .select('hazard_category, status, created_at')
        .eq('tenant_id', g.tenantId),
      g.authedClient
        .from('inspections')
        .select('status, due_at, inspection_templates!inner(category)')
        .eq('tenant_id', g.tenantId)
        .eq('inspection_templates.category', 'hazard_hunt')
        .gte('due_at', recentYmd),
    ])
    if (findRes.error) return sanitizeError(findRes.error, 'GET /api/hazard-hunt/analytics')
    if (insRes.error) return sanitizeError(insRes.error, 'GET /api/hazard-hunt/analytics')

    const findings: HazardHuntFindingInput[] = (findRes.data ?? []).map(f => ({
      hazardCategory: f.hazard_category,
      status:         f.status,
      createdAt:      f.created_at,
    }))
    const hunts = (insRes.data ?? []) as { status: string | null }[]
    const metrics = summarizeHazardHuntMetrics({
      findings,
      huntsGenerated: hunts.length,
      huntsCompleted: hunts.filter(h => h.status === 'submitted').length,
      windowDays:     WINDOW_DAYS,
    })

    let narrative: DsTrendsResult | null = null
    if (narrate) narrative = await tryNarrate(g.tenantId, g.userId, metrics)

    return Response.json({ metrics, narrative })
  } catch (e) {
    return sanitizeError(e, 'GET /api/hazard-hunt/analytics')
  }
}

async function tryNarrate(
  tenantId: string,
  userId: string,
  metrics: Parameters<typeof runDsTrendsAgent>[1],
): Promise<DsTrendsResult | null> {
  try {
    const budget = await checkTenantBudget({ tenantId, userId, surface: SURFACE })
    if (!budget.ok) return null
    const limit = await checkAiRateLimit({ tenantId, userId, surface: SURFACE })
    if (!limit.ok) return null

    const client = await getAnthropic(tenantId, { timeoutMs: 60_000 })
    const out = await runDsTrendsAgent(client, metrics)
    await logAiInvocation({
      tenantId, userId, surface: SURFACE, model: out.model, status: 'success',
      inputTokens: out.usage?.input_tokens, outputTokens: out.usage?.output_tokens,
      cacheReadTokens: out.usage?.cache_read_input_tokens ?? undefined,
    })
    return out.result
  } catch (e) {
    Sentry.captureException(e, { tags: { surface: SURFACE, route: 'hazard-hunt/analytics' } })
    return null
  }
}
