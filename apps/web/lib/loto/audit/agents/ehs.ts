// Agent 3 — Senior EHS Specialist (Cal/OSHA gate). Verifies the procedure
// against Cal/OSHA Title 8 §3314 + 1910.147 and holds sign-off authority.
//
// The model cites the regulations from the prompt's encoded requirements; the
// ingested Cal/OSHA T8 corpus (scripts/ingest-cal-osha-t8.mjs) can later
// augment this via RAG. Whatever the model returns, the HARD safety rules are
// re-enforced in TS below so a placeholder / missing-verification procedure can
// never pass — the gate is not allowed to depend on model goodwill.

import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import type { LotoStepType } from '@soteria/core/lotoProcedureValidation'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { EHS_SCHEMA, type EhsResult, type DsResult, type FpeResult, type RegulatorMachineResult, type EhsCitation } from '../schemas'
import { EHS_SYSTEM, describeEquipment, describeSteps } from '../prompts'
import { isIsolationUnverified } from '../safetySignals'
import type { AgentOutput } from './fpe'

const MODEL = MODEL_BY_SURFACE['loto-audit-ehs']

// The non-negotiable safety rules, applied to whatever the model returns. A
// placeholder/missing/mismatched isolation photo or a missing zero-energy
// verification can NEVER read as a pass — the gate must not depend on model
// goodwill. Shared by the first-pass gate AND the regulator-driven correction so
// a corrected assessment is held to the exact same floor. Mutates `result` in
// place (it owns the gated output) and returns it for call-site readability.
function applyHardGate(
  result: EhsResult,
  opts: { missingZeroEnergy: boolean; isoUnverified: boolean },
): EhsResult {
  if (opts.missingZeroEnergy || opts.isoUnverified) {
    result.pass = false
    if (opts.missingZeroEnergy && !result.citations.some(c => /verif|zero[- ]?energy|tryout/i.test(`${c.code} ${c.text}`))) {
      result.citations.push({
        code: '29 CFR 1910.147(c)(4)(ii) / Cal/OSHA T8 §3314(g)',
        text: 'Procedure lacks a documented zero-energy verification (tryout) step before work begins.',
        severity: 'critical',
      })
    }
    if (opts.isoUnverified && !result.citations.some(c => /isolation point|placeholder|photo/i.test(`${c.code} ${c.text}`))) {
      result.citations.push({
        code: 'Cal/OSHA T8 §3314(g)(4)',
        text: 'Isolation point is unverified (placeholder, missing, or mismatched photo); the lock-application location cannot be confirmed.',
        severity: 'high',
      })
    }
  }
  return result
}

export async function runEhsAgent(
  client: Anthropic,
  equipment: Equipment,
  steps: LotoEnergyStep[],
  ds: DsResult,
  fpe: FpeResult,
  missingPhases: LotoStepType[],
): Promise<AgentOutput<EhsResult>> {
  // What the deterministic + upstream signals already tell us. The model is
  // asked to reason as the authority, but these are the non-negotiables.
  const isoUnverified = isIsolationUnverified(equipment, fpe, ds)
  const missingZeroEnergy = missingPhases.includes('verify_zero_energy')

  const userText = [
    'Run the Cal/OSHA compliance gate on this LOTO procedure.',
    '',
    describeEquipment(equipment),
    '',
    'Energy steps:',
    describeSteps(steps),
    '',
    `OSHA phases missing: ${missingPhases.length ? missingPhases.join(', ') : 'none'}`,
    `Isolation photo verdict: ${fpe.iso_photo.verdict}; Data-Scientist low_confidence_iso: ${ds.low_confidence_iso}`,
    `Isolation photo on file is a known reference placeholder (not a field photo): ${equipment.iso_photo_is_placeholder === true || equipment.iso_photo_provenance === 'reference_placeholder'}`,
    `Data-Scientist notes: ${ds.notes}`,
    '',
    'Decide pass, cite each deficiency with its regulation code, and recommend fixes. Reply with JSON only.',
  ].join('\n')

  // No extended thinking: it pushed these structured calls past the shared
  // client's 30s timeout. The hard gate below is enforced in TS regardless of
  // model output, so the safety decision never depends on model deliberation.
  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 4000,
    system:     [{ type: 'text', text: EHS_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: EHS_SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('EHS agent: no text block in response')
  const result = JSON.parse(textBlock.text) as EhsResult

  // Hard gate (enforced regardless of model output).
  applyHardGate(result, { missingZeroEnergy, isoUnverified })

  return { result, usage: response.usage ?? null, model: MODEL }
}

// ── Regulator-driven correction ─────────────────────────────────────────────
// A senior Cal/OSHA regulator dissented/escalated on the first EHS assessment.
// This re-runs the EHS Specialist with a CORRECTION prompt that folds in the
// regulator's critique, MERGES citations, sharpens recommendations, and sets the
// final verdict. The SAME hard gate is re-applied so a corrected assessment can
// never fall below the safety floor — even if the model returns pass:true.
//
// `isoUnverified` is the DETERMINISTIC isolation-point signal (safetySignals,
// computed from the stored FPE/DS verdicts + the equipment row — the photos
// didn't change since the audit). It must come from the caller, never be
// re-derived from the correction model's returned citations: a correction that
// dropped the photo citation used to evaporate the floor and flip a missing-ISO
// machine to pass=true (Fable 5 finding A-C1).
export async function runEhsCorrection(
  client: Anthropic,
  equipment: Equipment,
  steps: LotoEnergyStep[],
  priorEhs: EhsResult,
  regulator: RegulatorMachineResult,
  missingPhases: LotoStepType[],
  isoUnverified: boolean,
): Promise<AgentOutput<EhsResult>> {
  const priorCitationLines = priorEhs.citations.length > 0
    ? priorEhs.citations.map((c, i) => `  ${i + 1}. [${c.severity}] ${c.code}: ${c.text}`).join('\n')
    : '  (none)'
  const addlCitationLines = regulator.additional_citations.length > 0
    ? regulator.additional_citations.map((c, i) => `  ${i + 1}. [${c.severity}] ${c.code}: ${c.text}`).join('\n')
    : '  (none)'
  const escalationLines = regulator.severity_escalations.length > 0
    ? regulator.severity_escalations.map((e, i) => `  ${i + 1}. ${e.code}: ${e.from} → ${e.to} (${e.reason})`).join('\n')
    : '  (none)'
  const deficiencyLines = regulator.procedure_deficiencies.length > 0
    ? regulator.procedure_deficiencies.map((d, i) => `  ${i + 1}. ${d}`).join('\n')
    : '  (none)'

  const userText = [
    'A senior Cal/OSHA regulator reviewed your assessment and raised the following critique. Produce a corrected, comprehensive assessment: incorporate every valid point, MERGE citations (dedupe by code+text), sharpen recommendations, and set the final pass verdict.',
    '',
    describeEquipment(equipment),
    '',
    'Energy steps:',
    describeSteps(steps),
    '',
    `Your prior verdict: ${priorEhs.pass ? 'PASS' : 'FAIL'}`,
    'Your prior citations:',
    priorCitationLines,
    '',
    `Regulator stance: ${regulator.concurs_with_ehs ? 'CONCURS' : 'DISSENTS'}`,
    'Regulator additional citations:',
    addlCitationLines,
    'Regulator severity escalations:',
    escalationLines,
    'Regulator procedure deficiencies:',
    deficiencyLines,
    `Regulator narrative: ${regulator.inspector_narrative || '(none)'}`,
    '',
    'Return the corrected assessment as JSON only.',
  ].join('\n')

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 4000,
    system:     [{ type: 'text', text: EHS_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: EHS_SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('EHS correction: no text block in response')
  const result = JSON.parse(textBlock.text) as EhsResult

  // Belt-and-braces: the model is told to merge the prior citations and the
  // regulator's additions, but union+dedupe them here too so a dropped citation
  // can't quietly weaken the corrected record. Nothing changed on the ground
  // between the audit and this correction, so a prior finding the model
  // "resolved" in prose is still a finding. Dedupe key is code+text, matching
  // the prompt's contract.
  result.citations = dedupeCitations([...result.citations, ...priorEhs.citations, ...regulator.additional_citations])

  // Same hard gate as the first pass, on the same deterministic signals: the
  // verify floor recomputed from missingPhases, the isolation floor from the
  // caller-supplied boolean — never from the model's own text.
  const missingZeroEnergy = missingPhases.includes('verify_zero_energy')
  applyHardGate(result, { missingZeroEnergy, isoUnverified })

  return { result, usage: response.usage ?? null, model: MODEL }
}

function dedupeCitations(citations: EhsCitation[]): EhsCitation[] {
  const seen = new Set<string>()
  const out: EhsCitation[] = []
  for (const c of citations) {
    const key = `${c.code}\u0000${c.text}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}
