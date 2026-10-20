import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const m = vi.hoisted(() => ({
  open: vi.fn(), record: vi.fn(), grade: vi.fn(), resolveMember: vi.fn(), loadVersion: vi.fn(),
}))
vi.mock('@/lib/strike/attempts', () => ({
  openOfflineAttempt: m.open, recordBlockEvents: m.record, gradeAndRecordAttempt: m.grade, resolveMemberIdForUser: m.resolveMember,
}))
vi.mock('@/lib/strike/moduleAccess', () => ({ loadPublishedStrikeVersion: m.loadVersion }))

import { syncOfflineAttempt, type OfflineCaller } from '@/lib/strike/offlineSync'

const NOW = new Date('2026-10-20T18:00:00.000Z')
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
const ATTEMPT = '3f1c2b9e-7a4d-4e1b-9c2a-1b2c3d4e5f60'
const VERSION = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const MEMBER = '5b6c7d8e-1a2b-4c3d-8e4f-0a1b2c3d4e5f'

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    client_attempt_id: ATTEMPT, module_version_id: VERSION, assignment_id: null, member_id: MEMBER,
    started_at: at(-600_000),
    events: [{ block_key: 'c1', event: 'seen', dwell_ms: 900, detail: {}, occurred_at: at(-590_000) }],
    submission: { submitted_at: at(-60_000), answers: { q1: ['a1'] }, provisional_passed: true },
    ...overrides,
  }
}

// members and strike_module_versions are the only tables syncOfflineAttempt reads itself.
function fakeAdmin(opts: { member?: Record<string, unknown> | null; versionRow?: Record<string, unknown> | null } = {}) {
  const member = 'member' in opts ? opts.member : { id: MEMBER, tenant_id: 't1', status: 'active', department: 'Packaging', site_label: 'Plant 2' }
  const versionRow = 'versionRow' in opts ? opts.versionRow : { module_id: 'mod-1' }
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      for (const x of ['select', 'eq']) chain[x] = () => chain
      chain.maybeSingle = async () => ({ data: table === 'members' ? member : versionRow, error: null })
      return chain
    },
  }
  return admin as unknown as SupabaseClient
}

const kioskDevice = (over: Record<string, unknown> = {}): OfflineCaller => ({
  tenantId: 't1', user: null,
  device: { id: 'dev-1', tenantId: 't1', name: 'Line 3', department: null, siteLabel: null, enrolledBy: 'admin-1', ...over },
})
const personal: OfflineCaller = { tenantId: 't1', device: null, user: { userId: 'u1', role: 'member' } }

const version = { id: VERSION, content: { blocks: [] } }

beforeEach(() => {
  Object.values(m).forEach(f => f.mockReset())
  m.loadVersion.mockResolvedValue({ ok: true, version })
  m.open.mockResolvedValue({ ok: true, value: { attemptId: 'att-1', alreadySynced: false, submitted: false, scorePercent: null, passed: null } })
  m.record.mockResolvedValue({ ok: true, value: { recorded: 1 } })
  m.grade.mockResolvedValue({ ok: true, value: { attemptId: 'att-1', passed: true, scorePercent: 100 } })
  m.resolveMember.mockResolvedValue('member-of-u1')
})

describe('syncOfflineAttempt', () => {
  it('accepts a finished attempt from a shared tablet and reports the official grade', async () => {
    const result = await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope(), NOW)
    expect(result).toEqual({ client_attempt_id: ATTEMPT, status: 'synced', attempt_id: 'att-1', submitted: true, passed: true, score_percent: 100 })

    expect(m.open.mock.calls[0][1]).toEqual({ tenantId: 't1', userId: null, memberId: MEMBER, role: null, channel: 'kiosk', kioskIssuedBy: 'admin-1' })
    expect(m.open.mock.calls[0][2]).toMatchObject({ clientAttemptId: ATTEMPT, deviceId: 'dev-1', moduleId: 'mod-1', startedAt: new Date(at(-600_000)) })
    expect(m.grade.mock.calls[0][2]).toMatchObject({
      attemptId: 'att-1', answers: { q1: ['a1'] },
      offline: { submittedAt: new Date(at(-60_000)), deviceId: 'dev-1', provisionalPassed: true },
    })
  })

  it('a worker signed in on their own tablet is a learner with an account, whatever member id the envelope claims', async () => {
    await syncOfflineAttempt(fakeAdmin(), personal, envelope({ member_id: '7c8d9e0f-2b3c-4d4e-9f50-1b2c3d4e5f6a' }), NOW)
    expect(m.open.mock.calls[0][1]).toEqual({ tenantId: 't1', userId: 'u1', memberId: 'member-of-u1', role: 'member', channel: 'account' })
    expect(m.open.mock.calls[0][2].deviceId).toBeNull()
  })

  it('answers a replay with what the server already decided, without writing again', async () => {
    m.open.mockResolvedValue({ ok: true, value: { attemptId: 'att-1', alreadySynced: true, submitted: true, scorePercent: 55, passed: false } })
    const result = await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope(), NOW)
    expect(result).toMatchObject({ status: 'synced', submitted: true, passed: false, score_percent: 55 })
    expect(m.record).not.toHaveBeenCalled()
    expect(m.grade).not.toHaveBeenCalled()
  })

  it('stores progress for an attempt still in progress and grades nothing', async () => {
    const result = await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope({ submission: null }), NOW)
    expect(result).toMatchObject({ status: 'synced', submitted: false, passed: null })
    expect(m.record).toHaveBeenCalledOnce()
    expect(m.grade).not.toHaveBeenCalled()
  })

  it('writes a long event log in slices the events route would accept', async () => {
    const events = Array.from({ length: 120 }, (_, i) => ({ block_key: `b${i}`, event: 'seen', dwell_ms: null, detail: {}, occurred_at: at(-590_000 + i * 1000) }))
    await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope({ events }), NOW)
    expect(m.record.mock.calls.map(c => c[2].events.length)).toEqual([50, 50, 20])
  })

  describe('refusals the device must not retry', () => {
    it('refuses a malformed attempt but keeps its id so the device can drop the right one', async () => {
      const result = await syncOfflineAttempt(fakeAdmin(), kioskDevice(), { ...envelope(), module_version_id: 'nope' }, NOW)
      expect(result).toMatchObject({ client_attempt_id: ATTEMPT, status: 'rejected', reason: 'invalid' })
      expect(m.open).not.toHaveBeenCalled()
    })

    it('refuses a device clock far in the future, and writes nothing', async () => {
      const result = await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope({ started_at: at(3_600_000), submission: null, events: [] }), NOW)
      expect(result).toMatchObject({ status: 'rejected', reason: 'clock' })
      expect(m.open).not.toHaveBeenCalled()
    })

    it('refuses an attempt recorded more than 30 days ago', async () => {
      const old = envelope({
        started_at: at(-31 * 86_400_000),
        events: [], submission: { submitted_at: at(-31 * 86_400_000 + 60_000), answers: {}, provisional_passed: true },
      })
      expect(await syncOfflineAttempt(fakeAdmin(), kioskDevice(), old, NOW)).toMatchObject({ status: 'rejected', reason: 'clock' })
    })

    it('a shared tablet must name the worker', async () => {
      expect(await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope({ member_id: null }), NOW)).toMatchObject({ status: 'rejected', reason: 'member' })
    })

    it.each([
      ['a worker from another tenant', { member: { id: MEMBER, tenant_id: 'other', status: 'active', department: null, site_label: null } }],
      ['a worker who has left', { member: { id: MEMBER, tenant_id: 't1', status: 'inactive', department: null, site_label: null } }],
      ['an unknown worker', { member: null }],
    ])('refuses %s', async (_label, opts) => {
      expect(await syncOfflineAttempt(fakeAdmin(opts), kioskDevice(), envelope(), NOW)).toMatchObject({ status: 'rejected', reason: 'member' })
      expect(m.open).not.toHaveBeenCalled()
    })

    it('refuses a worker outside the department or site the tablet is scoped to', async () => {
      const inLine = fakeAdmin({ member: { id: MEMBER, tenant_id: 't1', status: 'active', department: 'Packaging', site_label: 'Plant 2' } })
      expect(await syncOfflineAttempt(inLine, kioskDevice({ department: 'Packaging', siteLabel: 'Plant 2' }), envelope(), NOW)).toMatchObject({ status: 'synced' })
      expect(await syncOfflineAttempt(inLine, kioskDevice({ department: 'Maintenance' }), envelope(), NOW)).toMatchObject({ status: 'rejected', reason: 'member' })
      expect(await syncOfflineAttempt(inLine, kioskDevice({ siteLabel: 'Plant 9' }), envelope(), NOW)).toMatchObject({ status: 'rejected', reason: 'member' })
    })

    it('refuses a version that is gone, never reached by this tenant, or has no blocks to replay', async () => {
      expect(await syncOfflineAttempt(fakeAdmin({ versionRow: null }), kioskDevice(), envelope(), NOW)).toMatchObject({ status: 'rejected', reason: 'version_unavailable' })

      m.loadVersion.mockResolvedValue({ ok: false, status: 404, message: 'Module not found' })
      expect(await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope(), NOW)).toMatchObject({ status: 'rejected', reason: 'version_unavailable' })

      m.loadVersion.mockResolvedValue({ ok: true, version: { id: VERSION, content: null } })
      expect(await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope(), NOW)).toMatchObject({ status: 'rejected', reason: 'version_unavailable' })
    })

    it('accepts a version that was superseded after the tablet downloaded it', async () => {
      await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope(), NOW)
      expect(m.loadVersion.mock.calls[0][1].statuses).toEqual(['published', 'superseded'])
    })

    it('refuses an attempt id that belongs to someone else', async () => {
      m.open.mockResolvedValue({ ok: false, status: 409, message: 'This attempt id belongs to another attempt.' })
      expect(await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope(), NOW)).toMatchObject({ status: 'rejected', reason: 'conflict' })
    })

    it.each([
      ['retake limit', { ok: false, status: 409, message: 'Retake limit reached', code: 'retake_limit' }, 'retake_limit'],
      ['missing blocks', { ok: false, status: 422, message: 'Finish every section', code: 'incomplete' }, 'incomplete'],
      ['an assignment that is not theirs', { ok: false, status: 403, message: 'Assignment is not assigned to this user.' }, 'invalid'],
    ])('reports %s as final', async (_label, failure, reason) => {
      m.grade.mockResolvedValue(failure)
      expect(await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope(), NOW)).toMatchObject({ status: 'rejected', reason })
    })

    it('an event for a block the module does not have is invalid, not retryable', async () => {
      m.record.mockResolvedValue({ ok: false, status: 400, message: 'Unknown block "zz".' })
      expect(await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope(), NOW)).toMatchObject({ status: 'rejected', reason: 'invalid' })
      expect(m.grade).not.toHaveBeenCalled()
    })
  })

  it('when another sync submitted the attempt first, reports that outcome instead of failing', async () => {
    m.grade.mockResolvedValue({ ok: false, status: 409, message: 'already submitted', code: 'already_submitted' })
    m.open
      .mockResolvedValueOnce({ ok: true, value: { attemptId: 'att-1', alreadySynced: false, submitted: false, scorePercent: null, passed: null } })
      .mockResolvedValueOnce({ ok: true, value: { attemptId: 'att-1', alreadySynced: true, submitted: true, scorePercent: 90, passed: true } })
    expect(await syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope(), NOW)).toMatchObject({ status: 'synced', submitted: true, passed: true, score_percent: 90 })
  })

  it('lets a transient failure throw, so the caller can answer "retry" instead of "rejected"', async () => {
    m.grade.mockRejectedValue(new Error('connection reset'))
    await expect(syncOfflineAttempt(fakeAdmin(), kioskDevice(), envelope(), NOW)).rejects.toThrow('connection reset')
  })
})
