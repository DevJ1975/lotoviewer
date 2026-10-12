import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseRunStore } from '@/lib/environmental/checklistStore'
import { fakeSupabase } from '../../api/environmental/_fakeSupabase'

// Completing the deadline a submitted checklist satisfies. A signed-in person's client asks the
// database function (migration 315), which decides who may; the service-role client used by the
// demo seed has no signed-in user for the function to check, so it takes the direct path.

const actor = { tenantId: 'tenant-1', userId: 'user-1' }
const RPC = 'rpc:env_complete_obligation'
const args = { obligationId: 'ob-1', occurrenceAt: '2026-03-31', inspectionId: 'run-1', note: 'Checklist passed' }
const as = (db: ReturnType<typeof fakeSupabase>) => db.client as unknown as SupabaseClient

describe('completeOccurrence through the database function', () => {
  const store = (rpc: { data?: unknown; error?: { message: string; code?: string } | null }) => {
    const db = fakeSupabase({ [RPC]: [rpc] })
    return { db, store: supabaseRunStore(as(db), actor) }
  }

  it('asks the database to complete exactly that occurrence for that checklist, and touches no table itself', async () => {
    const { db, store: s } = store({ data: 'event-1' })
    expect(await s.completeOccurrence(args)).toBe('completed')
    expect(db.arg(RPC, 'rpc')).toEqual({
      p_obligation_id: 'ob-1', p_due_on: '2026-03-31', p_note: 'Checklist passed', p_evidence_id: null, p_inspection_id: 'run-1',
    })
    expect(db.calls.filter(c => !c.table.startsWith('rpc:'))).toEqual([])
  })

  it('reports "not permitted" when the database does not let this person complete it with this checklist', async () => {
    expect(await store({ error: { code: 'P0002', message: 'obligation x not found' } }).store.completeOccurrence(args)).toBe('not_permitted')
  })

  it.each([
    'The occurrence due on 2026-03-31 is already recorded; the next one is due on 2026-06-30.',
    'This deadline is dismissed, so there is nothing due to record.',
  ])('reports a deadline that is no longer waiting as stale, not as a failure: %s', async message => {
    expect(await store({ error: { code: '23514', message } }).store.completeOccurrence(args)).toBe('stale')
  })

  it('does not call any other refusal stale: a checklist already used elsewhere is a failure to look at', async () => {
    await expect(store({ error: { code: '23514', message: 'That checklist already completed a different deadline.' } }).store.completeOccurrence(args))
      .rejects.toThrow('That checklist already completed a different deadline.')
  })

  it('throws any other database error', async () => {
    await expect(store({ error: { code: 'XX000', message: 'connection reset' } }).store.completeOccurrence(args)).rejects.toThrow('connection reset')
  })
})

describe('completeOccurrence directly (service role, demo seeding)', () => {
  const ob = (over: Record<string, unknown> = {}) => ({
    id: 'ob-1', title: 'Quarterly', status: 'open', cadence: 'quarterly', cadence_days: null, next_due_at: '2026-03-31',
    due_anchor: 'period_end', owner_user_id: null, facility_id: 'site-1', library_key: null, ...over,
  })
  const store = (
    obligation: unknown, opts: { event?: { error: { code?: string; message: string } | null }; moved?: unknown[] } = {},
  ) => {
    const db = fakeSupabase({
      compliance_calendar_obligations: [{ data: obligation }, { data: opts.moved ?? [{ id: 'ob-1' }] }],
      compliance_calendar_events: [opts.event ?? { error: null }],
    })
    return { db, store: supabaseRunStore(as(db), actor, { direct: true }) }
  }

  it('records the completion against the checklist, then moves a period-end deadline to the next period end', async () => {
    const { db, store: s } = store(ob())
    expect(await s.completeOccurrence(args)).toBe('completed')
    expect(db.arg('compliance_calendar_events', 'insert')).toEqual({
      tenant_id: 'tenant-1', obligation_id: 'ob-1', occurrence_at: '2026-03-31', completed_by: 'user-1', inspection_id: 'run-1', note: 'Checklist passed',
    })
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({ next_due_at: '2026-06-30' })
    expect(db.used(RPC, 'rpc')).toEqual([])
  })

  it('moves the deadline only while it still sits on that date, so two runs cannot both move it', async () => {
    const { db, store: s } = store(ob())
    await s.completeOccurrence(args)
    const update = db.used('compliance_calendar_obligations', 'update')[0]!
    expect(update.ops).toContainEqual({ method: 'eq', args: ['next_due_at', '2026-03-31'] })
    expect(update.ops).toContainEqual({ method: 'eq', args: ['status', 'open'] })
  })

  it('closes a once-only deadline instead of moving it', async () => {
    const { db, store: s } = store(ob({ cadence: 'once' }))
    await s.completeOccurrence(args)
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({ status: 'completed' })
  })

  it('leaves a fixed-anchor deadline on the calendar\'s own arithmetic', async () => {
    const { db, store: s } = store(ob({ due_anchor: 'fixed' }))
    await s.completeOccurrence(args)
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({ next_due_at: '2026-07-01' })
  })

  it.each([
    ['has moved on', ob({ next_due_at: '2026-06-30' })],
    ['is closed', ob({ status: 'dismissed' })],
    ['is gone', null],
  ])('writes nothing and reports stale when the deadline %s', async (_label, obligation) => {
    const { db, store: s } = store(obligation)
    expect(await s.completeOccurrence(args)).toBe('stale')
    expect(db.used('compliance_calendar_events', 'insert')).toEqual([])
    expect(db.used('compliance_calendar_obligations', 'update')).toEqual([])
  })

  it('treats a repeat of the same checklist as fine: the unique link to it is ignored', async () => {
    const { store: s } = store(ob(), { event: { error: { code: '23505', message: 'duplicate key' } } })
    expect(await s.completeOccurrence(args)).toBe('completed')
  })

  it('reports stale when another run moved the deadline first', async () => {
    expect(await store(ob(), { moved: [] }).store.completeOccurrence(args)).toBe('stale')
  })

  it('throws when the completion cannot be recorded, rather than moving the deadline anyway', async () => {
    const { db, store: s } = store(ob(), { event: { error: { code: '57P01', message: 'disk full' } } })
    await expect(s.completeOccurrence(args)).rejects.toThrow('disk full')
    expect(db.used('compliance_calendar_obligations', 'update')).toEqual([])
  })
})
