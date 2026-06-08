// The Data-Scientist agent computes missing OSHA phases DETERMINISTICALLY via
// the shared validateProcedure (not by asking the model), and threads the FPE
// photo verdicts into its prompt. We stub the Anthropic client and assert both:
// the returned missingPhases match validateProcedure, and the FPE verdicts
// reach the model's user message.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { runDsAgent } from '@/lib/loto/audit/agents/ds'
import type { DsResult, FpeResult } from '@/lib/loto/audit/schemas'

const MODEL_RESULT: DsResult = {
  equipment_confidence: 'high',
  low_confidence_iso: false,
  steps: [],
  duplicates: [],
  outliers: [],
  notes: 'Consistent.',
}

// Typed param so .mock.calls entries are tuples we can index into.
const messagesCreate = vi.fn(async (_args: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(MODEL_RESULT) }],
  usage: { input_tokens: 30, output_tokens: 15 },
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

// Build a step row. Only step_type + sequence_order matter to validateProcedure.
function step(id: string, step_type: LotoEnergyStep['step_type'], sequence_order: number): LotoEnergyStep {
  return {
    id,
    equipment_id: 'EQ-001',
    step_number: sequence_order,
    step_type,
    sequence_order,
    energy_type: 'E',
  } as unknown as LotoEnergyStep
}

function fpe(): FpeResult {
  return {
    equip_photo: { verdict: 'match', confidence: 'high', notes: 'Shows the machine.' },
    iso_photo: {
      verdict: 'low_confidence', confidence: 'low',
      shows_isolation_point: false, consistent_with_energy_steps: false,
      notes: 'Blurry — cannot confirm the lockout point.',
    },
  }
}

beforeEach(() => {
  messagesCreate.mockClear()
})

describe('runDsAgent — deterministic missing phases', () => {
  it('returns the missing phases validateProcedure computes for a procedure lacking verify_zero_energy', async () => {
    // Has isolate + release + lockout, but NOT verify_zero_energy.
    const steps = [
      step('s1', 'isolate', 1),
      step('s2', 'release_stored_energy', 2),
      step('s3', 'lockout', 3),
    ]

    const { missingPhases } = await runDsAgent(client, EQUIPMENT, steps, fpe())

    expect(missingPhases).toEqual(['verify_zero_energy'])
  })

  it('returns an empty missing list when every required phase is present', async () => {
    const steps = [
      step('s1', 'isolate', 1),
      step('s2', 'release_stored_energy', 2),
      step('s3', 'lockout', 3),
      step('s4', 'verify_zero_energy', 4),
    ]

    const { missingPhases } = await runDsAgent(client, EQUIPMENT, steps, fpe())

    expect(missingPhases).toEqual([])
  })
})

describe('runDsAgent — prompt construction', () => {
  it('passes the FPE photo verdicts into the user prompt', async () => {
    const steps = [step('s1', 'isolate', 1)]

    await runDsAgent(client, EQUIPMENT, steps, fpe())

    const args = messagesCreate.mock.calls[0]![0] as { messages: Array<{ content: string }> }
    const userText = args.messages[0]!.content
    // The DS model must see what the FPE concluded about each photo.
    expect(userText).toContain('Equipment photo: match')
    expect(userText).toContain('Isolation photo: low_confidence')
    expect(userText).toContain('shows_isolation_point=false')
  })

  it('surfaces the computed missing phases in the prompt', async () => {
    const steps = [step('s1', 'isolate', 1), step('s2', 'lockout', 2)]

    await runDsAgent(client, EQUIPMENT, steps, fpe())

    const args = messagesCreate.mock.calls[0]![0] as { messages: Array<{ content: string }> }
    const userText = args.messages[0]!.content
    // release_stored_energy + verify_zero_energy are both absent.
    expect(userText).toMatch(/release_stored_energy/)
    expect(userText).toMatch(/verify_zero_energy/)
  })
})

describe('runDsAgent — response parsing', () => {
  it('throws when the response carries no text block', async () => {
    messagesCreate.mockResolvedValueOnce({ content: [], usage: null } as never)

    await expect(runDsAgent(client, EQUIPMENT, [step('s1', 'isolate', 1)], fpe())).rejects.toThrow(/no text block/i)
  })
})
