import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/toolbox-talks/[id]/sign
//
// Adds a sign-in row to the roster for a talk. Two modes:
//   - Self-sign: the logged-in user signs themselves. signer_user_id
//     defaults to gate.userId; the unique (talk_id, signer_user_id)
//     constraint prevents double-signing.
//   - Coworker sign: the supervisor's session is being used by a
//     non-Soteria worker (typed name + signature). Pass
//     signer_user_id: null in the body. Multiple coworker signatures
//     per talk are allowed because the constraint allows multiple
//     NULLs.
//
// Validation:
//   - signer_name required, 2–120 chars
//   - signature_data required, must look like a base64 PNG data URL
//   - signature payload size capped at 200 KB to keep the row small
//
// Auth: any tenant member. There is no admin-only mutation here —
// signing in is the whole point of being there. Generation is
// separately gated to the cron only.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIGNATURE_MAX_BYTES = 200_000
const SIGNATURE_PREFIX    = 'data:image/png;base64,'
// Only standard base64 alphabet + padding. Rejects garbage payloads
// that share the prefix but carry non-base64 characters (e.g. an
// attacker injecting HTML or shell metacharacters into the column).
const BASE64_RE           = /^[A-Za-z0-9+/]+={0,2}$/

interface SignBody {
  signer_name?:    unknown
  employee_id?:    unknown
  signature_data?: unknown
  // Pass false to attribute the signature to a non-Soteria worker
  // (handed-the-tablet flow). Defaults to self-sign.
  is_self?:        unknown
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id: talkId } = await ctx.params
  if (!UUID_RE.test(talkId)) {
    return NextResponse.json({ error: 'Invalid talk id' }, { status: 400 })
  }

  let body: SignBody
  try { body = await req.json() as SignBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const signerName = typeof body.signer_name === 'string' ? body.signer_name.trim() : ''
  if (signerName.length < 2 || signerName.length > 120) {
    return NextResponse.json({ error: 'signer_name must be 2–120 characters' }, { status: 400 })
  }

  const sigData = typeof body.signature_data === 'string' ? body.signature_data : ''
  if (!sigData.startsWith(SIGNATURE_PREFIX)) {
    return NextResponse.json({ error: 'signature_data must be a base64 PNG data URL' }, { status: 400 })
  }
  if (sigData.length > SIGNATURE_MAX_BYTES) {
    return NextResponse.json({ error: `signature_data exceeds ${SIGNATURE_MAX_BYTES} bytes` }, { status: 413 })
  }
  const sigPayload = sigData.slice(SIGNATURE_PREFIX.length)
  if (sigPayload.length === 0 || !BASE64_RE.test(sigPayload)) {
    return NextResponse.json({ error: 'signature_data payload is not valid base64' }, { status: 400 })
  }

  const employeeId = typeof body.employee_id === 'string' ? body.employee_id.trim().slice(0, 60) || null : null
  // Only an explicit `false` boolean opts out of self-sign — string
  // "false" or other falsy values default to self-sign (the gated
  // user is the source of truth either way; this just controls
  // whether signer_user_id is recorded).
  const isSelf     = body.is_self !== false

  try {
    // Verify the talk belongs to the active tenant (RLS is the real
    // gate, but the explicit check returns a clean 404 to the UI).
    const { data: talk, error: talkErr } = await gate.authedClient
      .from('toolbox_talks')
      .select('id')
      .eq('id', talkId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (talkErr) throw new Error(talkErr.message)
    if (!talk) return NextResponse.json({ error: 'Talk not found' }, { status: 404 })

    // Capture the signer's IP for the audit trail. Vercel forwards
    // the original request IP via x-forwarded-for; fall back to
    // x-real-ip and finally to the connection-level header.
    const fwd = req.headers.get('x-forwarded-for') ?? ''
    const ip  = fwd.split(',')[0].trim() ||
                req.headers.get('x-real-ip') ||
                null

    // Insert through supabaseAdmin so RLS doesn't block writes —
    // the tenant_id is fixed to the gated value, which is the
    // same scope RLS would enforce. This avoids the RLS dance
    // around inserting into a row a tenant member should have
    // every right to add to.
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('toolbox_talk_signatures')
      .insert({
        tenant_id:      gate.tenantId,
        talk_id:        talkId,
        signer_user_id: isSelf ? gate.userId : null,
        signer_name:    signerName,
        employee_id:    employeeId,
        signature_data: sigData,
        signed_ip:      ip,
      })
      .select('id, signer_user_id, signer_name, employee_id, signed_at')
      .single()

    if (error) {
      // 23505 = unique constraint, i.e. the same logged-in user
      // signed twice. Surface a clean 409 instead of a 500.
      if (error.code === '23505') {
        return NextResponse.json({ error: 'You have already signed this talk' }, { status: 409 })
      }
      Sentry.captureException(error, { tags: { route: 'toolbox-talks/sign' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ signature: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'toolbox-talks/sign' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
