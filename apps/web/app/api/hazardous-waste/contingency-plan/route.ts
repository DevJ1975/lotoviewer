import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  validateContingencyPlanInput,
  type EmergencyCoordinator,
  type EmergencyEquipmentItem,
  type HazardousWasteContingencyPlanInput,
} from '@soteria/core/contingencyPlan'

// /api/hazardous-waste/contingency-plan
//   GET — the active facility's LQG contingency plan (40 CFR 262 Subpart M).
//   PUT — upsert it. Tenant admin/owner only. Requires an active facility.

function trimOrNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max) : t
}

function coordinators(value: unknown): EmergencyCoordinator[] {
  if (!Array.isArray(value)) return []
  return value
    .map(v => (v && typeof v === 'object' ? v as Record<string, unknown> : {}))
    .map(v => ({
      name:  trimOrNull(v.name, 200) ?? '',
      phone: trimOrNull(v.phone, 60) ?? '',
      role:  trimOrNull(v.role, 120) ?? '',
    }))
    .filter(c => c.name || c.phone || c.role)
    .slice(0, 50)
}

function equipment(value: unknown): EmergencyEquipmentItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map(v => (v && typeof v === 'object' ? v as Record<string, unknown> : {}))
    .map(v => ({
      name:         trimOrNull(v.name, 200) ?? '',
      location:     trimOrNull(v.location, 200) ?? '',
      capabilities: trimOrNull(v.capabilities, 500) ?? '',
    }))
    .filter(e => e.name || e.location || e.capabilities)
    .slice(0, 50)
}

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  if (!gate.facilityId) {
    return NextResponse.json({ plan: null, facilityId: null })
  }

  try {
    const { data, error } = await gate.authedClient
      .from('hazardous_waste_contingency_plans')
      .select('*')
      .eq('tenant_id', gate.tenantId)
      .eq('facility_id', gate.facilityId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return NextResponse.json({ plan: data ?? null, facilityId: gate.facilityId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/contingency-plan/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  if (!gate.facilityId) {
    return NextResponse.json({ error: 'Select a facility before editing its contingency plan' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const input: HazardousWasteContingencyPlanInput = {
    plan_document_url:      trimOrNull(body.plan_document_url, 2000),
    max_waste_quantity:     trimOrNull(body.max_waste_quantity, 200),
    evacuation_plan:        trimOrNull(body.evacuation_plan, 4000),
    emergency_coordinators: coordinators(body.emergency_coordinators),
    emergency_equipment:    equipment(body.emergency_equipment),
    qrg_submitted_at:       trimOrNull(body.qrg_submitted_at, 30),
    qrg_submitted_to:       trimOrNull(body.qrg_submitted_to, 300),
    last_amended_at:        trimOrNull(body.last_amended_at, 30),
    review_due_date:        trimOrNull(body.review_due_date, 30),
    notes:                  trimOrNull(body.notes, 4000),
  }

  const errors = validateContingencyPlanInput(input)
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.map(e => `${e.field}: ${e.message}`).join('; ') }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('hazardous_waste_contingency_plans')
      .upsert(
        {
          tenant_id:   gate.tenantId,
          facility_id: gate.facilityId,
          updated_by:  gate.userId,
          created_by:  gate.userId,
          ...input,
        },
        { onConflict: 'tenant_id,facility_id' },
      )
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ plan: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/contingency-plan/PUT' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
