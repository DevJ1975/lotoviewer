import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { chemicalSdsStoragePath } from '@soteria/core/chemicals'
import { verifyPDF } from '@/lib/security/magicBytes'
import { sanitizeError } from '@/lib/security/sanitizeError'

// POST /api/chemicals/products/[id]/sds   (multipart, field "file")
//
// Uploads an SDS PDF to the chemical-sds bucket, inserts a
// chemical_sds_documents row, and (unless ?activate=false) flips the
// product's active_sds_id. Past revisions are kept; the previous one
// gets superseded_by/superseded_at stamped.

const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BYTES = 25_000_000

interface Ctx { params: Promise<{ id: string }> }

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const arr = Array.from(new Uint8Array(digest))
  return arr.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const tenantId = gate.tenantId
  const userId   = gate.userId

  const { id: productId } = await ctx.params
  if (!UUID_RE.test(productId)) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })

  const url = new URL(req.url)
  const activate = url.searchParams.get('activate') !== 'false'

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }

  const fileEntry = form.get('file')
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 })
  }
  const file = fileEntry
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({
      error: `File size out of range (must be 1B-${MAX_BYTES / 1_000_000}MB)`,
    }, { status: 400 })
  }
  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'SDS uploads must be PDF (application/pdf)' }, { status: 415 })
  }

  const revisionDateRaw = form.get('revision_date')
  const revisionDate = typeof revisionDateRaw === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(revisionDateRaw)
    ? revisionDateRaw : null
  const languageRaw = form.get('language')
  const language = typeof languageRaw === 'string' && /^[a-z]{2}$/i.test(languageRaw)
    ? languageRaw.toLowerCase() : 'en'

  try {
    const admin = supabaseAdmin()

    const { data: product, error: pErr } = await admin
      .from('chemical_products')
      .select('id, active_sds_id')
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (pErr)     return sanitizeError(pErr, 'chemicals/products/sds/POST')
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const buf = await file.arrayBuffer()
    // Magic-byte verification — rejects content with a forged
    // application/pdf Content-Type but bytes that are not a real
    // PDF. Defense in depth: even if the parser downstream is
    // tolerant of garbage, we don't store it.
    if (!verifyPDF(buf)) {
      return NextResponse.json({ error: 'File content is not a valid PDF' }, { status: 400 })
    }
    const fileHash = await sha256Hex(buf)

    const { data: existing } = await admin
      .from('chemical_sds_documents')
      .select('*')
      .eq('product_id', productId)
      .eq('tenant_id', tenantId)
      .eq('file_hash', fileHash)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ sds: existing, deduped: true }, { status: 200 })
    }

    let storagePath = chemicalSdsStoragePath(tenantId, productId, file.name)
    const { error: upErr } = await admin
      .storage
      .from('chemical-sds')
      .upload(storagePath, buf, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      })
    if (upErr) {
      if (/already exists|duplicate/i.test(upErr.message)) {
        const suffixed = storagePath.replace(/(\.pdf)?$/i, `-${Date.now()}.pdf`)
        const { error: retryErr } = await admin
          .storage
          .from('chemical-sds')
          .upload(suffixed, buf, { contentType: 'application/pdf', upsert: false })
        if (retryErr) return NextResponse.json({ error: `Upload failed: ${retryErr.message}` }, { status: 500 })
        storagePath = suffixed
      } else {
        return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })
      }
    }

    const { data: sds, error: insErr } = await admin
      .from('chemical_sds_documents')
      .insert({
        tenant_id:           tenantId,
        product_id:          productId,
        revision_date:       revisionDate,
        language,
        storage_path:        storagePath,
        file_hash:           fileHash,
        file_bytes:          file.size,
        mime_type:           'application/pdf',
        source:              'upload',
        parse_review_status: 'approved',
        created_by:          userId,
      })
      .select('*')
      .single()
    if (insErr) {
      await admin.storage.from('chemical-sds').remove([storagePath])
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    if (activate) {
      if (product.active_sds_id) {
        await admin
          .from('chemical_sds_documents')
          .update({
            superseded_by:     sds.id,
            superseded_at:     new Date().toISOString(),
            superseded_reason: 'Replaced by newer revision',
          })
          .eq('id',        product.active_sds_id)
          .eq('tenant_id', tenantId)
      }
      await admin
        .from('chemical_products')
        .update({
          active_sds_id:     sds.id,
          sds_revision_date: revisionDate,
          updated_by:        userId,
        })
        .eq('id',        productId)
        .eq('tenant_id', tenantId)
    }

    return NextResponse.json({ sds, activated: activate }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
