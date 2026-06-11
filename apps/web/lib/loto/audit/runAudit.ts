// Audit engine. Sweeps a tenant's equipment; per machine runs FPE → DS → EHS
// in order and stages proposed fixes into loto_audit_changes. It writes ONLY to
// the audit tables (and uploads placeholder images as new storage objects) —
// never to loto_equipment / loto_energy_steps. Those are touched solely by the
// apply RPC, and only for changes a human approved through the review link.
//
// Resumable: results are upserted per phase keyed by (run_id, equipment_id), so
// a re-run skips equipment already at agent_phase='ehs_done'. Bounded
// concurrency keeps the Anthropic fan-out polite.

import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { validateProcedure } from '@soteria/core/lotoProcedureValidation'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getAnthropic } from '@/lib/ai/client'
import { checkTenantBudget, checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import type { AiSurface } from '@/lib/ai/rateLimit'
import { runFpeAgent } from './agents/fpe'
import { runDsAgent } from './agents/ds'
import { runEhsAgent, runEhsCorrection } from './agents/ehs'
import { runAuthorAgent } from './agents/author'
import { runRegulatorMachineReview, runRegulatorProgramReview } from './agents/regulator'
import { buildPlaceholderPhoto } from './placeholderPhoto'
import { findExistingIsoPhoto } from './storagePhotoSearch'
import { isIsolationUnverified } from './safetySignals'
import { describeRunAggregate, type RunAggregate } from './prompts'
import type { AuditSeverity, AuthorResult, DsResult, EhsResult, FpeResult, RegulatorMachineResult } from './schemas'

export interface RunAuditScope {
  department?:    string
  equipment_ids?: string[]
  only_active?:   boolean
  limit?:         number
}

export interface RunAuditOptions {
  tenantId:     string
  runId:        string
  userId:       string | null
  scope:        RunAuditScope
  concurrency?: number
}

export interface RunAuditSummary { total: number; processed: number; failed: number }

const DEFAULT_CONCURRENCY = 3

export async function runAudit(opts: RunAuditOptions): Promise<RunAuditSummary> {
  const admin  = supabaseAdmin()
  // Audit agents (especially EHS, which emits citations + recommendations) can
  // exceed the shared client's 30s default; give them a generous timeout. The
  // engine runs via after() comfortably inside the route's maxDuration.
  const client = await getAnthropic(opts.tenantId, { timeoutMs: 120_000 })

  // Tenant kill-switch / budget. One upfront check — a per-equipment check
  // across hundreds of rows would hammer the budget query; per-call rate limits
  // still apply below.
  const budget = await checkTenantBudget({ tenantId: opts.tenantId, userId: opts.userId ?? 'audit-engine', surface: 'loto-audit-fpe' })
  if (!budget.ok) {
    await failRun(admin, opts.runId, budget.message)
    throw new Error(budget.message)
  }

  const equipment = await loadEquipment(admin, opts.tenantId, opts.scope)
  await admin.from('loto_audit_runs').update({ total_equipment: equipment.length }).eq('id', opts.runId)

  let processed = 0
  let failed = 0
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)

  await mapWithConcurrency(equipment, concurrency, async (eq) => {
    try {
      await processEquipment(admin, client, opts, eq)
    } catch (err) {
      failed += 1
      await admin.from('loto_audit_equipment_results').upsert({
        run_id: opts.runId, tenant_id: opts.tenantId, equipment_id: eq.equipment_id,
        agent_phase: 'error',
        raw_payload: { error: err instanceof Error ? err.message.slice(0, 500) : 'unknown error' },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'run_id,equipment_id' })
    } finally {
      processed += 1
      await admin.from('loto_audit_runs').update({ processed_equipment: processed }).eq('id', opts.runId)
    }
  })

  // Processing done — the change-set is ready for human review. The caller
  // mints the audit review link and sets review_link_id.
  await admin.from('loto_audit_runs')
    .update({ status: 'awaiting_review', finished_at: new Date().toISOString() })
    .eq('id', opts.runId)

  return { total: equipment.length, processed, failed }
}

// ── Cal/OSHA Regulator phase (post-audit, pre-human-review) ──────────────────
// Runs AFTER runAudit, over the same scope. Per audited machine a CSHO persona
// re-reviews the internal FPE/DS/EHS record and concurs or dissents; a material
// dissent drives an EHS CORRECTION → (if it now fails) a re-author → a SURGICAL
// re-emit of only the ehs_finding / procedure_draft rows. It NEVER re-runs the
// photo search and NEVER touches step_confidence / placeholder_photo rows — that
// is the audit's job and must not repeat. Finally it runs a program-level review
// over the run aggregate. Everything stays staged for the human review gate.
//
// Resumable: a machine whose regulator_payload is already set is skipped, and
// regulator_payload is written LAST (after the correction + re-emit) so a
// mid-phase reclaim re-runs that machine cleanly rather than leaving a critique
// with no corresponding re-emit.

export interface RunRegulatorSummary { reviewed: number; corrected: number }

export async function runRegulatorPhase(opts: RunAuditOptions): Promise<RunRegulatorSummary> {
  const admin  = supabaseAdmin()
  const client = await getAnthropic(opts.tenantId, { timeoutMs: 120_000 })

  const budget = await checkTenantBudget({ tenantId: opts.tenantId, userId: opts.userId ?? 'audit-engine', surface: 'loto-audit-regulator' })
  if (!budget.ok) throw new Error(budget.message)

  const equipment = await loadEquipment(admin, opts.tenantId, opts.scope)

  let reviewed  = 0
  let corrected = 0
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)

  await mapWithConcurrency(equipment, concurrency, async (eq) => {
    const did = await reviewEquipment(admin, client, opts, eq)
    if (did === 'skipped') return
    reviewed += 1
    if (did === 'corrected') corrected += 1
  })

  // Program-level review over the whole run aggregate. Best-effort: a failed
  // program review must not lose the per-machine critiques already stored.
  try {
    const aggregate = await buildRunAggregate(admin, opts)
    const program = await callAgent(opts, 'loto-audit-regulator', () => runRegulatorProgramReview(client, describeRunAggregate(aggregate)))
    await admin.from('loto_audit_runs').update({ regulator_report: program.result }).eq('id', opts.runId)
  } catch (err) {
    await admin.from('loto_audit_runs')
      .update({ regulator_report: { error: err instanceof Error ? err.message.slice(0, 500) : 'program review failed' } })
      .eq('id', opts.runId)
  }

  return { reviewed, corrected }
}

type ReviewOutcome = 'skipped' | 'reviewed' | 'corrected'

async function reviewEquipment(
  admin: SupabaseClient,
  client: Anthropic,
  opts: RunAuditOptions,
  eq: Equipment,
): Promise<ReviewOutcome> {
  // Resume guard + scope: only machines the audit finished (agent_phase
  // 'ehs_done'), and skip any already reviewed (regulator_payload present).
  const { data: row } = await admin
    .from('loto_audit_equipment_results')
    .select('agent_phase, regulator_payload, raw_payload, ehs_pass, ehs_citations, ehs_recommendations, ehs_notes')
    .eq('run_id', opts.runId)
    .eq('equipment_id', eq.equipment_id)
    .maybeSingle<AuditResultRow>()
  if (!row || row.agent_phase !== 'ehs_done' || row.regulator_payload != null) return 'skipped'

  const raw = (row.raw_payload ?? {}) as { fpe?: FpeResult; ds?: DsResult; ehs?: EhsResult }
  if (!raw.fpe || !raw.ds) return 'skipped' // can't re-review without the stored verdicts
  const fpe = raw.fpe
  const ds  = raw.ds
  // Prefer the stored raw EHS; fall back to the result columns if raw.ehs is absent.
  const ehs: EhsResult = raw.ehs ?? {
    pass:            row.ehs_pass ?? false,
    citations:       (row.ehs_citations ?? []) as EhsResult['citations'],
    recommendations: (row.ehs_recommendations ?? []) as string[],
    notes:           row.ehs_notes ?? '',
  }

  const steps = await loadSteps(admin, opts.tenantId, eq.equipment_id)
  // Recompute the missing OSHA phases from the live steps with the same shared
  // validator the DS agent used, so the EHS correction's hard-gate floor (a
  // missing verify_zero_energy ⇒ pass=false) matches the original audit exactly.
  const missingPhases = validateProcedure(
    steps.map(s => ({ step_type: s.step_type, sequence_order: s.sequence_order })),
  ).missing

  const regulator = await callAgent(opts, 'loto-audit-regulator', () =>
    runRegulatorMachineReview(client, eq, steps, fpe, ds, ehs))

  const material =
    regulator.result.concurs_with_ehs === false ||
    regulator.result.additional_citations.length > 0 ||
    regulator.result.severity_escalations.length > 0 ||
    regulator.result.procedure_deficiencies.length > 0

  let outcome: ReviewOutcome = 'reviewed'
  if (material) {
    // (a) Correct the EHS assessment, folding in the regulator's critique. The
    // isolation floor is the deterministic signal recomputed from the STORED
    // verdicts + the live equipment row — the photos didn't change since the
    // audit, and the floor must never come from the correction model's text.
    const corrected = await callAgent(opts, 'loto-audit-ehs', () =>
      runEhsCorrection(client, eq, steps, ehs, regulator.result, missingPhases, isIsolationUnverified(eq, fpe, ds)))
    await upsertResult(admin, opts, eq.equipment_id, {
      ehs_pass:            corrected.result.pass,
      ehs_citations:       corrected.result.citations,
      ehs_recommendations: corrected.result.recommendations,
      ehs_notes:           corrected.result.notes,
      raw_payload:         { ...raw, ehs: corrected.result },
    })

    // (b) Re-author ONLY if the corrected verdict still fails the gate.
    const reauthored = corrected.result.pass === false
      ? await callAgent(opts, 'loto-audit-author', () =>
          runAuthorAgent(client, eq, steps, corrected.result.citations, corrected.result.recommendations, ds.notes, missingPhases))
      : null

    // (c) Surgical re-emit of the corrected findings + (maybe) the new draft.
    await reemitFindingsAndDraft(admin, opts, eq, steps, corrected.result, reauthored?.result ?? null)
    outcome = 'corrected'
  }

  // Store the critique LAST so a mid-phase reclaim re-runs the whole correction
  // cleanly rather than skipping on a half-applied state. agent_phase is left at
  // 'ehs_done' — regulator_payload presence is the regulator resume marker.
  await upsertResult(admin, opts, eq.equipment_id, {
    regulator_payload: regulator.result,
    regulator_concurs: regulator.result.concurs_with_ehs,
  })

  return outcome
}

// SURGICAL re-emit: replace ONLY the pending ehs_finding + procedure_draft rows
// for this machine in this run, leaving step_confidence + placeholder_photo
// rows (and the already-done photo search) untouched. Mirrors emitChanges'
// insert shape exactly.
async function reemitFindingsAndDraft(
  admin: SupabaseClient,
  opts: RunAuditOptions,
  eq: Equipment,
  steps: LotoEnergyStep[],
  ehs: EhsResult,
  author: AuthorResult | null,
): Promise<void> {
  const changes: PendingChange[] = []

  // Corrected EHS citations as findings (one row each).
  for (const c of ehs.citations) {
    changes.push({
      change_kind:   'ehs_finding',
      target_table:  'loto_equipment',
      target_row_pk: null,
      target_column: null,
      old_value:     null,
      new_value:     c,
      agent:         'EHS',
      rationale:     c.text,
      severity:      c.severity,
    })
  }

  // The re-authored corrected procedure, if the corrected gate still failed.
  if (author) {
    changes.push({
      change_kind:   'procedure_draft',
      target_table:  'loto_energy_steps',
      target_row_pk: null,
      target_column: null,
      old_value:     steps.map(projectStepForDraft),
      new_value:     { steps: author.steps, summary: author.summary },
      agent:         'SSD',
      rationale:     'Re-drafted corrected procedure after Cal/OSHA regulator review.',
      severity:      'high',
    })
  }

  // Delete only the two re-emittable kinds; never touch step_confidence /
  // placeholder_photo (or the photo search behind them).
  await admin.from('loto_audit_changes')
    .delete()
    .eq('run_id', opts.runId)
    .eq('equipment_id', eq.equipment_id)
    .eq('status', 'pending')
    .in('change_kind', ['ehs_finding', 'procedure_draft'])

  if (changes.length === 0) return
  await admin.from('loto_audit_changes').insert(
    changes.map(c => ({
      run_id:              opts.runId,
      tenant_id:           opts.tenantId,
      equipment_id:        eq.equipment_id,
      change_kind:         c.change_kind,
      target_table:        c.target_table,
      target_row_pk:       c.target_row_pk,
      target_column:       c.target_column,
      old_value:           c.old_value,
      new_value:           c.new_value,
      agent:               c.agent,
      rationale:           c.rationale,
      severity:            c.severity,
      status:              'pending',
      staged_storage_path: null,
      staged_photo_url:    null,
    })),
  )
}

// ── Regulator-phase helpers ──────────────────────────────────────────────────

interface AuditResultRow {
  agent_phase:         string
  regulator_payload:   RegulatorMachineResult | null
  raw_payload:         unknown
  ehs_pass:            boolean | null
  ehs_citations:       unknown
  ehs_recommendations: unknown
  ehs_notes:           string | null
}

async function loadSteps(admin: SupabaseClient, tenantId: string, equipmentId: string): Promise<LotoEnergyStep[]> {
  const { data } = await admin
    .from('loto_energy_steps')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('equipment_id', equipmentId)
    .order('sequence_order', { ascending: true })
    .order('step_number', { ascending: true })
  return (data ?? []) as LotoEnergyStep[]
}

// The procedure-draft `old_value` projection — the current step set the reviewer
// diffs against. Identical to emitChanges' projection so a re-emitted draft reads
// the same as a first-pass one (including the Spanish so the ES before→after shows).
function projectStepForDraft(s: LotoEnergyStep) {
  return {
    energy_type:               s.energy_type,
    step_type:                 s.step_type,
    tag_description:           s.tag_description,
    isolation_procedure:       s.isolation_procedure,
    method_of_verification:    s.method_of_verification,
    tag_description_es:        s.tag_description_es,
    isolation_procedure_es:    s.isolation_procedure_es,
    method_of_verification_es: s.method_of_verification_es,
  }
}

// Build the run aggregate the program-level review summarizes: pass/fail counts,
// top recurring citation codes, # placeholder-photo changes, # machines missing
// a zero-energy verification (from ds_consistency.missing_phases), departments.
async function buildRunAggregate(admin: SupabaseClient, opts: RunAuditOptions): Promise<RunAggregate> {
  const [{ data: results }, { data: changes }] = await Promise.all([
    admin.from('loto_audit_equipment_results')
      .select('equipment_id, ehs_pass, ehs_citations, ds_consistency')
      .eq('run_id', opts.runId).eq('agent_phase', 'ehs_done'),
    admin.from('loto_audit_changes')
      .select('change_kind')
      .eq('run_id', opts.runId),
  ])

  const rows = (results ?? []) as Array<{
    equipment_id: string
    ehs_pass: boolean | null
    ehs_citations: unknown
    ds_consistency: { missing_phases?: unknown } | null
  }>

  let ehsPass = 0
  let ehsFail = 0
  let missingVerifyZero = 0
  const codeCounts = new Map<string, number>()
  for (const r of rows) {
    if (r.ehs_pass === true) ehsPass += 1
    else if (r.ehs_pass === false) ehsFail += 1
    const missing = Array.isArray(r.ds_consistency?.missing_phases) ? r.ds_consistency!.missing_phases as unknown[] : []
    if (missing.includes('verify_zero_energy')) missingVerifyZero += 1
    for (const c of Array.isArray(r.ehs_citations) ? r.ehs_citations as Array<{ code?: unknown }> : []) {
      const code = typeof c?.code === 'string' ? c.code : null
      if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1)
    }
  }

  const placeholderPhotos = ((changes ?? []) as Array<{ change_kind: string }>)
    .filter(c => c.change_kind === 'placeholder_photo').length

  // Departments come from the in-scope equipment list, not the results, so a
  // machine that errored still counts toward its department's footprint.
  const equipment = await loadEquipment(admin, opts.tenantId, opts.scope)
  const deptCounts = new Map<string, number>()
  for (const e of equipment) {
    const dept = e.department || '(none)'
    deptCounts.set(dept, (deptCounts.get(dept) ?? 0) + 1)
  }

  const topCitationCodes = [...codeCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  const departments = [...deptCounts.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count)

  return { total: rows.length, ehsPass, ehsFail, missingVerifyZero, placeholderPhotos, topCitationCodes, departments }
}

// ── Per-equipment pipeline ──────────────────────────────────────────────────

async function processEquipment(
  admin: SupabaseClient,
  client: Anthropic,
  opts: RunAuditOptions,
  eq: Equipment,
): Promise<void> {
  // Resume: skip equipment already fully processed in this run.
  const { data: existing } = await admin
    .from('loto_audit_equipment_results')
    .select('agent_phase')
    .eq('run_id', opts.runId)
    .eq('equipment_id', eq.equipment_id)
    .maybeSingle<{ agent_phase: string }>()
  if (existing?.agent_phase === 'ehs_done') return

  const { data: stepRows } = await admin
    .from('loto_energy_steps')
    .select('*')
    .eq('tenant_id', opts.tenantId)
    .eq('equipment_id', eq.equipment_id)
    .order('sequence_order', { ascending: true })
    .order('step_number', { ascending: true })
  const steps = (stepRows ?? []) as LotoEnergyStep[]

  // 1. FPE (vision)
  const fpe = await callAgent(opts, 'loto-audit-fpe', () => runFpeAgent(client, eq, steps))
  await upsertResult(admin, opts, eq.equipment_id, {
    equip_photo_verdict:    fpe.result.equip_photo.verdict,
    equip_photo_confidence: fpe.result.equip_photo.confidence,
    iso_photo_verdict:      fpe.result.iso_photo.verdict,
    iso_photo_confidence:   fpe.result.iso_photo.confidence,
    fpe_notes:              `${fpe.result.equip_photo.notes} | ${fpe.result.iso_photo.notes}`,
    agent_phase:            'fpe_done',
  })

  // 2. DS (consistency)
  const ds = await callAgent(opts, 'loto-audit-ds', () => runDsAgent(client, eq, steps, fpe.result))
  await upsertResult(admin, opts, eq.equipment_id, {
    ds_equipment_confidence: ds.result.equipment_confidence,
    ds_consistency: {
      low_confidence_iso: ds.result.low_confidence_iso,
      duplicates:         ds.result.duplicates,
      outliers:           ds.result.outliers,
      missing_phases:     ds.missingPhases,
    },
    ds_notes:    ds.result.notes,
    agent_phase: 'ds_done',
  })

  // 3. EHS (Cal/OSHA gate)
  const ehs = await callAgent(opts, 'loto-audit-ehs', () => runEhsAgent(client, eq, steps, ds.result, fpe.result, ds.missingPhases))

  // 4. Author — ONLY for machines that failed the gate. Drafts a corrected
  // procedure for a qualified safety professional to review/sign; it is staged,
  // never applied. Guarded on ehs_pass===false so a compliant machine never
  // burns an authoring call.
  const authored = ehs.result.pass === false
    ? await callAgent(opts, 'loto-audit-author', () =>
        runAuthorAgent(client, eq, steps, ehs.result.citations, ehs.result.recommendations, ds.result.notes, ds.missingPhases))
    : null

  // Emit the staged change-set BEFORE marking the equipment 'ehs_done'. If a
  // serverless reclaim hits mid-emit, the row stays at 'ds_done' and a resume
  // re-runs it cleanly — rather than 'ehs_done' with no changes, which the
  // resume guard below would skip, silently losing that machine's findings.
  await emitChanges(admin, client, opts, eq, steps, fpe.result, ds.result, ehs.result, authored?.result ?? null)

  await upsertResult(admin, opts, eq.equipment_id, {
    ehs_pass:            ehs.result.pass,
    ehs_citations:       ehs.result.citations,
    ehs_recommendations: ehs.result.recommendations,
    ehs_notes:           ehs.result.notes,
    agent_phase:         'ehs_done',
    raw_payload:         { fpe: fpe.result, ds: ds.result, ehs: ehs.result },
  })
}

// ── Change emission ─────────────────────────────────────────────────────────

interface PendingChange {
  change_kind:         string
  target_table:        'loto_energy_steps' | 'loto_equipment'
  target_row_pk:       string | null
  target_column:       string | null
  old_value:           unknown
  new_value:           unknown
  agent:               'FPE' | 'DS' | 'EHS' | 'SSD'
  rationale:           string
  severity:            AuditSeverity
  staged_storage_path?: string | null
  staged_photo_url?:    string | null
}

async function emitChanges(
  admin: SupabaseClient,
  client: Anthropic,
  opts: RunAuditOptions,
  eq: Equipment,
  steps: LotoEnergyStep[],
  fpe: FpeResult,
  ds: DsResult,
  ehs: EhsResult,
  author: AuthorResult | null,
): Promise<void> {
  const changes: PendingChange[] = []

  // (a) Confidence grades — only the actionable ones (non-high or flagged).
  const stepById = new Map(steps.map(s => [s.id, s]))
  for (const a of ds.steps) {
    const step = stepById.get(a.step_id)
    if (!step) continue
    if (a.confidence === 'high' && !a.issue) continue
    changes.push({
      change_kind:   'step_confidence',
      target_table:  'loto_energy_steps',
      target_row_pk: step.id,
      target_column: 'confidence',
      old_value:     step.confidence ?? null,
      new_value:     a.confidence,
      agent:         'DS',
      rationale:     a.issue || `Consistency audit graded this step ${a.confidence} confidence.`,
      severity:      a.confidence === 'low' ? 'high' : a.confidence === 'medium' ? 'medium' : 'info',
    })
  }

  // (b) Placeholder ISO photo when the isolation point is unverified — the
  // SAME deterministic signal the EHS gate uses, so the emitter can never
  // disagree with the gate about whether this machine's ISO needs help.
  const isoUnverified = isIsolationUnverified(eq, fpe, ds)
  if (isoUnverified) {
    // Prefer a REAL in-house photo over an internet placeholder. ISO photos are
    // often cross-wired between machines, so a correct shot of this isolation
    // point frequently already lives in the tenant's own storage. A vision-
    // verified match lands as a verified field photo (no watermark); only if
    // none is found do we fall back to the watermarked web placeholder.
    const existing = await findExistingIsoPhoto(client, admin, opts.tenantId, eq, steps)
    const placeholder = existing ? null : await buildPlaceholderPhoto(client, admin, opts.tenantId, eq)
    if (existing) {
      changes.push({
        change_kind:         'placeholder_photo',
        target_table:        'loto_equipment',
        target_row_pk:       eq.equipment_id,
        target_column:       'iso_photo_url',
        old_value:           eq.iso_photo_url ?? null,
        new_value:           { photo_url: existing.photoUrl, provenance: 'field', is_placeholder: false, source: 'storage' },
        agent:               'FPE',
        rationale:           'Matched an existing in-house photo that shows the real isolation point; proposing it as the ISO photo (no watermark).',
        severity:            'high',
        staged_storage_path: existing.storagePath,
        staged_photo_url:    existing.photoUrl,
      })
    } else if (placeholder) {
      changes.push({
        change_kind:         'placeholder_photo',
        target_table:        'loto_equipment',
        target_row_pk:       eq.equipment_id,
        target_column:       'iso_photo_url',
        old_value:           eq.iso_photo_url ?? null,
        new_value:           { photo_url: placeholder.photoUrl, source_url: placeholder.sourceUrl },
        agent:               'FPE',
        rationale:           'Isolation point is low-confidence; attaching a watermarked reference placeholder pending a verified field photo.',
        severity:            'high',
        staged_storage_path: placeholder.storagePath,
        staged_photo_url:    placeholder.photoUrl,
      })
    } else {
      // No reference image found / network unavailable — record a finding so
      // the reviewer knows a real ISO photo must be captured.
      changes.push({
        change_kind:   'ehs_finding',
        target_table:  'loto_equipment',
        target_row_pk: null,
        target_column: null,
        old_value:     null,
        new_value:     { code: 'Cal/OSHA T8 §3314(g)(4)', text: 'Isolation point unverified and no reference image available — capture a real isolation-point photo.', severity: 'high' },
        agent:         'EHS',
        rationale:     'ISO point unverified; no placeholder could be sourced.',
        severity:      'high',
      })
    }
  }

  // (c) EHS citations as findings.
  for (const c of ehs.citations) {
    changes.push({
      change_kind:   'ehs_finding',
      target_table:  'loto_equipment',
      target_row_pk: null,
      target_column: null,
      old_value:     null,
      new_value:     c,
      agent:         'EHS',
      rationale:     c.text,
      severity:      c.severity,
    })
  }

  // (d) Author's corrected procedure (only present when the EHS gate failed).
  // One staged change carrying the full replacement step set; applying it
  // replaces the machine's loto_energy_steps (migration 220). target_row_pk is
  // null because the whole procedure is replaced, not one row. agent 'SSD' is
  // the existing allowed value for the systems/author role — no new agent CHECK.
  // This is a DRAFT for the safety professional: the review gate is the only
  // path to a live write.
  if (author) {
    changes.push({
      change_kind:   'procedure_draft',
      target_table:  'loto_energy_steps',
      target_row_pk: null,
      target_column: null,
      old_value:     steps.map(projectStepForDraft),
      new_value:     { steps: author.steps, summary: author.summary },
      agent:         'SSD',
      rationale:     'Drafted corrected procedure for safety-professional review.',
      severity:      'high',
    })
  }

  // Replace any prior pending rows for this equipment in this run, then insert.
  await admin.from('loto_audit_changes')
    .delete()
    .eq('run_id', opts.runId)
    .eq('equipment_id', eq.equipment_id)
    .eq('status', 'pending')

  if (changes.length === 0) return
  await admin.from('loto_audit_changes').insert(
    changes.map(c => ({
      run_id:              opts.runId,
      tenant_id:           opts.tenantId,
      equipment_id:        eq.equipment_id,
      change_kind:         c.change_kind,
      target_table:        c.target_table,
      target_row_pk:       c.target_row_pk,
      target_column:       c.target_column,
      old_value:           c.old_value,
      new_value:           c.new_value,
      agent:               c.agent,
      rationale:           c.rationale,
      severity:            c.severity,
      status:              'pending',
      staged_storage_path: c.staged_storage_path ?? null,
      staged_photo_url:    c.staged_photo_url ?? null,
    })),
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function callAgent<R extends { usage: Anthropic.Usage | null; model: string }>(
  opts: RunAuditOptions,
  surface: AiSurface,
  fn: () => Promise<R>,
): Promise<R> {
  const limit = await checkAiRateLimit({ userId: opts.userId ?? 'audit-engine', tenantId: opts.tenantId, surface })
  if (!limit.ok) throw new Error(`AI rate limit (${limit.reason}) hit for ${surface}`)
  try {
    const out = await fn()
    await logAiInvocation({
      userId: opts.userId ?? 'audit-engine', tenantId: opts.tenantId, surface, model: out.model, status: 'success',
      inputTokens:     out.usage?.input_tokens,
      outputTokens:    out.usage?.output_tokens,
      cacheReadTokens: out.usage?.cache_read_input_tokens ?? undefined,
    })
    return out
  } catch (err) {
    await logAiInvocation({ userId: opts.userId ?? 'audit-engine', tenantId: opts.tenantId, surface, model: '(error)', status: 'error', context: err instanceof Error ? err.message.slice(0, 200) : undefined })
    throw err
  }
}

async function upsertResult(
  admin: SupabaseClient,
  opts: RunAuditOptions,
  equipmentId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await admin.from('loto_audit_equipment_results').upsert(
    { run_id: opts.runId, tenant_id: opts.tenantId, equipment_id: equipmentId, updated_at: new Date().toISOString(), ...fields },
    { onConflict: 'run_id,equipment_id' },
  )
}

async function loadEquipment(admin: SupabaseClient, tenantId: string, scope: RunAuditScope): Promise<Equipment[]> {
  let q = admin.from('loto_equipment').select('*').eq('tenant_id', tenantId)
  if (scope.only_active !== false) q = q.eq('decommissioned', false)
  if (scope.department) q = q.eq('department', scope.department)
  if (scope.equipment_ids && scope.equipment_ids.length > 0) q = q.in('equipment_id', scope.equipment_ids)
  q = q.order('equipment_id', { ascending: true })
  if (scope.limit && scope.limit > 0) q = q.limit(scope.limit)
  const { data, error } = await q
  if (error) throw new Error(`load equipment: ${error.message}`)
  return (data ?? []) as Equipment[]
}

async function failRun(admin: SupabaseClient, runId: string, message: string): Promise<void> {
  await admin.from('loto_audit_runs')
    .update({ status: 'failed', finished_at: new Date().toISOString(), error: message.slice(0, 500) })
    .eq('id', runId)
}

// Bounded-concurrency map. Keeps the Anthropic fan-out polite without pulling
// in a dependency; each worker drains a shared cursor.
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      await fn(items[i]!)
    }
  })
  await Promise.all(workers)
}
