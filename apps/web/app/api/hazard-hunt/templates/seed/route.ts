import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { HAZARD_HUNT_TEMPLATE_LIBRARY, type HazardHuntTemplateSeed } from '@soteria/core/hazardHuntTemplates'

// POST /api/hazard-hunt/templates/seed
// Instantiates the daily/weekly/monthly Hazard Hunt starter templates (the
// comprehensive OSHA + Cal/OSHA checklist library) for the active tenant: one
// inspection_templates row per cadence (category='hazard_hunt'), its items
// (carrying hazard_category/severity_hint/regulatory_ref in config), and a
// hazard_hunt_schedules row. Idempotent: a cadence whose template name already
// exists for the tenant is skipped, so re-running never duplicates. Admins edit
// the templates afterward via the normal inspection-template builder.

// Default recurrence anchors per cadence (admins can change these later).
const WEEKLY_DEFAULT_DOW = 1   // Monday
const MONTHLY_DEFAULT_DOM = 1  // 1st of the month

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()

  try {
    const { data: existing, error: exErr } = await admin
      .from('inspection_templates')
      .select('id, name')
      .eq('tenant_id', gate.tenantId)
      .eq('category', 'hazard_hunt')
    if (exErr) throw new Error(exErr.message)
    const idByName = new Map((existing ?? []).map(t => [t.name as string, t.id as string]))

    const result: { cadence: string; templateId: string; created: boolean }[] = []

    for (const tmpl of HAZARD_HUNT_TEMPLATE_LIBRARY) {
      const already = idByName.get(tmpl.name)
      if (already) {
        result.push({ cadence: tmpl.cadence, templateId: already, created: false })
        continue
      }
      const templateId = await seedTemplate(admin, gate.tenantId, gate.userId, tmpl)
      result.push({ cadence: tmpl.cadence, templateId, created: true })
    }

    return NextResponse.json({ templates: result }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazard-hunt/templates/seed' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function seedTemplate(
  admin: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  userId: string,
  tmpl: HazardHuntTemplateSeed,
): Promise<string> {
  const { data: template, error: tErr } = await admin
    .from('inspection_templates')
    .insert({
      tenant_id:    tenantId,
      name:         tmpl.name,
      description:  tmpl.description,
      category:     'hazard_hunt',
      scoring_mode: 'weighted',
      version:      1,
      active:       true,
      created_by:   userId,
    })
    .select('id')
    .single()
  if (tErr) throw new Error(tErr.message)
  const templateId = template.id as string

  const items = tmpl.items.map((item, i) => ({
    tenant_id:           tenantId,
    template_id:         templateId,
    section:             item.section,
    sort_order:          i,
    item_type:           item.itemType,
    prompt:              item.prompt,
    required:            false,
    weight:              item.weight,
    fail_creates_action: item.failCreatesAction,
    config: {
      hazard_category: item.hazardCategory,
      severity_hint:   item.severityHint,
      regulatory_ref:  item.regulatoryRef,
    },
  }))
  const { error: iErr } = await admin.from('inspection_template_items').insert(items)
  if (iErr) throw new Error(iErr.message)

  const { error: sErr } = await admin.from('hazard_hunt_schedules').insert({
    tenant_id:    tenantId,
    template_id:  templateId,
    cadence:      tmpl.cadence,
    day_of_week:  tmpl.cadence === 'weekly'  ? WEEKLY_DEFAULT_DOW  : null,
    day_of_month: tmpl.cadence === 'monthly' ? MONTHLY_DEFAULT_DOM : null,
    active:       true,
    created_by:   userId,
  })
  if (sErr) throw new Error(sErr.message)

  return templateId
}
