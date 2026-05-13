import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyJPEG } from '@/lib/security/magicBytes'
import { equipmentPhotoPath, type PhotoSlot } from '@soteria/core/storagePaths'

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
const MAX_REVIEW_PHOTO_BYTES = 2_000_000
const MAX_REVIEW_PHOTO_REQUEST_BYTES = 2_500_000

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

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    return handlePhotoReplace(req, lookup.link)
  }

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

  // After signoff, note + signoff JSON actions are blocked. Multipart
  // photo uploads are blocked inside handlePhotoReplace for the same
  // reason: the portal becomes read-only.
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
    const { error: upsertErr } = await admin.rpc('upsert_loto_placard_review', {
      p_review_link_id: lookup.link.id,
      p_equipment_id: equipmentId,
      p_status: status,
      p_notes: notes,
    })
    if (upsertErr) {
      Sentry.captureException(upsertErr, { tags: { route: 'review/[token]', stage: 'submit-note' } })
      return rpcErrorResponse(upsertErr)
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

    const { data: signed, error: signoffErr } = await admin.rpc('signoff_loto_review_link', {
      p_review_link_id: lookup.link.id,
      p_approved: approved,
      p_typed_name: typedName,
      p_signature: signature,
      p_notes: notes,
      p_ip: ip,
      p_user_agent: userAgent,
    })
    if (signoffErr) {
      Sentry.captureException(signoffErr, { tags: { route: 'review/[token]', stage: 'signoff' } })
      return rpcErrorResponse(signoffErr)
    }
    if (!signed?.length) {
      return NextResponse.json({ error: 'This review has already been signed off.' }, { status: 409 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}

async function handlePhotoReplace(
  req: Request,
  link: Extract<LinkLookup, { ok: true }>['link'],
) {
  if (link.signed_off_at) {
    return NextResponse.json({ error: 'This review has already been signed off.' }, { status: 409 })
  }

  const declaredLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REVIEW_PHOTO_REQUEST_BYTES) {
    return NextResponse.json({ error: 'photo upload request is too large' }, { status: 413 })
  }

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 }) }

  if (form.get('action') !== 'replace-photo') {
    return NextResponse.json({ error: 'Unsupported multipart action' }, { status: 400 })
  }

  const equipmentId = stringField(form, 'equipment_id')
  const slot = stringField(form, 'slot')
  const photo = form.get('photo')

  if (!equipmentId) {
    return NextResponse.json({ error: 'equipment_id required' }, { status: 400 })
  }
  if (slot !== 'EQUIP' && slot !== 'ISO') {
    return NextResponse.json({ error: 'slot must be EQUIP or ISO' }, { status: 400 })
  }
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: 'photo file required' }, { status: 400 })
  }
  if (photo.size <= 0) {
    return NextResponse.json({ error: 'photo file is empty' }, { status: 400 })
  }
  if (photo.size > MAX_REVIEW_PHOTO_BYTES) {
    return NextResponse.json({ error: 'photo must be 2 MB or smaller' }, { status: 400 })
  }

  const bytes = await photo.arrayBuffer()
  if (!verifyJPEG(bytes)) {
    return NextResponse.json({ error: 'photo must be a JPEG image' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const storagePath = equipmentPhotoPath(link.tenant_id, equipmentId, slot as PhotoSlot)
  const bucket = admin.storage.from('loto-photos')
  const { error: uploadErr } = await bucket.upload(storagePath, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (uploadErr) {
    Sentry.captureException(uploadErr, { tags: { route: 'review/[token]', stage: 'replace-photo-upload' } })
    return NextResponse.json({ error: uploadErr.message }, { status: 500 })
  }

  const { data: { publicUrl } } = bucket.getPublicUrl(storagePath)
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  const userAgent = req.headers.get('user-agent') ?? null

  const { data: result, error: replaceErr } = await admin.rpc('apply_loto_review_photo_replacement', {
    p_review_link_id: link.id,
    p_equipment_id: equipmentId,
    p_slot: slot,
    p_new_photo_url: publicUrl,
    p_storage_path: storagePath,
    p_ip: ip,
    p_user_agent: userAgent,
  })

  if (replaceErr) {
    Sentry.captureException(replaceErr, { tags: { route: 'review/[token]', stage: 'replace-photo-apply' } })
    const { error: cleanupErr } = await bucket.remove([storagePath])
    if (cleanupErr) {
      Sentry.captureException(cleanupErr, { tags: { route: 'review/[token]', stage: 'replace-photo-cleanup' } })
    }
    return rpcErrorResponse(replaceErr)
  }

  const photoStatus = Array.isArray(result) && typeof result[0]?.photo_status === 'string'
    ? result[0].photo_status
    : 'partial'

  return NextResponse.json({
    ok: true,
    equipment_id: equipmentId,
    slot,
    public_url: publicUrl,
    photo_status: photoStatus,
  })
}

function stringField(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function rpcErrorResponse(error: { message?: string }) {
  const message = error.message ?? 'Request failed'
  const lower = message.toLowerCase()
  if (lower.includes('already signed off')) {
    return NextResponse.json({ error: 'This review has already been signed off.' }, { status: 409 })
  }
  if (lower.includes('not in this review batch')) {
    return NextResponse.json({ error: 'Equipment not in this review batch' }, { status: 400 })
  }
  if (lower.includes('equipment not found')) {
    return NextResponse.json({ error: 'Equipment not found for this review batch' }, { status: 400 })
  }
  if (lower.includes('all placards must be reviewed')) {
    return NextResponse.json({ error: 'Review every placard before submitting signoff.' }, { status: 400 })
  }
  if (lower.includes('complete photos and generated placards')) {
    return NextResponse.json({ error: 'All placards must be current before signoff. Regenerate any placards changed by photo replacement, then reopen this link.' }, { status: 409 })
  }
  if (lower.includes('no equipment')) {
    return NextResponse.json({ error: 'This review batch has no equipment.' }, { status: 400 })
  }
  return NextResponse.json({ error: message }, { status: 500 })
}
