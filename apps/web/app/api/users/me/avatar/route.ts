import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST   /api/users/me/avatar  — multipart form, field "file"
// DELETE /api/users/me/avatar  — clears avatar_url and storage object
//
// User-scoped, NOT tenant-scoped: an avatar is a property of the user, not
// of any one tenant they belong to. We therefore verify the bearer token
// directly instead of going through requireTenantMember (which also
// requires the x-active-tenant header).
//
// Storage path: profile-pictures/{user_id}.{ext}. RLS in migration 069
// restricts writes to objects whose name starts with the caller's
// auth.uid() so a member of tenant A cannot overwrite the avatar of
// someone in tenant B.
//
// Accepted MIMEs: PNG, JPEG, WebP. SVG intentionally rejected — SVG can
// embed <script> and we'd have to sanitize server-side.

const MAX_BYTES = 1_000_000  // 1MB. Plenty for a 256-512px avatar.
const ACCEPTED_TYPES: Record<string, string> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

interface AuthOk { ok: true; userId: string }
interface AuthErr { ok: false; status: number; message: string }

async function requireUser(req: Request): Promise<AuthOk | AuthErr> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Missing bearer token' }
  }
  const token = authHeader.slice('Bearer '.length)
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return { ok: false, status: 500, message: 'Supabase env not configured' }
  }
  const userClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, message: 'Invalid session' }
  return { ok: true, userId: user.id }
}

async function removeStaleAvatars(userId: string, keepPath: string | null) {
  const admin = supabaseAdmin()
  // List objects matching `{user_id}.` in the bucket so we can clean up
  // prior-format files when the user uploads a new ext (PNG → JPEG, etc.)
  // or when they delete entirely.
  const { data: existing } = await admin
    .storage
    .from('profile-pictures')
    .list('', { search: userId })
  const stale = (existing ?? [])
    .filter(o => o.name.startsWith(`${userId}.`) && o.name !== keepPath)
    .map(o => o.name)
  if (stale.length > 0) {
    await admin.storage.from('profile-pictures').remove(stale)
  }
}

export async function POST(req: Request) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Avatar must be ≤ ${MAX_BYTES / 1000}KB` }, { status: 400 })
  }
  const ext = ACCEPTED_TYPES[file.type]
  if (!ext) {
    return NextResponse.json({
      error: `Unsupported file type "${file.type}". Use PNG, JPEG, or WebP.`,
    }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const path = `${auth.userId}.${ext}`
  const arrayBuffer = await file.arrayBuffer()

  // Cleanup BEFORE upload so a previous PNG doesn't linger when the new
  // upload writes a JPG to a different path. Keep `path` in case the user
  // is replacing same-extension — `upsert: true` below handles that.
  await removeStaleAvatars(auth.userId, path)

  const { error: uploadErr } = await admin
    .storage
    .from('profile-pictures')
    .upload(path, arrayBuffer, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: true,
    })
  if (uploadErr) {
    Sentry.captureException(uploadErr, { tags: { route: '/api/users/me/avatar', stage: 'storage-upload' } })
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 })
  }

  // Cache-busted public URL — the storage path is stable across re-uploads
  // so without ?v= the browser would keep showing the old avatar.
  const { data: pub } = admin.storage.from('profile-pictures').getPublicUrl(path)
  const avatarUrl = `${pub.publicUrl}?v=${Date.now()}`

  const { data: updated, error: updateErr } = await admin
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', auth.userId)
    .select('*')
    .maybeSingle()
  if (updateErr) {
    Sentry.captureException(updateErr, { tags: { route: '/api/users/me/avatar', stage: 'profile-update' } })
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ profile: updated })
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  const admin = supabaseAdmin()

  // Wipe all stored avatars for this user (any extension) before clearing
  // the URL so we don't leave orphan objects behind.
  await removeStaleAvatars(auth.userId, null)

  const { data: updated, error: updateErr } = await admin
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', auth.userId)
    .select('*')
    .maybeSingle()
  if (updateErr) {
    Sentry.captureException(updateErr, { tags: { route: '/api/users/me/avatar', stage: 'profile-update' } })
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ profile: updated })
}
