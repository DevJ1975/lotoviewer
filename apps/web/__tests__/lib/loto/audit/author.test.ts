// The Author agent drafts a CORRECTED procedure for a machine that failed the
// EHS gate. Its load-bearing behaviors: it feeds the model the existing
// (deficient) steps AND the EHS findings so the draft can address them, uses the
// structured json_schema output path, and parses the corrected step set back
// out. We stub the Anthropic client (the only seam) and assert the request
// contents + the parse — mirroring ds.test.ts / ehsGate.test.ts style.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { runAuthorAgent } from '@/lib/loto/audit/agents/author'
import type { AuthorResult, EhsCitation } from '@/lib/loto/audit/schemas'

const MODEL_RESULT: AuthorResult = {
  steps: [
    {
      energy_type: 'E',
      step_type: 'isolate',
      tag_description: '[VERIFY ON SITE: exact main disconnect ID and panel]',
      isolation_procedure: 'Open the main disconnect and apply a lock to the hasp.',
      method_of_verification: 'Attempt restart and confirm no motion; meter the motor leads for zero voltage.',
      // Spanish parity: the placard is bilingual; the marker token stays English.
      tag_description_es: '[VERIFY ON SITE: exact main disconnect ID and panel]',
      isolation_procedure_es: 'Abra el desconectador principal y aplique un candado a la aldaba.',
      method_of_verification_es: 'Intente reiniciar y confirme que no haya movimiento; mida cero voltaje en los conductores del motor.',
    },
    {
      energy_type: 'P',
      step_type: 'verify_zero_energy',
      tag_description: 'Pneumatic supply gauge at the FRL',
      isolation_procedure: 'Close the air shutoff and bleed downstream pressure.',
      method_of_verification: 'Confirm the supply gauge reads 0 PSI before work begins.',
      tag_description_es: 'Manómetro de suministro neumático en el FRL',
      isolation_procedure_es: 'Cierre el corte de aire y purgue la presión aguas abajo.',
      method_of_verification_es: 'Confirme que el manómetro de suministro lea 0 PSI antes de comenzar el trabajo.',
    },
  ],
  summary: 'Added a zero-energy verification step and split the air supply into its own isolation. Confirm the disconnect ID on site.',
}

// Typed impl param so .mock.calls entries are tuples we can index into.
const messagesCreate = vi.fn(async (_args: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(MODEL_RESULT) }],
  usage: { input_tokens: 40, output_tokens: 25 },
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

function step(id: string, step_type: LotoEnergyStep['step_type'], tag: string): LotoEnergyStep {
  return {
    id,
    equipment_id: 'EQ-001',
    step_number: 1,
    step_type,
    sequence_order: 1,
    energy_type: 'E',
    tag_description: tag,
    isolation_procedure: 'Open disconnect and lock.',
    method_of_verification: null,
  } as unknown as LotoEnergyStep
}

const CITATIONS: EhsCitation[] = [
  {
    code: '29 CFR 1910.147(c)(4)(ii)',
    text: 'Procedure lacks a documented zero-energy verification (tryout) step.',
    severity: 'critical',
  },
]
const RECOMMENDATIONS = ['Add a verify_zero_energy step that meters the motor leads.']

beforeEach(() => {
  messagesCreate.mockClear()
})

describe('runAuthorAgent — request construction', () => {
  it('includes the existing steps and the EHS findings in the draft request', async () => {
    const steps = [step('s1', 'isolate', 'Main disconnect MCC-A')]

    await runAuthorAgent(client, EQUIPMENT, steps, CITATIONS, RECOMMENDATIONS, 'Steps look thin.', ['verify_zero_energy'])

    const args = messagesCreate.mock.calls[0]![0] as {
      messages: Array<{ content: string }>
      output_config?: { format?: { type?: string } }
    }
    const userText = args.messages[0]!.content

    // The deficient procedure must be in the prompt so the draft can correct it.
    expect(userText).toContain('Main disconnect MCC-A')
    // The EHS citation (code + text) and recommendation must reach the model.
    expect(userText).toContain('29 CFR 1910.147(c)(4)(ii)')
    expect(userText).toContain('zero-energy verification')
    expect(userText).toContain('Add a verify_zero_energy step')
    // The computed missing phase is surfaced.
    expect(userText).toMatch(/verify_zero_energy/)
    // DS notes are threaded in.
    expect(userText).toContain('Steps look thin.')
    // Structured-output path is used, mirroring generate-loto-steps.
    expect(args.output_config?.format?.type).toBe('json_schema')
  })

  it('sends the cached Author system prompt', async () => {
    await runAuthorAgent(client, EQUIPMENT, [step('s1', 'isolate', 'x')], CITATIONS, RECOMMENDATIONS, '', [])

    const args = messagesCreate.mock.calls[0]![0] as {
      system: Array<{ text: string; cache_control?: { type: string } }>
    }
    // Author persona + the never-fabricate honesty rule are in the system prompt.
    expect(args.system[0]!.text).toMatch(/procedure author/i)
    expect(args.system[0]!.text).toMatch(/VERIFY ON SITE/)
    // Bilingual rule: the draft must produce matching Spanish for the placard.
    expect(args.system[0]!.text).toMatch(/Spanish|es-MX/i)
    expect(args.system[0]!.cache_control?.type).toBe('ephemeral')
  })
})

describe('runAuthorAgent — response parsing', () => {
  it('parses the corrected structured steps + summary', async () => {
    const { result, model } = await runAuthorAgent(
      client, EQUIPMENT, [step('s1', 'isolate', 'x')], CITATIONS, RECOMMENDATIONS, '', ['verify_zero_energy'],
    )

    expect(model).toBe('claude-sonnet-4-6')
    expect(result.steps).toHaveLength(2)
    // The draft addresses the cited gap: a verify_zero_energy step is present.
    expect(result.steps.some(s => s.step_type === 'verify_zero_energy')).toBe(true)
    // The honesty rule produced a placeholder rather than a fabricated ID.
    expect(result.steps[0]!.tag_description).toMatch(/VERIFY ON SITE/)
    // Spanish parity: the corrected step carries matching es-MX text, and the
    // "[VERIFY ON SITE: …]" marker token stays English even in the ES field.
    expect(result.steps[0]!.isolation_procedure_es).toMatch(/desconectador|candado/i)
    expect(result.steps[0]!.tag_description_es).toMatch(/VERIFY ON SITE/)
    expect(result.summary).toMatch(/verification/i)
  })

  it('throws when the response carries no text block', async () => {
    messagesCreate.mockResolvedValueOnce({ content: [], usage: null } as never)

    await expect(
      runAuthorAgent(client, EQUIPMENT, [step('s1', 'isolate', 'x')], CITATIONS, RECOMMENDATIONS, '', []),
    ).rejects.toThrow(/no text block/i)
  })
})
