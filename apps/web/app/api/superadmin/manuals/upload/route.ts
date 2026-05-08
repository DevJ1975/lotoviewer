import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/superadmin/manuals/upload  (multipart, field "file", optional "module_id")
//
// Uploads a screenshot / inline image to the public-read
// `module-manuals` bucket. Returns the public URL ready to paste
// into the editor as `![alt](url)`.
//
// Path:
//   module-manuals/{module_id}/{uuid}.{ext}    when module_id provided
//   module-manuals/_master/{uuid}.{ext}        otherwise

const SLUG_RE   = /^[a-z0-9][a-z0-9-]{0,79}$/
const MAX_BYTES = 5_000_000   // 5MB — manuals are read-heavy; oversized screenshots hurt page weight
const ACCEPTED: Record<string, string> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif':  'gif',
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 })
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File must be 1B-${MAX_BYTES / 1_000_000}MB` }, { status: 400 })
  }
  const ext = ACCEPTED[file.type]
  if (!ext) return NextResponse.json({ error: `Unsupported MIME ${file.type}. Use PNG, JPEG, WebP, or GIF.` }, { status: 415 })

  const rawModuleId = (form.get('module_id') ?? '').toString().trim().toLowerCase()
  const moduleId = rawModuleId && SLUG_RE.test(rawModuleId) ? rawModuleId : '_master'

  try {
    const admin = supabaseAdmin()
    const id = crypto.randomUUID()
    const path = `${moduleId}/${id}.${ext}`
    const buf  = await file.arrayBuffer()

    const { error: uploadErr } = await admin
      .storage
      .from('module-manuals')
      .upload(path, buf, {
        contentType: file.type,
        cacheControl: '604800',  // 7 days; manuals don't churn images often
        upsert: false,
      })
    if (uploadErr) {
      Sentry.captureException(uploadErr, { tags: { route: 'manuals-upload/POST', stage: 'upload' } })
      return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 })
    }

    const { data: pub } = admin.storage.from('module-manuals').getPublicUrl(path)
    return NextResponse.json({
      url:           pub.publicUrl,
      storage_path:  path,
      mime_type:     file.type,
      size_bytes:    file.size,
    }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'manuals-upload/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
