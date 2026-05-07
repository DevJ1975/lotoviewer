import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { computeLoginUrl } from '@/lib/email/sendInvite'
import { sendWitnessStatementRequestEmail } from '@/lib/email/sendWitnessStatementRequest'

// POST /api/incidents/[id]/witness-statement
//
// Creates an incident_witness_statements row with a tokenized
// public-link (collected_via='email_link') and emails the witness.
// Admin-only — issuing tokens is a meaningful action; we don't want
// any tenant member firing off email-link invitations.
//
// The public submission endpoint at /api/witness/[token]/submit
// consumes the token + persists the statement.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string }>
}

interface Body {
  email:            string
  witness_name?:    string
  context_summary?: string
  /** ISO timestamp; defaults to 14 days from now. */
  expires_at?:      string
  /** Optional incident_people.id this statement is associated with. */
  witness_person_id?: string
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id: incidentId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Body
  try { body = await req.json() as Body }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const email = body.email?.trim().toLowerCase() ?? ''
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }
  if (body.witness_person_id && !UUID_RE.test(body.witness_person_id)) {
    return NextResponse.json({ error: 'witness_person_id must be a uuid' }, { status: 400 })
  }

  // 14-day default expiry. Witness statements collected late are less
  // useful — reasonable default forces the issuer to think if they
  // want longer.
  let expiresAt = body.expires_at ? new Date(body.expires_at) : new Date(Date.now() + 14 * 86_400_000)
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now() + 60_000) {
    expiresAt = new Date(Date.now() + 14 * 86_400_000)
  }

  try {
    const admin = supabaseAdmin()

    // Confirm tenant ownership of the incident.
    const { data: incident } = await admin
      .from('incidents')
      .select('id, tenant_id, report_number')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    // 32 bytes of randomness → 64 hex chars. Hex (vs base64url) keeps
    // the URL clean and avoids needing percent-encoding.
    const token = randomBytes(32).toString('hex')

    const { data: statement, error: insErr } = await admin
      .from('incident_witness_statements')
      .insert({
        tenant_id:         gate.tenantId,
        incident_id:       incidentId,
        witness_person_id: body.witness_person_id ?? null,
        collected_via:     'email_link',
        collection_token:  token,
        token_expires_at:  expiresAt.toISOString(),
      })
      .select('id, collection_token, token_expires_at')
      .single()
    if (insErr) {
      Sentry.captureException(insErr, { tags: { route: 'witness-statement/POST', stage: 'insert' } })
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    // Resolve the requester display name (best-effort) from profiles.
    const { data: requester } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', gate.userId)
      .maybeSingle()
    const requesterName = requester?.full_name?.trim() || requester?.email || gate.userEmail

    // Resolve tenant name for subject line.
    const { data: tenant } = await admin
      .from('tenants')
      .select('name')
      .eq('id', gate.tenantId)
      .maybeSingle()

    const appUrl = computeLoginUrl(req)
    const emailSent = await sendWitnessStatementRequestEmail({
      to:             email,
      witnessName:    body.witness_name?.trim() || null,
      reportNumber:   incident.report_number,
      contextSummary: body.context_summary?.trim() || null,
      appUrl,
      token:          statement.collection_token,
      expiresAt:      statement.token_expires_at,
      requesterName:  requesterName ?? null,
      tenantName:     tenant?.name ?? null,
      tenantId:       gate.tenantId,
      triggeredBy:    gate.userId,
    })

    return NextResponse.json({
      statement_id: statement.id,
      expires_at:   statement.token_expires_at,
      email_sent:   emailSent,
      // Surface the link for the admin so they can copy-paste if the
      // email failed (mirrors the invite flow).
      link:         `${appUrl.replace(/\/$/, '')}/witness/${token}`,
    }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'witness-statement/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
