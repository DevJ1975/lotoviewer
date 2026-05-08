import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/safety-boards/attachments  (multipart, field "file")
//
// Uploads a file to the safety-board-attachments bucket and creates a
// safety_board_attachments row with target_type/target_id NULL. The
// caller then includes the returned attachment id in their POST
// /threads or POST /replies body — those handlers claim the
// attachment and stamp the target.
//
// Path: safety-board-attachments/{tenant_id}/{attachment_uuid}/{filename}
//
// Bucket is private; client fetches a short-lived signed URL via
// /api/safety-boards/attachments/[id]/url.

const MAX_BYTES = 25_000_000   // matches the DB CHECK constraint
const ACCEPTED: ReadonlySet<string> = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
  'text/plain', 'text/csv',
])

function safeFilename(input: string | null | undefined, fallback: string): string {
  const raw = (input ?? '').replace(/[\x00-\x1f\x7f]/g, '')
  const base = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_')
  return cleaned || fallback
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 })
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File size out of range (must be 1B-${MAX_BYTES / 1_000_000}MB)` }, { status: 400 })
  }
  if (!ACCEPTED.has(file.type)) {
    return NextResponse.json({
      error: `Unsupported file type "${file.type}". Allowed: images, PDF, plain text, CSV.`,
    }, { status: 415 })
  }

  try {
    const admin = supabaseAdmin()
    const attachmentId = crypto.randomUUID()
    const filename = safeFilename(file.name, `${attachmentId}.bin`)
    const path = `${gate.tenantId}/${attachmentId}/${filename}`
    const buf  = await file.arrayBuffer()

    const { error: uploadErr } = await admin
      .storage
      .from('safety-board-attachments')
      .upload(path, buf, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      })
    if (uploadErr) {
      Sentry.captureException(uploadErr, { tags: { route: 'safety-attachments/POST', stage: 'upload' } })
      return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 })
    }

    const { data: row, error: insertErr } = await admin
      .from('safety_board_attachments')
      .insert({
        id:           attachmentId,
        tenant_id:    gate.tenantId,
        target_type:  null,
        target_id:    null,
        uploaded_by:  gate.userId,
        storage_path: path,
        mime_type:    file.type,
        size_bytes:   file.size,
        filename,
      })
      .select('*')
      .single()
    if (insertErr) {
      Sentry.captureException(insertErr, { tags: { route: 'safety-attachments/POST', stage: 'insert' } })
      await admin.storage.from('safety-board-attachments').remove([path])
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ attachment: row }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-attachments/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
