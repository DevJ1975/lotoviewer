import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  inferEquipmentFamily,
  normalizeEquipmentFamily,
  type EquipmentFamily,
} from '@soteria/core/equipmentReadiness'
import { computeStrikeReadiness, isStrikeCompletionCurrent } from '@soteria/core/strike'

const QR_TOKEN_RE = /^[0-9a-f]{16}$/i

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const token = (url.searchParams.get('token') ?? '').trim()
  const equipmentId = (url.searchParams.get('equipment_id') ?? '').trim()
  if (!token && !equipmentId) {
    return NextResponse.json({ error: 'token or equipment_id is required.' }, { status: 400 })
  }
  if (token && !QR_TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid QR token format.' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    let equipmentQuery = admin
      .from('loto_equipment')
      .select('id,tenant_id,equipment_id,description,department,equipment_family,readiness_status,last_pre_use_inspection_at,last_pre_use_inspection_id,qr_token')
      .eq('tenant_id', gate.tenantId)

    if (token) equipmentQuery = equipmentQuery.eq('qr_token', token)
    else equipmentQuery = equipmentQuery.ilike('equipment_id', equipmentId.replace(/[\\%_]/g, m => '\\' + m))

    const { data: equipment, error: equipmentErr } = await equipmentQuery.maybeSingle()
    if (equipmentErr) throw equipmentErr
    if (!equipment) return NextResponse.json({ error: 'Equipment not found in your active tenant.' }, { status: 404 })

    const row = equipment as {
      id: string
      tenant_id: string
      equipment_id: string
      description: string | null
      department: string | null
      equipment_family?: string | null
      readiness_status?: string | null
      last_pre_use_inspection_at?: string | null
      last_pre_use_inspection_id?: string | null
      qr_token?: string | null
    }
    const family = row.equipment_family && row.equipment_family !== 'general'
      ? normalizeEquipmentFamily(row.equipment_family)
      : inferEquipmentFamily(row.description)

    const template = await loadTemplate(admin, gate.tenantId, family)
    if (!template) {
      return NextResponse.json({ error: `No published checklist template for ${family}.` }, { status: 404 })
    }

    const { data: items, error: itemsErr } = await admin
      .from('equipment_checklist_items')
      .select('id,template_id,section,prompt,response_type,required,critical,photo_required,sort_order,help_text')
      .eq('template_id', template.id)
      .order('sort_order', { ascending: true })
    if (itemsErr) throw itemsErr

    const [{ data: defects, error: defectsErr }, { data: latest, error: latestErr }, { data: authorizations, error: authErr }, strikeReadiness] = await Promise.all([
      admin
        .from('equipment_defects')
        .select('id,severity,status,out_of_service,description,last_seen_at')
        .eq('tenant_id', gate.tenantId)
        .eq('equipment_record_id', row.id)
        .in('status', ['open', 'acknowledged', 'in_repair'])
        .order('last_seen_at', { ascending: false })
        .limit(10),
      admin
        .from('equipment_inspections')
        .select('id,submitted_at,readiness_result,failed_critical_count,failed_item_count,operator_id')
        .eq('tenant_id', gate.tenantId)
        .eq('equipment_record_id', row.id)
        .order('submitted_at', { ascending: false })
        .limit(1),
      admin
        .from('equipment_operator_authorizations')
        .select('id,status,evaluation_due_at,expires_at,equipment_family')
        .eq('tenant_id', gate.tenantId)
        .eq('user_id', gate.userId)
        .eq('equipment_family', family)
        .eq('status', 'active')
        .limit(1),
      loadStrikeReadiness(admin, gate.tenantId, gate.userId, row.id, family),
    ])

    if (defectsErr) throw defectsErr
    if (latestErr) throw latestErr
    if (authErr) throw authErr

    return NextResponse.json({
      equipment: { ...row, equipment_family: family },
      template,
      items: items ?? [],
      open_defects: defects ?? [],
      latest_inspection: latest?.[0] ?? null,
      operator_authorization: authorizations?.[0] ?? null,
      strike_readiness: strikeReadiness,
    })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'equipment-readiness/resolve' } })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Resolve failed.' }, { status: 500 })
  }
}

async function loadStrikeReadiness(
  admin: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  userId: string,
  equipmentRecordId: string,
  family: EquipmentFamily,
) {
  const { data: requirements, error: requirementErr } = await admin
    .from('strike_training_requirements')
    .select('id,module_id,module_version_id,source_id,hazard_category,required_before_start,notes')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .eq('source_type', 'equipment_readiness')
    .or(`source_id.eq.${equipmentRecordId},source_id.is.null,hazard_category.eq.${family}`)

  if (requirementErr) throw requirementErr
  const activeRequirements = (requirements ?? []).filter(req => (
    req.source_id === equipmentRecordId
    || req.source_id === null
    || req.hazard_category === family
  ))

  if (activeRequirements.length === 0) {
    return {
      status: 'not_required',
      required_count: 0,
      valid_completion_count: 0,
      missing_count: 0,
      percent: 100,
      requirements: [],
    }
  }

  const moduleIds = [...new Set(activeRequirements.map(req => req.module_id as string).filter(Boolean))]
  const { data: modules, error: moduleErr } = await admin
    .from('strike_modules')
    .select('id,title,slug')
    .in('id', moduleIds)
  if (moduleErr) throw moduleErr
  const titleByModule = new Map((modules ?? []).map(row => [row.id as string, row as { id: string; title: string; slug: string }]))

  const { data: completions, error: completionErr } = await admin
    .from('strike_completions')
    .select('id,module_id,module_version_id,completed_at,expires_at,passed')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('passed', true)
    .in('module_id', moduleIds)
    .order('completed_at', { ascending: false })
  if (completionErr) throw completionErr

  const satisfied = new Set<string>()
  const completionRows = completions ?? []
  for (const req of activeRequirements) {
    const completion = completionRows.find(row => (
      row.module_id === req.module_id
      && isStrikeCompletionCurrent({
        completedAt: row.completed_at as string,
        expiresAt: row.expires_at as string | null,
        moduleVersionId: row.module_version_id as string,
        requiredVersionId: req.module_version_id as string | null,
      })
    ))
    if (completion) satisfied.add(req.id as string)
  }

  const readiness = computeStrikeReadiness({
    requiredCount: activeRequirements.length,
    validCompletionCount: satisfied.size,
  })

  await admin.from('strike_task_checks').insert({
    tenant_id: tenantId,
    user_id: userId,
    source_type: 'equipment_readiness',
    source_id: equipmentRecordId,
    readiness_status: readiness.status,
    required_count: activeRequirements.length,
    valid_completion_count: satisfied.size,
    checked_by: userId,
    notes: `Equipment Readiness pre-use check for ${family}`,
  })

  return {
    status: readiness.status,
    required_count: activeRequirements.length,
    valid_completion_count: satisfied.size,
    missing_count: readiness.missingCount,
    percent: readiness.percent,
    requirements: activeRequirements.map(req => {
      const strikeModule = titleByModule.get(req.module_id as string)
      return {
        id: req.id,
        module_id: req.module_id,
        module_version_id: req.module_version_id,
        title: strikeModule?.title ?? 'STRIKE module',
        slug: strikeModule?.slug ?? null,
        current: satisfied.has(req.id as string),
        required_before_start: req.required_before_start,
        notes: req.notes,
      }
    }),
  }
}

async function loadTemplate(
  admin: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  family: EquipmentFamily,
) {
  const select = 'id,tenant_id,library_scope,equipment_family,title,version_number,status,osha_basis,effective_at'
  const { data: tenantTemplates, error: tenantErr } = await admin
    .from('equipment_checklist_templates')
    .select(select)
    .eq('tenant_id', tenantId)
    .eq('library_scope', 'tenant')
    .eq('equipment_family', family)
    .eq('status', 'published')
    .order('version_number', { ascending: false })
    .limit(1)
  if (tenantErr) throw tenantErr
  if (tenantTemplates?.[0]) return tenantTemplates[0]

  const { data: globalTemplates, error: globalErr } = await admin
    .from('equipment_checklist_templates')
    .select(select)
    .eq('library_scope', 'global')
    .eq('equipment_family', family)
    .eq('status', 'published')
    .order('version_number', { ascending: false })
    .limit(1)
  if (globalErr) throw globalErr
  if (globalTemplates?.[0]) return globalTemplates[0]

  const { data: fallback, error: fallbackErr } = await admin
    .from('equipment_checklist_templates')
    .select(select)
    .eq('library_scope', 'global')
    .eq('equipment_family', 'general')
    .eq('status', 'published')
    .order('version_number', { ascending: false })
    .limit(1)
  if (fallbackErr) throw fallbackErr
  return fallback?.[0] ?? null
}
