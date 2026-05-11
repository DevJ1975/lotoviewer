import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { canReleaseEquipmentToService } from '@soteria/core/equipmentReadiness'

interface Body {
  action?: unknown
  notes?: unknown
  evidence?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid defect id.' }, { status: 400 })

  let body: Body
  try { body = await req.json() as Body }
  catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }

  const action = typeof body.action === 'string' ? body.action : ''
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  if (!['acknowledge', 'start_repair', 'return_to_service', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: defect, error: defectErr } = await admin
      .from('equipment_defects')
      .select('id,tenant_id,equipment_record_id,status,severity,out_of_service,description')
      .eq('tenant_id', gate.tenantId)
      .eq('id', id)
      .maybeSingle()
    if (defectErr) throw defectErr
    if (!defect) return NextResponse.json({ error: 'Defect not found.' }, { status: 404 })

    if (action === 'acknowledge') {
      const { error } = await admin
        .from('equipment_defects')
        .update({ status: 'acknowledged', updated_at: new Date().toISOString() })
        .eq('tenant_id', gate.tenantId)
        .eq('id', id)
      if (error) throw error
    }

    if (action === 'start_repair') {
      const now = new Date().toISOString()
      const { error: defectUpdateErr } = await admin
        .from('equipment_defects')
        .update({ status: 'in_repair', updated_at: now })
        .eq('tenant_id', gate.tenantId)
        .eq('id', id)
      if (defectUpdateErr) throw defectUpdateErr

      const { error: repairErr } = await admin
        .from('equipment_repairs')
        .insert({
          tenant_id: gate.tenantId,
          defect_id: id,
          status: 'in_repair',
          repair_notes: notes,
          mechanic_id: gate.userId,
        })
      if (repairErr) throw repairErr
    }

    if (action === 'return_to_service') {
      const now = new Date().toISOString()
      const { error: defectUpdateErr } = await admin
        .from('equipment_defects')
        .update({
          status: 'resolved',
          out_of_service: false,
          updated_at: now,
        })
        .eq('tenant_id', gate.tenantId)
        .eq('id', id)
      if (defectUpdateErr) throw defectUpdateErr

      const { data: openCritical, error: openErr } = await admin
        .from('equipment_defects')
        .select('id')
        .eq('tenant_id', gate.tenantId)
        .eq('equipment_record_id', defect.equipment_record_id)
        .neq('id', id)
        .in('status', ['open', 'acknowledged', 'in_repair'])
        .eq('out_of_service', true)
        .limit(1)
      if (openErr) throw openErr

      if (canReleaseEquipmentToService(openCritical?.length ?? 0)) {
        const { error: equipmentErr } = await admin
          .from('loto_equipment')
          .update({ readiness_status: 'available', updated_at: now })
          .eq('tenant_id', gate.tenantId)
          .eq('id', defect.equipment_record_id)
        if (equipmentErr) throw equipmentErr
      }

      const { data: existingRepair, error: existingErr } = await admin
        .from('equipment_repairs')
        .select('id')
        .eq('tenant_id', gate.tenantId)
        .eq('defect_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
      if (existingErr) throw existingErr

      if (existingRepair?.[0]) {
        const { error: repairErr } = await admin
          .from('equipment_repairs')
          .update({
            status: 'returned_to_service',
            repair_notes: notes,
            completed_at: now,
            return_to_service_by: gate.userId,
            return_to_service_at: now,
            return_to_service_notes: notes,
            updated_at: now,
          })
          .eq('tenant_id', gate.tenantId)
          .eq('id', existingRepair[0].id)
        if (repairErr) throw repairErr
        await insertRepairEvidence(admin, gate.tenantId, gate.userId, defect.equipment_record_id as string, existingRepair[0].id as string, body.evidence)
      } else {
        const { data: insertedRepair, error: repairErr } = await admin
          .from('equipment_repairs')
          .insert({
            tenant_id: gate.tenantId,
            defect_id: id,
            status: 'returned_to_service',
            repair_notes: notes,
            mechanic_id: gate.userId,
            completed_at: now,
            return_to_service_by: gate.userId,
            return_to_service_at: now,
            return_to_service_notes: notes,
          })
          .select('id')
          .single()
        if (repairErr) throw repairErr
        await insertRepairEvidence(admin, gate.tenantId, gate.userId, defect.equipment_record_id as string, insertedRepair.id as string, body.evidence)
      }
    }

    if (action === 'cancel') {
      const { error } = await admin
        .from('equipment_defects')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('tenant_id', gate.tenantId)
        .eq('id', id)
      if (error) throw error
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'equipment-readiness/defects/[id]' } })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Defect update failed.' }, { status: 500 })
  }
}

async function insertRepairEvidence(
  admin: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  userId: string,
  equipmentRecordId: string,
  repairId: string,
  rawEvidence: unknown,
) {
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) return
  const rows = rawEvidence.flatMap(row => {
    if (!isRecord(row) || typeof row.storage_path !== 'string' || !row.storage_path.trim()) return []
    return [{
      tenant_id: tenantId,
      source_type: 'repair',
      source_id: repairId,
      equipment_record_id: equipmentRecordId,
      storage_path: row.storage_path.trim(),
      evidence_kind: 'repair',
      caption: typeof row.caption === 'string' && row.caption.trim() ? row.caption.trim() : null,
      uploaded_by: userId,
      captured_at: new Date().toISOString(),
    }]
  })
  if (rows.length === 0) return
  const { error } = await admin.from('equipment_evidence').insert(rows)
  if (error) throw error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
