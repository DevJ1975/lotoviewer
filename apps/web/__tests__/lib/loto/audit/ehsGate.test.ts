// The EHS agent is the Cal/OSHA gate. Its safety contract is that the HARD
// rules are re-enforced in TypeScript regardless of what the model returns:
// a model that says pass:true must be overruled to pass:false when the
// procedure lacks a zero-energy verification, the isolation photo is
// missing/mismatched, or the Data-Scientist flagged the ISO as low-confidence.
//
// We stub the Anthropic client so the model always returns a clean pass with
// no citations, then assert the gate's deterministic behavior — that is the
// behavior a worker's safety actually depends on, and it must not rely on
// model goodwill.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import type { LotoStepType } from '@soteria/core/lotoProcedureValidation'
import { runEhsAgent } from '@/lib/loto/audit/agents/ehs'
import type { DsResult, EhsResult, FpeResult } from '@/lib/loto/audit/schemas'

// A single Anthropic client stub whose messages.create returns whatever JSON
// the current test queued. Reset before each test.
let modelResult: EhsResult
const messagesCreate = vi.fn(async () => ({
  content: [{ type: 'text', text: JSON.stringify(modelResult) }],
  usage: { input_tokens: 10, output_tokens: 5 },
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

const STEPS: LotoEnergyStep[] = []

// A clean, fully-verified upstream signal set — nothing here should trip the gate.
function cleanFpe(): FpeResult {
  return {
    equip_photo: { verdict: 'match', confidence: 'high', notes: 'Shows the mixer.' },
    iso_photo: {
      verdict: 'match', confidence: 'high',
      shows_isolation_point: true, consistent_with_energy_steps: true,
      notes: 'Shows the disconnect.',
    },
  }
}

function cleanDs(): DsResult {
  return {
    equipment_confidence: 'high',
    low_confidence_iso: false,
    steps: [],
    duplicates: [],
    outliers: [],
    notes: 'Consistent.',
  }
}

beforeEach(() => {
  messagesCreate.mockClear()
  // Model is generous: it passes the procedure with no citations. The gate's
  // job is to overrule this when a hard rule is violated.
  modelResult = { pass: true, citations: [], recommendations: [], notes: 'Looks fine.' }
})

describe('runEhsAgent — hard gate overrides a passing model', () => {
  it('forces pass:false when verify_zero_energy phase is missing', async () => {
    const missingPhases: LotoStepType[] = ['verify_zero_energy']

    const { result } = await runEhsAgent(client, EQUIPMENT, STEPS, cleanDs(), cleanFpe(), missingPhases)

    expect(result.pass).toBe(false)
    // A citation naming the missing verification must be appended.
    expect(result.citations.some(c => /verif|zero[- ]?energy|tryout/i.test(`${c.code} ${c.text}`))).toBe(true)
  })

  it('forces pass:false when the ISO photo verdict is "missing"', async () => {
    const fpe = cleanFpe()
    fpe.iso_photo.verdict = 'missing'

    const { result } = await runEhsAgent(client, EQUIPMENT, STEPS, cleanDs(), fpe, [])

    expect(result.pass).toBe(false)
    expect(result.citations.some(c => /isolation point|placeholder|photo/i.test(`${c.code} ${c.text}`))).toBe(true)
  })

  it('forces pass:false when the ISO photo verdict is "mismatch"', async () => {
    const fpe = cleanFpe()
    fpe.iso_photo.verdict = 'mismatch'

    const { result } = await runEhsAgent(client, EQUIPMENT, STEPS, cleanDs(), fpe, [])

    expect(result.pass).toBe(false)
    expect(result.citations.some(c => /isolation point|placeholder|photo/i.test(`${c.code} ${c.text}`))).toBe(true)
  })

  it('forces pass:false when the Data-Scientist set low_confidence_iso', async () => {
    const ds = cleanDs()
    ds.low_confidence_iso = true

    const { result } = await runEhsAgent(client, EQUIPMENT, STEPS, ds, cleanFpe(), [])

    expect(result.pass).toBe(false)
    expect(result.citations.some(c => /isolation point|placeholder|photo/i.test(`${c.code} ${c.text}`))).toBe(true)
  })
})

describe('runEhsAgent — golden path', () => {
  it('leaves pass:true when no hard rule is violated', async () => {
    const { result } = await runEhsAgent(client, EQUIPMENT, STEPS, cleanDs(), cleanFpe(), [])

    expect(result.pass).toBe(true)
    // No deficiency was forced, so the model's empty citation list stands.
    expect(result.citations).toHaveLength(0)
  })

  it('does not duplicate a citation the model already supplied for the missing phase', async () => {
    // Model already cited the zero-energy gap with matching wording.
    modelResult = {
      pass: false,
      citations: [{
        code: '29 CFR 1910.147(d)(6)',
        text: 'Procedure does not verify zero-energy state before work.',
        severity: 'critical',
      }],
      recommendations: ['Add a tryout step.'],
      notes: 'Missing verification.',
    }

    const { result } = await runEhsAgent(client, EQUIPMENT, STEPS, cleanDs(), cleanFpe(), ['verify_zero_energy'])

    expect(result.pass).toBe(false)
    // The gate must NOT append a second verification citation when the model
    // already provided one — exactly one such citation remains.
    const verificationCitations = result.citations.filter(c =>
      /verif|zero[- ]?energy|tryout/i.test(`${c.code} ${c.text}`),
    )
    expect(verificationCitations).toHaveLength(1)
  })
})

describe('runEhsAgent — response parsing', () => {
  it('throws when the response carries no text block', async () => {
    messagesCreate.mockResolvedValueOnce({ content: [], usage: null } as never)

    await expect(
      runEhsAgent(client, EQUIPMENT, STEPS, cleanDs(), cleanFpe(), []),
    ).rejects.toThrow(/no text block/i)
  })
})
