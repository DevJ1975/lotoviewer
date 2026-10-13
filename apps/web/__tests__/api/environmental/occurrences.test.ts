// Recording that a condition was done (Phase 2 plan D5). The database function
// ms_record_obligation_occurrence() decides who may and moves the due date on; the
// PGlite suite proves that. Here: the route calls it as it should, and turns its
// answers into the right replies.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FACILITY_A, MEMBER_A, TENANT_A, TENANT_B,
  asMemberA, gateRejects, idContext, jsonRequest, onRpc, resetStore, rpcCalls, seed,
} from './_emsHarness'

import * as occurrences from '@/app/api/environmental/obligations/[id]/occurrences/route'

const OB = 'b0000000-0000-4000-8000-00000000000a'
const EVENT = 'e0000000-0000-4000-8000-00000000000e'
const post = (body: unknown) => occurrences.POST(jsonRequest('/x', 'POST', body), idContext(OB))

beforeEach(() => {
  resetStore()
  asMemberA()
  seed('compliance_calendar_obligations', [
    { id: OB, tenant_id: TENANT_A, facility_id: FACILITY_A, discipline: 'ems', owner_user_id: MEMBER_A, next_due_at: '2026-09-30' },
  ])
})

describe('POST /obligations/[id]/occurrences', () => {
  it('records it through the database function, with the date still due and the note', async () => {
    onRpc('ms_record_obligation_occurrence', () => ({ data: EVENT, error: null }))
    const res = await post({ due_on: '2026-09-30', note: 'Sampled both outfalls' })
    expect(res.status).toBe(201)
    expect((await res.json()).occurrence).toEqual({ id: EVENT, obligation_id: OB, occurrence_at: '2026-09-30' })
    expect(rpcCalls).toEqual([{
      name: 'ms_record_obligation_occurrence',
      args: { p_obligation_id: OB, p_due_on: '2026-09-30', p_note: 'Sampled both outfalls' },
    }])
  })

  it('answers 404 when the function finds it is not the caller\'s to record', async () => {
    onRpc('ms_record_obligation_occurrence', () => ({ data: null, error: { code: 'P0002', message: 'obligation not found' } }))
    expect((await post({ due_on: '2026-09-30' })).status).toBe(404)
  })

  it('passes on the function\'s own reason when the occurrence is already recorded', async () => {
    const reason = 'The occurrence due on 2026-09-30 is already recorded; the next one is due on 2026-12-30.'
    onRpc('ms_record_obligation_occurrence', () => ({ data: null, error: { code: '23514', message: reason } }))
    const res = await post({ due_on: '2026-09-30' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(reason)
  })

  it('needs the due date, and caps the note, before calling the database', async () => {
    expect((await post({ note: 'done' })).status).toBe(400)
    expect((await post({ due_on: '2026-09-30', note: 'x'.repeat(2001) })).status).toBe(400)
    expect(rpcCalls).toEqual([])
  })

  it('passes gate failures through', async () => {
    gateRejects(401, 'Invalid session')
    expect((await post({ due_on: '2026-09-30' })).status).toBe(401)
  })
})

describe('GET /obligations/[id]/occurrences', () => {
  it('lists each occurrence, newest first, with its evidence', async () => {
    seed('compliance_calendar_events', [
      { id: 'ev1', tenant_id: TENANT_A, obligation_id: OB, occurrence_at: '2026-06-30', completed_at: '2026-06-28T10:00:00Z' },
      { id: 'ev2', tenant_id: TENANT_A, obligation_id: OB, occurrence_at: '2026-09-30', completed_at: '2026-09-29T10:00:00Z' },
      { id: 'evB', tenant_id: TENANT_B, obligation_id: OB, occurrence_at: '2026-09-30', completed_at: '2026-09-29T10:00:00Z' },
    ])
    seed('ms_evidence', [{ id: 'proof', tenant_id: TENANT_A, subject_type: 'compliance_calendar_event', subject_id: 'ev2', uploaded_at: '2026-09-29' }])
    const body = await (await occurrences.GET(jsonRequest('/x', 'GET'), idContext(OB))).json()
    expect(body.occurrences.map((o: { id: string }) => o.id)).toEqual(['ev2', 'ev1'])
    expect(body.evidence.map((e: { id: string }) => e.id)).toEqual(['proof'])
  })

  it('answers 404 for an obligation outside the caller\'s tenant or register', async () => {
    seed('compliance_calendar_obligations', [{ id: 'b0000000-0000-4000-8000-0000000000c5', tenant_id: TENANT_A, discipline: 'ohs' }])
    expect((await occurrences.GET(jsonRequest('/x', 'GET'), idContext('b0000000-0000-4000-8000-0000000000c5'))).status).toBe(404)
  })
})
