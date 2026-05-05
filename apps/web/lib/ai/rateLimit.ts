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

export type AiSurface =
  | 'support-chat'
  | 'generate-loto-steps'
  | 'generate-confined-space-hazards'
  | 'validate-photo'

// Per-surface limits. Tuned for typical authoring workflows:
//   generate-loto-steps          — heavy reasoning, low frequency
//   generate-confined-space-haz. — heavy reasoning, low frequency
//   validate-photo               — lightweight, called per upload
export const AI_LIMITS: Record<AiSurface, { perHour: number; perDay: number }> = {
  'support-chat':                     { perHour: 30, perDay: 200 },
  'generate-loto-steps':              { perHour: 20, perDay: 100 },
  'generate-confined-space-hazards':  { perHour: 20, perDay: 100 },
  'validate-photo':                   { perHour: 60, perDay: 300 },
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
  userId:        string
  tenantId:      string | null
  surface:       AiSurface
  model:         string
  status:        'success' | 'rate_limited' | 'error'
  inputTokens?:  number
  outputTokens?: number
  context?:      string
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
      user_id:       args.userId,
      tenant_id:     args.tenantId,
      surface:       args.surface,
      model:         args.model,
      status:        args.status,
      input_tokens:  args.inputTokens ?? null,
      output_tokens: args.outputTokens ?? null,
      context:       args.context ?? null,
    })
  } catch (e) {
    Sentry.captureException(e, {
      tags: { source: 'ai-invocation-log', surface: args.surface, status: args.status },
    })
  }
}
