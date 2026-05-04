import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST   /api/superadmin/tenants/[number]/logo  — multipart form, field "file"
// DELETE /api/superadmin/tenants/[number]/logo  — clears logo_url (does NOT
//                                                  delete the storage object;
//                                                  uploading a new one
//                                                  overwrites by path)
//
// Logos go to the tenant-logos bucket (created in migration 027) at path
// {tenant_id}.{ext}. Bucket is public-read so <img src> works without
// signed URLs. Storage RLS allows writes only when profiles.is_superadmin
// is true; this route additionally enforces SUPERADMIN_EMAILS allowlist
// via requireSuperadmin().
//
// Accepted MIMEs: PNG, JPEG, WebP. SVG intentionally rejected — SVG can
// embed <script> and we'd have to sanitize server-side; logos are usually
// raster anyway.

const MAX_BYTES = 1_000_000  // 1MB. Logos > 1MB are bloated.
const ACCEPTED_TYPES: Record<string, string> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

async function findTenant(number: string) {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('tenants')
    .select('id, tenant_number, logo_url')
    .eq('tenant_number', number)
    .maybeSingle()
  return { admin, tenant: data, error }
}

export async function POST(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!/^[0-9]{4}$/.test(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Logo must be ≤ ${MAX_BYTES / 1000}KB` }, { status: 400 })
  }
  const ext = ACCEPTED_TYPES[file.type]
  if (!ext) {
    return NextResponse.json({
      error: `Unsupported file type "${file.type}". Use PNG, JPEG, or WebP.`,
    }, { status: 400 })
  }

  const { admin, tenant, error: lookupErr } = await findTenant(number)
  if (lookupErr) {
    Sentry.captureException(lookupErr)
    return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  }
  if (!tenant) {
    return NextResponse.json({ error: `No tenant with number ${number}` }, { status: 404 })
  }

  const path = `${tenant.id}.${ext}`
  const arrayBuffer = await file.arrayBuffer()

  // upsert: same path overwrites (avoids stale objects when admin replaces
  // a PNG with a new PNG). The path stays stable across re-uploads which
  // means logo_url is also stable, but cache-busting is the public CDN's
  // problem — Storage public URLs are immutable per object-version.
  const { error: uploadErr } = await admin
    .storage
    .from('tenant-logos')
    .upload(path, arrayBuffer, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: true,
    })
  if (uploadErr) {
    Sentry.captureException(uploadErr)
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 })
  }

  // Public URL for the bucket. Append a cache-bust query so the browser
  // picks up the new file even though the storage path is unchanged.
  const { data: pub } = admin.storage.from('tenant-logos').getPublicUrl(path)
  const logoUrl = `${pub.publicUrl}?v=${Date.now()}`

  const { data: updated, error: updateErr } = await admin
    .from('tenants')
    .update({ logo_url: logoUrl })
    .eq('id', tenant.id)
    .select('*')
    .maybeSingle()
  if (updateErr) {
    Sentry.captureException(updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ tenant: updated })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!/^[0-9]{4}$/.test(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  const { admin, tenant, error: lookupErr } = await findTenant(number)
  if (lookupErr) {
    Sentry.captureException(lookupErr)
    return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  }
  if (!tenant) {
    return NextResponse.json({ error: `No tenant with number ${number}` }, { status: 404 })
  }

  // Clear logo_url; leave the storage object in place (idempotent + cheap).
  // A future migration can sweep orphans if storage cost ever matters.
  const { data: updated, error: updateErr } = await admin
    .from('tenants')
    .update({ logo_url: null })
    .eq('id', tenant.id)
    .select('*')
    .maybeSingle()
  if (updateErr) {
    Sentry.captureException(updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ tenant: updated })
}
