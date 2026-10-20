import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import {
  strikeXapiActivityId,
  strikeXapiActor,
  strikeXapiStatement,
  type StrikeXapiEvent,
  type StrikeXapiLearner,
} from '@soteria/core/strikeXapi'
import type { StrikeLearner } from '@/lib/strike/attempts'
import type { StrikeVersionRow } from '@/lib/strike/moduleAccess'

// The learner-path half of LMS sync: turn learning events into xAPI
// statements in the outbox. Delivery is lib/strike/lrs.ts, on a cron, so a
// slow or broken LMS never slows a learner down.

/**
 * Deterministic statement id: one (attempt, verb, activity) is one
 * statement, so a retried request can't enqueue it twice and a re-sent
 * statement is one the LRS already holds. Laid out as an RFC 4122 v5 UUID
 * because LRSs validate the format.
 */
export function strikeXapiStatementId(registration: string, verb: string, activityId: string): string {
  const hex = createHash('sha256').update(`${registration}|${verb}|${activityId}`).digest('hex')
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Appends statements for these events when the tenant has an enabled LRS;
 * otherwise does nothing. Never throws: LMS sync must not fail an attempt.
 */
export async function enqueueStrikeXapi(
  admin: SupabaseClient,
  learner: StrikeLearner,
  opts: {
    moduleId: string
    version: Pick<StrikeVersionRow, 'id' | 'locale' | 'title'>
    attemptId: string
    events: StrikeXapiEvent[]
  },
): Promise<void> {
  if (opts.events.length === 0) return
  try {
    const { data: endpoint, error } = await admin
      .from('strike_lrs_endpoints')
      .select('enabled')
      .eq('tenant_id', learner.tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!endpoint?.enabled) return

    const [{ data: moduleRow, error: moduleErr }, identity] = await Promise.all([
      admin.from('strike_modules').select('title').eq('id', opts.moduleId).maybeSingle(),
      loadLearnerIdentity(admin, learner),
    ])
    if (moduleErr) throw new Error(moduleErr.message)

    const xapiModule = {
      moduleId: opts.moduleId,
      moduleTitle: opts.version.title ?? (moduleRow?.title as string | undefined) ?? 'STRIKE module',
      versionId: opts.version.id,
      locale: opts.version.locale,
    }
    const actor = strikeXapiActor(identity)
    const timestamp = new Date().toISOString()
    const rows = new Map<string, Record<string, unknown>>()
    for (const event of opts.events) {
      const activityId = strikeXapiActivityId(xapiModule, 'block' in event && event.block ? event.block.key : null)
      const id = strikeXapiStatementId(opts.attemptId, event.verb, activityId)
      rows.set(id, {
        id,
        tenant_id: learner.tenantId,
        attempt_id: opts.attemptId,
        verb: event.verb,
        statement: strikeXapiStatement({ id, timestamp, registration: opts.attemptId, actor, module: xapiModule, event }),
      })
    }

    const { error: insertErr } = await admin
      .from('strike_xapi_statements')
      .upsert([...rows.values()], { onConflict: 'id', ignoreDuplicates: true })
    if (insertErr) throw new Error(insertErr.message)
  } catch (e) {
    Sentry.captureException(e, { tags: { module: 'strike-xapi', stage: 'enqueue' } })
  }
}

async function loadLearnerIdentity(admin: SupabaseClient, learner: StrikeLearner): Promise<StrikeXapiLearner> {
  if (learner.userId) {
    const { data, error } = await admin.from('profiles').select('full_name,email').eq('id', learner.userId).maybeSingle()
    if (error) throw new Error(error.message)
    return { name: (data?.full_name as string | null) ?? null, email: (data?.email as string | null) ?? null, accountName: learner.userId }
  }
  const { data, error } = await admin.from('members').select('display_name,email').eq('id', learner.memberId).maybeSingle()
  if (error) throw new Error(error.message)
  return { name: (data?.display_name as string | null) ?? null, email: (data?.email as string | null) ?? null, accountName: `member:${learner.memberId}` }
}
