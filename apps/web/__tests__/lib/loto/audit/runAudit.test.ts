// The audit engine orchestrates FPE → DS → EHS per equipment and stages the
// change-set. Two behaviors carry real consequences:
//   1. Resumability — equipment already at agent_phase='ehs_done' must be
//      skipped entirely (no agent calls), so a re-run is cheap and idempotent.
//   2. Placeholder routing — a low-confidence ISO point emits a
//      'placeholder_photo' change when buildPlaceholderPhoto succeeds, and an
//      'ehs_finding' when it returns null (no reference image could be sourced).
//
// Every external seam is mocked: the agents, the Anthropic client, the
// rate-limit/budget gate, the placeholder builder, and a chainable Supabase
// admin stub that records inserts.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  runFpeAgentMock, runDsAgentMock, runEhsAgentMock,
  buildPlaceholderPhotoMock, findExistingIsoPhotoMock,
  getAnthropicMock,
  checkTenantBudgetMock, checkAiRateLimitMock, logAiInvocationMock,
  supabaseState,
} = vi.hoisted(() => {
  // Per-table state for terminal reads (.maybeSingle / awaited selects), and a
  // capture log for inserts the engine stages.
  const supabaseState = {
    equipment: [] as unknown[],
    // run_id+equipment_id keyed resume rows: map equipment_id → agent_phase|null
    existingPhase: new Map<string, string | null>(),
    steps: [] as unknown[],
    inserts: [] as Array<{ table: string; payload: unknown }>,
    upserts: [] as Array<{ table: string; payload: unknown }>,
    reset() {
      this.equipment = []
      this.existingPhase = new Map()
      this.steps = []
      this.inserts = []
      this.upserts = []
    },
  }

  // Untyped mocks (vi.fn()) so the thin module wrappers can spread args in and
  // .mock.calls indexes as any[] — matching the repo's existing test style.
  return {
    runFpeAgentMock: vi.fn(),
    runDsAgentMock: vi.fn(),
    runEhsAgentMock: vi.fn(),
    buildPlaceholderPhotoMock: vi.fn(),
    findExistingIsoPhotoMock: vi.fn(),
    getAnthropicMock: vi.fn(async (..._a: unknown[]) => ({ messages: { create: vi.fn() } })),
    checkTenantBudgetMock: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
    checkAiRateLimitMock: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
    logAiInvocationMock: vi.fn(async (..._a: unknown[]) => {}),
    supabaseState,
  }
})

vi.mock('@/lib/loto/audit/agents/fpe', () => ({
  runFpeAgent: (...a: unknown[]) => runFpeAgentMock(...a),
}))
vi.mock('@/lib/loto/audit/agents/ds', () => ({
  runDsAgent: (...a: unknown[]) => runDsAgentMock(...a),
}))
vi.mock('@/lib/loto/audit/agents/ehs', () => ({
  runEhsAgent: (...a: unknown[]) => runEhsAgentMock(...a),
}))
vi.mock('@/lib/loto/audit/placeholderPhoto', () => ({
  buildPlaceholderPhoto: (...a: unknown[]) => buildPlaceholderPhotoMock(...a),
}))
vi.mock('@/lib/loto/audit/storagePhotoSearch', () => ({
  findExistingIsoPhoto: (...a: unknown[]) => findExistingIsoPhotoMock(...a),
}))
vi.mock('@/lib/ai/client', () => ({
  getAnthropic: (...a: unknown[]) => getAnthropicMock(...a),
}))
vi.mock('@/lib/ai/rateLimit', () => ({
  checkTenantBudget: (...a: unknown[]) => checkTenantBudgetMock(...a),
  checkAiRateLimit: (...a: unknown[]) => checkAiRateLimitMock(...a),
  logAiInvocation: (...a: unknown[]) => logAiInvocationMock(...a),
}))

// Chainable Supabase admin stub. Each from(table) returns a builder whose
// filter methods chain and whose terminals (.maybeSingle / await / .insert /
// .upsert / .update) resolve from supabaseState.
vi.mock('@/lib/supabaseAdmin', () => {
  function builder(table: string) {
    // Track which equipment_id an equipment_results read is scoped to so the
    // resume check can answer per-equipment.
    let scopedEquipmentId: string | null = null

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        if (col === 'equipment_id') scopedEquipmentId = String(val)
        return chain
      },
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      is: () => chain,
      update: () => chain,
      delete: () => chain,
      insert: (payload: unknown) => {
        supabaseState.inserts.push({ table, payload })
        return Promise.resolve({ data: null, error: null })
      },
      upsert: (payload: unknown) => {
        supabaseState.upserts.push({ table, payload })
        return Promise.resolve({ data: null, error: null })
      },
      maybeSingle: () => {
        if (table === 'loto_audit_equipment_results') {
          const phase = supabaseState.existingPhase.get(scopedEquipmentId ?? '') ?? null
          return Promise.resolve({ data: phase ? { agent_phase: phase } : null, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      single: () => Promise.resolve({ data: null, error: null }),
      // Thenable: awaiting the chain resolves the table's bulk read.
      then: (onF: (v: { data: unknown; error: unknown }) => unknown, onR?: (e: unknown) => unknown) => {
        let data: unknown = null
        if (table === 'loto_equipment') data = supabaseState.equipment
        else if (table === 'loto_energy_steps') data = supabaseState.steps
        return Promise.resolve({ data, error: null }).then(onF, onR)
      },
    }
    return chain
  }

  return { supabaseAdmin: () => ({ from: (table: string) => builder(table) }) }
})

import { runAudit } from '@/lib/loto/audit/runAudit'
import type { DsResult, EhsResult, FpeResult } from '@/lib/loto/audit/schemas'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const RUN_ID = 'run-1'
const TENANT_ID = 'tenant-1'

function equipment(id: string) {
  return {
    equipment_id: id,
    description: 'Mixer',
    department: 'Bakery',
    equip_photo_url: 'https://cdn.example/eq.jpg',
    iso_photo_url: 'https://cdn.example/iso.jpg',
    decommissioned: false,
  }
}

function fpeOutput(isoVerdict: FpeResult['iso_photo']['verdict']) {
  const result: FpeResult = {
    equip_photo: { verdict: 'match', confidence: 'high', notes: '' },
    iso_photo: {
      verdict: isoVerdict, confidence: 'low',
      shows_isolation_point: false, consistent_with_energy_steps: false, notes: '',
    },
  }
  return { result, usage: null, model: 'm-fpe' }
}

function dsOutput(lowConfidenceIso: boolean) {
  const result: DsResult = {
    equipment_confidence: 'high',
    low_confidence_iso: lowConfidenceIso,
    steps: [],
    duplicates: [],
    outliers: [],
    notes: '',
  }
  return { result, usage: null, model: 'm-ds', missingPhases: [] }
}

function ehsOutput(): { result: EhsResult; usage: null; model: string } {
  const result: EhsResult = { pass: true, citations: [], recommendations: [], notes: '' }
  return { result, usage: null, model: 'm-ehs' }
}

beforeEach(() => {
  supabaseState.reset()
  runFpeAgentMock.mockReset()
  runDsAgentMock.mockReset()
  runEhsAgentMock.mockReset()
  buildPlaceholderPhotoMock.mockReset()
  findExistingIsoPhotoMock.mockReset()
  getAnthropicMock.mockClear()
  checkTenantBudgetMock.mockClear()
  checkAiRateLimitMock.mockClear()
  logAiInvocationMock.mockClear()
  checkTenantBudgetMock.mockResolvedValue({ ok: true })
  checkAiRateLimitMock.mockResolvedValue({ ok: true })
  // Default: no in-house photo matches, so the existing tests exercise the
  // web-placeholder fallback exactly as before. The storage-first test below
  // overrides this to return a match.
  findExistingIsoPhotoMock.mockResolvedValue(null)
})

describe('runAudit — resumability', () => {
  it('skips equipment already at agent_phase="ehs_done" (no agent calls)', async () => {
    supabaseState.equipment = [equipment('EQ-DONE')]
    supabaseState.existingPhase.set('EQ-DONE', 'ehs_done')

    const summary = await runAudit({
      tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1,
    })

    // It still counts toward processed, but no agent ran for it.
    expect(summary.total).toBe(1)
    expect(runFpeAgentMock).not.toHaveBeenCalled()
    expect(runDsAgentMock).not.toHaveBeenCalled()
    expect(runEhsAgentMock).not.toHaveBeenCalled()
    // And no change-set was staged.
    expect(supabaseState.inserts).toHaveLength(0)
  })

  it('processes equipment that has no prior result row', async () => {
    supabaseState.equipment = [equipment('EQ-NEW')]
    runFpeAgentMock.mockResolvedValue(fpeOutput('match'))
    runDsAgentMock.mockResolvedValue(dsOutput(false))
    runEhsAgentMock.mockResolvedValue(ehsOutput())

    await runAudit({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    expect(runFpeAgentMock).toHaveBeenCalledTimes(1)
    expect(runDsAgentMock).toHaveBeenCalledTimes(1)
    expect(runEhsAgentMock).toHaveBeenCalledTimes(1)
  })
})

describe('runAudit — low-confidence ISO routing', () => {
  it('proposes an in-house storage match (provenance=field) before any web placeholder', async () => {
    supabaseState.equipment = [equipment('EQ-MATCH')]
    runFpeAgentMock.mockResolvedValue(fpeOutput('mismatch'))
    runDsAgentMock.mockResolvedValue(dsOutput(true)) // ISO unverified ⇒ search storage first
    runEhsAgentMock.mockResolvedValue(ehsOutput())
    findExistingIsoPhotoMock.mockResolvedValue({
      photoUrl: 'https://cdn.example/loto-photos/tenant-1/EQ-MATCH/EQ-MATCH_ISO_good.jpg',
      storagePath: 'tenant-1/EQ-MATCH/EQ-MATCH_ISO_good.jpg',
    })

    await runAudit({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    const changeInsert = supabaseState.inserts.find(i => i.table === 'loto_audit_changes')
    expect(changeInsert).toBeDefined()
    const rows = changeInsert!.payload as Array<{
      change_kind: string
      staged_photo_url?: string | null
      new_value?: { provenance?: string; is_placeholder?: boolean; source?: string }
    }>
    const match = rows.find(r => r.change_kind === 'placeholder_photo')
    expect(match).toBeDefined()
    expect(match!.staged_photo_url).toBe('https://cdn.example/loto-photos/tenant-1/EQ-MATCH/EQ-MATCH_ISO_good.jpg')
    // The real-photo signal the apply RPC keys on: field provenance, NOT a placeholder.
    expect(match!.new_value?.provenance).toBe('field')
    expect(match!.new_value?.is_placeholder).toBe(false)
    expect(match!.new_value?.source).toBe('storage')
    // A real match means the watermarked-internet fallback must never run.
    expect(buildPlaceholderPhotoMock).not.toHaveBeenCalled()
  })

  it('emits a placeholder_photo change when buildPlaceholderPhoto succeeds', async () => {
    supabaseState.equipment = [equipment('EQ-LC')]
    runFpeAgentMock.mockResolvedValue(fpeOutput('match'))
    runDsAgentMock.mockResolvedValue(dsOutput(true)) // low_confidence_iso ⇒ placeholder flow
    runEhsAgentMock.mockResolvedValue(ehsOutput())
    buildPlaceholderPhotoMock.mockResolvedValue({
      storagePath: 'tenant-1/EQ-LC/EQ-LC_ISO_PLACEHOLDER_1.jpg',
      photoUrl: 'https://cdn.example/placeholder.jpg?v=1',
      sourceUrl: 'https://maker.example/ref.jpg',
    })

    await runAudit({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    const changeInsert = supabaseState.inserts.find(i => i.table === 'loto_audit_changes')
    expect(changeInsert).toBeDefined()
    const rows = changeInsert!.payload as Array<{ change_kind: string; staged_photo_url?: string | null }>
    const placeholder = rows.find(r => r.change_kind === 'placeholder_photo')
    expect(placeholder).toBeDefined()
    expect(placeholder!.staged_photo_url).toBe('https://cdn.example/placeholder.jpg?v=1')
    // It must NOT also raise the "no reference available" finding.
    expect(rows.some(r => r.change_kind === 'ehs_finding' && /no placeholder/i.test(String((r as { rationale?: string }).rationale)))).toBe(false)
  })

  it('emits an ehs_finding when buildPlaceholderPhoto returns null', async () => {
    supabaseState.equipment = [equipment('EQ-LC2')]
    runFpeAgentMock.mockResolvedValue(fpeOutput('match'))
    runDsAgentMock.mockResolvedValue(dsOutput(true))
    runEhsAgentMock.mockResolvedValue(ehsOutput())
    buildPlaceholderPhotoMock.mockResolvedValue(null) // no reference image sourced

    await runAudit({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    const changeInsert = supabaseState.inserts.find(i => i.table === 'loto_audit_changes')
    expect(changeInsert).toBeDefined()
    const rows = changeInsert!.payload as Array<{ change_kind: string; rationale?: string }>
    // No placeholder image was staged…
    expect(rows.some(r => r.change_kind === 'placeholder_photo')).toBe(false)
    // …but a finding tells the reviewer a real ISO photo is required.
    const finding = rows.find(r => r.change_kind === 'ehs_finding' && /no placeholder/i.test(String(r.rationale)))
    expect(finding).toBeDefined()
  })

  it('does not invoke buildPlaceholderPhoto when the ISO point is verified', async () => {
    supabaseState.equipment = [equipment('EQ-OK')]
    runFpeAgentMock.mockResolvedValue(fpeOutput('match'))
    runDsAgentMock.mockResolvedValue(dsOutput(false))
    runEhsAgentMock.mockResolvedValue(ehsOutput())

    await runAudit({ tenantId: TENANT_ID, runId: RUN_ID, userId: 'u1', scope: {}, concurrency: 1 })

    expect(buildPlaceholderPhotoMock).not.toHaveBeenCalled()
  })
})
