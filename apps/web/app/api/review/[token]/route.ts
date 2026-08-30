import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyJPEG } from '@/lib/security/magicBytes'
import { stagingReviewPhotoPath, type PhotoSlot } from '@soteria/core/storagePaths'
import { sealReviewPlacards } from '@/lib/sealedArtifact'

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
        department:       string | null
        is_public:        boolean
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
    .select('id, tenant_id, department, is_public, expires_at, revoked_at, first_viewed_at, signed_off_at')
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
      is_public:       !!link.is_public,
      first_viewed_at: link.first_viewed_at,
      signed_off_at:   link.signed_off_at,
    },
  }
}

interface PostBody {
  action?:        unknown
  // submit-note, mark-for-review, undo-photo-replace
  equipment_id?:  unknown
  // undo-photo-replace
  slot?:          unknown
  status?:        unknown
  notes?:         unknown
  // signoff, mark-for-review
  typed_name?:    unknown
  // mark-for-review
  reviewer_name?: unknown
  reason?:        unknown
  // signoff
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

  // ─── mark-for-review ────────────────────────────────────────────────────
  // Flag an equipment row for an admin to take a deeper look. Used on
  // the public supervisor link: the supervisor sees something off
  // (faded photo, wrong description, unclear isolation) but can't fix
  // it on the spot. Idempotent — re-flagging just overwrites the
  // note and timestamp; clearing happens through the admin queue API.
  if (action === 'mark-for-review') {
    const equipmentId  = typeof body.equipment_id === 'string' ? body.equipment_id.trim() : ''
    const reviewerName = typeof body.reviewer_name === 'string' ? body.reviewer_name.trim() : ''
    const reason       = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!equipmentId) {
      return NextResponse.json({ error: 'equipment_id required' }, { status: 400 })
    }
    if (!reviewerName) {
      return NextResponse.json({ error: 'reviewer_name required' }, { status: 400 })
    }
    // Confirm the equipment belongs to this link's tenant before we
    // patch. Without this check, a holder of any token could mark
    // any tenant's equipment by guessing equipment ids.
    const { data: eq, error: eqErr } = await admin
      .from('loto_equipment')
      .select('equipment_id')
      .eq('tenant_id',   lookup.link.tenant_id)
      .eq('equipment_id', equipmentId)
      .maybeSingle()
    if (eqErr) {
      Sentry.captureException(eqErr, { tags: { route: 'review/[token]', stage: 'mark-for-review-lookup' } })
      return NextResponse.json({ error: eqErr.message }, { status: 500 })
    }
    if (!eq) {
      return NextResponse.json({ error: 'Equipment not found in this tenant' }, { status: 404 })
    }
    const { error: flagErr } = await admin
      .from('loto_equipment')
      .update({
        flagged_for_review_at:   new Date().toISOString(),
        flagged_for_review_by:   reviewerName,
        flagged_for_review_via:  'public-link',
        flagged_for_review_note: reason || null,
      })
      .eq('tenant_id',   lookup.link.tenant_id)
      .eq('equipment_id', equipmentId)
    if (flagErr) {
      Sentry.captureException(flagErr, { tags: { route: 'review/[token]', stage: 'mark-for-review' } })
      return NextResponse.json({ error: flagErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // ─── unmark-for-review ──────────────────────────────────────────────────
  // Lets a supervisor undo a flag they set in error during the floor
  // walk. Requires reviewer_name for the audit trail (the underlying
  // log_audit trigger captures who changed the row); validates the
  // equipment is in the link's tenant before clearing.
  //
  // We intentionally allow any holder of the public link to clear any
  // flagged row in the tenant, not just rows they themselves flagged.
  // The link is the only auth here; tying clear-permissions to a
  // typed-in name would be a paper boundary, not real security.
  if (action === 'unmark-for-review') {
    const equipmentId  = typeof body.equipment_id === 'string' ? body.equipment_id.trim() : ''
    const reviewerName = typeof body.reviewer_name === 'string' ? body.reviewer_name.trim() : ''
    if (!equipmentId) {
      return NextResponse.json({ error: 'equipment_id required' }, { status: 400 })
    }
    if (!reviewerName) {
      return NextResponse.json({ error: 'reviewer_name required' }, { status: 400 })
    }
    const { data: eq, error: eqErr } = await admin
      .from('loto_equipment')
      .select('equipment_id')
      .eq('tenant_id',   lookup.link.tenant_id)
      .eq('equipment_id', equipmentId)
      .maybeSingle()
    if (eqErr) {
      Sentry.captureException(eqErr, { tags: { route: 'review/[token]', stage: 'unmark-for-review-lookup' } })
      return NextResponse.json({ error: eqErr.message }, { status: 500 })
    }
    if (!eq) {
      return NextResponse.json({ error: 'Equipment not found in this tenant' }, { status: 404 })
    }
    const { error: clearErr } = await admin
      .from('loto_equipment')
      .update({
        flagged_for_review_at:   null,
        flagged_for_review_by:   null,
        flagged_for_review_via:  null,
        flagged_for_review_note: null,
      })
      .eq('tenant_id',   lookup.link.tenant_id)
      .eq('equipment_id', equipmentId)
    if (clearErr) {
      Sentry.captureException(clearErr, { tags: { route: 'review/[token]', stage: 'unmark-for-review' } })
      return NextResponse.json({ error: clearErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // ─── undo-photo-replace ─────────────────────────────────────────────────
  // Drop a staged (pending) replacement before sign-off: delete the row and
  // its staged object so the tile reverts to the live photo. Idempotent —
  // no pending row is a no-op. Blocked once the review is signed off.
  if (action === 'undo-photo-replace') {
    if (lookup.link.signed_off_at) {
      return NextResponse.json({ error: 'This review has already been signed off.' }, { status: 409 })
    }
    const equipmentId = typeof body.equipment_id === 'string' ? body.equipment_id.trim() : ''
    const slot        = typeof body.slot === 'string' ? body.slot : ''
    if (!equipmentId) {
      return NextResponse.json({ error: 'equipment_id required' }, { status: 400 })
    }
    if (slot !== 'EQUIP' && slot !== 'ISO') {
      return NextResponse.json({ error: 'slot must be EQUIP or ISO' }, { status: 400 })
    }
    const { data: row, error: findErr } = await admin
      .from('loto_review_photo_replacements')
      .select('id, storage_path')
      .eq('review_link_id', lookup.link.id)
      .eq('equipment_id',   equipmentId)
      .eq('slot',           slot)
      .eq('status',         'pending')
      .maybeSingle()
    if (findErr) {
      Sentry.captureException(findErr, { tags: { route: 'review/[token]', stage: 'undo-photo-lookup' } })
      return NextResponse.json({ error: findErr.message }, { status: 500 })
    }
    if (row) {
      const { error: delErr } = await admin
        .from('loto_review_photo_replacements')
        .delete()
        .eq('id', row.id)
      if (delErr) {
        Sentry.captureException(delErr, { tags: { route: 'review/[token]', stage: 'undo-photo-delete' } })
        return NextResponse.json({ error: delErr.message }, { status: 500 })
      }
      if (row.storage_path) {
        const { error: rmErr } = await admin.storage.from('loto-photos').remove([row.storage_path])
        if (rmErr) {
          Sentry.captureException(rmErr, { tags: { route: 'review/[token]', stage: 'undo-photo-object' } })
        }
      }
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

    // Seal each approved placard: hash the bytes, upload to storage,
    // write the audit row. Best-effort — the signoff itself has
    // already landed, so a sealing miss surfaces in Sentry rather
    // than rolling back the signature. The signed_at timestamp comes
    // from the RPC's `now()` so the row and the hash agree.
    const signedAt = new Date().toISOString()
    try {
      const { data: placardRows } = await admin
        .from('loto_review_link_equipment')
        .select('equipment_id')
        .eq('review_link_id', lookup.link.id)
      const equipmentIds = (placardRows ?? []).map(r => r.equipment_id as string)
      if (equipmentIds.length > 0) {
        const { data: equipmentRows } = await admin
          .from('loto_equipment')
          .select('equipment_id, placard_url')
          .eq('tenant_id', lookup.link.tenant_id)
          .in('equipment_id', equipmentIds)
        await sealReviewPlacards(
          {
            tenantId:         lookup.link.tenant_id,
            reviewLinkId:     lookup.link.id,
            signedAt,
            typedName,
            signatureDataUrl: signature,
            signerIp:         ip,
            signerUserAgent:  userAgent,
          },
          (equipmentRows ?? []) as { equipment_id: string; placard_url: string | null }[],
        )
      }
    } catch (sealErr) {
      Sentry.captureException(sealErr, { tags: { route: 'review/[token]', stage: 'seal-artifacts' } })
    }

    // Reconcile-on-signoff hook. Apply any photos the reviewer staged so
    // sign-off "swaps them at the end" without an admin round-trip. Runs
    // after sealing (the sealed artifact captures the signed-off placards;
    // the staged improvements then land and null placard_url for re-render).
    // Idempotent and best-effort — a miss surfaces in Sentry and the admin
    // "Apply photo replacements" action can still finish the job.
    try {
      const { error: reconcileErr } = await admin.rpc('reconcile_review_link_photos', {
        p_review_link_id: lookup.link.id,
        p_applied_by:     null,
      })
      if (reconcileErr) {
        Sentry.captureException(reconcileErr, { tags: { route: 'review/[token]', stage: 'reconcile-on-signoff' } })
      }
    } catch (reconcileErr) {
      Sentry.captureException(reconcileErr, { tags: { route: 'review/[token]', stage: 'reconcile-on-signoff' } })
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

  const equipmentId  = stringField(form, 'equipment_id')
  const slot         = stringField(form, 'slot')
  const reviewerName = stringField(form, 'reviewer_name')
  const photo        = form.get('photo')

  if (!equipmentId) {
    return NextResponse.json({ error: 'equipment_id required' }, { status: 400 })
  }
  if (slot !== 'EQUIP' && slot !== 'ISO') {
    return NextResponse.json({ error: 'slot must be EQUIP or ISO' }, { status: 400 })
  }
  if (!reviewerName) {
    return NextResponse.json({ error: 'reviewer_name required' }, { status: 400 })
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
  // Park the upload in the staging area (NOT the live equipmentPhotoPath).
  // Nothing on loto_equipment changes until an admin reconciles.
  const storagePath = stagingReviewPhotoPath(link.id, equipmentId, slot as PhotoSlot)
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

  // Stage the replacement as a pending row. The RPC supersedes any prior
  // pending row for this slot and returns its storage path so we can drop
  // the now-orphaned object.
  const { data: staged, error: stageErr } = await admin.rpc('stage_loto_review_photo_replacement', {
    p_review_link_id:   link.id,
    p_equipment_id:     equipmentId,
    p_slot:             slot,
    p_new_photo_url:    publicUrl,
    p_storage_path:     storagePath,
    p_replaced_by_name: reviewerName,
    p_ip:               ip,
    p_user_agent:       userAgent,
  })

  if (stageErr) {
    Sentry.captureException(stageErr, { tags: { route: 'review/[token]', stage: 'replace-photo-stage' } })
    const { error: cleanupErr } = await bucket.remove([storagePath])
    if (cleanupErr) {
      Sentry.captureException(cleanupErr, { tags: { route: 'review/[token]', stage: 'replace-photo-cleanup' } })
    }
    return rpcErrorResponse(stageErr)
  }

  const supersededPath = Array.isArray(staged) && typeof staged[0]?.superseded_storage_path === 'string'
    ? staged[0].superseded_storage_path
    : null
  if (supersededPath && supersededPath !== storagePath) {
    const { error: orphanErr } = await bucket.remove([supersededPath])
    if (orphanErr) {
      Sentry.captureException(orphanErr, { tags: { route: 'review/[token]', stage: 'replace-photo-supersede-cleanup' } })
    }
  }

  return NextResponse.json({
    ok:           true,
    equipment_id: equipmentId,
    slot,
    staged_url:   publicUrl,
    status:       'pending',
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
  if (lower.includes('no equipment')) {
    return NextResponse.json({ error: 'This review batch has no equipment.' }, { status: 400 })
  }
  return NextResponse.json({ error: message }, { status: 500 })
}
