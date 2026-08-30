// The Cal/OSHA regulator phase (runRegulatorPhase) re-reviews each audited
// machine and stages corrections. Behaviors that carry real consequences:
//   1. MATERIAL critique (dissent / additions / escalations / deficiencies) ⇒
//      the EHS correction runs and reemitFindingsAndDraft REPLACES only the
//      ehs_finding + procedure_draft rows — step_confidence + placeholder_photo
//      rows (and the photo search behind them) must SURVIVE.
//   2. CONCUR with no additions ⇒ no correction, no re-emit; only the critique
//      is stored.
//   3. Resume guard ⇒ a machine whose regulator_payload is already set is
//      skipped entirely (no agent calls).
//   4. The program-level report is stored on the run after the per-machine pass.
//
// Every external seam is mocked: the regulator/EHS/author agents, the Anthropic
// client, the rate-limit/budget gate, and a chainable Supabase admin stub that
// records inserts / deletes / upserts and answers the phase's reads.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  runRegulatorMachineReviewMock, runRegulatorProgramReviewMock,
  runEhsCorrectionMock, runAuthorAgentMock,
  getAnthropicMock, checkTenantBudgetMock, checkAiRateLimitMock, logAiInvocationMock,
  supabaseState,
} = vi.hoisted(() => {
  const supabaseState = {
    equipment: [] as unknown[],
    steps: [] as unknown[],
    // equipment_id → the result row a per-machine maybeSingle() read returns.
    resultRow: new Map<string, unknown>(),
    // Rows the aggregate's awaited equipment_results read returns.
    aggregateResults: [] as unknown[],
    // Rows the aggregate's awaited changes read returns.
    aggregateChanges: [] as unknown[],
    inserts: [] as Array<{ table: string; payload: unknown }>,
    upserts: [] as Array<{ table: string; payload: unknown }>,
    deletes: [] as Array<{ table: string; kinds: unknown }>,
    runUpdates: [] as Array<{ table: string; payload: unknown }>,
    reset() {
      this.equipment = []
      this.steps = []
      this.resultRow = new Map()
      this.aggregateResults = []
      this.aggregateChanges = []
      this.inserts = []
      this.upserts = []
      this.deletes = []
      this.runUpdates = []
    },
  }
  return {
    runRegulatorMachineReviewMock: vi.fn(),
    runRegulatorProgramReviewMock: vi.fn(),
    runEhsCorrectionMock: vi.fn(),
    runAuthorAgentMock: vi.fn(),
    getAnthropicMock: vi.fn(async (..._a: unknown[]) => ({ messages: { create: vi.fn() } })),
    checkTenantBudgetMock: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
    checkAiRateLimitMock: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
    logAiInvocationMock: vi.fn(async (..._a: unknown[]) => {}),
    supabaseState,
  }
})

vi.mock('@/lib/loto/audit/agents/regulator', () => ({
  runRegulatorMachineReview: (...a: unknown[]) => runRegulatorMachineReviewMock(...a),
  runRegulatorProgramReview: (...a: unknown[]) => runRegulatorProgramReviewMock(...a),
}))
vi.mock('@/lib/loto/audit/agents/ehs', () => ({
  // runAudit imports runEhsAgent too; provide a stub so the module loads.
  runEhsAgent: vi.fn(),
  runEhsCorrection: (...a: unknown[]) => runEhsCorrectionMock(...a),
}))
vi.mock('@/lib/loto/audit/agents/author', () => ({
  runAuthorAgent: (...a: unknown[]) => runAuthorAgentMock(...a),
}))
// The audit pipeline imports these; stub so the module loads (the regulator
// phase never calls them — that's part of what we assert).
vi.mock('@/lib/loto/audit/agents/fpe', () => ({ runFpeAgent: vi.fn() }))
vi.mock('@/lib/loto/audit/agents/ds', () => ({ runDsAgent: vi.fn() }))
vi.mock('@/lib/loto/audit/placeholderPhoto', () => ({ buildPlaceholderPhoto: vi.fn() }))
vi.mock('@/lib/loto/audit/storagePhotoSearch', () => ({ findExistingIsoPhoto: vi.fn() }))
vi.mock('@/lib/ai/client', () => ({ getAnthropic: (...a: unknown[]) => getAnthropicMock(...a) }))
vi.mock('@/lib/ai/rateLimit', () => ({
  checkTenantBudget: (...a: unknown[]) => checkTenantBudgetMock(...a),
  checkAiRateLimit: (...a: unknown[]) => checkAiRateLimitMock(...a),
  logAiInvocation: (...a: unknown[]) => logAiInvocationMock(...a),
}))

vi.mock('@/lib/supabaseAdmin', () => {
  function builder(table: string) {
    let scopedEquipmentId: string | null = null

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        if (col === 'equipment_id') scopedEquipmentId = String(val)
        return chain
      },
      in: (_col: string, val: unknown) => {
        // Only the surgical re-emit deletes with .in(change_kind, [...]); record
        // it so the test can assert which kinds were replaced.
        if (table === 'loto_audit_changes') supabaseState.deletes.push({ table, kinds: val })
        return chain
      },
      order: () => chain,
      limit: () => chain,
      is: () => chain,
      update: (payload: unknown) => {
        if (table === 'loto_audit_runs') supabaseState.runUpdates.push({ table, payload })
        return chain
      },
      delete: () => chain,
      insert: (payload: unknown) => {
        supabaseState.inserts.push({ table, payload })
        return Promise.resolve({ data: null, error: null })
      },
      upsert: (payload: unknown) => {
        supabaseState.upserts.push({ table, payload })
        return Promise.resolve({ data: null, error: null })
      },
      maybeSingle: () => {
        if (table === 'loto_audit_equipment_results') {
          return Promise.resolve({ data: supabaseState.resultRow.get(scopedEquipmentId ?? '') ?? null, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      single: () => Promise.resolve({ data: null, error: null }),
      then: (onF: (v: { data: unknown; error: unknown }) => unknown, onR?: (e: unknown) => unknown) => {
        let data: unknown = null
        if (table === 'loto_equipment') data = supabaseState.equipment
        else if (table === 'loto_energy_steps') data = supabaseState.steps
        else if (table === 'loto_audit_equipment_results') data = supabaseState.aggregateResults
        else if (table === 'loto_audit_changes') data = supabaseState.aggregateChanges
        return Promise.resolve({ data, error: null }).then(onF, onR)
      },
    }
    return chain
  }
  return { supabaseAdmin: () => ({ from: (table: string) => builder(table) }) }
})

import { runRegulatorPhase } from '@/lib/loto/audit/runAudit'
import type { AuthorResult, EhsResult, RegulatorMachineResult, RegulatorProgramResult } from '@/lib/loto/audit/schemas'

const RUN_ID = 'run-1'
const TENANT_ID = 'tenant-1'

function equipment(id: string) {
  return { equipment_id: id, description: 'Mixer', department: 'Bakery', decommissioned: false }
}

// A stored audit result row in raw_payload form, ready for the regulator phase.
function resultRow(id: string, over: Partial<{ agent_phase: string; regulator_payload: unknown; ehsPass: boolean }> = {}) {
  return {
    agent_phase: over.agent_phase ?? 'ehs_done',
    regulator_payload: over.regulator_payload ?? null,
    raw_payload: {
      fpe: { equip_photo: { verdict: 'match', confidence: 'high', notes: '' }, iso_photo: { verdict: 'match', confidence: 'high', shows_isolation_point: true, consistent_with_energy_steps: true, notes: '' } },
      ds: { equipment_confidence: 'high', low_confidence_iso: false, steps: [], duplicates: [], outliers: [], notes: '' },
      ehs: { pass: over.ehsPass ?? true, citations: [], recommendations: [], notes: '' },
    },
    ehs_pass: over.ehsPass ?? true,
    ehs_citations: [],
    ehs_recommendations: [],
    ehs_notes: '',
  }
}

function machineReview(over: Partial<RegulatorMachineResult> = {}): { result: RegulatorMachineResult; usage: null; model: string } {
  return {
    result: {
      concurs_with_ehs: true,
      additional_citations: [],
      severity_escalations: [],
      procedure_deficiencies: [],
      inspector_narrative: 'Concur with the internal assessment.',
      ...over,
    },
    usage: null, model: 'm-reg',
  }
}

function correctionOutput(pass: boolean): { result: EhsResult; usage: null; model: string } {
  return {
    result: {
      pass,
      citations: [{ code: '29 CFR 1910.147(c)(4)(ii)', text: 'No tryout step.', severity: 'critical' }],
      recommendations: ['Add a verify_zero_energy step.'],
      notes: 'Corrected.',
    },
    usage: null, model: 'm-ehs',
  }
}

function authorOutput(): { result: AuthorResult; usage: null; model: string } {
  return {
    result: {
      steps: [{ energy_type: 'E', step_type: 'verify_zero_energy', tag_description: 'x', isolation_procedure: 'y', method_of_verification: 'z', tag_description_es: 'x', isolation_procedure_es: 'y', method_of_verification_es: 'z' }],
      summary: 'Added verification.',
    },
    usage: null, model: 'm-author',
  }
}

const PROGRAM: { result: RegulatorProgramResult; usage: null; model: string } = {
  result: { executive_summary: 'Deficient program.', program_elements: [], systemic_findings: [], top_priorities: [] },
  usage: null, model: 'm-reg',
}

beforeEach(() => {
  supabaseState.reset()
  runRegulatorMachineReviewMock.mockReset()
  runRegulatorProgramReviewMock.mockReset()
  runEhsCorrectionMock.mockReset()
  runAuthorAgentMock.mockReset()
  checkTenantBudgetMock.mockResolvedValue({ ok: true })
  checkAiRateLimitMock.mockResolvedValue({ ok: true })
  runRegulatorProgramReviewMock.mockResolvedValue(PROGRAM)
})

describe('runRegulatorPhase — concur, no material change', () => {
  it('stores the critique but runs no correction when the regulator concurs with no additions', async () => {
    supabaseState.equipment = [equipment('EQ-OK')]
    supabaseState.resultRow.set('EQ-OK', resultRow('EQ-OK'))
    runRegulatorMachineReviewMock.mockResolvedValue(machineReview()) // concurs, empty

    const summary = await runRegulatorPhase({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    expect(summary.reviewed).toBe(1)
    expect(summary.corrected).toBe(0)
    expect(runEhsCorrectionMock).not.toHaveBeenCalled()
    expect(runAuthorAgentMock).not.toHaveBeenCalled()
    // No surgical re-emit happened (no delete of ehs_finding/procedure_draft).
    expect(supabaseState.deletes).toHaveLength(0)
    // The critique was stored (regulator_payload + regulator_concurs upsert).
    const regUpsert = supabaseState.upserts.find(u =>
      typeof u.payload === 'object' && u.payload !== null && 'regulator_payload' in (u.payload as object))
    expect(regUpsert).toBeDefined()
  })
})

describe('runRegulatorPhase — material dissent drives a correction', () => {
  it('runs the EHS correction and re-emits ONLY ehs_finding + procedure_draft (placeholder/confidence survive)', async () => {
    supabaseState.equipment = [equipment('EQ-FAIL')]
    supabaseState.resultRow.set('EQ-FAIL', resultRow('EQ-FAIL'))
    runRegulatorMachineReviewMock.mockResolvedValue(machineReview({
      concurs_with_ehs: false,
      additional_citations: [{ code: '29 CFR 1910.147(c)(4)(ii)', text: 'No tryout.', severity: 'critical' }],
      procedure_deficiencies: ['Missing zero-energy verification.'],
    }))
    runEhsCorrectionMock.mockResolvedValue(correctionOutput(false)) // still fails ⇒ re-author
    runAuthorAgentMock.mockResolvedValue(authorOutput())

    const summary = await runRegulatorPhase({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    expect(summary.reviewed).toBe(1)
    expect(summary.corrected).toBe(1)
    expect(runEhsCorrectionMock).toHaveBeenCalledTimes(1)
    // Corrected verdict still fails ⇒ the author re-runs.
    expect(runAuthorAgentMock).toHaveBeenCalledTimes(1)

    // The surgical delete scoped to EXACTLY the two re-emittable kinds.
    expect(supabaseState.deletes).toHaveLength(1)
    expect(supabaseState.deletes[0]!.kinds).toEqual(['ehs_finding', 'procedure_draft'])

    // The re-emit inserted the corrected finding + the new procedure_draft.
    const changeInsert = supabaseState.inserts.find(i => i.table === 'loto_audit_changes')
    expect(changeInsert).toBeDefined()
    const rows = changeInsert!.payload as Array<{ change_kind: string; agent: string }>
    expect(rows.some(r => r.change_kind === 'ehs_finding' && r.agent === 'EHS')).toBe(true)
    expect(rows.some(r => r.change_kind === 'procedure_draft' && r.agent === 'SSD')).toBe(true)
    // It must NOT stage step_confidence / placeholder_photo (those are the
    // audit's, untouched by the regulator).
    expect(rows.some(r => r.change_kind === 'placeholder_photo')).toBe(false)
    expect(rows.some(r => r.change_kind === 'step_confidence')).toBe(false)
  })

  it('does NOT re-author when the corrected verdict passes', async () => {
    supabaseState.equipment = [equipment('EQ-FIX')]
    supabaseState.resultRow.set('EQ-FIX', resultRow('EQ-FIX'))
    runRegulatorMachineReviewMock.mockResolvedValue(machineReview({
      concurs_with_ehs: false,
      additional_citations: [{ code: 'x', text: 'y', severity: 'low' }],
    }))
    runEhsCorrectionMock.mockResolvedValue(correctionOutput(true)) // now passes ⇒ no author

    const summary = await runRegulatorPhase({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    expect(summary.corrected).toBe(1)
    expect(runAuthorAgentMock).not.toHaveBeenCalled()
    // A passing correction emits only findings — no procedure_draft.
    const changeInsert = supabaseState.inserts.find(i => i.table === 'loto_audit_changes')
    const rows = (changeInsert?.payload ?? []) as Array<{ change_kind: string }>
    expect(rows.some(r => r.change_kind === 'procedure_draft')).toBe(false)
  })
})

describe('runRegulatorPhase — resume guard', () => {
  it('skips a machine whose regulator_payload is already set (no agent calls)', async () => {
    supabaseState.equipment = [equipment('EQ-DONE')]
    supabaseState.resultRow.set('EQ-DONE', resultRow('EQ-DONE', { regulator_payload: { concurs_with_ehs: true } }))

    const summary = await runRegulatorPhase({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    expect(summary.reviewed).toBe(0)
    expect(runRegulatorMachineReviewMock).not.toHaveBeenCalled()
    expect(runEhsCorrectionMock).not.toHaveBeenCalled()
  })

  it('skips a machine that is not yet audited (agent_phase != ehs_done)', async () => {
    supabaseState.equipment = [equipment('EQ-PENDING')]
    supabaseState.resultRow.set('EQ-PENDING', resultRow('EQ-PENDING', { agent_phase: 'ds_done' }))

    const summary = await runRegulatorPhase({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    expect(summary.reviewed).toBe(0)
    expect(runRegulatorMachineReviewMock).not.toHaveBeenCalled()
  })
})

describe('runRegulatorPhase — program report', () => {
  it('stores the program-level report on the run after the per-machine pass', async () => {
    supabaseState.equipment = [equipment('EQ-OK')]
    supabaseState.resultRow.set('EQ-OK', resultRow('EQ-OK'))
    runRegulatorMachineReviewMock.mockResolvedValue(machineReview())
    supabaseState.aggregateResults = [{ equipment_id: 'EQ-OK', ehs_pass: true, ehs_citations: [], ds_consistency: { missing_phases: [] } }]
    supabaseState.aggregateChanges = []

    await runRegulatorPhase({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    expect(runRegulatorProgramReviewMock).toHaveBeenCalledTimes(1)
    const reportUpdate = supabaseState.runUpdates.find(u =>
      typeof u.payload === 'object' && u.payload !== null && 'regulator_report' in (u.payload as object))
    expect(reportUpdate).toBeDefined()
    expect((reportUpdate!.payload as { regulator_report: RegulatorProgramResult }).regulator_report.executive_summary).toBe('Deficient program.')
  })
})
