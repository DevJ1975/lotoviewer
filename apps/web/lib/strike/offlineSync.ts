import type { SupabaseClient } from '@supabase/supabase-js'
import {
  clampDeviceTimestamp,
  parseStrikeOfflineEnvelope,
  type StrikeOfflineAttemptEnvelope,
  type StrikeOfflineEvent,
} from '@soteria/core/strikeOfflineSync'
import {
  gradeAndRecordAttempt,
  openOfflineAttempt,
  recordBlockEvents,
  resolveMemberIdForUser,
  type StrikeLearner,
  type StrikeResult,
} from '@/lib/strike/attempts'
import type { StrikeDevice } from '@/lib/strike/deviceAuth'
import { loadPublishedStrikeVersion, type StrikeVersionRow } from '@/lib/strike/moduleAccess'

// One offline attempt, replayed on the server. The device already showed the
// worker a provisional result; this is the official one. Everything the online
// routes enforce still applies, because it is the same grading path
// (gradeAndRecordAttempt): attempt ownership, required blocks, retake limits,
// assignment targeting and double-submit protection. The only differences are
// the clock (the device's, clamped) and the idempotency key (the device's id).

/** Statuses an offline attempt is accepted against: published when it was downloaded, possibly superseded since. */
const ACCEPTED_VERSION_STATUSES = ['published', 'superseded'] as const

const EVENTS_PER_WRITE = 50

export type OfflineRejection =
  | 'invalid'
  | 'clock'
  | 'member'
  | 'version_unavailable'
  | 'retake_limit'
  | 'incomplete'
  | 'conflict'

/**
 * `synced`: the server has it, and the device may delete its copy.
 * `rejected`: the server will never accept it; retrying cannot help.
 * `retry`: something transient failed; keep it and try again later.
 */
export type OfflineSyncResult =
  | { client_attempt_id: string; status: 'synced'; attempt_id: string; submitted: boolean; passed: boolean | null; score_percent: number | null }
  | { client_attempt_id: string; status: 'rejected'; reason: OfflineRejection; message: string }
  | { client_attempt_id: string; status: 'retry' }

/** Who is syncing: an enrolled tablet (kiosk, many workers) or a signed-in user's own tablet. */
export interface OfflineCaller {
  tenantId: string
  device: StrikeDevice | null
  user: { userId: string; role: string } | null
}

export async function syncOfflineAttempt(
  admin: SupabaseClient,
  caller: OfflineCaller,
  raw: unknown,
  now = new Date(),
): Promise<OfflineSyncResult> {
  const clientAttemptId = idOf(raw)
  const reject = (reason: OfflineRejection, message: string): OfflineSyncResult =>
    ({ client_attempt_id: clientAttemptId, status: 'rejected', reason, message })

  const parsed = parseStrikeOfflineEnvelope(raw)
  if (!parsed.ok) return reject('invalid', parsed.issues[0]?.message ?? 'Malformed attempt.')
  const envelope = parsed.envelope

  const clocks = clampEnvelopeClocks(envelope, now)
  if (!clocks.ok) return reject('clock', `This device's clock is ${clocks.reason}: ${clocks.field}.`)

  const learner = await resolveLearner(admin, caller, envelope)
  if (!learner.ok) return reject('member', learner.message)

  const versionLookup = await loadOfflineVersion(admin, caller.tenantId, envelope.module_version_id)
  if (!versionLookup.ok) return reject('version_unavailable', versionLookup.message)
  const { moduleId, version } = versionLookup.value

  const opened = await openOfflineAttempt(admin, learner.value, {
    moduleId,
    version,
    assignmentId: envelope.assignment_id,
    clientAttemptId: envelope.client_attempt_id,
    deviceId: caller.device?.id ?? null,
    startedAt: clocks.startedAt,
  })
  if (!opened.ok) return reject('conflict', opened.message)
  const { attemptId } = opened.value

  const synced = (o: { submitted: boolean; passed: boolean | null; scorePercent: number | null }): OfflineSyncResult => ({
    client_attempt_id: envelope.client_attempt_id,
    status: 'synced',
    attempt_id: attemptId,
    submitted: o.submitted,
    passed: o.passed,
    score_percent: o.scorePercent,
  })

  // A replay of an attempt the server already graded: hand back what it decided.
  if (opened.value.submitted) return synced(opened.value)

  for (let i = 0; i < clocks.events.length; i += EVENTS_PER_WRITE) {
    const chunk = clocks.events.slice(i, i + EVENTS_PER_WRITE)
    const recorded = await recordBlockEvents(admin, learner.value, {
      moduleId,
      version,
      attemptId,
      events: chunk,
      at: new Date(chunk[chunk.length - 1].occurred_at),
    })
    if (!recorded.ok) return reject(recorded.status === 400 ? 'invalid' : 'conflict', recorded.message)
  }

  if (!envelope.submission || !clocks.submittedAt) return synced({ submitted: false, passed: null, scorePercent: null })

  const graded = await gradeAndRecordAttempt(admin, learner.value, {
    moduleId,
    version,
    attemptId,
    assignmentId: envelope.assignment_id,
    answers: envelope.submission.answers,
    watch: null,
    offline: {
      submittedAt: clocks.submittedAt,
      deviceId: caller.device?.id ?? null,
      provisionalPassed: envelope.submission.provisional_passed,
    },
  })
  if (graded.ok) {
    return synced({ submitted: true, passed: graded.value.passed, scorePercent: graded.value.scorePercent })
  }
  return rejectionForGradingFailure(graded, async () => {
    // Another sync of this attempt submitted it first: report that outcome.
    const again = await openOfflineAttempt(admin, learner.value, {
      moduleId, version, assignmentId: envelope.assignment_id, clientAttemptId: envelope.client_attempt_id,
      deviceId: caller.device?.id ?? null, startedAt: clocks.startedAt,
    })
    return again.ok ? synced(again.value) : reject('conflict', again.message)
  }, reject)
}

async function rejectionForGradingFailure(
  failure: Extract<StrikeResult<unknown>, { ok: false }>,
  alreadySubmitted: () => Promise<OfflineSyncResult>,
  reject: (reason: OfflineRejection, message: string) => OfflineSyncResult,
): Promise<OfflineSyncResult> {
  switch (failure.code) {
    case 'already_submitted': return alreadySubmitted()
    case 'retake_limit': return reject('retake_limit', failure.message)
    case 'incomplete': return reject('incomplete', failure.message)
    default: return reject(failure.status >= 400 && failure.status < 500 ? 'invalid' : 'conflict', failure.message)
  }
}

function idOf(raw: unknown): string {
  const id = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).client_attempt_id : null
  return typeof id === 'string' ? id : ''
}

type ClockCheck =
  | { ok: true; startedAt: Date; submittedAt: Date | null; events: StrikeOfflineEvent[] }
  | { ok: false; reason: string; field: string }

/** Pulls every device timestamp inside the accepted window; one bad clock refuses the whole attempt. */
function clampEnvelopeClocks(envelope: StrikeOfflineAttemptEnvelope, now: Date): ClockCheck {
  const started = clampDeviceTimestamp(envelope.started_at, { now })
  if (!started.ok) return { ok: false, reason: started.reason, field: 'started_at' }
  let submittedAt: Date | null = null
  if (envelope.submission) {
    const submitted = clampDeviceTimestamp(envelope.submission.submitted_at, { now })
    if (!submitted.ok) return { ok: false, reason: submitted.reason, field: 'submitted_at' }
    submittedAt = submitted.at
  }
  const events: StrikeOfflineEvent[] = []
  for (const [index, event] of envelope.events.entries()) {
    const at = clampDeviceTimestamp(event.occurred_at, { now })
    if (!at.ok) return { ok: false, reason: at.reason, field: `events[${index}].occurred_at` }
    events.push({ ...event, occurred_at: at.at.toISOString() })
  }
  return { ok: true, startedAt: started.at, submittedAt, events }
}

async function resolveLearner(
  admin: SupabaseClient,
  caller: OfflineCaller,
  envelope: StrikeOfflineAttemptEnvelope,
): Promise<StrikeResult<StrikeLearner>> {
  if (caller.user) {
    return {
      ok: true,
      value: {
        tenantId: caller.tenantId,
        userId: caller.user.userId,
        memberId: await resolveMemberIdForUser(admin, caller.tenantId, caller.user.userId),
        role: caller.user.role,
        channel: 'account',
      },
    }
  }

  const device = caller.device
  if (!device || !envelope.member_id) return { ok: false, status: 400, message: 'A shared tablet must say which worker took the training.' }
  const { data: member, error } = await admin
    .from('members')
    .select('id,tenant_id,status,department,site_label')
    .eq('id', envelope.member_id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const inScope = !!member
    && (device.department === null || member.department === device.department)
    && (device.siteLabel === null || member.site_label === device.siteLabel)
  if (!member || member.tenant_id !== caller.tenantId || member.status !== 'active' || !inScope) {
    return { ok: false, status: 403, message: 'This worker is not active on this tablet.' }
  }
  return {
    ok: true,
    value: {
      tenantId: caller.tenantId,
      userId: null,
      memberId: member.id as string,
      role: null,
      channel: 'kiosk',
      kioskIssuedBy: device.enrolledBy ?? undefined,
    },
  }
}

async function loadOfflineVersion(
  admin: SupabaseClient,
  tenantId: string,
  versionId: string,
): Promise<StrikeResult<{ moduleId: string; version: StrikeVersionRow }>> {
  const { data: row, error } = await admin.from('strike_module_versions').select('module_id').eq('id', versionId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) return { ok: false, status: 404, message: 'This training is no longer available.' }
  const lookup = await loadPublishedStrikeVersion(admin, {
    moduleId: row.module_id as string,
    moduleVersionId: versionId,
    tenantId,
    role: 'member',
    statuses: ACCEPTED_VERSION_STATUSES,
  })
  if (!lookup.ok) return { ok: false, status: lookup.status, message: 'This training is no longer available.' }
  // The offline player only plays block modules; a legacy video-only version has nothing to replay.
  if (lookup.version.content == null) return { ok: false, status: 404, message: 'This training is no longer available.' }
  return { ok: true, value: { moduleId: row.module_id as string, version: lookup.version } }
}
