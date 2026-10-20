import type { SupabaseClient } from '@supabase/supabase-js'
import {
  missingAssistedBlocks,
  strikeAssistedAcknowledgment,
  strikeAssistedChecklist,
  uncheckedChecklistItems,
  type StrikeAssistedLocale,
} from '@soteria/core/strikeAssisted'
import type { StrikeBlockEventRecord } from '@soteria/core/strikeContent'
import { versionContent, type StrikeLearner, type StrikeResult } from '@/lib/strike/attempts'
import { loadPublishedStrikeVersion } from '@/lib/strike/moduleAccess'
import { enqueueStrikeXapi } from '@/lib/strike/xapi'
import { awardPassXp } from '@/lib/strike/xp'

// Completing an assisted (ADA) attempt: a supervisor, signed in as
// themselves, attests the checklist and signs. This is the only path that
// writes a completion without a quiz score, so it re-derives everything it
// stores — the learner, the checklist wording, that every scene was played —
// from the database rather than from the request.

export interface AssistedVerifier {
  tenantId: string
  userId: string
  name: string
}

export interface AssistedVerificationInput {
  attemptId: string
  checkedKeys: string[]
  signaturePng: string
}

interface AttemptRow {
  id: string
  tenant_id: string
  module_id: string
  module_version_id: string
  assignment_id: string | null
  user_id: string | null
  member_id: string | null
  delivery: string
  submitted_at: string | null
  client_context: { kiosk_issued_by?: unknown } | null
}

export async function verifyAssistedAttempt(
  admin: SupabaseClient,
  verifier: AssistedVerifier,
  input: AssistedVerificationInput,
): Promise<StrikeResult<{ completionId: string; signedAt: string }>> {
  const { data: attempt, error } = await admin
    .from('strike_attempts')
    .select('id,tenant_id,module_id,module_version_id,assignment_id,user_id,member_id,delivery,submitted_at,client_context')
    .eq('id', input.attemptId)
    .maybeSingle<AttemptRow>()
  if (error) throw new Error(error.message)
  if (!attempt || attempt.tenant_id !== verifier.tenantId) return { ok: false, status: 404, message: 'Training session not found.' }
  if (attempt.delivery !== 'assisted') return { ok: false, status: 409, message: 'This session is not an assisted session.' }
  if (attempt.submitted_at) return { ok: false, status: 409, message: 'This session was already verified.' }

  const learner = await loadLearner(admin, attempt)
  if (learner.profileId === verifier.userId) {
    return { ok: false, status: 403, message: 'You can’t verify your own training. Ask another supervisor.' }
  }

  const lookup = await loadPublishedStrikeVersion(admin, {
    moduleId: attempt.module_id, moduleVersionId: attempt.module_version_id, tenantId: attempt.tenant_id, role: 'member',
  })
  if (!lookup.ok) return lookup
  const version = lookup.version
  const content = versionContent(version)
  if (!content) return { ok: false, status: 400, message: 'This module has no videos to verify.' }

  const [{ data: events, error: eventsErr }, { data: moduleRow, error: moduleErr }] = await Promise.all([
    admin.from('strike_block_events').select('block_key,event').eq('attempt_id', attempt.id),
    admin.from('strike_modules').select('title').eq('id', attempt.module_id).maybeSingle(),
  ])
  if (eventsErr || moduleErr) throw new Error((eventsErr ?? moduleErr)?.message)
  const missing = missingAssistedBlocks(content, (events ?? []) as StrikeBlockEventRecord[])
  if (missing.length > 0) {
    return { ok: false, status: 422, message: `The worker still has ${missing.length} video${missing.length === 1 ? '' : 's'} to watch.` }
  }

  const locale: StrikeAssistedLocale = version.locale === 'es' ? 'es' : 'en'
  const checklist = strikeAssistedChecklist(content, { learnerName: learner.name, locale })
  const unchecked = uncheckedChecklistItems(checklist, input.checkedKeys)
  if (unchecked.length > 0) return { ok: false, status: 422, message: 'Tick every checklist item before signing.' }
  const acknowledgment = strikeAssistedAcknowledgment({ learnerName: learner.name, moduleTitle: version.title ?? (moduleRow?.title as string | undefined) ?? '', locale })

  const kioskIssuedBy = typeof attempt.client_context?.kiosk_issued_by === 'string' ? attempt.client_context.kiosk_issued_by : null
  const kioskEvidence = kioskIssuedBy ? { kiosk_issued_by: kioskIssuedBy } : {}

  const signedAt = new Date()
  const signedAtIso = signedAt.toISOString()
  const { data: verification, error: verifyErr } = await admin
    .from('strike_assisted_verifications')
    .insert({
      tenant_id: attempt.tenant_id,
      attempt_id: attempt.id,
      module_id: attempt.module_id,
      module_version_id: attempt.module_version_id,
      user_id: attempt.user_id,
      member_id: attempt.member_id,
      verifier_user_id: verifier.userId,
      verifier_name: verifier.name,
      locale,
      checklist: checklist.map(item => ({ ...item, checked: true })),
      acknowledgment,
      signature_png: input.signaturePng,
      signed_at: signedAtIso,
    })
    .select('id')
    .single()
  // The unique attempt_id makes a double-tap of Sign a no-op, not two completions.
  if (verifyErr?.code === '23505') return { ok: false, status: 409, message: 'This session was already verified.' }
  if (verifyErr) throw new Error(verifyErr.message)

  const { data: completion, error: completionErr } = await admin
    .from('strike_completions')
    .insert({
      tenant_id: attempt.tenant_id,
      module_id: attempt.module_id,
      module_version_id: attempt.module_version_id,
      assignment_id: attempt.assignment_id,
      attempt_id: attempt.id,
      user_id: attempt.user_id,
      member_id: attempt.member_id,
      completed_at: signedAtIso,
      expires_at: version.validity_days ? new Date(signedAt.getTime() + version.validity_days * 86_400_000).toISOString() : null,
      score_percent: null,
      passed: true,
      source: attempt.assignment_id ? 'assigned' : 'library',
      evidence: {
        mode: 'assisted_verified',
        channel: attempt.user_id ? 'account' : 'kiosk',
        ...kioskEvidence,
        verification_id: verification.id,
        verified_by: verifier.userId,
        verifier_name: verifier.name,
      },
    })
    .select('id')
    .single()
  if (completionErr) {
    // Without a completion the signature means nothing; remove it so the supervisor can sign again.
    await admin.from('strike_assisted_verifications').delete().eq('id', verification.id)
    throw new Error(completionErr.message)
  }

  const [{ error: linkErr }, { error: attemptErr }] = await Promise.all([
    admin.from('strike_assisted_verifications').update({ completion_id: completion.id }).eq('id', verification.id),
    admin.from('strike_attempts').update({
      submitted_at: signedAtIso,
      passed: true,
      score_percent: null,
      client_context: { mode: 'assisted', verification_id: verification.id, ...kioskEvidence },
    }).eq('id', attempt.id).is('submitted_at', null),
  ])
  if (linkErr || attemptErr) throw new Error((linkErr ?? attemptErr)?.message)

  const strikeLearner: StrikeLearner = {
    tenantId: attempt.tenant_id,
    userId: attempt.user_id,
    memberId: attempt.member_id,
    role: null,
    channel: attempt.user_id ? 'account' : 'kiosk',
  }
  await awardPassXp(admin, {
    tenantId: attempt.tenant_id,
    memberId: attempt.member_id,
    moduleId: attempt.module_id,
    versionId: attempt.module_version_id,
    attemptId: attempt.id,
    assignmentId: attempt.assignment_id,
    passedAt: signedAt,
    interactionKeys: new Set(),
  })
  await enqueueStrikeXapi(admin, strikeLearner, {
    moduleId: attempt.module_id,
    version,
    attemptId: attempt.id,
    events: [{ verb: 'completed', block: null }],
  })

  return { ok: true, value: { completionId: completion.id as string, signedAt: signedAtIso } }
}

/** The learner's display name and, when they have one, their login. */
async function loadLearner(admin: SupabaseClient, attempt: AttemptRow): Promise<{ name: string; profileId: string | null }> {
  if (attempt.user_id) {
    const { data, error } = await admin.from('profiles').select('full_name,email').eq('id', attempt.user_id).maybeSingle()
    if (error) throw new Error(error.message)
    return { name: (data?.full_name as string | null) || (data?.email as string | null) || 'the worker', profileId: attempt.user_id }
  }
  const { data, error } = await admin.from('members').select('preferred_name,display_name,profile_id').eq('id', attempt.member_id).maybeSingle()
  if (error) throw new Error(error.message)
  return {
    name: (data?.preferred_name as string | null) || (data?.display_name as string | null) || 'the worker',
    profileId: (data?.profile_id as string | null) ?? null,
  }
}
