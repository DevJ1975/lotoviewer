import { describe, expect, it } from 'vitest'
import {
  STRIKE_OFFLINE_MAX_AGE_MS,
  STRIKE_OFFLINE_MAX_CLOCK_SKEW_MS,
  STRIKE_OFFLINE_MAX_EVENTS,
  clampDeviceTimestamp,
  parseStrikeOfflineEnvelope,
} from '../strikeOfflineSync'

const NOW = new Date('2026-10-20T18:00:00.000Z')
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

describe('clampDeviceTimestamp', () => {
  it('accepts a past timestamp inside the window unchanged', () => {
    expect(clampDeviceTimestamp(at(-60_000), { now: NOW })).toEqual({ ok: true, at: new Date(at(-60_000)) })
  })

  it('pulls a slightly-fast device clock back to the server time', () => {
    expect(clampDeviceTimestamp(at(STRIKE_OFFLINE_MAX_CLOCK_SKEW_MS), { now: NOW })).toEqual({ ok: true, at: NOW })
  })

  it('refuses a clock far in the future, too old, or before the content existed', () => {
    expect(clampDeviceTimestamp(at(STRIKE_OFFLINE_MAX_CLOCK_SKEW_MS + 1), { now: NOW })).toEqual({ ok: false, reason: 'future' })
    expect(clampDeviceTimestamp(at(-STRIKE_OFFLINE_MAX_AGE_MS - 1), { now: NOW })).toEqual({ ok: false, reason: 'stale' })
    expect(clampDeviceTimestamp(at(-120_000), { now: NOW, notBefore: new Date(at(-60_000)) })).toEqual({ ok: false, reason: 'before_floor' })
  })

  it('refuses something that is not a timestamp', () => {
    expect(clampDeviceTimestamp('yesterday-ish', { now: NOW })).toEqual({ ok: false, reason: 'invalid' })
  })
})

const ATTEMPT_ID = '3f1c2b9e-7a4d-4e1b-9c2a-1b2c3d4e5f60'
const VERSION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

const validEnvelope = () => ({
  client_attempt_id: ATTEMPT_ID,
  module_version_id: VERSION_ID,
  assignment_id: null,
  member_id: null,
  started_at: at(-600_000),
  events: [
    { block_key: 's1', event: 'seen', dwell_ms: 900, detail: {}, occurred_at: at(-590_000) },
    { block_key: 's1', event: 'completed', dwell_ms: null, detail: {}, occurred_at: at(-560_000) },
  ],
  submission: { submitted_at: at(-60_000), answers: { q1: ['a1'], q2: true }, provisional_passed: true },
})

describe('parseStrikeOfflineEnvelope', () => {
  it('accepts a complete attempt and normalizes ids and timestamps', () => {
    const raw = { ...validEnvelope(), client_attempt_id: ATTEMPT_ID.toUpperCase() }
    const result = parseStrikeOfflineEnvelope(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.envelope.client_attempt_id).toBe(ATTEMPT_ID)
    expect(result.envelope.events).toHaveLength(2)
    expect(result.envelope.submission?.provisional_passed).toBe(true)
  })

  it('accepts an attempt still in progress', () => {
    const result = parseStrikeOfflineEnvelope({ ...validEnvelope(), submission: null })
    expect(result.ok && result.envelope.submission).toBeNull()
  })

  it('is deterministic: parsing the same envelope twice gives the same result', () => {
    expect(parseStrikeOfflineEnvelope(validEnvelope())).toEqual(parseStrikeOfflineEnvelope(validEnvelope()))
  })

  it('caps dwell time the same way the online events route does', () => {
    const raw = validEnvelope()
    raw.events[0].dwell_ms = 99_999_999
    const result = parseStrikeOfflineEnvelope(raw)
    expect(result.ok && result.envelope.events[0].dwell_ms).toBe(3_600_000)
  })

  it('refuses ids that are not UUIDs', () => {
    const result = parseStrikeOfflineEnvelope({ ...validEnvelope(), client_attempt_id: 'attempt-1', member_id: 'bob' })
    expect(result.ok ? [] : result.issues.map(i => i.path)).toEqual(['client_attempt_id', 'member_id'])
  })

  it('refuses events outside the attempt and a submit before the start', () => {
    const early = validEnvelope()
    early.events[0].occurred_at = at(-700_000)
    expect(parseStrikeOfflineEnvelope(early)).toMatchObject({ ok: false, issues: [{ path: 'events[0].occurred_at' }] })

    const late = validEnvelope()
    late.events[1].occurred_at = at(-30_000)
    expect(parseStrikeOfflineEnvelope(late)).toMatchObject({ ok: false, issues: [{ path: 'events[1].occurred_at' }] })

    const backwards = { ...validEnvelope(), events: [], submission: { ...validEnvelope().submission, submitted_at: at(-700_000) } }
    expect(parseStrikeOfflineEnvelope(backwards)).toMatchObject({ ok: false, issues: [{ path: 'submission.submitted_at' }] })
  })

  it('refuses unknown events, oversized detail and too many events', () => {
    const unknown = validEnvelope()
    ;(unknown.events[0] as { event: string }).event = 'skipped'
    expect(parseStrikeOfflineEnvelope(unknown).ok).toBe(false)

    const bloated = validEnvelope()
    bloated.events[0].detail = { note: 'x'.repeat(2001) }
    expect(parseStrikeOfflineEnvelope(bloated).ok).toBe(false)

    const flood = { ...validEnvelope(), events: Array.from({ length: STRIKE_OFFLINE_MAX_EVENTS + 1 }, () => validEnvelope().events[0]) }
    expect(parseStrikeOfflineEnvelope(flood).ok).toBe(false)
  })

  it('refuses malformed answers and a missing provisional result', () => {
    const answers = { ...validEnvelope(), submission: { ...validEnvelope().submission, answers: { q1: 7 } } }
    expect(parseStrikeOfflineEnvelope(answers)).toMatchObject({ ok: false, issues: [{ path: 'submission.answers' }] })

    const { provisional_passed: _omit, ...noVerdict } = validEnvelope().submission
    expect(parseStrikeOfflineEnvelope({ ...validEnvelope(), submission: noVerdict })).toMatchObject({
      ok: false,
      issues: [{ path: 'submission.provisional_passed' }],
    })
  })

  it('refuses something that is not an object', () => {
    expect(parseStrikeOfflineEnvelope([validEnvelope()]).ok).toBe(false)
    expect(parseStrikeOfflineEnvelope(null).ok).toBe(false)
  })
})
