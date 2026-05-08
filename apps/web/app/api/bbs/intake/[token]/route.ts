import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  BBS_KINDS,
  BBS_SEVERITY,
  BBS_LIKELIHOOD,
  validateBBSCreateInput,
  type BBSKind,
  type BBSSeverity,
  type BBSLikelihood,
} from '@soteria/core/bbs'

// Public intake: anyone with a valid QR token can submit. The token
// is matched against bbs_qr_locations; if active, the submission is
// inserted with submitted_by=null and the location's tenant_id.
//
// No JWT required. Bypasses RLS via the service-role client. We
// intentionally accept submissions even when the device is offline
// and queues — the form-side handles retry; this endpoint is just
// the receiver.

const TOKEN_RE = /^[a-f0-9]{16,64}$/i

interface QRLocationRow {
  id:        string
  tenant_id: string
  active:    boolean
  name:      string
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('bbs_qr_locations')
    .select('id, tenant_id, active, name, area, description')
    .eq('token', token)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || !data.active) return NextResponse.json({ error: 'Invalid or expired QR' }, { status: 404 })

  // Fetch tenant name for the public landing page header.
  const { data: tenant } = await admin
    .from('tenants')
    .select('name, logo_url')
    .eq('id', data.tenant_id)
    .maybeSingle()

  return NextResponse.json({
    location: {
      id:          data.id,
      name:        data.name,
      area:        data.area,
      description: data.description,
    },
    tenant: tenant ? { name: tenant.name, logo_url: tenant.logo_url } : null,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const admin = supabaseAdmin()
  const { data: location, error: locErr } = await admin
    .from('bbs_qr_locations')
    .select('id, tenant_id, active')
    .eq('token', token)
    .maybeSingle<QRLocationRow>()

  if (locErr) return NextResponse.json({ error: locErr.message }, { status: 500 })
  if (!location || !location.active) {
    return NextResponse.json({ error: 'Invalid or expired QR' }, { status: 404 })
  }

  const kind = typeof body.kind === 'string' && (BBS_KINDS as readonly string[]).includes(body.kind)
    ? (body.kind as BBSKind) : null
  const severity = typeof body.severity === 'string' && (BBS_SEVERITY as readonly string[]).includes(body.severity)
    ? (body.severity as BBSSeverity) : null
  const likelihood = typeof body.likelihood === 'string' && (BBS_LIKELIHOOD as readonly string[]).includes(body.likelihood)
    ? (body.likelihood as BBSLikelihood) : null

  if (!kind) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })

  const submittedName  = typeof body.submitted_name === 'string' ? body.submitted_name.trim().slice(0, 120) : ''
  const submittedEmail = typeof body.submitted_email === 'string' ? body.submitted_email.trim().slice(0, 200) : ''

  const errors = validateBBSCreateInput({
    kind,
    description: typeof body.description === 'string' ? body.description : '',
    severity,
    likelihood,
    submitted_email: submittedEmail || null,
  })
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.map(e => `${e.field}: ${e.message}`).join('; ') }, { status: 400 })
  }

  // Anonymous submissions: submitted_by = null. The DB trigger sets
  // anonymous=true and points_awarded based on kind/score; the
  // leaderboard view filters anonymous rows out, so they don't earn
  // gamification credit.
  const insert = {
    tenant_id:              location.tenant_id,
    submitted_by:           null,
    submitted_name:         submittedName || null,
    submitted_email:        submittedEmail || null,
    qr_location_id:         location.id,
    observed_at:            new Date().toISOString(),
    location_text:          typeof body.location_text === 'string' && body.location_text.trim() ? body.location_text.trim() : null,
    department:             typeof body.department === 'string' && body.department.trim() ? body.department.trim() : null,
    kind,
    category:               typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null,
    description:            (body.description as string).trim(),
    immediate_action_taken: typeof body.immediate_action_taken === 'string' && body.immediate_action_taken.trim() ? body.immediate_action_taken.trim() : null,
    abc_antecedent:         typeof body.abc_antecedent === 'string' && body.abc_antecedent.trim() ? body.abc_antecedent.trim() : null,
    abc_behavior:           typeof body.abc_behavior === 'string' && body.abc_behavior.trim() ? body.abc_behavior.trim() : null,
    abc_consequence:        typeof body.abc_consequence === 'string' && body.abc_consequence.trim() ? body.abc_consequence.trim() : null,
    severity,
    likelihood,
    status:                 'open' as const,
  }

  try {
    const { data, error } = await admin
      .from('bbs_observations')
      .insert(insert)
      .select('id, report_number')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ observation: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
