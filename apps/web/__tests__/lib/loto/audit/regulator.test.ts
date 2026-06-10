// The Cal/OSHA Regulator agent re-reviews the internal audit. Its load-bearing
// behaviors: the per-machine review feeds the model the THREE internal verdicts
// (FPE/DS/EHS) + the steps so it can concur/dissent on an informed basis, uses
// the structured json_schema output path with a cached system prompt, and parses
// the critique back out; the program-level review parses its report. We stub the
// Anthropic client (the only seam) — mirroring author.test.ts / ehsGate.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { runRegulatorMachineReview, runRegulatorProgramReview } from '@/lib/loto/audit/agents/regulator'
import type { DsResult, EhsResult, FpeResult, RegulatorMachineResult, RegulatorProgramResult } from '@/lib/loto/audit/schemas'

const MACHINE_RESULT: RegulatorMachineResult = {
  concurs_with_ehs: false,
  additional_citations: [
    { code: 'Cal/OSHA T8 §3314(g)(2)', text: 'No documented sequence for restoring energy.', severity: 'medium' },
  ],
  severity_escalations: [
    { code: '29 CFR 1910.147(c)(4)(ii)', from: 'high', to: 'critical', reason: 'Missing tryout is a willful-class exposure.' },
  ],
  procedure_deficiencies: ['No zero-energy verification (tryout) step before work.'],
  inspector_narrative: 'The procedure cannot be verified as de-energized; an inspector would cite §3314(g).',
}

const PROGRAM_RESULT: RegulatorProgramResult = {
  executive_summary: 'The program is broadly deficient on zero-energy verification.',
  program_elements: [
    { element: 'Machine-specific procedures', status: 'deficient', finding: 'Many machines share a generic template.', citation: 'Cal/OSHA T8 §3314(g)' },
    { element: 'Employee training and retraining', status: 'not_evaluable', finding: 'Training records are out of scope.', citation: '29 CFR 1910.147(c)(7)' },
  ],
  systemic_findings: [
    { pattern: 'Missing zero-energy verification', affected_count: 42, severity: 'critical', citation: '29 CFR 1910.147(c)(4)(ii)', recommended_action: 'Add a tryout step to every procedure.' },
  ],
  top_priorities: ['Add zero-energy verification to all failing machines.'],
}

// One client whose messages.create returns whatever JSON the current test
// queued (machine review or program review). Reset before each test.
let modelText = JSON.stringify(MACHINE_RESULT)
const messagesCreate = vi.fn(async (_args: unknown) => ({
  content: [{ type: 'text', text: modelText }],
  usage: { input_tokens: 30, output_tokens: 20 },
}))
const client = { messages: { create: messagesCreate } } as unknown as Anthropic

const EQUIPMENT: Equipment = {
  equipment_id: 'EQ-001',
  description: 'Industrial dough mixer',
  department: 'Bakery',
  equip_photo_url: 'https://cdn.example/eq.jpg',
  iso_photo_url: 'https://cdn.example/iso.jpg',
  decommissioned: false,
} as unknown as Equipment

function step(id: string, tag: string): LotoEnergyStep {
  return {
    id, equipment_id: 'EQ-001', step_number: 1, step_type: 'isolate', sequence_order: 1,
    energy_type: 'E', tag_description: tag, isolation_procedure: 'Open disconnect and lock.', method_of_verification: null,
  } as unknown as LotoEnergyStep
}

function fpe(): FpeResult {
  return {
    equip_photo: { verdict: 'match', confidence: 'high', notes: 'Shows the mixer.' },
    iso_photo: { verdict: 'match', confidence: 'high', shows_isolation_point: true, consistent_with_energy_steps: true, notes: 'Shows the disconnect.' },
  }
}
function ds(): DsResult {
  return { equipment_confidence: 'high', low_confidence_iso: false, steps: [], duplicates: [], outliers: [], notes: 'Consistent.' }
}
function ehs(): EhsResult {
  return {
    pass: true,
    citations: [{ code: '29 CFR 1910.147(c)(4)(ii)', text: 'Verification step is generic.', severity: 'high' }],
    recommendations: ['Make the tryout concrete.'],
    notes: 'Looks acceptable.',
  }
}

beforeEach(() => {
  messagesCreate.mockClear()
  modelText = JSON.stringify(MACHINE_RESULT)
})

describe('runRegulatorMachineReview — request construction', () => {
  it('feeds the model the steps and all three internal verdicts', async () => {
    await runRegulatorMachineReview(client, EQUIPMENT, [step('s1', 'Main disconnect MCC-A')], fpe(), ds(), ehs())

    const args = messagesCreate.mock.calls[0]![0] as {
      messages: Array<{ content: string }>
      system: Array<{ text: string; cache_control?: { type: string } }>
      output_config?: { format?: { type?: string } }
    }
    const userText = args.messages[0]!.content

    // The machine + its steps reach the model.
    expect(userText).toContain('EQ-001')
    expect(userText).toContain('Main disconnect MCC-A')
    // The EHS verdict under review is present (the regulator must concur/dissent on it).
    expect(userText).toMatch(/Internal EHS verdict: PASS/)
    expect(userText).toContain('Verification step is generic.')
    // The other two agents' verdicts are present too.
    expect(userText).toMatch(/Food-Production-Engineer/i)
    expect(userText).toMatch(/Data-Scientist/i)
    // Structured-output path + cached CSHO system prompt.
    expect(args.output_config?.format?.type).toBe('json_schema')
    expect(args.system[0]!.text).toMatch(/Cal\/OSHA compliance officer/i)
    expect(args.system[0]!.cache_control?.type).toBe('ephemeral')
  })
})

describe('runRegulatorMachineReview — response parsing', () => {
  it('parses the dissent, additional citations, escalations, and narrative', async () => {
    const { result, model } = await runRegulatorMachineReview(client, EQUIPMENT, [step('s1', 'x')], fpe(), ds(), ehs())

    expect(model).toBe('claude-sonnet-4-6')
    expect(result.concurs_with_ehs).toBe(false)
    expect(result.additional_citations).toHaveLength(1)
    expect(result.severity_escalations[0]!.to).toBe('critical')
    expect(result.procedure_deficiencies[0]).toMatch(/tryout/i)
    expect(result.inspector_narrative).toMatch(/§3314/)
  })

  it('throws when the response carries no text block', async () => {
    messagesCreate.mockResolvedValueOnce({ content: [], usage: null } as never)
    await expect(
      runRegulatorMachineReview(client, EQUIPMENT, [step('s1', 'x')], fpe(), ds(), ehs()),
    ).rejects.toThrow(/no text block/i)
  })
})

describe('runRegulatorProgramReview — request + parsing', () => {
  it('sends the aggregate text under the cached program system prompt and parses the report', async () => {
    modelText = JSON.stringify(PROGRAM_RESULT)
    const aggregate = 'Equipment audited: 50\nEHS pass: 8; EHS fail: 42'

    const { result } = await runRegulatorProgramReview(client, aggregate)

    const args = messagesCreate.mock.calls[0]![0] as {
      messages: Array<{ content: string }>
      system: Array<{ text: string }>
      output_config?: { format?: { type?: string } }
    }
    // The aggregate the program review summarizes is in the prompt.
    expect(args.messages[0]!.content).toContain('EHS fail: 42')
    expect(args.system[0]!.text).toMatch(/program/i)
    expect(args.output_config?.format?.type).toBe('json_schema')

    // The parsed report carries the program elements + systemic findings.
    expect(result.executive_summary).toMatch(/zero-energy/i)
    expect(result.program_elements).toHaveLength(2)
    expect(result.systemic_findings[0]!.affected_count).toBe(42)
    expect(result.top_priorities).toHaveLength(1)
  })

  it('throws when the program response carries no text block', async () => {
    messagesCreate.mockResolvedValueOnce({ content: [], usage: null } as never)
    await expect(runRegulatorProgramReview(client, 'agg')).rejects.toThrow(/no text block/i)
  })
})
