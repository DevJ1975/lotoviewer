import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { deriveInherentScore, type NearMissRow } from '@soteria/core/nearMiss'

// POST /api/near-miss/[id]/escalate
// Atomically (best-effort) creates a `risks` register entry from a
// near-miss and links the two together:
//
//   1. Insert risk via service-role admin client. Title comes from
//      the body (caller can override) or first 80 chars of the
//      near-miss description. hazard_category, location, source_ref_id,
//      assigned_to all carry over. inherent severity is derived from
//      severity_potential via deriveInherentScore (low→2, moderate→3,
//      high→4, extreme→5) with a conservative likelihood=3. Caller
//      can override either via the body.
//
//   2. Update near_miss: linked_risk_id = newRisk.id,
//      status = 'escalated_to_risk', resolved_at = now().
//      If this step fails we delete the risk to avoid an orphan
//      (compensation; not a transaction, but the only realistic
//      failure here is a network blip).
//
// Required body fields the near-miss can't supply:
//   activity_type:      'routine' | 'non_routine' | 'emergency'
//   exposure_frequency: 'continuous' | 'daily' | 'weekly' | 'monthly' | 'rare'
//
// Optional overrides:
//   title:               string
//   inherent_severity:   1..5
//   inherent_likelihood: 1..5

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_ACTIVITY_TYPES  = ['routine', 'non_routine', 'emergency'] as const
const VALID_EXPOSURE_FREQS  = ['continuous', 'daily', 'weekly', 'monthly', 'rare'] as const

interface EscalateBody {
  activity_type?:       unknown
  exposure_frequency?:  unknown
  title?:               unknown
  inherent_severity?:   unknown
  inherent_likelihood?: unknown
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
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

  const overrideTitle = typeof body.title === 'string' ? body.title.trim() : ''
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
    // Load the near-miss + verify it's escalatable.
    const { data: nm, error: nmErr } = await admin
      .from('near_misses')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle<NearMissRow>()
    if (nmErr) throw new Error(nmErr.message)
    if (!nm)   return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (nm.status === 'escalated_to_risk' && nm.linked_risk_id) {
      return NextResponse.json({ error: 'Already escalated', linked_risk_id: nm.linked_risk_id }, { status: 409 })
    }

    const derived = deriveInherentScore(nm.severity_potential)
    const inh_sev = overrideSeverity   ?? derived.severity
    const inh_lik = overrideLikelihood ?? derived.likelihood

    const title = overrideTitle
      || (nm.description.length > 80 ? nm.description.slice(0, 77) + '…' : nm.description)

    const description = `Escalated from near-miss ${nm.report_number}.\n\n${nm.description}`
      + (nm.immediate_action_taken ? `\n\nImmediate action taken at the time:\n${nm.immediate_action_taken}` : '')

    const riskInsert = {
      tenant_id:           gate.tenantId,
      title,
      description,
      hazard_category:     nm.hazard_category,
      source:              'worker_report',     // closest fit; near-miss is fundamentally a worker-reported event
      source_ref_id:       nm.id,
      location:            nm.location,
      activity_type:       body.activity_type,
      exposure_frequency:  body.exposure_frequency,
      affected_personnel:  {},
      inherent_severity:   inh_sev,
      inherent_likelihood: inh_lik,
      assigned_to:         nm.assigned_to,
      created_by:          gate.userId,
      status:              'open',
    }

    // Step 1: insert the risk.
    const { data: risk, error: riskErr } = await admin
      .from('risks')
      .insert(riskInsert)
      .select('id, risk_number')
      .single()
    if (riskErr) {
      Sentry.captureException(riskErr, { tags: { route: 'near-miss/escalate', stage: 'risk-insert' } })
      return NextResponse.json({ error: riskErr.message }, { status: 500 })
    }

    // Step 2: link + close the near-miss. Compensate by deleting the
    // risk if this fails so we don't leave an orphan.
    const { error: linkErr } = await admin
      .from('near_misses')
      .update({
        linked_risk_id: risk.id,
        status:         'escalated_to_risk',
        resolved_at:    new Date().toISOString(),
        updated_by:     gate.userId,
      })
      .eq('id', nm.id)
      .eq('tenant_id', gate.tenantId)
    if (linkErr) {
      Sentry.captureException(linkErr, { tags: { route: 'near-miss/escalate', stage: 'link-update', risk_id: risk.id } })
      // Best-effort compensation. If the delete also fails, the
      // Sentry breadcrumb above carries the orphan risk id for
      // manual cleanup.
      await admin.from('risks').delete().eq('id', risk.id).eq('tenant_id', gate.tenantId)
      return NextResponse.json({ error: `Failed to link near-miss to new risk: ${linkErr.message}` }, { status: 500 })
    }

    return NextResponse.json({
      risk:            { id: risk.id, risk_number: risk.risk_number },
      near_miss_id:    nm.id,
    }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'near-miss/escalate' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
