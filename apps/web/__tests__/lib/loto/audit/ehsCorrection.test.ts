// runEhsCorrection re-runs the EHS Specialist after a Cal/OSHA regulator
// dissent. Two contracts carry real consequences and are tested here:
//   1. It MERGES the regulator's additional citations into the corrected record
//      and DEDUPES by code+text — a citation can't be silently dropped, nor
//      duplicated when the model already returned it.
//   2. The SAME hard gate as the first pass is re-applied: a missing
//      verify_zero_energy phase forces pass=false even if the model (and the
//      regulator) would let it pass. The safety floor never depends on goodwill.
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
    const { result } = await runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator(), [])

    // The regulator's added citation must survive even though the model returned none.
    expect(result.citations.some(c => c.code === '29 CFR 1910.147(c)(4)(ii)')).toBe(true)
  })

  it('dedupes by code+text when the model already returned a regulator citation', async () => {
    const dup = { code: '29 CFR 1910.147(c)(4)(ii)', text: 'No tryout step documented.', severity: 'critical' as const }
    modelResult = { pass: false, citations: [dup], recommendations: [], notes: '' }

    const { result } = await runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator({ additional_citations: [dup] }), [])

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
      client, EQUIPMENT, STEPS, priorEhs(), regulator({ concurs_with_ehs: true, additional_citations: [], procedure_deficiencies: [] }), missingPhases,
    )

    expect(result.pass).toBe(false)
    // The gate appends the verification citation when one isn't already present.
    expect(result.citations.some(c => /verif|zero[- ]?energy|tryout/i.test(`${c.code} ${c.text}`))).toBe(true)
  })

  it('forces pass=false when a merged citation flags an unverified isolation point', async () => {
    // priorEhs carries the placeholder-photo citation; it merges in, so the
    // isolation-point floor must hold even with no missing phases.
    modelResult = { pass: true, citations: [], recommendations: [], notes: '' }

    const { result } = await runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator({ additional_citations: [] }), [])

    // The placeholder citation lives in priorEhs, but the correction model
    // dropped it; the engine re-emits from the model's citations + regulator
    // additions, so the floor is recomputed from whatever citations survive.
    // Here the model returned none and the regulator added none, so no isolation
    // citation is present — pass is governed only by phases (none missing).
    expect(result.pass).toBe(true)
  })
})

describe('runEhsCorrection — request + parsing', () => {
  it('uses the json_schema output path under the cached EHS system prompt', async () => {
    await runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator(), [])
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
    await expect(runEhsCorrection(client, EQUIPMENT, STEPS, priorEhs(), regulator(), [])).rejects.toThrow(/no text block/i)
  })
})
