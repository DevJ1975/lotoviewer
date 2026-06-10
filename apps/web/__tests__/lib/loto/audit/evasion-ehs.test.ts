// EVASION REGRESSION GUARDS — Fable 5 audit (gate-bypass findings A-C1, A-C2,
// A-H7), closed by the safetySignals helper + the runEhsCorrection contract.
//
// Each test encodes the SAFE contract these holes used to violate: a
// placeholder / self-contradictory / citation-dropped isolation photo could earn
// pass=true. They were first landed as `it.fails()` tripwires proving the holes
// existed; the fix flipped them red, and they now stand as plain assertions so
// any regression re-opens them loudly.
//
// Mock shape mirrors ehsGate.test.ts: the Anthropic client returns whatever JSON
// the test queued, and we assert the deterministic TS gate — the thing a worker's
// safety actually depends on.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { runEhsAgent, runEhsCorrection } from '@/lib/loto/audit/agents/ehs'
import { isIsolationUnverified } from '@/lib/loto/audit/safetySignals'
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

describe('EVASION GUARDS — the EHS gate cannot be bypassed (Fable 5 audit)', () => {
  // A-C2: the gate must read loto_equipment's own placeholder flags, so an
  // already-applied watermarked placeholder is never re-judged "verified" by a
  // fresh vision call on the next run.
  it('[A-C2] a known placeholder ISO photo on file does NOT pass the gate', async () => {
    const eq = equipment({ iso_photo_is_placeholder: true, iso_photo_provenance: 'reference_placeholder' })
    const { result } = await runEhsAgent(client, eq, STEPS, cleanDs(), cleanFpe(), [])
    expect(result.pass).toBe(false)
    expect(result.citations.some(c => /isolation point|placeholder|photo/i.test(`${c.code} ${c.text}`))).toBe(true)
  })

  // A-H7: a self-contradictory FPE verdict (match, but shows_isolation_point=false)
  // is not a match — "verified" requires the sub-flags to agree with the verdict.
  it('[A-H7] a "match" that does not actually show the isolation point does NOT pass', async () => {
    const fpe = cleanFpe()
    fpe.iso_photo.verdict = 'match'
    fpe.iso_photo.shows_isolation_point = false
    fpe.iso_photo.consistent_with_energy_steps = false
    const { result } = await runEhsAgent(client, equipment(), STEPS, cleanDs(), fpe, [])
    expect(result.pass).toBe(false)
  })

  // A-C1: the regulator-driven correction takes the isolation floor as a
  // DETERMINISTIC boolean from the caller (computed from the stored FPE/DS
  // verdicts — the photos didn't change), and unions the prior citations in
  // code. A correction model that "resolves" everything and drops the photo
  // citation can no longer clear the floor.
  it('[A-C1] a correction that drops the ISO-photo finding does NOT clear the floor', async () => {
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
    // The stored verdicts behind the prior citation: the ISO photo was a mismatch.
    const storedFpe = cleanFpe()
    storedFpe.iso_photo.verdict = 'mismatch'
    // Correction model "resolves" everything and drops the photo citation.
    modelResult = { pass: true, citations: [], recommendations: [], notes: 'Corrected.' }

    const { result } = await runEhsCorrection(
      client, equipment(), STEPS, priorEhs, regulator, [],
      isIsolationUnverified(equipment(), storedFpe, cleanDs()),
    )

    expect(result.pass).toBe(false)
    // The dropped prior citation is restored by the in-code union.
    expect(result.citations.some(c => c.code === 'Cal/OSHA T8 §3314(g)(4)')).toBe(true)
  })
})

describe('isIsolationUnverified — the single deterministic signal', () => {
  it('treats a clean, agreeing high-confidence match as verified', () => {
    expect(isIsolationUnverified(equipment(), cleanFpe(), cleanDs())).toBe(false)
  })

  it.each([
    ['placeholder flag on the row', { iso_photo_is_placeholder: true }],
    ['reference_placeholder provenance', { iso_photo_provenance: 'reference_placeholder' }],
  ])('reads %s as unverified regardless of clean verdicts', (_label, extra) => {
    expect(isIsolationUnverified(equipment(extra), cleanFpe(), cleanDs())).toBe(true)
  })

  it.each(['missing', 'mismatch', 'low_confidence'] as const)(
    'reads a %s verdict as unverified',
    (verdict) => {
      const fpe = cleanFpe()
      fpe.iso_photo.verdict = verdict
      expect(isIsolationUnverified(equipment(), fpe, cleanDs())).toBe(true)
    },
  )

  it('reads a DS low_confidence_iso flag as unverified', () => {
    const ds = cleanDs()
    ds.low_confidence_iso = true
    expect(isIsolationUnverified(equipment(), cleanFpe(), ds)).toBe(true)
  })
})
