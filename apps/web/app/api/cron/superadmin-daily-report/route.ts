import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { sendDailyReport } from '@/lib/email/sendDailyReport'

// Daily superadmin morning report.
//
// Aggregates the last 24h across:
//   - AI usage per tenant (with cap utilization %)
//   - cron success rate
//   - support ticket activity
//   - webhook delivery success %
//   - audit log volume by tenant
//   - near-miss count + severity mix
// Then asks Sonnet to synthesize a 4-6 sentence narrative + bullets
// of anomalies. Stores in superadmin_daily_reports keyed by for_date.
//
// Auth: same Bearer/internal-secret pattern as the other crons.
//       Manual trigger by a superadmin via /superadmin/run-cron sets
//       trigger=manual on the cron_runs row but the email still goes
//       out (idempotent — same for_date row gets updated).
//
// Schedule: 0 12 * * * (07:00 EST). vercel.json gets the entry.

export const runtime = 'nodejs'

const MODEL    = MODEL_BY_SURFACE['superadmin-daily-report']
const SURFACE  = 'superadmin-daily-report' as const

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth     = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer   = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret     = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret     && bearer   && safeEqual(bearer,   cronSecret))     return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer   && safeEqual(bearer,   internalSecret)) return true
  return false
}

const SCHEMA = {
  type: 'object',
  properties: {
    narrative: {
      type: 'string',
      description: '4-6 sentence prose summary of operational health across all tenants. Lead with anything urgent. Use plain prose, no headings, no markdown.',
    },
    anomalies: {
      type: 'array',
      description: 'Short bullets calling out anything outside the norm: AI cap >80%, multiple cron failures, webhook delivery <80% on a tenant, sudden ticket volume spike, etc. Empty if nothing.',
      items: { type: 'string' },
    },
  },
  required: ['narrative', 'anomalies'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `You are an SRE/operations analyst for Soteria FIELD, a multi-tenant industrial-safety SaaS. Each morning you receive aggregate metrics for the last 24h and produce a brief health narrative for the on-call superadmin.

Style:
- 4-6 sentences. Conversational but precise. No headings, no bullets in the narrative field. No markdown.
- Lead with what matters most: anything broken, then anything spiked, then steady-state context.
- Name tenants when something is tenant-specific.

Anomalies (separate field, list of short strings):
- AI spend > 80% of cap on any tenant (or no cap but jump > 3x baseline you can infer)
- Cron job with > 1 failure in the window
- Webhook delivery success rate < 80% on any tenant with > 5 attempts
- Support ticket spike (> 2x prior 7-day average)
- Audit-log volume spike on a single actor (>50 rows in 24h)

If nothing is anomalous, return an empty anomalies array. Use only the data provided. Do not invent activity.`

interface DailyMetrics {
  for_date:     string                       // YYYY-MM-DD UTC
  window_hours: number
  ai: {
    total_invocations: number
    total_spend_usd:   number
    by_tenant: Array<{
      tenant_name: string
      invocations: number
      spend_usd:   number
      cap_usd:     number | null
      cap_pct:     number | null
    }>
    cache_hit_rate: number
    error_count:    number
    budget_blocked_count: number
  }
  cron: {
    runs:       number
    successes:  number
    errors:     number
  }
  webhooks: {
    total: number
    ok:    number
    fail:  number
    pending: number
    by_tenant: Array<{ tenant_name: string; total: number; ok: number; fail: number }>
  }
  support: {
    new_tickets:    number
    open_total:     number
  }
  audit: {
    rows: number
    top_actors: Array<{ actor: string; rows: number; tenant_name: string | null }>
  }
  near_miss: {
    new: number
    severity_mix: Record<string, number>
  }
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return withCronLogging(req, () => runCron())
}

async function runCron(): Promise<NextResponse> {
  const admin     = supabaseAdmin()
  const now       = new Date()
  const since     = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const sinceISO  = since.toISOString()
  const forDate   = now.toISOString().slice(0, 10)

  // Aggregate everything in parallel — these are independent reads.
  const [
    { data: aiRows },
    { data: cronRows },
    { data: webhookRows },
    { data: ticketsNew },
    { data: ticketsOpen },
    { data: auditRows },
    { data: nmRows },
    { data: tenantRows },
  ] = await Promise.all([
    admin.from('ai_invocations')
      .select('tenant_id, model, status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens')
      .gte('occurred_at', sinceISO).limit(50_000),
    admin.from('cron_runs')
      .select('cron_path, status').gte('started_at', sinceISO).limit(2_000),
    admin.from('loto_webhook_deliveries')
      .select('tenant_id, response_status, completed_at').gte('fired_at', sinceISO).limit(20_000),
    admin.from('support_tickets')
      .select('id').gte('created_at', sinceISO).limit(1_000),
    admin.from('support_tickets')
      .select('id', { count: 'exact', head: true }).is('resolved_at', null).is('archived_at', null),
    admin.from('audit_log')
      .select('actor_email, tenant_id').gte('created_at', sinceISO).limit(20_000),
    admin.from('near_misses')
      .select('severity_potential').gte('reported_at', sinceISO).limit(2_000),
    admin.from('tenants')
      .select('id, name, settings'),
  ])

  // Build a tenant lookup so we can name things.
  const tenantById = new Map<string, { name: string; capCents: number | null }>()
  for (const t of (tenantRows ?? []) as Array<{ id: string; name: string; settings: { ai_daily_budget_cents?: number } | null }>) {
    const cap = t.settings?.ai_daily_budget_cents
    tenantById.set(t.id, {
      name:    t.name,
      capCents: typeof cap === 'number' && cap > 0 ? cap : null,
    })
  }

  // ── AI rollup ──────────────────────────────────────────────────────
  // Pull pricing in via the aggregator (reuse, don't reimplement).
  const { costForInvocation } = await import('@/lib/ai/usageAggregator')
  type AiBucket = { invocations: number; spendUsd: number; cacheRead: number; uncachedInput: number; errors: number; bb: number }
  const aiByTenant = new Map<string, AiBucket>()
  let aiTotal: AiBucket = { invocations: 0, spendUsd: 0, cacheRead: 0, uncachedInput: 0, errors: 0, bb: 0 }
  for (const r of (aiRows ?? []) as Array<{
    tenant_id: string | null; model: string; status: string;
    input_tokens: number | null; output_tokens: number | null;
    cache_read_tokens: number | null; cache_write_tokens: number | null
  }>) {
    const cost = costForInvocation(r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens)
    aiTotal.invocations  += 1
    aiTotal.spendUsd     += cost
    aiTotal.cacheRead    += r.cache_read_tokens ?? 0
    aiTotal.uncachedInput += r.input_tokens ?? 0
    if (r.status === 'error')           aiTotal.errors += 1
    if (r.status === 'budget_blocked')  aiTotal.bb     += 1

    const tk = r.tenant_id ?? '__none__'
    const ten = aiByTenant.get(tk) ?? { invocations: 0, spendUsd: 0, cacheRead: 0, uncachedInput: 0, errors: 0, bb: 0 }
    ten.invocations  += 1
    ten.spendUsd     += cost
    aiByTenant.set(tk, ten)
  }
  const aiByTenantArr = Array.from(aiByTenant.entries())
    .filter(([k]) => k !== '__none__')
    .map(([tid, b]) => {
      const meta = tenantById.get(tid)
      const capUsd = meta?.capCents != null ? meta.capCents / 100 : null
      return {
        tenant_name: meta?.name ?? '(unknown)',
        invocations: b.invocations,
        spend_usd:   Math.round(b.spendUsd * 100) / 100,
        cap_usd:     capUsd,
        cap_pct:     capUsd != null && capUsd > 0 ? Math.round((b.spendUsd / capUsd) * 100) : null,
      }
    })
    .sort((a, b) => b.spend_usd - a.spend_usd)
    .slice(0, 8)
  const cacheable = aiTotal.cacheRead + aiTotal.uncachedInput
  const cacheHit  = cacheable > 0 ? aiTotal.cacheRead / cacheable : 0

  // ── Cron rollup ────────────────────────────────────────────────────
  let cronRuns = 0, cronSuc = 0, cronErr = 0
  for (const r of (cronRows ?? []) as Array<{ status: string }>) {
    cronRuns += 1
    if (r.status === 'success') cronSuc += 1
    if (r.status === 'error')   cronErr += 1
  }

  // ── Webhook rollup ─────────────────────────────────────────────────
  type WhBucket = { total: number; ok: number; fail: number; pending: number }
  const whByTenant = new Map<string, WhBucket>()
  let whTotal: WhBucket = { total: 0, ok: 0, fail: 0, pending: 0 }
  for (const r of (webhookRows ?? []) as Array<{ tenant_id: string | null; response_status: number | null; completed_at: string | null }>) {
    whTotal.total += 1
    const ok = r.completed_at != null && r.response_status != null && r.response_status >= 200 && r.response_status < 300
    const pending = r.completed_at == null
    if (ok)       whTotal.ok      += 1
    else if (pending) whTotal.pending += 1
    else          whTotal.fail    += 1
    if (r.tenant_id) {
      const b = whByTenant.get(r.tenant_id) ?? { total: 0, ok: 0, fail: 0, pending: 0 }
      b.total += 1
      if (ok) b.ok += 1
      else if (!pending) b.fail += 1
      else b.pending += 1
      whByTenant.set(r.tenant_id, b)
    }
  }
  const whByTenantArr = Array.from(whByTenant.entries())
    .map(([tid, b]) => ({
      tenant_name: tenantById.get(tid)?.name ?? '(unknown)',
      total:       b.total,
      ok:          b.ok,
      fail:        b.fail,
    }))
    .filter(x => x.total >= 5)
    .sort((a, b) => (a.fail / a.total) - (b.fail / b.total))
    .reverse()
    .slice(0, 5)

  // ── Audit rollup — top 5 actors by row count ──────────────────────
  const actorMap = new Map<string, { rows: number; tenantId: string | null }>()
  for (const r of (auditRows ?? []) as Array<{ actor_email: string | null; tenant_id: string | null }>) {
    const key = r.actor_email ?? '(system)'
    const a = actorMap.get(key) ?? { rows: 0, tenantId: null }
    a.rows += 1
    if (!a.tenantId && r.tenant_id) a.tenantId = r.tenant_id
    actorMap.set(key, a)
  }
  const topActors = Array.from(actorMap.entries())
    .sort((a, b) => b[1].rows - a[1].rows)
    .slice(0, 5)
    .map(([actor, v]) => ({
      actor,
      rows:        v.rows,
      tenant_name: v.tenantId ? tenantById.get(v.tenantId)?.name ?? null : null,
    }))

  // ── Near-miss rollup ──────────────────────────────────────────────
  const sevMix: Record<string, number> = {}
  for (const r of (nmRows ?? []) as Array<{ severity_potential: string }>) {
    sevMix[r.severity_potential] = (sevMix[r.severity_potential] ?? 0) + 1
  }

  const metrics: DailyMetrics = {
    for_date:     forDate,
    window_hours: 24,
    ai: {
      total_invocations: aiTotal.invocations,
      total_spend_usd:   Math.round(aiTotal.spendUsd * 100) / 100,
      by_tenant:         aiByTenantArr,
      cache_hit_rate:    Math.round(cacheHit * 1000) / 1000,
      error_count:       aiTotal.errors,
      budget_blocked_count: aiTotal.bb,
    },
    cron: {
      runs:      cronRuns,
      successes: cronSuc,
      errors:    cronErr,
    },
    webhooks: {
      total:     whTotal.total,
      ok:        whTotal.ok,
      fail:      whTotal.fail,
      pending:   whTotal.pending,
      by_tenant: whByTenantArr,
    },
    support: {
      new_tickets: (ticketsNew ?? []).length,
      open_total:  ticketsOpen?.length ?? 0,
    },
    audit: {
      rows:       (auditRows ?? []).length,
      top_actors: topActors,
    },
    near_miss: {
      new:          (nmRows ?? []).length,
      severity_mix: sevMix,
    },
  }

  // Ask Sonnet to synthesize. Tenant-less surface — uses the platform
  // env API key (no per-tenant API key for cron-driven cross-tenant
  // synthesis).
  const apiKey = process.env.ANTHROPIC_API_KEY
  let narrative = ''
  let anomalies: string[] = []
  if (!apiKey) {
    narrative = `Daily report fallback (no Anthropic API key configured): ${metrics.ai.total_invocations} AI invocations, ${metrics.cron.runs} cron runs (${metrics.cron.errors} errors), ${metrics.webhooks.total} webhook attempts (${metrics.webhooks.fail} failed), ${metrics.support.new_tickets} new tickets, ${metrics.audit.rows} audit rows.`
  } else {
    try {
      const client = new Anthropic({ apiKey })
      const response = await client.messages.create({
        model:      MODEL,
        max_tokens: 1500,
        thinking:   { type: 'adaptive' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: JSON.stringify(metrics, null, 2) }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      })
      const textBlock = response.content.find(b => b.type === 'text')
      if (textBlock && textBlock.type === 'text') {
        const parsed = JSON.parse(textBlock.text) as { narrative: string; anomalies: string[] }
        narrative = parsed.narrative
        anomalies = Array.isArray(parsed.anomalies) ? parsed.anomalies : []
      }
      await logAiInvocation({
        userId:           '00000000-0000-0000-0000-000000000000',
        tenantId:         null,
        surface:          SURFACE,
        model:            MODEL,
        status:           'success',
        inputTokens:      response.usage?.input_tokens,
        outputTokens:     response.usage?.output_tokens,
        cacheReadTokens:  response.usage?.cache_read_input_tokens     ?? undefined,
        cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? undefined,
        context:          forDate,
      })
    } catch (err) {
      Sentry.captureException(err, { tags: { route: '/api/cron/superadmin-daily-report' } })
      narrative = `AI synthesis failed for ${forDate}; raw metrics: ${metrics.ai.total_invocations} AI invocations, ${metrics.cron.errors} cron errors, ${metrics.webhooks.fail} webhook failures, ${metrics.support.new_tickets} new tickets.`
      await logAiInvocation({
        userId:   '00000000-0000-0000-0000-000000000000',
        tenantId: null, surface: SURFACE, model: MODEL, status: 'error', context: forDate,
      })
    }
  }

  // Upsert. Same for_date overwrites narrative + metrics + generated_at;
  // delivered_at remains NULL on this write so a manual regenerate
  // doesn't double-send the email — the email loop below skips when
  // delivered_at is already set within the same UTC day.
  const { data: existing } = await admin
    .from('superadmin_daily_reports')
    .select('delivered_at')
    .eq('for_date', forDate)
    .maybeSingle()
  const alreadyDelivered = existing?.delivered_at != null

  await admin.from('superadmin_daily_reports').upsert({
    for_date:     forDate,
    generated_at: new Date().toISOString(),
    narrative,
    anomalies,
    metrics,
    model:        MODEL,
    delivered_at: alreadyDelivered ? existing!.delivered_at : null,
  }, { onConflict: 'for_date' })

  // Email superadmins. Skip if already delivered today (avoids
  // double-sending on manual regenerate).
  let emailSent = 0
  let emailFail = 0
  if (!alreadyDelivered) {
    const allowlist = (process.env.SUPERADMIN_EMAILS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
    const reportUrl = `${baseUrl}/superadmin/daily-report`
    for (const to of allowlist) {
      const r = await sendDailyReport({ to, forDate, narrative, anomalies, reportUrl })
      if (r.sent) emailSent += 1
      else        emailFail += 1
    }
    if (emailSent > 0) {
      await admin.from('superadmin_daily_reports')
        .update({ delivered_at: new Date().toISOString() })
        .eq('for_date', forDate)
    }
  }

  return NextResponse.json({
    forDate,
    aiInvocations: metrics.ai.total_invocations,
    cronErrors:    metrics.cron.errors,
    anomalies:     anomalies.length,
    emailSent,
    emailFail,
    alreadyDelivered,
  })
}

export const POST = GET
