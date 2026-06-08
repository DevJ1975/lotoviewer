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
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getAnthropic } from '@/lib/ai/client'
import { checkTenantBudget, checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import type { AiSurface } from '@/lib/ai/rateLimit'
import { runFpeAgent } from './agents/fpe'
import { runDsAgent } from './agents/ds'
import { runEhsAgent } from './agents/ehs'
import { buildPlaceholderPhoto } from './placeholderPhoto'
import { findExistingIsoPhoto } from './storagePhotoSearch'
import type { AuditSeverity, DsResult, EhsResult, FpeResult } from './schemas'

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

  // Emit the staged change-set BEFORE marking the equipment 'ehs_done'. If a
  // serverless reclaim hits mid-emit, the row stays at 'ds_done' and a resume
  // re-runs it cleanly — rather than 'ehs_done' with no changes, which the
  // resume guard below would skip, silently losing that machine's findings.
  await emitChanges(admin, client, opts, eq, steps, fpe.result, ds.result, ehs.result)

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

  // (b) Placeholder ISO photo when the isolation point is low-confidence.
  const isoUnverified =
    ds.low_confidence_iso ||
    fpe.iso_photo.verdict === 'missing' ||
    fpe.iso_photo.verdict === 'mismatch' ||
    fpe.iso_photo.verdict === 'low_confidence'
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
