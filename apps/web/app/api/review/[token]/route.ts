import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Public review-portal API. No auth — the URL token is the auth.
// Service-role under the hood; every request:
//   1. Validates the 32-hex token format up front (cheap reject).
//   2. Looks up the review_link by token.
//   3. Confirms the link is not revoked and not expired.
//   4. Applies the requested action.
//
// Channel marker: any audit row created from this route ends up
// flagged 'review-portal' so the audit feed distinguishes
// public-portal writes from in-app admin writes.

const TOKEN_RE = /^[0-9a-f]{32}$/

type LinkLookup =
  | {
      ok: true
      link: {
        id:               string
        tenant_id:        string
        department:       string
        first_viewed_at:  string | null
        signed_off_at:    string | null
      }
    }
  | { ok: false; status: number; message: string }

async function lookupLink(token: string): Promise<LinkLookup> {
  if (!TOKEN_RE.test(token)) {
    return { ok: false, status: 400, message: 'Invalid token format' }
  }
  const admin = supabaseAdmin()
  const { data: link, error } = await admin
    .from('loto_review_links')
    .select('id, tenant_id, department, expires_at, revoked_at, first_viewed_at, signed_off_at')
    .eq('token', token)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { route: 'review/[token]', stage: 'lookup' } })
    return { ok: false, status: 500, message: error.message }
  }
  if (!link) {
    return { ok: false, status: 404, message: 'Review link not found' }
  }
  if (link.revoked_at) {
    return { ok: false, status: 410, message: 'This review link has been revoked.' }
  }
  if (Date.parse(link.expires_at) < Date.now()) {
    return { ok: false, status: 410, message: 'This review link has expired.' }
  }
  return {
    ok: true,
    link: {
      id:              link.id,
      tenant_id:       link.tenant_id,
      department:      link.department,
      first_viewed_at: link.first_viewed_at,
      signed_off_at:   link.signed_off_at,
    },
  }
}

interface PostBody {
  action?:        unknown
  // submit-note
  equipment_id?:  unknown
  status?:        unknown
  notes?:         unknown
  // signoff
  typed_name?:    unknown
  signature?:     unknown
  approved?:      unknown
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const lookup = await lookupLink(token)
  if (!lookup.ok) return NextResponse.json({ error: lookup.message }, { status: lookup.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const action = typeof body.action === 'string' ? body.action : ''
  const admin = supabaseAdmin()

  // ─── view-ack ───────────────────────────────────────────────────────────
  // Idempotent: only sets first_viewed_at on the first view. Subsequent
  // views just return ok without touching the row. The reviewer's
  // initial page load fires this once; revisits are no-ops.
  if (action === 'view-ack') {
    if (!lookup.link.first_viewed_at) {
      const { error } = await admin
        .from('loto_review_links')
        .update({ first_viewed_at: new Date().toISOString() })
        .eq('id', lookup.link.id)
      if (error) {
        Sentry.captureException(error, { tags: { route: 'review/[token]', stage: 'view-ack' } })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
    return NextResponse.json({ ok: true })
  }

  // After signoff, both note + signoff actions are blocked. The portal
  // becomes read-only.
  if (lookup.link.signed_off_at && (action === 'submit-note' || action === 'signoff')) {
    return NextResponse.json({ error: 'This review has already been signed off.' }, { status: 409 })
  }

  // ─── submit-note ────────────────────────────────────────────────────────
  // Upsert one row per (review_link_id, equipment_id). Notes are
  // overwritten on each save; the user's last word wins. Status must
  // be 'approved' or 'needs_changes'.
  if (action === 'submit-note') {
    const equipmentId = typeof body.equipment_id === 'string' ? body.equipment_id.trim() : ''
    const status      = typeof body.status === 'string' ? body.status : ''
    const notes       = typeof body.notes === 'string' ? body.notes : ''
    if (!equipmentId) {
      return NextResponse.json({ error: 'equipment_id required' }, { status: 400 })
    }
    if (!['approved', 'needs_changes'].includes(status)) {
      return NextResponse.json({ error: 'status must be approved or needs_changes' }, { status: 400 })
    }
    // Verify the equipment belongs to the same tenant + department.
    const { data: equip } = await admin
      .from('loto_equipment')
      .select('equipment_id')
      .eq('tenant_id', lookup.link.tenant_id)
      .eq('department', lookup.link.department)
      .eq('equipment_id', equipmentId)
      .maybeSingle()
    if (!equip) {
      return NextResponse.json({ error: 'Equipment not in this review batch' }, { status: 400 })
    }

    const { error: upsertErr } = await admin
      .from('loto_placard_reviews')
      .upsert({
        review_link_id: lookup.link.id,
        equipment_id:   equipmentId,
        status,
        notes:          notes.trim() || null,
      }, { onConflict: 'review_link_id,equipment_id' })
    if (upsertErr) {
      Sentry.captureException(upsertErr, { tags: { route: 'review/[token]', stage: 'submit-note' } })
      return NextResponse.json({ error: upsertErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // ─── signoff ────────────────────────────────────────────────────────────
  // Final write. Sets signed_off_at + the signature payload + IP / UA
  // for audit. Capping at one signoff per link — if the reviewer has
  // already signed, we 409 above.
  if (action === 'signoff') {
    const typedName = typeof body.typed_name === 'string' ? body.typed_name.trim() : ''
    const signature = typeof body.signature === 'string' ? body.signature : ''
    const approved  = body.approved === true ? true : body.approved === false ? false : null
    const notes     = typeof body.notes === 'string' ? body.notes.trim() : ''
    if (!typedName) {
      return NextResponse.json({ error: 'typed_name required' }, { status: 400 })
    }
    if (!signature.startsWith('data:image/')) {
      return NextResponse.json({ error: 'signature data URL required' }, { status: 400 })
    }
    if (approved === null) {
      return NextResponse.json({ error: 'approved (boolean) required' }, { status: 400 })
    }

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null
    const userAgent = req.headers.get('user-agent') ?? null

    const { error: signoffErr } = await admin
      .from('loto_review_links')
      .update({
        signed_off_at:       new Date().toISOString(),
        signoff_approved:    approved,
        signoff_signature:   signature,
        signoff_typed_name:  typedName,
        signoff_notes:       notes || null,
        signoff_ip:          ip,
        signoff_user_agent:  userAgent,
      })
      .eq('id', lookup.link.id)
    if (signoffErr) {
      Sentry.captureException(signoffErr, { tags: { route: 'review/[token]', stage: 'signoff' } })
      return NextResponse.json({ error: signoffErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
