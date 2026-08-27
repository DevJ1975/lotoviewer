// Applying a `procedure_draft` REPLACES the machine's entire step set
// (migration 220: delete-then-insert from `new_value -> 'steps'`). So a draft
// the Author agent should never have produced is not a cosmetic problem:
//
//   - zero steps  → jsonb_array_elements('[]') inserts nothing, the DELETE
//                   still runs, the machine's LOTO procedure is erased and a
//                   blank placard is reprinted for the panel
//   - missing a required OSHA phase → a shorter, still non-compliant procedure
//                   ships with a reviewer's signature on it
//
// Structured output makes both unlikely, not impossible — a truncated or
// degraded response still parses. runAuthorAgent refuses rather than staging.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { runAuthorAgent } from '@/lib/loto/audit/agents/author'
import type { AuthorResult, EhsCitation } from '@/lib/loto/audit/schemas'

/** One well-formed step; `over` lets a test bend a single field. */
function step(over: Partial<AuthorResult['steps'][number]> = {}): AuthorResult['steps'][number] {
  return {
    energy_type: 'E',
    step_type: 'isolate',
    tag_description: 'Main disconnect',
    isolation_procedure: 'Open the disconnect and apply a lock.',
    method_of_verification: 'Meter the load side for zero voltage.',
    tag_description_es: 'Desconectador principal',
    isolation_procedure_es: 'Abra el desconectador y aplique un candado.',
    method_of_verification_es: 'Mida cero voltaje en el lado de carga.',
    ...over,
  }
}

/** validateProcedure requires isolate + release_stored_energy + lockout + verify_zero_energy. */
const COMPLIANT_STEPS = [
  step({ step_type: 'isolate' }),
  step({ step_type: 'release_stored_energy' }),
  step({ step_type: 'lockout' }),
  step({ step_type: 'verify_zero_energy' }),
]

const messagesCreate = vi.fn()
const client = { messages: { create: messagesCreate } } as unknown as Anthropic

const EQUIPMENT = { equipment_id: 'MIX-04', description: 'Dough mixer', department: 'Bakery' } as unknown as Equipment
const STEPS: LotoEnergyStep[] = []
const CITATIONS: EhsCitation[] = []

function respondWith(result: unknown) {
  messagesCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(result) }],
    usage: { input_tokens: 10, output_tokens: 5 },
  })
}

function run() {
  return runAuthorAgent(client, EQUIPMENT, STEPS, CITATIONS, [], '', ['verify_zero_energy'])
}

beforeEach(() => { messagesCreate.mockReset() })

describe('runAuthorAgent — refuses a draft that would degrade the procedure', () => {
  it('throws on an empty step list rather than staging a procedure-deleting draft', async () => {
    respondWith({ steps: [], summary: 'nothing to do' })
    await expect(run()).rejects.toThrow(/empty step list/i)
  })

  it('throws when steps is missing entirely', async () => {
    respondWith({ summary: 'truncated response' })
    await expect(run()).rejects.toThrow(/empty step list/i)
  })

  it('throws when steps is not an array', async () => {
    respondWith({ steps: { step_type: 'isolate' }, summary: 'malformed' })
    await expect(run()).rejects.toThrow(/empty step list/i)
  })

  it('throws on an unrecognised step_type', async () => {
    respondWith({ steps: [...COMPLIANT_STEPS, step({ step_type: 'de_energize' as never })], summary: 'x' })
    await expect(run()).rejects.toThrow(/unknown step_type/i)
  })

  // The failure mode with no visible symptom: the draft looks plausible, the
  // reviewer approves a real-looking diff, and the audit ships a procedure that
  // still fails the very gate that triggered it.
  it('throws when the draft omits the required phase it was asked to add', async () => {
    respondWith({
      steps: [
        step({ step_type: 'shutdown' }),
        step({ step_type: 'isolate' }),
        step({ step_type: 'release_stored_energy' }),
        step({ step_type: 'lockout' }),
        // no verify_zero_energy — the phase §147(d)(6) names explicitly
      ],
      summary: 'Corrected the isolation sequence.',
    })
    await expect(run()).rejects.toThrow(/missing required phase\(s\).*verify_zero_energy/i)
  })

  it('names the equipment in the error so the failure is traceable to a machine', async () => {
    respondWith({ steps: [], summary: '' })
    await expect(run()).rejects.toThrow(/MIX-04/)
  })

  it('accepts a compliant draft unchanged', async () => {
    respondWith({ steps: COMPLIANT_STEPS, summary: 'Added zero-energy verification.' })

    const out = await run()

    expect(out.result.steps).toHaveLength(4)
    expect(out.result.summary).toMatch(/zero-energy/i)
  })

  it('accepts a draft carrying extra phases beyond the required set', async () => {
    respondWith({ steps: [step({ step_type: 'shutdown' }), ...COMPLIANT_STEPS], summary: 'ok' })

    const out = await run()

    expect(out.result.steps).toHaveLength(5)
  })
})
