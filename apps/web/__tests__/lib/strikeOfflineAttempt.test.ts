import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { enqueue, awardXp } = vi.hoisted(() => ({ enqueue: vi.fn(), awardXp: vi.fn() }))
vi.mock('@/lib/strike/xapi', () => ({ enqueueStrikeXapi: enqueue }))
vi.mock('@/lib/strike/xp', () => ({ awardPassXp: awardXp }))

import { gradeAndRecordAttempt, openOfflineAttempt, type StrikeLearner } from '@/lib/strike/attempts'
import type { StrikeVersionRow } from '@/lib/strike/moduleAccess'

type Result = { data?: unknown; count?: number; error?: { message: string; code?: string } | null }

// A queue per table: each query consumes the next queued answer, in the order
// the code under test asks. Inserts and updates are captured for assertions.
function fakeAdmin(queues: Record<string, Result[]>) {
  const inserts: { table: string; payload: Record<string, unknown> }[] = []
  const updates: { table: string; payload: Record<string, unknown> }[] = []
  const next = (table: string): Result => queues[table]?.shift() ?? { data: null, error: null }
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'neq', 'in', 'not', 'is', 'or', 'order', 'limit']) chain[m] = () => chain
      chain.insert = (payload: Record<string, unknown>) => { inserts.push({ table, payload }); return chain }
      chain.update = (payload: Record<string, unknown>) => { updates.push({ table, payload }); return chain }
      chain.maybeSingle = async () => next(table)
      chain.single = async () => next(table)
      chain.then = (resolve: (v: Result) => unknown) => Promise.resolve(next(table)).then(resolve)
      return chain
    },
  }
  return { admin: admin as unknown as SupabaseClient, inserts, updates }
}

const kiosk: StrikeLearner = { tenantId: 't1', userId: null, memberId: 'm1', role: null, channel: 'kiosk', kioskIssuedBy: 'admin-1' }
const version = {
  id: 'ver-1', module_id: 'mod-1', locale: 'en', passing_score: 80, retake_limit: null, validity_days: 365,
  content: { blocks: [{ kind: 'callout', key: 'c1', tone: 'info', title: 'Read me', body: 'Lock out first.' }] },
} as unknown as StrikeVersionRow
const STARTED = new Date('2026-10-20T08:00:00Z')
const SUBMITTED = new Date('2026-10-20T08:07:00Z')
const open = { moduleId: 'mod-1', version, assignmentId: null, clientAttemptId: 'cid-1', deviceId: 'dev-1', startedAt: STARTED }

describe('openOfflineAttempt', () => {
  beforeEach(() => { enqueue.mockReset(); awardXp.mockReset() })

  it('opens a new attempt keyed by the device id, at the device start time, and tells the LMS', async () => {
    const { admin, inserts } = fakeAdmin({ strike_attempts: [{ data: null }, { data: { id: 'att-new' } }] })
    const result = await openOfflineAttempt(admin, kiosk, open)
    expect(result).toEqual({ ok: true, value: { attemptId: 'att-new', alreadySynced: false, submitted: false, scorePercent: null, passed: null } })
    expect(inserts[0].payload).toMatchObject({
      tenant_id: 't1', module_version_id: 'ver-1', member_id: 'm1', user_id: null, delivery: 'standard',
      client_attempt_id: 'cid-1', device_id: 'dev-1',
      client_started_at: STARTED.toISOString(), started_at: STARTED.toISOString(),
      client_context: { mode: 'kiosk_player', offline: true, kiosk_issued_by: 'admin-1' },
    })
    expect(enqueue).toHaveBeenCalledWith(admin, kiosk, expect.objectContaining({ attemptId: 'att-new', at: STARTED }))
  })

  it('finds the first row on a replay instead of opening a second one', async () => {
    const row = { id: 'att-1', module_version_id: 'ver-1', user_id: null, member_id: 'm1', submitted_at: SUBMITTED.toISOString(), score_percent: 90, passed: true }
    const { admin, inserts } = fakeAdmin({ strike_attempts: [{ data: row }] })
    const result = await openOfflineAttempt(admin, kiosk, open)
    expect(result).toEqual({ ok: true, value: { attemptId: 'att-1', alreadySynced: true, submitted: true, scorePercent: 90, passed: true } })
    expect(inserts).toEqual([])
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("refuses an attempt id that is another learner's, or another version's", async () => {
    const theirs = { id: 'att-9', module_version_id: 'ver-1', user_id: null, member_id: 'someone-else', submitted_at: null, score_percent: null, passed: null }
    expect(await openOfflineAttempt(fakeAdmin({ strike_attempts: [{ data: theirs }] }).admin, kiosk, open)).toMatchObject({ ok: false, status: 409 })

    const otherVersion = { ...theirs, member_id: 'm1', module_version_id: 'ver-2' }
    expect(await openOfflineAttempt(fakeAdmin({ strike_attempts: [{ data: otherVersion }] }).admin, kiosk, open)).toMatchObject({ ok: false, status: 409 })
  })

  it('does not hand a worker the attempt they started signed in, only kiosk rows', async () => {
    const signedIn = { id: 'att-2', module_version_id: 'ver-1', user_id: 'user-7', member_id: 'm1', submitted_at: null, score_percent: null, passed: null }
    expect(await openOfflineAttempt(fakeAdmin({ strike_attempts: [{ data: signedIn }] }).admin, kiosk, open)).toMatchObject({ ok: false, status: 409 })
  })

  it('resolves two syncs racing on the same attempt to the winner’s row', async () => {
    const winner = { id: 'att-w', module_version_id: 'ver-1', user_id: null, member_id: 'm1', submitted_at: null, score_percent: null, passed: null }
    const { admin } = fakeAdmin({ strike_attempts: [{ data: null }, { data: null, error: { message: 'duplicate key', code: '23505' } }, { data: winner }] })
    expect(await openOfflineAttempt(admin, kiosk, open)).toMatchObject({ ok: true, value: { attemptId: 'att-w', alreadySynced: true } })
  })

  it('surfaces any other database error instead of hiding it', async () => {
    const { admin } = fakeAdmin({ strike_attempts: [{ data: null }, { data: null, error: { message: 'connection reset' } }] })
    await expect(openOfflineAttempt(admin, kiosk, open)).rejects.toThrow('connection reset')
  })
})

describe('gradeAndRecordAttempt for an offline attempt', () => {
  beforeEach(() => { enqueue.mockReset(); awardXp.mockReset() })

  function gradingAdmin(answerIsCorrect: boolean) {
    return fakeAdmin({
      strike_attempts: [
        { data: { id: 'att-1', tenant_id: 't1', user_id: null, member_id: 'm1', module_version_id: 'ver-1', submitted_at: null, delivery: 'standard' } },
        { data: { id: 'att-1' } },
      ],
      strike_block_events: [{ data: [{ block_key: 'c1', event: 'seen' }] }],
      strike_quiz_questions: [{ data: [{ id: 'q1', question_type: 'multiple_choice', required: true, points: 1, explanation: 'Because.', graded: true }] }],
      strike_quiz_answers: [{ data: [{ id: 'a1', question_id: 'q1', is_correct: answerIsCorrect }, { id: 'a2', question_id: 'q1', is_correct: !answerIsCorrect }] }],
      strike_completions: [{ error: null }],
    })
  }
  const offline = { submittedAt: SUBMITTED, deviceId: 'dev-1', provisionalPassed: true }
  const grade = (admin: SupabaseClient) => gradeAndRecordAttempt(admin, kiosk, {
    moduleId: 'mod-1', version, attemptId: 'att-1', assignmentId: null, answers: { q1: ['a1'] }, watch: null, offline,
  })

  it('records the submit and the completion at the device time, with the server’s grade and the device’s verdict', async () => {
    const { admin, updates, inserts } = gradingAdmin(true)
    const result = await grade(admin)
    expect(result).toMatchObject({ ok: true, value: { passed: true, scorePercent: 100 } })

    expect(updates[0].payload).toMatchObject({
      submitted_at: SUBMITTED.toISOString(), client_submitted_at: SUBMITTED.toISOString(),
      score_percent: 100, passed: true, provisional_passed: true,
      client_context: expect.objectContaining({ offline: true }),
    })
    expect(typeof updates[0].payload.synced_at).toBe('string')

    const completion = inserts.find(i => i.table === 'strike_completions')!.payload
    expect(completion).toMatchObject({ completed_at: SUBMITTED.toISOString(), evidence: expect.objectContaining({ offline: true, device_id: 'dev-1', channel: 'kiosk' }) })
    // validity runs from the day the worker passed, not the day the tablet found coverage
    expect(completion.expires_at).toBe(new Date(SUBMITTED.getTime() + 365 * 86_400_000).toISOString())
    expect(awardXp).toHaveBeenCalledWith(admin, expect.objectContaining({ passedAt: SUBMITTED }))
    expect(enqueue).toHaveBeenCalledWith(admin, kiosk, expect.objectContaining({ at: SUBMITTED }))
  })

  it('the server’s grade wins when the device was wrong: a provisional pass can still be an official fail', async () => {
    const { admin, updates, inserts } = gradingAdmin(false)
    const result = await grade(admin)
    expect(result).toMatchObject({ ok: true, value: { passed: false } })
    expect(updates[0].payload).toMatchObject({ passed: false, provisional_passed: true })
    expect(inserts.find(i => i.table === 'strike_completions')).toBeUndefined()
  })

  it('leaves the online path untouched: no offline marks, the server clock', async () => {
    const { admin, updates } = gradingAdmin(true)
    await gradeAndRecordAttempt(admin, kiosk, { moduleId: 'mod-1', version, attemptId: 'att-1', assignmentId: null, answers: { q1: ['a1'] }, watch: null })
    expect(Object.keys(updates[0].payload)).not.toContain('provisional_passed')
    expect(Object.keys(updates[0].payload)).not.toContain('client_submitted_at')
    expect(updates[0].payload.client_context).not.toHaveProperty('offline')
  })

  it('reports why it refused, so the sync can tell a final no from a retry', async () => {
    const capped = { ...version, retake_limit: 1 } as StrikeVersionRow
    const limited = fakeAdmin({ strike_module_versions: [{ data: [] }], strike_attempts: [{ count: 1 }] })
    expect(await gradeAndRecordAttempt(limited.admin, kiosk, { moduleId: 'mod-1', version: capped, attemptId: 'att-1', assignmentId: null, answers: {}, watch: null, offline }))
      .toMatchObject({ ok: false, status: 409, code: 'retake_limit' })

    const missing = fakeAdmin({
      strike_attempts: [{ data: { id: 'att-1', tenant_id: 't1', user_id: null, member_id: 'm1', module_version_id: 'ver-1', submitted_at: null, delivery: 'standard' } }],
      strike_block_events: [{ data: [] }],
    })
    expect(await gradeAndRecordAttempt(missing.admin, kiosk, { moduleId: 'mod-1', version, attemptId: 'att-1', assignmentId: null, answers: {}, watch: null, offline }))
      .toMatchObject({ ok: false, status: 422, code: 'incomplete' })

    const done = fakeAdmin({ strike_attempts: [{ data: { id: 'att-1', tenant_id: 't1', user_id: null, member_id: 'm1', module_version_id: 'ver-1', submitted_at: SUBMITTED.toISOString(), delivery: 'standard' } }] })
    expect(await gradeAndRecordAttempt(done.admin, kiosk, { moduleId: 'mod-1', version, attemptId: 'att-1', assignmentId: null, answers: {}, watch: null, offline }))
      .toMatchObject({ ok: false, status: 409, code: 'already_submitted' })
  })
})
