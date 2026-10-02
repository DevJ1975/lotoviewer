// @vitest-environment node
//
// A permit, one of its conditions, and a change of owner through the real
// /api/environmental route handlers and the nightly job (Phase 2 plan, section
// 6): a permit whose renewal application is 29 days away is announced once, a
// condition is marked done with evidence and moves on a quarter, and a change of
// owner opens a transfer checklist that closes only when the holder of record has
// really been updated.
//
// The in-memory database has no triggers, so the two database functions the
// routes call (ms_record_obligation_occurrence, ms_open_change) are stood in for
// here by handlers that apply the same core rules, and the one refusal the
// database would make is staged with the message the checklist already shows.
// emsPhase2.db.test.ts proves the real functions and triggers in Postgres.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { advanceDueDate } from '@soteria/core/complianceCalendar'
import {
  ADMIN_A, FACILITY_A, MEMBER_A, TENANT_A,
  asAdminA, asMemberA, callAs, failNext, idContext, jsonRequest, onRpc, resetStore, rowsIn, seed,
} from '../api/environmental/_emsHarness'

vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (_req: Request, run: () => Promise<Response>) => run(),
}))
interface Digest { to: string; renewals: { permitTitle: string; tier: unknown; daysLeft: number }[]; conditions: { conditionTitle: string; stage: string }[] }
const sendMock = vi.fn<(args: Digest) => Promise<{ sent: boolean; providerId: string }>>(async () => ({ sent: true, providerId: 'p1' }))
vi.mock('@/lib/email/sendPermitsDue', () => ({ sendPermitsDue: (args: Digest) => sendMock(args) }))
vi.mock('@/lib/email/suppression', () => ({ loadSuppressedEmails: async () => new Set<string>() }))
vi.mock('@/lib/email/unsubscribe', () => ({ buildUnsubscribe: () => ({ url: 'https://app.test/unsubscribe' }) }))

import * as permits from '@/app/api/environmental/permits/route'
import * as permit from '@/app/api/environmental/permits/[id]/route'
import * as conditions from '@/app/api/environmental/permits/[id]/conditions/route'
import * as occurrences from '@/app/api/environmental/obligations/[id]/occurrences/route'
import * as evidence from '@/app/api/environmental/evidence/route'
import * as changes from '@/app/api/environmental/changes/route'
import * as change from '@/app/api/environmental/changes/[id]/route'
import * as resolve from '@/app/api/environmental/changes/[id]/impacts/[impactId]/resolve/route'
import * as nightly from '@/app/api/cron/environmental-permits/route'

const OLD_ENTITY = 'Northfield Metal Products Inc.'
const NEW_ENTITY = 'Northfield Forge & Finish Holdings LLC'
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n')
const ORIG_ENV = process.env

const on = (date: string) => vi.setSystemTime(new Date(`${date}T14:00:00Z`))

async function call(response: Promise<Response>): Promise<{ status: number; body: Record<string, any> }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await response
  return { status: res.status, body: await res.json() }
}

let pdfNumber = 0
function upload(subjectType: string, subjectId: string): Promise<Response> {
  const form = new FormData()
  form.append('subject_type', subjectType)
  form.append('subject_id', subjectId)
  form.append('kind', 'document')
  // Evidence is unique by content within its record, so each file differs.
  pdfNumber += 1
  form.append('file', new File([PDF, new TextEncoder().encode(`% ${pdfNumber}`)], `proof-${pdfNumber}.pdf`, { type: 'application/pdf' }))
  return evidence.POST(new Request('https://app.test/api/environmental/evidence', { method: 'POST', body: form }))
}

const runNightlyJob = () =>
  nightly.GET(new Request('https://app.test/api/cron/environmental-permits', { headers: { authorization: 'Bearer cron-secret' } }))

/** The database functions the routes call, standing in with the core rules; the PGlite suite proves the real ones. */
function standInForDatabaseFunctions(): void {
  onRpc('ms_record_obligation_occurrence', args => {
    const obligation = rowsIn('compliance_calendar_obligations').find(row => row.id === args.p_obligation_id)!
    const eventId = `e0000000-0000-4000-8000-${String(rowsIn('compliance_calendar_events').length + 1).padStart(12, '0')}`
    seed('compliance_calendar_events', [{
      id: eventId, tenant_id: obligation.tenant_id, obligation_id: obligation.id, occurrence_at: args.p_due_on,
      completed_at: new Date().toISOString(), note: args.p_note,
    }])
    obligation.next_due_at = advanceDueDate(String(args.p_due_on), obligation.cadence as never, obligation.cadence_days as number | null)
    return { data: eventId, error: null }
  })
  onRpc('ms_open_change', args => {
    const header = args.p_change as Record<string, unknown>
    const changeId = 'c0000000-0000-4000-8000-00000000000a'
    seed('ms_changes', [{ id: changeId, ...header, status: 'open', opened_at: new Date().toISOString() }])
    ;(args.p_impacts as Record<string, unknown>[]).forEach((impact, index) => seed('ms_change_impacts', [{
      id: `c1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, tenant_id: header.tenant_id, change_id: changeId,
      resolved_at: null, ...impact,
    }]))
    return { data: changeId, error: null }
  })
}

beforeEach(() => {
  resetStore()
  pdfNumber = 0
  sendMock.mockClear()
  vi.useFakeTimers({ toFake: ['Date'] })
  process.env = { ...ORIG_ENV, CRON_SECRET: 'cron-secret', NEXT_PUBLIC_APP_URL: 'https://app.test' }
  standInForDatabaseFunctions()
  seed('tenants', [{ id: TENANT_A, name: 'Northfield Forge & Finish', modules: { environmental: true }, disabled_at: null }])
  seed('tenant_memberships', [
    { tenant_id: TENANT_A, user_id: ADMIN_A, role: 'admin', invite_cancelled_at: null },
    { tenant_id: TENANT_A, user_id: MEMBER_A, role: 'member', invite_cancelled_at: null },
  ])
  seed('profiles', [
    { id: ADMIN_A, email: 'ehs.lead@example.test', full_name: 'EHS Lead' },
    { id: MEMBER_A, email: 'permit.owner@example.test', full_name: 'Permit Owner' },
  ])
  seed('ms_scope_statements', [{ id: 'scope-1', tenant_id: TENANT_A, discipline: 'ems', version: 1, legal_entity: OLD_ENTITY, effective_from: '2020-01-01' }])
  seed('ms_policies', [{ id: 'policy-1', tenant_id: TENANT_A, discipline: 'ems', version: 1, signed_at: '2020-02-01' }])
  asAdminA()
})

afterEach(() => {
  vi.useRealTimers()
  process.env = ORIG_ENV
})

describe('permits and a change of owner, end to end', () => {
  it('announces a renewal once, marks a condition done with evidence, and closes a change of owner only when the holder is updated', async () => {
    on('2026-10-02')

    // 1. A permit whose renewal application is due in 29 days, and a quarterly condition.
    const created = await call(permits.POST(jsonRequest('/x', 'POST', {
      program: 'wastewater', title: 'Industrial wastewater discharge permit', agency: 'City of Northfield', permit_number: 'DEMO-IWD-0001',
      jurisdiction: 'local:Northfield', holder_of_record: OLD_ENTITY, issued_on: '2024-01-01', expires_on: '2026-12-31',
      renewal_application_due_on: '2026-10-31', owner_user_id: MEMBER_A,
    })))
    expect(created.status).toBe(201)
    const permitId: string = created.body.permit.id
    const listed = await call(permits.GET(jsonRequest('/x', 'GET')))
    expect(listed.body.permits[0]).toMatchObject({ standing: 'renewal_due', holder_mismatch: false, escalation: { tier: 30, daysLeft: 29 } })

    const added = await call(conditions.POST(jsonRequest('/x', 'POST', {
      title: 'Submit the quarterly monitoring report', next_due_at: '2026-10-10', cadence: 'quarterly', owner_user_id: MEMBER_A,
      applicability_rationale: 'The permit requires quarterly self-monitoring reports.',
    }), idContext(permitId)))
    expect(added.status).toBe(201)
    const conditionId: string = added.body.condition.id

    // 2. The nightly job sends the owner one digest naming the 30-day permit and the condition; the next run sends nothing.
    expect((await runNightlyJob()).status).toBe(200)
    const sent = sendMock.mock.calls.map(([args]) => args)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: 'permit.owner@example.test',
      renewals: [{ permitTitle: 'Industrial wastewater discharge permit', tier: 30, daysLeft: 29 }],
      conditions: [{ conditionTitle: 'Submit the quarterly monitoring report', stage: 'due_soon' }],
    })
    expect((await runNightlyJob()).status).toBe(200)
    expect(sendMock).toHaveBeenCalledTimes(1)

    // 3. The owner marks the condition done and attaches the proof; the deadline moves on a quarter.
    asMemberA()
    const done = await call(occurrences.POST(jsonRequest('/x', 'POST', { due_on: '2026-10-10', note: 'Filed online' }), idContext(conditionId)))
    expect(done.status).toBe(201)
    expect((await upload('compliance_calendar_event', done.body.occurrence.id)).status).toBe(201)
    asAdminA()
    const detail = await call(permit.GET(jsonRequest('/x', 'GET'), idContext(permitId)))
    expect(detail.body.conditions[0]).toMatchObject({ id: conditionId, next_due_at: '2027-01-10' })

    // 4. A change of owner, opened from all facilities: three steps for the permit, then the scope and the policy.
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'admin', facilityId: null })
    const opened = await call(changes.POST(jsonRequest('/x', 'POST', {
      kind: 'ownership_name', title: 'Sale of the plant', description: 'The plant is sold to a new owner.',
      new_legal_entity: NEW_ENTITY, effective_on: '2026-12-01',
    })))
    expect(opened.status).toBe(201)
    expect(opened.body.impacts).toBe(5)
    const changeId: string = opened.body.change.id
    const checklist = () => call(change.GET(jsonRequest('/x', 'GET'), idContext(changeId)))
    const resolveImpact = (id: string, note?: string) => call(resolve.POST(
      jsonRequest('/x', 'POST', note ? { resolution_note: note } : {}), { params: Promise.resolve({ id: changeId, impactId: id }) }))
    const impactNamed = async (step: string | null, target?: string) =>
      (await checklist()).body.impacts.find((i: { step: string | null; target_type: string }) => i.step === step && (!target || i.target_type === target))

    // 5. Each transfer step needs a file. "Confirm holder" is held back until the permit names the new entity.
    const notify = await impactNamed('notify_agency')
    const submit = await impactNamed('submit_transfer')
    const confirm = await impactNamed('confirm_holder')
    expect(notify.blockers).toEqual([expect.stringContaining('Attach evidence')])
    for (const impact of [notify, submit, confirm]) expect((await upload('ms_change_impact', impact.id)).status).toBe(201)
    expect((await resolveImpact(notify.id)).status).toBe(200)
    expect((await resolveImpact(submit.id)).status).toBe(200)

    const refusal = (await impactNamed('confirm_holder')).blockers
    expect(refusal).toEqual([expect.stringContaining('still names another holder')])
    failNext('ms_change_impacts', { code: '23514', message: refusal[0] }, 'update')
    const refused = await resolveImpact(confirm.id)
    expect(refused).toMatchObject({ status: 409, body: { error: refusal[0] } })

    expect((await call(permit.PATCH(jsonRequest('/x', 'PATCH', { holder_of_record: NEW_ENTITY }), idContext(permitId)))).status).toBe(200)
    expect((await impactNamed('confirm_holder')).blockers).toEqual([])
    expect((await resolveImpact(confirm.id)).status).toBe(200)

    // 6. The scope and the policy resolve once they have been reissued; closing waits for the last one.
    expect((await impactNamed(null, 'scope')).blockers).toEqual([expect.stringContaining('does not name the new legal entity')])
    seed('ms_scope_statements', [{ id: 'scope-2', tenant_id: TENANT_A, discipline: 'ems', version: 2, legal_entity: NEW_ENTITY, effective_from: '2026-12-01' }])
    expect((await resolveImpact((await impactNamed(null, 'scope')).id)).status).toBe(200)

    const closeTooSoon = await call(change.PATCH(jsonRequest('/x', 'PATCH', { status: 'closed' }), idContext(changeId)))
    expect(closeTooSoon).toMatchObject({ status: 409, body: { error: '1 impact is not resolved yet.' } })

    expect((await impactNamed(null, 'policy')).blockers).toEqual([expect.stringContaining('signed before the scope')])
    seed('ms_policies', [{ id: 'policy-2', tenant_id: TENANT_A, discipline: 'ems', version: 2, signed_at: '2026-12-02' }])
    expect((await resolveImpact((await impactNamed(null, 'policy')).id)).status).toBe(200)

    const closed = await call(change.PATCH(jsonRequest('/x', 'PATCH', { status: 'closed' }), idContext(changeId)))
    expect(closed.status).toBe(200)
    expect(closed.body.change.status).toBe('closed')

    // The permit now reads as held by the entity the scope names.
    const after = await call(permit.GET(jsonRequest('/x', 'GET'), idContext(permitId)))
    expect(after.body.permit).toMatchObject({ holder_of_record: NEW_ENTITY })
  })
})
