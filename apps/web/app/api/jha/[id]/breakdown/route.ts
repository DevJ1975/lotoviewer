import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  JHA_HAZARD_CATEGORIES,
  JHA_SEVERITY_BANDS,
  aggregateRequiredPpe,
  type JhaHazardCategory,
  type JhaSeverity,
  type JhaHazardControl,
} from '@soteria/core/jha'
import { HIERARCHY_ORDER, type HierarchyLevel } from '@soteria/core/risk'

// PUT /api/jha/[id]/breakdown
// Atomic-ish bulk replace of a JHA's steps + hazards + controls.
// The editor maintains the tree in-memory and POSTs the whole shape;
// the route validates, deletes the existing breakdown, inserts the
// new one, and re-aggregates `required_ppe` on the parent JHA.
//
// Body shape — uses local_ids so the editor can pre-key new rows
// without round-tripping the DB-issued UUIDs:
//   {
//     steps:    [{ local_id, sequence, description, notes? }],
//     hazards:  [{ local_id, step_local_id|null, hazard_category,
//                  description, potential_severity, notes? }],
//     controls: [{ hazard_local_id, control_id?, custom_name?,
//                  hierarchy_level, notes? }],
//   }
//
// "Atomic-ish" because Supabase JS doesn't expose a transaction
// API — if a step in the sequence fails after we've deleted the
// existing breakdown, the JHA is left empty. The realistic risk
// surface (single user editing their own draft) makes this
// acceptable for v1; a future migration can wrap the whole flow
// in a SECURITY DEFINER stored procedure.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_STEPS    = 50
const MAX_HAZARDS  = 200
const MAX_CONTROLS = 500

interface StepInput {
  local_id:    string
  sequence:    number
  description: string
  notes?:      string | null
}

interface HazardInput {
  local_id:           string
  step_local_id:      string | null
  hazard_category:    JhaHazardCategory
  description:        string
  potential_severity: JhaSeverity
  notes?:             string | null
}

interface ControlInput {
  hazard_local_id: string
  control_id?:     string | null
  custom_name?:    string | null
  hierarchy_level: HierarchyLevel
  notes?:          string | null
}

interface BodyShape {
  steps?:    unknown
  hazards?:  unknown
  controls?: unknown
}

function parseBody(raw: BodyShape): { ok: true; data: { steps: StepInput[]; hazards: HazardInput[]; controls: ControlInput[] } } | { ok: false; message: string } {
  if (!Array.isArray(raw.steps))    return { ok: false, message: 'steps must be an array' }
  if (!Array.isArray(raw.hazards))  return { ok: false, message: 'hazards must be an array' }
  if (!Array.isArray(raw.controls)) return { ok: false, message: 'controls must be an array' }

  if (raw.steps.length    > MAX_STEPS)    return { ok: false, message: `Too many steps (max ${MAX_STEPS})` }
  if (raw.hazards.length  > MAX_HAZARDS)  return { ok: false, message: `Too many hazards (max ${MAX_HAZARDS})` }
  if (raw.controls.length > MAX_CONTROLS) return { ok: false, message: `Too many controls (max ${MAX_CONTROLS})` }

  // Steps
  const steps: StepInput[] = []
  const stepLocalIds = new Set<string>()
  for (const s of raw.steps as Record<string, unknown>[]) {
    if (typeof s.local_id    !== 'string' || !s.local_id)   return { ok: false, message: 'step.local_id required' }
    if (typeof s.description !== 'string' || !s.description.trim()) return { ok: false, message: `step ${s.local_id}: description required` }
    if (typeof s.sequence    !== 'number' || !Number.isInteger(s.sequence) || s.sequence < 1) {
      return { ok: false, message: `step ${s.local_id}: sequence must be an integer ≥ 1` }
    }
    if (stepLocalIds.has(s.local_id)) return { ok: false, message: `Duplicate step.local_id: ${s.local_id}` }
    stepLocalIds.add(s.local_id)
    steps.push({
      local_id:    s.local_id,
      sequence:    s.sequence,
      description: s.description.trim(),
      notes:       typeof s.notes === 'string' ? s.notes.trim() || null : null,
    })
  }
  // Sequences should be 1..N with no gaps. Enforced by the DB unique
  // constraint AND defensively here so we surface a friendly error
  // before round-tripping to Postgres.
  const sortedSeq = steps.map(s => s.sequence).sort((a, b) => a - b)
  for (let i = 0; i < sortedSeq.length; i++) {
    if (sortedSeq[i] !== i + 1) {
      return { ok: false, message: 'step sequences must be 1..N with no gaps or duplicates' }
    }
  }

  // Hazards
  const hazards: HazardInput[] = []
  const hazardLocalIds = new Set<string>()
  for (const h of raw.hazards as Record<string, unknown>[]) {
    if (typeof h.local_id    !== 'string' || !h.local_id)            return { ok: false, message: 'hazard.local_id required' }
    if (typeof h.description !== 'string' || !h.description.trim())  return { ok: false, message: `hazard ${h.local_id}: description required` }
    if (typeof h.hazard_category    !== 'string' || !(JHA_HAZARD_CATEGORIES as readonly string[]).includes(h.hazard_category)) {
      return { ok: false, message: `hazard ${h.local_id}: invalid hazard_category` }
    }
    if (typeof h.potential_severity !== 'string' || !(JHA_SEVERITY_BANDS as readonly string[]).includes(h.potential_severity)) {
      return { ok: false, message: `hazard ${h.local_id}: invalid potential_severity` }
    }
    const stepRef = h.step_local_id
    if (stepRef !== null && (typeof stepRef !== 'string' || !stepLocalIds.has(stepRef))) {
      return { ok: false, message: `hazard ${h.local_id}: step_local_id must be null or reference an existing step` }
    }
    if (hazardLocalIds.has(h.local_id)) return { ok: false, message: `Duplicate hazard.local_id: ${h.local_id}` }
    hazardLocalIds.add(h.local_id)
    hazards.push({
      local_id:           h.local_id,
      step_local_id:      stepRef as string | null,
      hazard_category:    h.hazard_category as JhaHazardCategory,
      description:        h.description.trim(),
      potential_severity: h.potential_severity as JhaSeverity,
      notes:              typeof h.notes === 'string' ? h.notes.trim() || null : null,
    })
  }

  // Controls
  const controls: ControlInput[] = []
  for (const c of raw.controls as Record<string, unknown>[]) {
    if (typeof c.hazard_local_id !== 'string' || !hazardLocalIds.has(c.hazard_local_id)) {
      return { ok: false, message: 'control.hazard_local_id must reference an existing hazard' }
    }
    if (typeof c.hierarchy_level !== 'string' || !HIERARCHY_ORDER.includes(c.hierarchy_level as HierarchyLevel)) {
      return { ok: false, message: `control: invalid hierarchy_level` }
    }
    const ctrlId = c.control_id
    if (ctrlId != null && (typeof ctrlId !== 'string' || !UUID_RE.test(ctrlId))) {
      return { ok: false, message: 'control.control_id must be a uuid or null' }
    }
    const custom = typeof c.custom_name === 'string' ? c.custom_name.trim() : ''
    if (!ctrlId && !custom) {
      return { ok: false, message: 'control needs either a control_id or a custom_name' }
    }
    controls.push({
      hazard_local_id: c.hazard_local_id,
      control_id:      (ctrlId as string) || null,
      custom_name:     custom || null,
      hierarchy_level: c.hierarchy_level as HierarchyLevel,
      notes:           typeof c.notes === 'string' ? c.notes.trim() || null : null,
    })
  }

  return { ok: true, data: { steps, hazards, controls } }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let raw: BodyShape
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = parseBody(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 })
  const { steps, hazards, controls } = parsed.data

  const admin = supabaseAdmin()

  try {
    // Confirm the JHA exists + belongs to the active tenant.
    const { data: jha, error: jhaErr } = await admin
      .from('jhas')
      .select('id, tenant_id, status')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (jhaErr) throw new Error(jhaErr.message)
    if (!jha)   return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (jha.status === 'superseded') {
      return NextResponse.json({ error: 'Cannot edit a superseded JHA' }, { status: 422 })
    }

    // Wipe existing breakdown. DB cascades from steps→hazards→controls,
    // but general hazards (step_id=null) don't ride that cascade so
    // we explicitly delete each table to be safe.
    for (const t of ['jha_hazard_controls', 'jha_hazards', 'jha_steps'] as const) {
      const { error } = await admin.from(t).delete().eq('jha_id', id).eq('tenant_id', gate.tenantId)
      if (error) throw new Error(`${t}.delete: ${error.message}`)
    }

    // Insert steps + capture local→DB id mapping.
    const stepLocalToId = new Map<string, string>()
    if (steps.length > 0) {
      const { data, error } = await admin
        .from('jha_steps')
        .insert(steps.map(s => ({
          tenant_id:   gate.tenantId,
          jha_id:      id,
          sequence:    s.sequence,
          description: s.description,
          notes:       s.notes,
        })))
        .select('id, sequence')
      if (error) throw new Error(`jha_steps.insert: ${error.message}`)
      // Match the inserted row back to its local_id by sequence (unique).
      const bySequence = new Map<number, string>()
      for (const r of data ?? []) bySequence.set(r.sequence, r.id)
      for (const s of steps) {
        const dbId = bySequence.get(s.sequence)
        if (dbId) stepLocalToId.set(s.local_id, dbId)
      }
    }

    // Insert hazards + capture mapping.
    const hazardLocalToId = new Map<string, string>()
    if (hazards.length > 0) {
      const insertRows = hazards.map(h => ({
        tenant_id:          gate.tenantId,
        jha_id:             id,
        step_id:            h.step_local_id ? stepLocalToId.get(h.step_local_id) ?? null : null,
        hazard_category:    h.hazard_category,
        description:        h.description,
        potential_severity: h.potential_severity,
        notes:              h.notes,
      }))
      const { data, error } = await admin
        .from('jha_hazards')
        .insert(insertRows)
        .select('id, description')
      if (error) throw new Error(`jha_hazards.insert: ${error.message}`)
      // Match by description + insertion order. Description isn't
      // guaranteed unique, so we walk both arrays in parallel —
      // .insert() preserves request order in the response.
      const dbRows = data ?? []
      for (let i = 0; i < hazards.length && i < dbRows.length; i++) {
        hazardLocalToId.set(hazards[i].local_id, dbRows[i].id)
      }
    }

    // Insert controls.
    const insertedControls: JhaHazardControl[] = []
    if (controls.length > 0) {
      const insertRows = controls.map(c => ({
        tenant_id:       gate.tenantId,
        jha_id:          id,
        hazard_id:       hazardLocalToId.get(c.hazard_local_id)!,    // validated to exist above
        control_id:      c.control_id,
        custom_name:     c.custom_name,
        hierarchy_level: c.hierarchy_level,
        notes:           c.notes,
      }))
      const { data, error } = await admin
        .from('jha_hazard_controls')
        .insert(insertRows)
        .select('*')
      if (error) throw new Error(`jha_hazard_controls.insert: ${error.message}`)
      insertedControls.push(...((data ?? []) as JhaHazardControl[]))
    }

    // Re-aggregate required_ppe on the parent JHA.
    const requiredPpe = aggregateRequiredPpe(insertedControls)
    const { error: updateErr } = await admin
      .from('jhas')
      .update({ required_ppe: requiredPpe, updated_by: gate.userId })
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
    if (updateErr) throw new Error(`jhas.update: ${updateErr.message}`)

    return NextResponse.json({
      ok:            true,
      counts: {
        steps:    steps.length,
        hazards:  hazards.length,
        controls: controls.length,
      },
      required_ppe:  requiredPpe,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'jha/[id]/breakdown/PUT' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
