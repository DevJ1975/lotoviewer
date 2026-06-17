// AI rate-limit + invocation logger.
//
// Backed by the public.ai_invocations table from migration 047.
// Two responsibilities:
//   1. checkAiRateLimit() — refuses calls that would exceed the
//      surface's per-user limits. Logs a 'rate_limited' row so the
//      attempt counts against the daily quota too (otherwise a bot
//      could just retry-loop past the rate-limited check).
//   2. logAiInvocation() — records the success/error outcome after
//      the Anthropic call returns. Token usage is captured when
//      available so Phase 3 can attribute spend per tenant.
//
// Both functions take the supabaseAdmin client to bypass RLS — the
// rate-limit check needs to count rows the user inserted but the
// SELECT policy doesn't allow them to see across tenants. Insert
// policy already constrains user_id to auth.uid(), so writes via
// the admin client are safe.

import { supabaseAdmin } from '@/lib/supabaseAdmin'
import * as Sentry from '@sentry/nextjs'
import { costForInvocation } from '@/lib/ai/usageAggregator'

export type AiSurface =
  | 'support-chat'
  | 'generate-loto-steps'
  | 'generate-confined-space-hazards'
  | 'classify-recordability'
  | 'parse-sds'
  | 'discover-sds'
  | 'seed-sds-list'
  | 'assistant-chat'
  | 'assistant-scan-photo'
  | 'assistant-hazards'
  | 'summarize-audit'
  | 'classify-near-miss'
  | 'superadmin-daily-report'
  | 'predict-incident-escalation'
  | 'loto-audit-fpe'
  | 'loto-audit-ds'
  | 'loto-audit-ehs'
  | 'loto-audit-author'
  | 'loto-audit-regulator'
  | 'scorecard-focus'
  | 'rca-assist'

// Per-surface limits. Tuned for typical authoring workflows:
//   generate-loto-steps          — heavy reasoning, low frequency
//   generate-confined-space-haz. — heavy reasoning, low frequency
//   support-chat                 — conversational
//   classify-recordability       — light reasoning per incident; we
//                                  cap at 30/hr because the wizard
//                                  is interactive and the user might
//                                  iterate while typing.
//   parse-sds                    — PDF-in-context, expensive per call;
//                                  cap aggressively. Most tenants only
//                                  parse during onboarding (bulk) and
//                                  on revision (rare).
export const AI_LIMITS: Record<AiSurface, { perHour: number; perDay: number }> = {
  'support-chat':                     { perHour: 30, perDay: 200 },
  'generate-loto-steps':              { perHour: 20, perDay: 100 },
  'generate-confined-space-hazards':  { perHour: 20, perDay: 100 },
  'classify-recordability':           { perHour: 30, perDay: 200 },
  'parse-sds':                        { perHour: 30, perDay: 200 },
  // SDS discovery runs a multi-round web_search loop plus a normalize
  // call — expensive, and a rare onboarding/"can't find the URL" action.
  // Cap aggressively.
  'discover-sds':                     { perHour: 15, perDay: 60 },
  // Library-seed list generation is a superadmin batch op throttled by the
  // seed run's own MAX_PER_RUN cap, not per-user limits — these values exist
  // to satisfy the Record and as a backstop if ever called interactively.
  'seed-sds-list':                    { perHour: 60, perDay: 300 },
  // Home-page assistant — conversational, expected to be the
  // highest-volume AI surface once it lands.
  'assistant-chat':                   { perHour: 60, perDay: 400 },
  // Vision-on-nameplate scan. Field workers scan once per
  // equipment-touch, but the model call is on the heavier side so
  // we cap at modest rates per user.
  'assistant-scan-photo':             { perHour: 30, perDay: 100 },
  // Hazard report generation — heavy reasoning + RAG. Capped low
  // because each call is expensive and the per-equipment result is
  // cached server-side (24h) so honest usage stays well under.
  'assistant-hazards':                { perHour: 30, perDay: 100 },
  'summarize-audit':                  { perHour: 30, perDay: 100 },
  'classify-near-miss':               { perHour: 30, perDay: 200 },
  'superadmin-daily-report':          { perHour: 10, perDay: 30 },
  // Predict-escalation runs Haiku on a single description; admins
  // typically run it once per incident triage. Capped conservatively
  // to keep cost predictable on a bursty intake day.
  'predict-incident-escalation':      { perHour: 30, perDay: 150 },
  // Multi-agent audit surfaces. A full Snak King run is ~500 equipment, one
  // call per surface each, run as a bursty batch from the audit engine. Caps
  // sit above a single full run but well below an abuse loop.
  'loto-audit-fpe':                   { perHour: 600, perDay: 4000 },
  'loto-audit-ds':                    { perHour: 600, perDay: 4000 },
  'loto-audit-ehs':                   { perHour: 600, perDay: 4000 },
  // Author only fires for the subset of machines that FAIL the EHS gate, so its
  // volume is a fraction of the other surfaces — but it rides the same bursty
  // full-run fan-out, so it gets the same generous caps.
  'loto-audit-author':                { perHour: 600, perDay: 4000 },
  // Regulator runs once per audited machine in a post-audit pass (plus one
  // program-level call per run), so it rides the same bursty full-run fan-out as
  // the other audit surfaces — same generous caps.
  'loto-audit-regulator':             { perHour: 600, perDay: 4000 },
  // EHS scorecard "where to focus" — an interactive, admin-triggered advisory
  // over the deterministic risk drivers. One call per "analyze" click; an admin
  // iterates a handful of times per review session. Conversational-class caps.
  'scorecard-focus':                  { perHour: 20, perDay: 100 },
  // RCA assist — interactive during an investigation: an admin clicks
  // "suggest next why" / "draft root cause & actions" a handful of times per
  // case and iterates. Conversational-class caps keep an active investigation
  // unblocked while bounding a retry loop.
  'rca-assist':                       { perHour: 40, perDay: 200 },
}

interface CheckArgs {
  userId:    string
  tenantId:  string | null
  surface:   AiSurface
  /** Override AI_LIMITS for tests. */
  perHour?:  number
  perDay?:   number
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: 'hourly' | 'daily'; retryAfterSec: number }

/**
 * Counts the user's recent invocations of `surface` against the
 * configured limits. Both successful AND rate_limited rows count
 * (so a bot that hammers a rate-limited endpoint can't reset by
 * retrying). Errors don't count — a transient Anthropic failure
 * shouldn't penalize the user.
 */
export async function checkAiRateLimit(args: CheckArgs): Promise<RateLimitResult> {
  const limits = AI_LIMITS[args.surface]
  const perHour = args.perHour ?? limits.perHour
  const perDay  = args.perDay  ?? limits.perDay

  const admin = supabaseAdmin()
  const now = Date.now()
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString()
  const oneDayAgo  = new Date(now - 24 * 60 * 60 * 1000).toISOString()

  // Two count() queries in parallel.
  const [hourRes, dayRes] = await Promise.all([
    admin
      .from('ai_invocations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', args.userId)
      .eq('surface', args.surface)
      .in('status', ['success', 'rate_limited'])
      .gte('occurred_at', oneHourAgo),
    admin
      .from('ai_invocations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', args.userId)
      .eq('surface', args.surface)
      .in('status', ['success', 'rate_limited'])
      .gte('occurred_at', oneDayAgo),
  ])

  if (hourRes.error || dayRes.error) {
    // If the count query itself fails, log to Sentry and let the
    // request through — better to over-spend than to hard-fail
    // legitimate users on a rate-limit infrastructure error.
    Sentry.captureException(hourRes.error ?? dayRes.error, {
      tags: { source: 'ai-rate-limit', surface: args.surface },
    })
    return { ok: true }
  }

  const hourCount = hourRes.count ?? 0
  const dayCount  = dayRes.count  ?? 0

  if (dayCount >= perDay) {
    await logAiInvocation({ ...args, status: 'rate_limited', model: '(blocked)' })
    return { ok: false, reason: 'daily', retryAfterSec: 60 * 60 * 24 }
  }
  if (hourCount >= perHour) {
    await logAiInvocation({ ...args, status: 'rate_limited', model: '(blocked)' })
    return { ok: false, reason: 'hourly', retryAfterSec: 60 * 60 }
  }
  return { ok: true }
}

interface LogArgs {
  userId:           string
  tenantId:         string | null
  surface:          AiSurface
  model:            string
  status:           'success' | 'rate_limited' | 'error' | 'budget_blocked'
  inputTokens?:     number
  outputTokens?:    number
  /** Tokens served from the prompt cache. Logged separately from
   *  inputTokens so the dashboard can distinguish chargeable from
   *  cached input. Older callers omit this. */
  cacheReadTokens?: number
  cacheWriteTokens?: number
  context?:         string
}

/**
 * Records one row in ai_invocations. Best-effort: errors are
 * captured to Sentry but don't propagate, so a logging failure
 * never breaks the user-facing AI request.
 */
export async function logAiInvocation(args: LogArgs): Promise<void> {
  try {
    const admin = supabaseAdmin()
    await admin.from('ai_invocations').insert({
      user_id:           args.userId,
      tenant_id:         args.tenantId,
      surface:           args.surface,
      model:             args.model,
      status:            args.status,
      input_tokens:      args.inputTokens     ?? null,
      output_tokens:     args.outputTokens    ?? null,
      cache_read_tokens: args.cacheReadTokens ?? null,
      cache_write_tokens: args.cacheWriteTokens ?? null,
      context:           args.context         ?? null,
    })
  } catch (e) {
    Sentry.captureException(e, {
      tags: { source: 'ai-invocation-log', surface: args.surface, status: args.status },
    })
  }
}

// ─── Tenant budget + kill switch ────────────────────────────────────
//
// Reads two optional knobs from `tenants.settings` jsonb:
//   - ai_disabled            : boolean. Hard off-switch.
//   - ai_daily_budget_cents  : int. Caps today's estimated spend.
// Both are unset by default — no enforcement until a superadmin
// configures them on a tenant. Tenant-less invocations (tenantId
// null) skip this check; nothing to read settings from.

export type TenantBudgetResult =
  | { ok: true }
  | { ok: false; reason: 'disabled';       message: string }
  | { ok: false; reason: 'budget_exceeded'; message: string; spentCents: number; capCents: number; retryAfterSec: number }

interface TenantBudgetArgs {
  tenantId: string | null
  surface:  AiSurface
  userId:   string
}

export async function checkTenantBudget(args: TenantBudgetArgs): Promise<TenantBudgetResult> {
  if (!args.tenantId) return { ok: true }

  const admin = supabaseAdmin()

  // Hot path: a single SELECT for the tenant's settings + a sum of
  // today's invocations. Both are bounded + indexed; total < 50ms.
  const [tenantRes, todayRes] = await Promise.all([
    admin.from('tenants')
      .select('settings')
      .eq('id', args.tenantId)
      .maybeSingle(),
    (() => {
      const startOfDay = new Date()
      startOfDay.setUTCHours(0, 0, 0, 0)
      return admin
        .from('ai_invocations')
        .select('model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens')
        .eq('tenant_id', args.tenantId)
        .eq('status', 'success')
        .gte('occurred_at', startOfDay.toISOString())
    })(),
  ])

  // Fail-open on infrastructure errors — same posture as
  // checkAiRateLimit. Better to over-spend than to hard-fail
  // legitimate users when the budget query itself errors.
  if (tenantRes.error) {
    Sentry.captureException(tenantRes.error, { tags: { source: 'ai-budget', tenantId: args.tenantId } })
    return { ok: true }
  }
  const settings = (tenantRes.data?.settings ?? {}) as { ai_disabled?: boolean; ai_daily_budget_cents?: number }

  if (settings.ai_disabled === true) {
    await logAiInvocation({ ...args, status: 'budget_blocked', model: '(disabled)' })
    return {
      ok: false,
      reason: 'disabled',
      message: 'AI is disabled for this tenant. Contact your administrator.',
    }
  }

  const cap = settings.ai_daily_budget_cents
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) return { ok: true }

  if (todayRes.error) {
    Sentry.captureException(todayRes.error, { tags: { source: 'ai-budget-spend', tenantId: args.tenantId } })
    return { ok: true }
  }

  // Sum today's spend. Pure JS over a small row set — no DB-side
  // aggregation because the cost math (which factors model + cache
  // tiers) lives in usageAggregator and shouldn't be duplicated.
  let spentUsd = 0
  for (const r of (todayRes.data ?? []) as Array<{
    model: string
    input_tokens: number | null
    output_tokens: number | null
    cache_read_tokens: number | null
    cache_write_tokens: number | null
  }>) {
    spentUsd += costForInvocation(
      r.model,
      r.input_tokens, r.output_tokens,
      r.cache_read_tokens, r.cache_write_tokens,
    )
  }
  const spentCents = Math.round(spentUsd * 100)

  if (spentCents >= cap) {
    await logAiInvocation({ ...args, status: 'budget_blocked', model: '(over-budget)' })
    const tomorrow = new Date()
    tomorrow.setUTCHours(24, 0, 0, 0)
    const retryAfterSec = Math.ceil((tomorrow.getTime() - Date.now()) / 1000)
    return {
      ok:      false,
      reason:  'budget_exceeded',
      message: `Daily AI budget exceeded ($${(cap / 100).toFixed(2)}). Resets at midnight UTC.`,
      spentCents,
      capCents: cap,
      retryAfterSec,
    }
  }
  return { ok: true }
}
