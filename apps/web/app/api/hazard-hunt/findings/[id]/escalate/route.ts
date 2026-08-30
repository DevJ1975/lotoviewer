import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { severityHintToInherent, type SeverityHint } from '@soteria/core/hazardHunt'

// POST /api/hazard-hunt/findings/[id]/escalate
// Promotes a Hazard Hunt finding into a risks-register entry via the soft-FK
// pattern (risks.source='hazard_hunt' + risks.source_ref_id = finding id). This
// is how a hazard surfaced on the floor "ties into the risk analysis": the
// finding's category carries over unchanged (shared 9-category taxonomy) and its
// severity hint seeds the inherent severity. Mirrors the JHA-hazard escalate
// route — same idempotency + body contract.
//
// Required body fields the finding can't supply:
//   activity_type:      'routine' | 'non_routine' | 'emergency'
//   exposure_frequency: 'continuous' | 'daily' | 'weekly' | 'monthly' | 'rare'
// Optional: title, inherent_severity (1-5), inherent_likelihood (1-5).
//
// Idempotency: if a risk already exists for this finding, returns 409 with the
// existing risk's id rather than creating a duplicate.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_ACTIVITY_TYPES = ['routine', 'non_routine', 'emergency'] as const
const VALID_EXPOSURE_FREQS = ['continuous', 'daily', 'weekly', 'monthly', 'rare'] as const

interface EscalateBody {
  activity_type?:       unknown
  exposure_frequency?:  unknown
  title?:               unknown
  inherent_severity?:   unknown
  inherent_likelihood?: unknown
}

interface FindingRow {
  id:              string
  tenant_id:       string
  finding_number:  string | null
  inspection_id:   string
  hazard_category: string
  title:           string
  description:     string
  severity_hint:   SeverityHint | null
  status:          string
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

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
      .eq('source', 'hazard_hunt')
      .eq('source_ref_id', id)
      .maybeSingle()
    if (existingErr) throw new Error(existingErr.message)
    if (existing) {
      return NextResponse.json({
        error: 'Already escalated',
        risk:  { id: existing.id, risk_number: existing.risk_number },
      }, { status: 409 })
    }

    const { data: finding, error: findErr } = await admin
      .from('hazard_hunt_findings')
      .select('id, tenant_id, finding_number, inspection_id, hazard_category, title, description, severity_hint, status')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle<FindingRow>()
    if (findErr) throw new Error(findErr.message)
    if (!finding) return NextResponse.json({ error: 'Finding not found' }, { status: 404 })

    const inh_sev = overrideSeverity   ?? severityHintToInherent(finding.severity_hint)
    const inh_lik = overrideLikelihood ?? 3

    const title = overrideTitle
      || (finding.title.length > 80 ? finding.title.slice(0, 77) + '…' : finding.title)

    const description = `Escalated from Hazard Hunt finding ${finding.finding_number ?? finding.id}.\n\n`
      + `Hazard category: ${finding.hazard_category}\n`
      + (finding.severity_hint ? `Inspector severity: ${finding.severity_hint}\n` : '')
      + `\n${finding.description}`

    const insert = {
      tenant_id:           gate.tenantId,
      title,
      description,
      hazard_category:     finding.hazard_category,
      source:              'hazard_hunt',
      source_ref_id:       finding.id,
      activity_type:       body.activity_type,
      exposure_frequency:  body.exposure_frequency,
      affected_personnel:  {},
      inherent_severity:   inh_sev,
      inherent_likelihood: inh_lik,
      created_by:          gate.userId,
      status:              'open',
    }

    const { data: risk, error: riskErr } = await admin
      .from('risks')
      .insert(insert)
      .select('id, risk_number')
      .single()
    if (riskErr) {
      Sentry.captureException(riskErr, { tags: { route: 'hazard-hunt/escalate', stage: 'risk-insert' } })
      return NextResponse.json({ error: riskErr.message }, { status: 500 })
    }

    // Mark the finding escalated so it counts as "resolved" for the proactive
    // EHS indicator and disappears from the open-findings queue.
    const { error: updErr } = await admin
      .from('hazard_hunt_findings')
      .update({ status: 'escalated' })
      .eq('id', finding.id)
      .eq('tenant_id', gate.tenantId)
    if (updErr) {
      Sentry.captureException(updErr, { tags: { route: 'hazard-hunt/escalate', stage: 'finding-update' } })
      // The risk exists; surface the partial failure rather than silently swallowing.
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    return NextResponse.json({
      risk:    { id: risk.id, risk_number: risk.risk_number },
      finding: { id: finding.id, finding_number: finding.finding_number },
    }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazard-hunt/escalate' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
