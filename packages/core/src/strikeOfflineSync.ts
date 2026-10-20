// The envelope an offline STRIKE device (the Soteria STRIKE tablet app) uploads
// for one attempt it recorded while out of coverage. The online player calls
// start -> events -> submit and the server stamps its own clock on each step;
// a device that was offline for a shift can't, so it sends the whole attempt at
// once with its own ids and timestamps. The device and the sync route run the
// same validator, so a device never queues an envelope the server will refuse.
//
// Device clocks are trusted only inside a window: a timestamp slightly ahead of
// the server (clock skew) is pulled back to "now"; one far in the future, too
// old, or before the content existed is refused, so a wrong clock can't
// backdate or postdate a training record.

import { STRIKE_BLOCK_EVENTS, type StrikeBlockEvent } from './strikeContent'

export const STRIKE_OFFLINE_SYNC_MAX_BATCH = 25
export const STRIKE_OFFLINE_MAX_EVENTS = 200
export const STRIKE_OFFLINE_MAX_CLOCK_SKEW_MS = 5 * 60_000
export const STRIKE_OFFLINE_MAX_AGE_MS = 30 * 24 * 60 * 60_000

// Same caps as the online events route (apps/web/lib/strike/attempts.ts).
const MAX_DWELL_MS = 3_600_000
const MAX_DETAIL_CHARS = 2000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type StrikeOfflineAnswer = string | boolean | string[]

export interface StrikeOfflineEvent {
  block_key: string
  event: StrikeBlockEvent
  dwell_ms: number | null
  detail: Record<string, unknown>
  occurred_at: string
}

export interface StrikeOfflineSubmission {
  submitted_at: string
  answers: Record<string, StrikeOfflineAnswer>
  /** The provisional result the device showed the learner; kept for audit only. */
  provisional_passed: boolean
}

export interface StrikeOfflineAttemptEnvelope {
  /** Generated on the device; the server's idempotency key for this attempt. */
  client_attempt_id: string
  module_version_id: string
  assignment_id: string | null
  /** Kiosk devices name the roster member; personal devices learn as the signed-in user. */
  member_id: string | null
  started_at: string
  events: StrikeOfflineEvent[]
  /** Null while the learner is still part-way through the module. */
  submission: StrikeOfflineSubmission | null
}

export type StrikeTimestampRejection = 'invalid' | 'future' | 'stale' | 'before_floor'

export type StrikeTimestampCheck =
  | { ok: true; at: Date }
  | { ok: false; reason: StrikeTimestampRejection }

export interface StrikeClockWindow {
  now: Date
  /** Nothing can have happened before this, e.g. when the version was published. */
  notBefore?: Date | null
}

export function clampDeviceTimestamp(value: string, window: StrikeClockWindow): StrikeTimestampCheck {
  const at = new Date(value)
  if (typeof value !== 'string' || Number.isNaN(at.getTime())) return { ok: false, reason: 'invalid' }
  const now = window.now.getTime()
  if (at.getTime() > now + STRIKE_OFFLINE_MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'future' }
  if (at.getTime() < now - STRIKE_OFFLINE_MAX_AGE_MS) return { ok: false, reason: 'stale' }
  if (window.notBefore && at.getTime() < window.notBefore.getTime()) return { ok: false, reason: 'before_floor' }
  return { ok: true, at: new Date(Math.min(at.getTime(), now)) }
}

export interface StrikeEnvelopeIssue {
  path: string
  message: string
}

export type StrikeEnvelopeParseResult =
  | { ok: true; envelope: StrikeOfflineAttemptEnvelope }
  | { ok: false; issues: StrikeEnvelopeIssue[] }

/**
 * Shape and ordering checks only. Whether the version, assignment and member
 * exist and belong to the device's tenant is for the server to decide.
 */
export function parseStrikeOfflineEnvelope(value: unknown): StrikeEnvelopeParseResult {
  const issues: StrikeEnvelopeIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Envelope must be an object.' }] }

  const clientAttemptId = uuidField(value, 'client_attempt_id', issues)
  const moduleVersionId = uuidField(value, 'module_version_id', issues)
  const assignmentId = optionalUuidField(value, 'assignment_id', issues)
  const memberId = optionalUuidField(value, 'member_id', issues)
  const startedAt = timestampField(value, 'started_at', issues)
  const events = parseEvents(value.events, issues)
  const submission = parseSubmission(value.submission, issues)

  if (startedAt !== null) {
    const startMs = Date.parse(startedAt)
    const endMs = submission ? Date.parse(submission.submitted_at) : Number.POSITIVE_INFINITY
    if (submission && endMs < startMs) issues.push({ path: 'submission.submitted_at', message: 'Submitted before the attempt started.' })
    events.forEach((event, index) => {
      const at = Date.parse(event.occurred_at)
      if (at < startMs || at > endMs) issues.push({ path: `events[${index}].occurred_at`, message: 'Event falls outside the attempt.' })
    })
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    envelope: {
      client_attempt_id: clientAttemptId!,
      module_version_id: moduleVersionId!,
      assignment_id: assignmentId,
      member_id: memberId,
      started_at: startedAt!,
      events,
      submission,
    },
  }
}

function parseEvents(value: unknown, issues: StrikeEnvelopeIssue[]): StrikeOfflineEvent[] {
  if (!Array.isArray(value)) {
    issues.push({ path: 'events', message: 'Events must be an array.' })
    return []
  }
  if (value.length > STRIKE_OFFLINE_MAX_EVENTS) {
    issues.push({ path: 'events', message: `At most ${STRIKE_OFFLINE_MAX_EVENTS} events per attempt.` })
    return []
  }
  const events: StrikeOfflineEvent[] = []
  value.forEach((raw, index) => {
    const path = `events[${index}]`
    if (!isRecord(raw) || typeof raw.block_key !== 'string' || raw.block_key === '') {
      issues.push({ path, message: 'Each event needs a block_key.' })
      return
    }
    if (!(STRIKE_BLOCK_EVENTS as readonly string[]).includes(raw.event as string)) {
      issues.push({ path: `${path}.event`, message: 'Unknown event.' })
      return
    }
    const detail = isRecord(raw.detail) ? raw.detail : {}
    if (JSON.stringify(detail).length > MAX_DETAIL_CHARS) {
      issues.push({ path: `${path}.detail`, message: 'Event detail is too large.' })
      return
    }
    const occurredAt = timestampField(raw, 'occurred_at', issues, path)
    if (occurredAt === null) return
    const dwell = typeof raw.dwell_ms === 'number' && Number.isFinite(raw.dwell_ms)
      ? Math.max(0, Math.min(MAX_DWELL_MS, Math.round(raw.dwell_ms)))
      : null
    events.push({ block_key: raw.block_key, event: raw.event as StrikeBlockEvent, dwell_ms: dwell, detail, occurred_at: occurredAt })
  })
  return events
}

function parseSubmission(value: unknown, issues: StrikeEnvelopeIssue[]): StrikeOfflineSubmission | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) {
    issues.push({ path: 'submission', message: 'Submission must be an object or null.' })
    return null
  }
  const submittedAt = timestampField(value, 'submitted_at', issues, 'submission')
  if (!isAnswerMap(value.answers)) issues.push({ path: 'submission.answers', message: 'Answers must map question ids to strings, booleans or string lists.' })
  if (typeof value.provisional_passed !== 'boolean') issues.push({ path: 'submission.provisional_passed', message: 'provisional_passed must be a boolean.' })
  if (submittedAt === null || !isAnswerMap(value.answers) || typeof value.provisional_passed !== 'boolean') return null
  return { submitted_at: submittedAt, answers: value.answers, provisional_passed: value.provisional_passed }
}

function uuidField(record: Record<string, unknown>, key: string, issues: StrikeEnvelopeIssue[]): string | null {
  const value = record[key]
  if (typeof value === 'string' && UUID_RE.test(value)) return value.toLowerCase()
  issues.push({ path: key, message: `${key} must be a UUID.` })
  return null
}

function optionalUuidField(record: Record<string, unknown>, key: string, issues: StrikeEnvelopeIssue[]): string | null {
  if (record[key] === null || record[key] === undefined) return null
  return uuidField(record, key, issues)
}

function timestampField(record: Record<string, unknown>, key: string, issues: StrikeEnvelopeIssue[], parent?: string): string | null {
  const value = record[key]
  const path = parent ? `${parent}.${key}` : key
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  issues.push({ path, message: `${key} must be an ISO timestamp.` })
  return null
}

function isAnswerMap(value: unknown): value is Record<string, StrikeOfflineAnswer> {
  if (!isRecord(value)) return false
  return Object.values(value).every(v =>
    typeof v === 'string'
    || typeof v === 'boolean'
    || (Array.isArray(v) && v.every(item => typeof item === 'string')),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
