// EVASION TESTS — Fable 5 audit (gate-bypass findings A-C1, A-C2, A-H7).
//
// Each test encodes the SAFE contract that the CURRENT engine VIOLATES: a
// placeholder / self-contradictory / citation-dropped isolation photo can still
// earn pass=true. Because today's code is unsafe, each test uses `it.fails()` —
// it stays GREEN while the hole is open (the assertion `pass === false` genuinely
// fails, and `it.fails` expects that failure) and turns RED the moment someone
// closes the hole. That red is the cue: delete `.fails` so the plain
// `expect(pass).toBe(false)` becomes the permanent regression guard.
//
// These are executable tripwires that prove each bypass exists, not happy-path
// coverage. Run with `expect().toBe(false)` un-wrapped to see the live bypass.
//
// The companion suite ehsCorrection.test.ts:95-108 currently asserts the *unsafe*
// outcome (pass=true) as if it were correct; A-C1 below is its safe inverse.
//
// Mock shape mirrors ehsGate.test.ts: the Anthropic client returns whatever JSON
// the test queued, and we assert the deterministic TS gate — the thing a worker's
// safety actually depends on.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { runEhsAgent, runEhsCorrection } from '@/lib/loto/audit/agents/ehs'
import type { DsResult, EhsResult, FpeResult, RegulatorMachineResult } from '@/lib/loto/audit/schemas'

let modelResult: EhsResult
const messagesCreate = vi.fn(async () => ({
  content: [{ type: 'text', text: JSON.stringify(modelResult) }],
  usage: { input_tokens: 10, output_tokens: 5 },
}))
const client = { messages: { create: messagesCreate } } as unknown as Anthropic

function equipment(extra: Record<string, unknown> = {}): Equipment {
  return {
    equipment_id: 'EQ-001', description: 'Industrial dough mixer', department: 'Bakery',
    equip_photo_url: 'https://cdn.example/eq.jpg', iso_photo_url: 'https://cdn.example/iso.jpg',
    decommissioned: false, ...extra,
  } as unknown as Equipment
}
const STEPS: LotoEnergyStep[] = []

function cleanFpe(): FpeResult {
  return {
    equip_photo: { verdict: 'match', confidence: 'high', notes: '' },
    iso_photo: { verdict: 'match', confidence: 'high', shows_isolation_point: true, consistent_with_energy_steps: true, notes: '' },
  }
}
function cleanDs(): DsResult {
  return { equipment_confidence: 'high', low_confidence_iso: false, steps: [], duplicates: [], outliers: [], notes: '' }
}

beforeEach(() => {
  messagesCreate.mockClear()
  // Generous model: passes with no citations. The gate must do the safety work.
  modelResult = { pass: true, citations: [], recommendations: [], notes: '' }
})

describe('EVASION — the EHS gate can be bypassed (Fable 5 audit)', () => {
  // A-C2: the gate never reads loto_equipment.iso_photo_is_placeholder, so an
  // already-applied watermarked placeholder is re-judged "verified" by the model.
  it.fails('[A-C2] a known placeholder ISO photo on file must NOT pass the gate', async () => {
    const eq = equipment({ iso_photo_is_placeholder: true, iso_photo_provenance: 'reference_placeholder' })
    const { result } = await runEhsAgent(client, eq, STEPS, cleanDs(), cleanFpe(), [])
    expect(result.pass).toBe(false) // SAFE contract. Current code returns true.
  })

  // A-H7: a self-contradictory FPE verdict (match, but shows_isolation_point=false)
  // is accepted as a match — a false positive is invisible to every downstream defense.
  it.fails('[A-H7] a "match" that does not actually show the isolation point must NOT pass', async () => {
    const fpe = cleanFpe()
    fpe.iso_photo.verdict = 'match'
    fpe.iso_photo.shows_isolation_point = false
    fpe.iso_photo.consistent_with_energy_steps = false
    const { result } = await runEhsAgent(client, equipment(), STEPS, cleanDs(), fpe, [])
    expect(result.pass).toBe(false) // SAFE contract. Current code returns true.
  })

  // A-C1: the regulator-driven correction recomputes the isolation-photo floor
  // from the correction MODEL's returned citations; if it drops the photo citation
  // while dissenting on an unrelated point, pass flips to true and the re-emit
  // then deletes the pending photo finding.
  it.fails('[A-C1] a correction that drops the ISO-photo finding must NOT clear the floor', async () => {
    const priorEhs: EhsResult = {
      pass: false,
      citations: [{ code: 'Cal/OSHA T8 §3314(g)(4)', text: 'Isolation point is unverified (placeholder photo).', severity: 'high' }],
      recommendations: ['Capture a real isolation-point photo.'],
      notes: '',
    }
    const regulator: RegulatorMachineResult = {
      concurs_with_ehs: false,
      additional_citations: [{ code: '8 CCR §3203', text: 'IIPP training records incomplete.', severity: 'medium' }],
      severity_escalations: [], procedure_deficiencies: [], inspector_narrative: 'Training gap.',
    }
    // Correction model "resolves" everything and drops the photo citation.
    modelResult = { pass: true, citations: [], recommendations: [], notes: 'Corrected.' }
    const { result } = await runEhsCorrection(client, equipment(), STEPS, priorEhs, regulator, [])
    expect(result.pass).toBe(false) // SAFE contract. Current code returns true.
  })
})
