import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  computeInspectionResult,
  readinessStatusFromInspection,
  type InspectionEvidenceInput,
  type InspectionResponseInput,
} from '@soteria/core/equipmentReadiness'

interface Body {
  equipment_id?: unknown
  checklist_template_id?: unknown
  started_at?: unknown
  submitted_at?: unknown
  shift_label?: unknown
  hour_meter?: unknown
  location_label?: unknown
  operator_attestation?: unknown
  signature_name?: unknown
  responses?: unknown
  evidence?: unknown
  client_context?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Body
  try { body = await req.json() as Body }
  catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }

  const equipmentId = typeof body.equipment_id === 'string' ? body.equipment_id.trim() : ''
  const templateId = typeof body.checklist_template_id === 'string' ? body.checklist_template_id.trim() : ''
  if (!equipmentId) return NextResponse.json({ error: 'equipment_id is required.' }, { status: 400 })
  if (!UUID_RE.test(templateId)) return NextResponse.json({ error: 'Valid checklist_template_id is required.' }, { status: 400 })
  if (body.operator_attestation !== true) return NextResponse.json({ error: 'Operator attestation is required.' }, { status: 400 })

  const responses = parseResponses(body.responses)
  if (!responses.length) return NextResponse.json({ error: 'At least one checklist response is required.' }, { status: 400 })
  const evidence = parseEvidence(body.evidence)
  if (!evidence.some(e => e.evidence_kind === 'equipment_full_view')) {
    return NextResponse.json({ error: 'A current full-view equipment photo is required.' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: equipment, error: equipmentErr } = await admin
      .from('loto_equipment')
      .select('id,tenant_id,equipment_id,description,department')
      .eq('tenant_id', gate.tenantId)
      .ilike('equipment_id', equipmentId.replace(/[\\%_]/g, m => '\\' + m))
      .maybeSingle()
    if (equipmentErr) throw equipmentErr
    if (!equipment) return NextResponse.json({ error: 'Equipment not found in your active tenant.' }, { status: 404 })

    const { data: items, error: itemsErr } = await admin
      .from('equipment_checklist_items')
      .select('id,critical,prompt,section')
      .eq('template_id', templateId)
    if (itemsErr) throw itemsErr
    const itemById = new Map((items ?? []).map(item => [item.id as string, item as { id: string; critical: boolean; prompt: string; section: string }]))

    const enrichedResponses = responses.map(response => ({
      ...response,
      critical: itemById.get(response.item_id)?.critical === true,
    }))
    const computed = computeInspectionResult(enrichedResponses)
    const submittedAt = parseDate(body.submitted_at) ?? new Date()
    const startedAt = parseDate(body.started_at) ?? submittedAt
    const durationSeconds = Math.max(0, Math.round((submittedAt.getTime() - startedAt.getTime()) / 1000))

    const { data: inspection, error: inspectionErr } = await admin
      .from('equipment_inspections')
      .insert({
        tenant_id: gate.tenantId,
        equipment_record_id: equipment.id,
        equipment_id: equipment.equipment_id,
        checklist_template_id: templateId,
        operator_id: gate.userId,
        started_at: startedAt.toISOString(),
        submitted_at: submittedAt.toISOString(),
        duration_seconds: durationSeconds,
        shift_label: stringOrNull(body.shift_label),
        hour_meter: numberOrNull(body.hour_meter),
        location_label: stringOrNull(body.location_label),
        readiness_result: computed.result,
        failed_critical_count: computed.failedCriticalCount,
        failed_item_count: computed.failedItemCount,
        operator_attestation: true,
        signature_name: stringOrNull(body.signature_name),
        client_context: isRecord(body.client_context) ? body.client_context : {},
      })
      .select('id,readiness_result,failed_critical_count,failed_item_count,submitted_at')
      .single()
    if (inspectionErr) throw inspectionErr

    const inspectionId = inspection.id as string
    const responseRows = responses.map(response => ({
      tenant_id: gate.tenantId,
      inspection_id: inspectionId,
      item_id: response.item_id,
      response: response.response,
      numeric_value: response.numeric_value ?? null,
      notes: response.notes ?? null,
      severity: response.severity ?? null,
      action_decision: response.action_decision ?? null,
    }))
    const { error: responsesErr } = await admin.from('equipment_inspection_responses').insert(responseRows)
    if (responsesErr) throw responsesErr

    if (evidence.length > 0) {
      const { error: evidenceErr } = await admin.from('equipment_evidence').insert(evidence.map(row => ({
        tenant_id: gate.tenantId,
        source_type: 'inspection',
        source_id: inspectionId,
        equipment_record_id: equipment.id,
        storage_path: row.storage_path,
        evidence_kind: row.evidence_kind,
        caption: row.caption ?? null,
        component: row.component ?? null,
        uploaded_by: gate.userId,
        captured_at: row.captured_at ?? submittedAt.toISOString(),
      })))
      if (evidenceErr) throw evidenceErr
    }

    const failedRows = responses.filter(row => row.response === 'fail')
    if (failedRows.length > 0) {
      const { error: defectErr } = await admin.from('equipment_defects').insert(failedRows.map(row => {
        const item = itemById.get(row.item_id)
        const critical = item?.critical === true || row.severity === 'critical' || row.action_decision === 'remove_from_service'
        return {
          tenant_id: gate.tenantId,
          equipment_record_id: equipment.id,
          inspection_id: inspectionId,
          item_id: row.item_id,
          component: item?.section ?? null,
          severity: critical ? 'critical' : (row.severity ?? 'repair_soon'),
          out_of_service: critical,
          description: row.notes?.trim() || item?.prompt || 'Failed pre-use inspection item',
          created_by: gate.userId,
        }
      }))
      if (defectErr) throw defectErr
    }

    const readinessStatus = readinessStatusFromInspection(computed.result)
    const { error: updateErr } = await admin
      .from('loto_equipment')
      .update({
        readiness_status: readinessStatus,
        last_pre_use_inspection_at: submittedAt.toISOString(),
        last_pre_use_inspection_id: inspectionId,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', gate.tenantId)
      .eq('id', equipment.id)
    if (updateErr) throw updateErr

    return NextResponse.json({ inspection, readiness_status: readinessStatus }, { status: 201 })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'equipment-readiness/inspections' } })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Inspection submission failed.' }, { status: 500 })
  }
}

function parseResponses(value: unknown): InspectionResponseInput[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(row => {
    if (!isRecord(row) || typeof row.item_id !== 'string') return []
    const response = row.response
    if (response !== 'pass' && response !== 'fail' && response !== 'na') return []
    const severity = row.severity === 'monitor' || row.severity === 'repair_soon' || row.severity === 'critical' ? row.severity : null
    const action = row.action_decision === 'continue' || row.action_decision === 'limited_use' || row.action_decision === 'remove_from_service'
      ? row.action_decision
      : null
    return [{
      item_id: row.item_id,
      response,
      numeric_value: numberOrNull(row.numeric_value),
      notes: stringOrNull(row.notes),
      severity,
      action_decision: action,
    }]
  })
}

function parseEvidence(value: unknown): InspectionEvidenceInput[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(row => {
    if (!isRecord(row) || typeof row.storage_path !== 'string') return []
    const kind = row.evidence_kind
    const evidence_kind = kind === 'equipment_full_view' || kind === 'hour_meter' || kind === 'damage' || kind === 'defect' || kind === 'repair' || kind === 'general'
      ? kind
      : 'general'
    return [{
      storage_path: row.storage_path,
      evidence_kind,
      caption: stringOrNull(row.caption),
      component: stringOrNull(row.component),
      captured_at: stringOrNull(row.captured_at),
    }]
  })
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
