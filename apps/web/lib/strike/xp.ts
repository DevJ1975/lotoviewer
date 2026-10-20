import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { curriculumCompleteEvent, xpEventsForPass, type StrikeXpEvent } from '@soteria/core/strikeGamification'

// Writes the XP ledger after a pass. Awarding is best-effort: a ledger
// failure must never undo or block the training record itself, which is
// what permits and auditors depend on, so errors are reported, not thrown.

export async function awardPassXp(
  admin: SupabaseClient,
  ctx: {
    tenantId: string
    memberId: string | null
    moduleId: string
    versionId: string
    attemptId: string
    assignmentId: string | null
    passedAt: Date
    /** Keys of the version's interaction blocks; narrated scenes also emit 'completed' but are not practice. */
    interactionKeys: ReadonlySet<string>
  },
): Promise<void> {
  if (!ctx.memberId) return
  try {
    const [{ data: solved }, { data: assignment }] = await Promise.all([
      admin.from('strike_block_events').select('block_key').eq('attempt_id', ctx.attemptId).eq('event', 'completed'),
      ctx.assignmentId
        ? admin.from('strike_assignments').select('id,due_at,curriculum_id').eq('id', ctx.assignmentId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    const events: StrikeXpEvent[] = xpEventsForPass({
      moduleId: ctx.moduleId,
      versionId: ctx.versionId,
      passedAt: ctx.passedAt,
      assignment: assignment ? { id: assignment.id as string, dueAt: assignment.due_at as string | null } : null,
      solvedBlockKeys: (solved ?? []).map(r => r.block_key as string).filter(key => ctx.interactionKeys.has(key)),
    })

    const curriculumId = assignment?.curriculum_id as string | null | undefined
    if (curriculumId && await curriculumFinished(admin, ctx.tenantId, ctx.memberId, curriculumId)) {
      events.push(curriculumCompleteEvent(curriculumId))
    }

    const { error } = await admin.from('strike_xp_events').upsert(
      events.map(e => ({
        tenant_id: ctx.tenantId,
        member_id: ctx.memberId,
        event_type: e.eventType,
        dedupe_key: e.dedupeKey,
        points: e.points,
        module_id: e.moduleId,
      })),
      { onConflict: 'tenant_id,member_id,event_type,dedupe_key', ignoreDuplicates: true },
    )
    if (error) throw new Error(error.message)
  } catch (e) {
    Sentry.captureException(e, { tags: { module: 'strike/xp' } })
  }
}

async function curriculumFinished(admin: SupabaseClient, tenantId: string, memberId: string, curriculumId: string): Promise<boolean> {
  const { data: items } = await admin.from('strike_curriculum_items').select('module_id').eq('curriculum_id', curriculumId)
  const moduleIds = (items ?? []).map(i => i.module_id as string)
  if (moduleIds.length === 0) return false
  const { data: completions } = await admin
    .from('strike_completions')
    .select('module_id')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .eq('passed', true)
    .in('module_id', moduleIds)
  return new Set((completions ?? []).map(c => c.module_id as string)).size === moduleIds.length
}
