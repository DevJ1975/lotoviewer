import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { type JhaHazard, type JhaRow, type JhaSeverity } from '@soteria/core/jha'

// POST /api/jha/[id]/hazards/[hazardId]/escalate
// Promotes a JHA hazard into a risks register entry with a soft
// link via the risks.source='jsa' + risks.source_ref_id columns
// (no schema change required — those columns exist for exactly
// this kind of cross-module link). The risk's title comes from
// the hazard description; the inherent severity is derived from
// the hazard's potential_severity (low→2, moderate→3, high→4,
// extreme→5) with a conservative likelihood=3.
//
// Required body fields the JHA can't supply:
//   activity_type:      'routine' | 'non_routine' | 'emergency'
//   exposure_frequency: 'continuous' | 'daily' | 'weekly' | 'monthly' | 'rare'
//
// Optional: title, inherent_severity (1-5), inherent_likelihood (1-5).
//
// Idempotency: if a risks row with source='jsa' and source_ref_id
// = this hazard already exists, returns 409 with the existing
// risk's id rather than creating a duplicate.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_ACTIVITY_TYPES = ['routine', 'non_routine', 'emergency'] as const
const VALID_EXPOSURE_FREQS = ['continuous', 'daily', 'weekly', 'monthly', 'rare'] as const

const SEVERITY_TO_INHERENT: Record<JhaSeverity, 1 | 2 | 3 | 4 | 5> = {
  low: 2, moderate: 3, high: 4, extreme: 5,
}

interface EscalateBody {
  activity_type?:       unknown
  exposure_frequency?:  unknown
  title?:               unknown
  inherent_severity?:   unknown
  inherent_likelihood?: unknown
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; hazardId: string }> },
) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id, hazardId } = await ctx.params
  if (!UUID_RE.test(id) || !UUID_RE.test(hazardId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: EscalateBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (typeof body.activity_type !== 'string' || !(VALID_ACTIVITY_TYPES as readonly string[]).includes(body.activity_type)) {
    return NextResponse.json({ error: `activity_type must be one of ${VALID_ACTIVITY_TYPES.join(', ')}` }, { status: 400 })
  }
  if (typeof body.exposure_frequency !== 'string' || !(VALID_EXPOSURE_FREQS as readonly string[]).includes(body.exposure_frequency)) {
    return NextResponse.json({ error: `exposure_frequency must be one of ${VALID_EXPOSURE_FREQS.join(', ')}` }, { status: 400 })
  }

  const overrideTitle      = typeof body.title === 'string' ? body.title.trim() : ''
  const overrideSeverity   = typeof body.inherent_severity   === 'number' ? body.inherent_severity   : null
  const overrideLikelihood = typeof body.inherent_likelihood === 'number' ? body.inherent_likelihood : null
  for (const [key, val] of [['inherent_severity', overrideSeverity], ['inherent_likelihood', overrideLikelihood]] as const) {
    if (val == null) continue
    if (!Number.isInteger(val) || val < 1 || val > 5) {
      return NextResponse.json({ error: `${key} must be an integer 1..5` }, { status: 400 })
    }
  }

  const admin = supabaseAdmin()

  try {
    // Idempotency check.
    const { data: existing, error: existingErr } = await admin
      .from('risks')
      .select('id, risk_number')
      .eq('tenant_id', gate.tenantId)
      .eq('source', 'jsa')
      .eq('source_ref_id', hazardId)
      .maybeSingle()
    if (existingErr) throw new Error(existingErr.message)
    if (existing) {
      return NextResponse.json({
        error: 'Already escalated',
        risk:  { id: existing.id, risk_number: existing.risk_number },
      }, { status: 409 })
    }

    // Load the JHA + hazard. Tenant scope is enforced by RLS but
    // we double-check on the JHA side via the membership client.
    const { data: jha, error: jhaErr } = await admin
      .from('jhas')
      .select('id, tenant_id, job_number, title, location, assigned_to')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle<Pick<JhaRow, 'id' | 'tenant_id' | 'job_number' | 'title' | 'location' | 'assigned_to'>>()
    if (jhaErr) throw new Error(jhaErr.message)
    if (!jha)   return NextResponse.json({ error: 'JHA not found' }, { status: 404 })

    const { data: hazard, error: hazardErr } = await admin
      .from('jha_hazards')
      .select('*')
      .eq('id', hazardId)
      .eq('jha_id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle<JhaHazard>()
    if (hazardErr) throw new Error(hazardErr.message)
    if (!hazard)   return NextResponse.json({ error: 'Hazard not found' }, { status: 404 })

    const inh_sev = overrideSeverity   ?? SEVERITY_TO_INHERENT[hazard.potential_severity]
    const inh_lik = overrideLikelihood ?? 3

    const title = overrideTitle
      || (hazard.description.length > 80 ? hazard.description.slice(0, 77) + '…' : hazard.description)

    const description = `Escalated from JHA ${jha.job_number} (${jha.title}).\n\n`
      + `Hazard category: ${hazard.hazard_category}\n`
      + `Potential severity: ${hazard.potential_severity}\n\n`
      + hazard.description
      + (hazard.notes ? `\n\nNotes: ${hazard.notes}` : '')

    const insert = {
      tenant_id:           gate.tenantId,
      title,
      description,
      hazard_category:     hazard.hazard_category,
      source:              'jsa',
      source_ref_id:       hazard.id,
      location:            jha.location,
      activity_type:       body.activity_type,
      exposure_frequency:  body.exposure_frequency,
      affected_personnel:  {},
      inherent_severity:   inh_sev,
      inherent_likelihood: inh_lik,
      assigned_to:         jha.assigned_to,
      created_by:          gate.userId,
      status:              'open',
    }

    const { data: risk, error: riskErr } = await admin
      .from('risks')
      .insert(insert)
      .select('id, risk_number')
      .single()
    if (riskErr) {
      Sentry.captureException(riskErr, { tags: { route: 'jha/escalate', stage: 'risk-insert' } })
      return NextResponse.json({ error: riskErr.message }, { status: 500 })
    }

    return NextResponse.json({
      risk:    { id: risk.id, risk_number: risk.risk_number },
      hazard:  { id: hazard.id, jha_id: jha.id },
    }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'jha/escalate' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
