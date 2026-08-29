// runEhsCorrection re-runs the EHS Specialist after a Cal/OSHA regulator
// dissent. Three contracts carry real consequences and are tested here:
//   1. It MERGES the prior citations AND the regulator's additions into the
//      corrected record and DEDUPES by code+text — a citation can't be silently
//      dropped (nothing changed on the ground), nor duplicated when the model
//      already returned it.
//   2. The SAME hard gate as the first pass is re-applied: a missing
//      verify_zero_energy phase forces pass=false even if the model (and the
//      regulator) would let it pass. The safety floor never depends on goodwill.
//   3. The isolation floor comes from the CALLER's deterministic boolean
//      (safetySignals over the stored FPE/DS verdicts) — never re-derived from
//      the correction model's own citation text (Fable 5 finding A-C1).
//
// We stub the Anthropic client so the model returns whatever the test queues,
// mirroring ehsGate.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import type { LotoStepType } from '@soteria/core/lotoProcedureValidation'
import { runEhsCorrection } from '@/lib/loto/audit/agents/ehs'
import type { EhsResult, RegulatorMachineResult } from '@/lib/loto/audit/schemas'

let modelResult: EhsResult
// Typed impl param so .mock.calls entries are tuples we can index into.
const messagesCreate = vi.fn(async (_args: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(modelResult) }],
  usage: { input_tokens: 12, output_tokens: 6 },
}))
const client = { messages: { create: messagesCreate } } as unknown as Anthropic

const EQUIPMENT: Equipment = {
  equipment_id: 'EQ-001', description: 'Industrial dough mixer', department: 'Bakery',
  equip_photo_url: 'https://cdn.example/eq.jpg', iso_photo_url: 'https://cdn.example/iso.jpg', decommissioned: false,
} as unknown as Equipment
const STEPS: LotoEnergyStep[] = []

function priorEhs(): EhsResult {
  return {
    pass: false,
    citations: [{ code: 'Cal/OSHA T8 §3314(g)(4)', text: 'Isolation point is unverified (placeholder photo).', severity: 'high' }],
    recommendations: ['Capture a real isolation-point photo.'],
    notes: 'Photo is a placeholder.',
  }
}

function regulator(overrides: Partial<RegulatorMachineResult> = {}): RegulatorMachineResult {
  return {
    concurs_with_ehs: false,
    additional_citations: [{ code: '29 CFR 1910.147(c)(4)(ii)', text: 'No tryout step documented.', severity: 'critical' }],
    severity_escalations: [],
    procedure_deficiencies: ['Missing zero-energy verification.'],
    inspector_narrative: 'Cannot confirm de-energization.',
    ...overrides,
  }
}

beforeEach(() => {
  messagesCreate.mockClear()
  // Model returns a clean, generous correction with no citations — the merge +
  // hard gate must do the safety work.
  modelResult = { pass: true, citations: [], recommendations: ['Tighten the procedure.'], notes: 'Corrected.' }
})

describe('runEhsCorrection — citation merge + dedupe', () => {
  it('folds the regulator\'s additional citations into the corrected record', async () => {
    const { result } = await runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator(), [], true)

    // The regulator's added citation must survive even though the model returned none.
    expect(result.citations.some(c => c.code === '29 CFR 1910.147(c)(4)(ii)')).toBe(true)
  })

  it('folds the PRIOR citations back in when the model drops them', async () => {
    // Model returns none; the prior placeholder-photo citation must survive —
    // the photos didn't change, so a "resolved" finding is still a finding.
    const { result } = await runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator(), [], true)

    expect(result.citations.some(c => c.code === 'Cal/OSHA T8 §3314(g)(4)')).toBe(true)
  })

  it('dedupes by code+text when the model already returned a regulator citation', async () => {
    const dup = { code: '29 CFR 1910.147(c)(4)(ii)', text: 'No tryout step documented.', severity: 'critical' as const }
    modelResult = { pass: false, citations: [dup], recommendations: [], notes: '' }

    const { result } = await runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator({ additional_citations: [dup] }), [], true)

    const matches = result.citations.filter(c => c.code === dup.code && c.text === dup.text)
    expect(matches).toHaveLength(1)
  })
})

describe('runEhsCorrection — hard gate is preserved', () => {
  it('forces pass=false when verify_zero_energy is missing even if the model returns pass=true', async () => {
    const missingPhases: LotoStepType[] = ['verify_zero_energy']
    // Model is generous AND the regulator concurs with a pass — the gate must still overrule.
    modelResult = { pass: true, citations: [], recommendations: [], notes: 'Looks fine.' }

    const { result } = await runEhsCorrection(
      client, EQUIPMENT, STEPS, priorEhs(), regulator({ concurs_with_ehs: true, additional_citations: [], procedure_deficiencies: [] }), missingPhases, false,
    )

    expect(result.pass).toBe(false)
    // The gate appends the verification citation when one isn't already present.
    expect(result.citations.some(c => /verif|zero[- ]?energy|tryout/i.test(`${c.code} ${c.text}`))).toBe(true)
  })

  it('forces pass=false on the caller\'s isoUnverified signal even when the model drops every citation', async () => {
    // The photos didn't change between the audit and this correction, so the
    // deterministic signal (computed by the caller from the stored FPE/DS
    // verdicts) still says unverified — a charitable correction cannot clear it.
    modelResult = { pass: true, citations: [], recommendations: [], notes: '' }

    const { result } = await runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator({ additional_citations: [] }), [], true)

    expect(result.pass).toBe(false)
    // The prior placeholder-photo citation is restored by the in-code union.
    expect(result.citations.some(c => /isolation point|placeholder|photo/i.test(`${c.code} ${c.text}`))).toBe(true)
  })

  it('can pass when the isolation point is verified, no phase is missing, and no prior citations exist', async () => {
    const cleanPrior: EhsResult = { pass: true, citations: [], recommendations: [], notes: '' }
    modelResult = { pass: true, citations: [], recommendations: [], notes: '' }

    const { result } = await runEhsCorrection(client, EQUIPMENT, STEPS, cleanPrior, regulator({ additional_citations: [], procedure_deficiencies: [] }), [], false)

    expect(result.pass).toBe(true)
  })
})

describe('runEhsCorrection — request + parsing', () => {
  it('uses the json_schema output path under the cached EHS system prompt', async () => {
    await runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator(), [], true)
    const args = messagesCreate.mock.calls[0]![0] as {
      messages: Array<{ content: string }>
      system: Array<{ text: string; cache_control?: { type: string } }>
      output_config?: { format?: { type?: string } }
    }
    // The correction prompt names the regulator critique it must incorporate.
    expect(args.messages[0]!.content).toMatch(/senior Cal\/OSHA regulator/i)
    expect(args.messages[0]!.content).toContain('No tryout step documented.')
    expect(args.output_config?.format?.type).toBe('json_schema')
    expect(args.system[0]!.cache_control?.type).toBe('ephemeral')
  })

  it('throws when the response carries no text block', async () => {
    messagesCreate.mockResolvedValueOnce({ content: [], usage: null } as never)
    await expect(runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator(), [], true)).rejects.toThrow(/no text block/i)
  })
})
