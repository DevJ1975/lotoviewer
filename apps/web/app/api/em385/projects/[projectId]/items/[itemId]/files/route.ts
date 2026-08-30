import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'

// GET  /api/em385/projects/[projectId]/items/[itemId]/files   List files (member).
// POST /api/em385/projects/[projectId]/items/[itemId]/files   Record an uploaded
//                                                             evidence file (admin).
//
// The browser uploads the bytes straight to the `loto-photos` bucket at the
// tenant-prefixed em385 path (see core em385DocumentPath); this route only
// persists the metadata row, mirroring how incident attachments are recorded.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_RE = /^[0-9a-f]{64}$/
const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB cap for compliance documents

export async function GET(req: Request, ctx: { params: Promise<{ itemId: string }> }) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { itemId } = await ctx.params
  if (!UUID_RE.test(itemId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data, error } = await gate.authedClient
      .from('em385_document_files')
      .select('id, register_item_id, storage_path, mime_type, file_size_bytes, file_hash_sha256, version_label, uploaded_by, uploaded_at')
      .eq('register_item_id', itemId)
      .order('uploaded_at', { ascending: false })
    if (error) throw new Error(error.message)
    return NextResponse.json({ files: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/files/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ itemId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { itemId } = await ctx.params
  if (!UUID_RE.test(itemId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const storagePath = typeof body.storage_path === 'string' ? body.storage_path.trim() : ''
  // Defence in depth: the path must live under this tenant's em385 prefix so a
  // forged metadata row can't point at another tenant's objects.
  if (!storagePath || !storagePath.startsWith(`${gate.tenantId}/em385/`)) {
    return NextResponse.json({ error: 'storage_path must be under this tenant\'s em385 prefix' }, { status: 400 })
  }

  const hash = typeof body.file_hash_sha256 === 'string' ? body.file_hash_sha256.toLowerCase() : null
  if (hash && !SHA256_RE.test(hash)) {
    return NextResponse.json({ error: 'file_hash_sha256 must be lowercase hex SHA-256' }, { status: 400 })
  }

  const size = typeof body.file_size_bytes === 'number' ? Math.floor(body.file_size_bytes) : null
  if (size != null && (size < 0 || size > MAX_FILE_BYTES)) {
    return NextResponse.json({ error: 'file_size_bytes out of range' }, { status: 400 })
  }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  try {
    const admin = supabaseAdmin()

    // Confirm the register item belongs to the active tenant.
    const { data: item, error: itemErr } = await admin
      .from('em385_register_items')
      .select('id')
      .eq('id', itemId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (itemErr) return sanitizeError(itemErr, 'em385/files/POST:item')
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const insert = {
      tenant_id:        gate.tenantId,
      register_item_id: itemId,
      storage_path:     storagePath,
      mime_type:        str(body.mime_type),
      file_size_bytes:  size,
      file_hash_sha256: hash,
      version_label:    str(body.version_label),
      uploaded_by:      gate.userId,
    }

    const { data, error } = await admin
      .from('em385_document_files')
      .insert(insert)
      .select('*')
      .single()
    if (error) return sanitizeError(error, 'em385/files/POST')
    return NextResponse.json({ file: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/files/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
