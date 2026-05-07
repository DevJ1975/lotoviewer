import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET   /api/witness/[token]      Verify a token before rendering the
//                                 public form. Returns minimal incident
//                                 context (report number + tenant name);
//                                 NEVER the description or PII.
// POST  /api/witness/[token]/submit  Persist the witness's statement,
//                                    consume the token, log IP+UA.
//
// PUBLIC endpoints — no JWT required. All security rests on:
//   1. Token (32-byte random hex, single-use, expirable)
//   2. supabaseAdmin write (RLS-bypassing service role) — the witness
//      has no Supabase identity, so we deliberately don't add an
//      anon RLS policy on the table.
//   3. token_consumed_at single-use enforcement: a token submission
//      sets consumed_at; a second POST with the same token errors.

const TOKEN_RE = /^[0-9a-f]{64}$/i

interface RouteContext {
  params: Promise<{ token: string }>
}

interface Body {
  statement_text: string
  signed_name:    string
}

// ─── GET — verify only, no mutations ──────────────────────────────────────

export async function GET(_req: Request, ctx: RouteContext) {
  const { token } = await ctx.params
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('incident_witness_statements')
      .select(`
        id,
        token_expires_at,
        token_consumed_at,
        signed_at,
        incident:incidents!inner(
          id, report_number, occurred_at, tenant_id,
          tenant:tenants!inner(name)
        )
      `)
      .eq('collection_token', token)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Token not found' }, { status: 404 })

    type IncidentLink = {
      id: string
      report_number: string
      occurred_at: string
      tenant_id: string
      tenant: { name: string | null } | { name: string | null }[] | null
    }
    const incident = (Array.isArray(data.incident) ? data.incident[0] : data.incident) as IncidentLink | undefined
    if (!incident) return NextResponse.json({ error: 'Incident missing' }, { status: 404 })
    const tenantBlock = incident.tenant
    const tenant = (Array.isArray(tenantBlock) ? tenantBlock[0] : tenantBlock) as { name: string | null } | null

    if (data.token_consumed_at || data.signed_at) {
      return NextResponse.json({ error: 'This statement has already been submitted.' }, { status: 410 })
    }
    if (data.token_expires_at && new Date(data.token_expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'This link has expired.' }, { status: 410 })
    }

    return NextResponse.json({
      report_number: incident.report_number,
      occurred_at:   incident.occurred_at,
      tenant_name:   tenant?.name ?? null,
      expires_at:    data.token_expires_at,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'witness/[token]/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST — submit + consume ──────────────────────────────────────────────

export async function POST(req: Request, ctx: RouteContext) {
  const { token } = await ctx.params
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  let body: Body
  try { body = await req.json() as Body }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const statement = body.statement_text?.trim() ?? ''
  const signedName = body.signed_name?.trim() ?? ''
  if (!statement) return NextResponse.json({ error: 'Statement is required' }, { status: 400 })
  if (statement.length > 50_000) return NextResponse.json({ error: 'Statement is too long' }, { status: 400 })
  if (!signedName) return NextResponse.json({ error: 'Please type your name to sign' }, { status: 400 })

  // Best-effort caller fingerprint for forensic audit.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null
  const ua = req.headers.get('user-agent') ?? null

  try {
    const admin = supabaseAdmin()

    // Atomic single-use enforcement: filter on collection_token AND
    // token_consumed_at IS NULL AND token_expires_at > now(). If
    // someone double-submits, only the first wins.
    const nowIso = new Date().toISOString()
    const { data, error } = await admin
      .from('incident_witness_statements')
      .update({
        statement_text:    statement,
        signed_name:       signedName,
        signed_at:         nowIso,
        collected_at:      nowIso,
        token_consumed_at: nowIso,
        ip_address:        ip,
        user_agent:        ua,
      })
      .eq('collection_token', token)
      .is('token_consumed_at', null)
      .gt('token_expires_at', nowIso)
      .select('id, incident_id')
      .maybeSingle()

    if (error) {
      Sentry.captureException(error, { tags: { route: 'witness/[token]/POST', stage: 'update' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      // No row matched → token already consumed, expired, or never existed.
      return NextResponse.json({ error: 'This link has expired or has already been used.' }, { status: 410 })
    }

    return NextResponse.json({ ok: true, statement_id: data.id }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'witness/[token]/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
