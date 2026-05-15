import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyPngDataUrl } from '@/lib/security/magicBytes'
import { localDateString, tenantTimeZone } from '@/lib/toolboxDates'
import { TOOLBOX_TALKS_MODULE_ID } from '@/lib/toolboxTalkPacks'

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
// Prefix + base64-alphabet + magic-byte verification all live in
// `verifyPngDataUrl` (lib/security/magicBytes.ts).

interface SignBody {
  signer_name?:    unknown
  employee_id?:    unknown
  signature_data?: unknown
  // Pass false to attribute the signature to a non-Soteria worker
  // (handed-the-tablet flow). Defaults to self-sign.
  is_self?:        unknown
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantModuleMember(req, TOOLBOX_TALKS_MODULE_ID)
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
  if (sigData.length > SIGNATURE_MAX_BYTES) {
    return NextResponse.json({ error: `signature_data exceeds ${SIGNATURE_MAX_BYTES} bytes` }, { status: 413 })
  }
  // verifyPngDataUrl checks: prefix, base64 alphabet, AND that the
  // decoded payload starts with the PNG magic bytes
  // (89 50 4E 47 0D 0A 1A 0A). Without the magic-byte check, an
  // attacker could store arbitrary bytes (HTML, JS, garbage) under
  // a `data:image/png;base64,…` prefix that passes the alphabet
  // regex.
  const pngErr = verifyPngDataUrl(sigData)
  if (pngErr) {
    return NextResponse.json({ error: 'signature_data must be a valid base64 PNG data URL' }, { status: 400 })
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
      .select('id, talk_date')
      .eq('id', talkId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (talkErr) throw new Error(talkErr.message)
    if (!talk) return NextResponse.json({ error: 'Talk not found' }, { status: 404 })

    const todayStr = localDateString(new Date(), tenantTimeZone(gate.tenantSettings))
    if (String(talk.talk_date) > todayStr) {
      return NextResponse.json({
        error: `This talk is scheduled for ${talk.talk_date} and cannot be signed before that date.`,
      }, { status: 409 })
    }

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
        // Audit trail: always record who pressed Save, even when
        // signer_user_id is NULL (coworker mode). For self-signs
        // this is the same user as signer_user_id; the redundancy
        // is intentional so a single column query answers "who
        // touched this row" without branching on null.
        inserted_by:    gate.userId,
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
