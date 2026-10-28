// @vitest-environment node
//
// One aspect and one obligation through the real /api/environmental route
// handlers and the nightly job, from empty registers to green (Phase 1 plan,
// section 6). The traffic lights are read from the health route at every
// step, as the hub reads them: red when a register is empty, amber while
// anything is unscored or overdue, green once the work is done. Node
// environment: the evidence upload is the real multipart request.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { aspectCompleteness, type AspectOperatingCondition } from '@soteria/core/environmentalAspect'
import {
  ADMIN_A, TENANT_A,
  asAdminA, asAdminB, idContext, jsonRequest, resetStore, rowsIn, seed, writes,
} from '../api/environmental/_emsHarness'

vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (_req: Request, run: () => Promise<Response>) => run(),
}))
const sendMock = vi.fn<(args: { to: string; evaluations: unknown[] }) => Promise<{ sent: boolean; providerId: string }>>(
  async () => ({ sent: true, providerId: 'p1' }))
vi.mock('@/lib/email/sendComplianceEvaluationDue', () => ({
  sendComplianceEvaluationDue: (args: { to: string; evaluations: unknown[] }) => sendMock(args),
}))
vi.mock('@/lib/email/suppression', () => ({ loadSuppressedEmails: async () => new Set<string>() }))
vi.mock('@/lib/email/unsubscribe', () => ({ buildUnsubscribe: () => ({ url: 'https://app.test/unsubscribe' }) }))

import * as health from '@/app/api/environmental/registers/health/route'
import * as aspects from '@/app/api/environmental/aspects/route'
import * as aspect from '@/app/api/environmental/aspects/[id]/route'
import * as aspectScores from '@/app/api/environmental/aspects/[id]/scores/route'
import * as aspectObligations from '@/app/api/environmental/aspects/[id]/obligations/route'
import * as aspectReview from '@/app/api/environmental/aspects/[id]/review/route'
import * as obligations from '@/app/api/environmental/obligations/route'
import * as obligation from '@/app/api/environmental/obligations/[id]/route'
import * as obligationReview from '@/app/api/environmental/obligations/[id]/review/route'
import * as evidence from '@/app/api/environmental/evidence/route'
import * as download from '@/app/api/environmental/evidence/[id]/download/route'
import * as complete from '@/app/api/environmental/evaluations/[id]/complete/route'
import * as nightly from '@/app/api/cron/compliance-evaluations/route'

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n')
const ORIG_ENV = process.env

function on(date: string): void {
  vi.setSystemTime(new Date(`${date}T14:00:00Z`))
}

async function call(response: Promise<Response>): Promise<{ status: number; body: Record<string, any> }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await response
  return { status: res.status, body: await res.json() }
}

/** The aspects and obligations traffic lights, as the hub shows them. */
async function lights(): Promise<{ aspects: string; obligations: string }> {
  const { body } = await call(health.GET(jsonRequest('/api/environmental/registers/health', 'GET')))
  return { aspects: body.aspects.health, obligations: body.obligations.health }
}

function runNightlyJob(): Promise<Response> {
  return nightly.GET(new Request('https://app.test/api/cron/compliance-evaluations', {
    headers: { authorization: 'Bearer cron-secret' },
  }))
}

function uploadEvidence(evaluationId: string): Promise<Response> {
  const form = new FormData()
  form.append('subject_type', 'compliance_evaluation')
  form.append('subject_id', evaluationId)
  form.append('kind', 'document')
  form.append('file', new File([PDF], 'Q3 visual monitoring.pdf', { type: 'application/pdf' }))
  return evidence.POST(new Request('https://app.test/api/environmental/evidence', { method: 'POST', body: form }))
}

beforeEach(() => {
  resetStore()
  sendMock.mockClear()
  vi.useFakeTimers({ toFake: ['Date'] })
  process.env = { ...ORIG_ENV, CRON_SECRET: 'cron-secret', NEXT_PUBLIC_APP_URL: 'https://app.test' }
  seed('tenants', [{ id: TENANT_A, name: 'Northfield Forge & Finish', modules: { environmental: true }, disabled_at: null }])
  seed('tenant_memberships', [{ tenant_id: TENANT_A, user_id: ADMIN_A, role: 'admin', invite_cancelled_at: null }])
  seed('profiles', [{ id: ADMIN_A, email: 'ehs.lead@example.test', full_name: 'EHS Lead' }])
  asAdminA()
})

afterEach(() => {
  vi.useRealTimers()
  process.env = ORIG_ENV
})

describe('EMS registers, end to end', () => {
  it('takes an aspect and an obligation from empty registers to green', async () => {
    on('2026-10-02')
    expect(await lights()).toEqual({ aspects: 'red', obligations: 'red' })

    // 1. Record an aspect. Unscored, it keeps the register amber.
    const created = await call(aspects.POST(jsonRequest('/api/environmental/aspects', 'POST', {
      activity: 'Paint mixing', aspect: 'Solvent spill', impact: 'Soil and stormwater contamination', process_area: 'Finishing',
    })))
    expect(created.status).toBe(201)
    const aspectId: string = created.body.aspect.id
    expect(await lights()).toEqual({ aspects: 'amber', obligations: 'red' })

    // 2. Score it under normal and emergency operation: coverage shows N and E, and A is missing.
    for (const score of [
      { operating_condition: 'normal', severity: 2, likelihood: 2, rationale: 'Drums sit on secondary containment' },
      { operating_condition: 'emergency', severity: 4, likelihood: 3, rationale: 'A dropped drum reaches the yard drain' },
    ]) {
      expect((await aspectScores.POST(jsonRequest('/x', 'POST', score), idContext(aspectId))).status).toBe(201)
    }
    const scored = await call(aspect.GET(jsonRequest('/x', 'GET'), idContext(aspectId)))
    const conditions = (scored.body.aspect.current_scores as { operating_condition: AspectOperatingCondition }[])
      .map(s => ({ operatingCondition: s.operating_condition }))
    expect(aspectCompleteness(conditions)).toEqual({ covered: ['normal', 'emergency'], missing: ['abnormal'] })
    expect(scored.body.aspect).toMatchObject({ significant: true, max_score: 12 })
    expect(await lights()).toEqual({ aspects: 'green', obligations: 'red' })

    // 3. Record the obligation the aspect answers to, with an evaluation cadence; the nightly job schedules it.
    const recorded = await call(obligations.POST(jsonRequest('/x', 'POST', {
      title: 'Industrial stormwater general permit', source_kind: 'permit', regulatory_ref: 'State MSGP',
      jurisdiction: 'state:TX', applicability_rationale: 'Outdoor storage drains to the north outfall',
      // Its next deadline falls after the story ends, so only the reviews below drive the light.
      evaluation_cadence_days: 365, cadence: 'quarterly', next_due_at: '2028-06-30',
    })))
    expect(recorded.status).toBe(201)
    const obligationId: string = recorded.body.obligation.id
    expect((await aspectObligations.PUT(jsonRequest('/x', 'PUT', { obligation_ids: [obligationId] }), idContext(aspectId))).status).toBe(200)

    expect((await runNightlyJob()).status).toBe(200)
    const [evaluation] = rowsIn('ms_compliance_evaluations')
    // No owner is recorded, so it stays unassigned and the tenant's admins are told.
    expect(evaluation).toMatchObject({ obligation_id: obligationId, scheduled_for: '2026-10-02', assigned_to: null })
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'ehs.lead@example.test' }))
    expect(await lights()).toEqual({ aspects: 'green', obligations: 'green' })

    // A week later the evaluation is overdue...
    on('2026-10-09')
    expect(await lights()).toEqual({ aspects: 'green', obligations: 'amber' })

    // 4. ...until evidence is filed and the result recorded.
    const filed = await call(uploadEvidence(evaluation.id as string))
    expect(filed.status).toBe(201)
    const done = await call(complete.POST(jsonRequest('/x', 'POST', { result: 'compliant', notes: 'No sheen or solids' }), idContext(evaluation.id as string)))
    expect(done.status).toBe(200)
    expect(await lights()).toEqual({ aspects: 'green', obligations: 'green' })

    const detail = await call(obligation.GET(jsonRequest('/x', 'GET'), idContext(obligationId)))
    expect(detail.body.obligation).toMatchObject({ last_result: 'compliant', open_evaluation_id: null })
    expect(detail.body.linkedAspects.map((a: { id: string }) => a.id)).toEqual([aspectId])
    const file = await download.GET(jsonRequest('/x', 'GET'), idContext(filed.body.evidence.id))
    expect(file.status).toBe(200)
    expect(createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex')).toBe(filed.body.evidence.sha256)

    // 5. A year on, both reviews have come due: amber until someone confirms each still holds.
    on('2027-10-03')
    expect(await lights()).toEqual({ aspects: 'amber', obligations: 'amber' })
    expect((await aspectReview.POST(jsonRequest('/x', 'POST'), idContext(aspectId))).status).toBe(200)
    expect((await obligationReview.POST(jsonRequest('/x', 'POST'), idContext(obligationId))).status).toBe(200)
    expect(await lights()).toEqual({ aspects: 'green', obligations: 'green' })
  })

  it('shows another tenant none of it, and lets them change none of it', async () => {
    on('2026-10-02')
    const aspectId: string = (await call(aspects.POST(jsonRequest('/x', 'POST', {
      activity: 'Paint mixing', aspect: 'Solvent spill', impact: 'Soil contamination', process_area: 'Finishing',
    })))).body.aspect.id
    const obligationId: string = (await call(obligations.POST(jsonRequest('/x', 'POST', {
      title: 'Used oil management', source_kind: 'law', regulatory_ref: '40 CFR Part 279', jurisdiction: 'federal',
      applicability_rationale: 'Spent hydraulic oil', evaluation_cadence_days: 365, cadence: 'annual', next_due_at: '2027-01-31',
    })))).body.obligation.id
    await runNightlyJob()
    const [evaluation] = rowsIn('ms_compliance_evaluations')

    asAdminB()
    const writesBefore = writes.length
    expect((await aspect.GET(jsonRequest('/x', 'GET'), idContext(aspectId))).status).toBe(404)
    expect((await obligation.GET(jsonRequest('/x', 'GET'), idContext(obligationId))).status).toBe(404)
    expect((await aspectScores.POST(jsonRequest('/x', 'POST', {
      operating_condition: 'normal', severity: 5, likelihood: 5, rationale: 'Not mine to score',
    }), idContext(aspectId))).status).toBe(404)
    expect((await uploadEvidence(evaluation.id as string)).status).toBe(404)
    expect((await complete.POST(jsonRequest('/x', 'POST', { result: 'not_applicable', notes: 'Not mine' }), idContext(evaluation.id as string))).status).toBe(404)
    expect(writes.slice(writesBefore)).toEqual([])
    expect(await lights()).toEqual({ aspects: 'red', obligations: 'red' })
  })
})
