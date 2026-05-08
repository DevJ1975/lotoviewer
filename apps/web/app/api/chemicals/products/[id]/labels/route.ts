import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  renderChemicalLabel,
  LABEL_SIZES,
  type LabelTemplate,
  type LabelInput,
} from '@/lib/chemicalLabels'
import {
  GHS_PICTOGRAMS,
  GHS_SIGNAL_WORDS,
  type GhsPictogram,
  type GhsSignalWord,
} from '@soteria/core/chemicals'

// POST /api/chemicals/products/[id]/labels
//   body: { template: 'secondary_container'|'placard'|'inventory_tag', size: '4x6', barcode?: string }
//
// Streams back a PDF with chemical-management label content snapshotted
// from the product row. Logs every render to chemical_label_prints so
// auditors can answer "what did the label printed on date X actually
// say?" even after the product row changes.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TEMPLATES: readonly LabelTemplate[] =
  ['secondary_container', 'placard', 'inventory_tag'] as const

interface Ctx { params: Promise<{ id: string }> }

interface ProductRow {
  id:                string
  name:              string
  manufacturer:      string | null
  product_code:      string | null
  ghs_signal_word:   string | null
  ghs_pictograms:    string[] | null
  hazard_statements: { code: string; text: string }[] | null
  ppe_required:      string[] | null
  nfpa_health:       number | null
  nfpa_flammability: number | null
  nfpa_instability:  number | null
  nfpa_special:      string | null
  cas_numbers:       string[] | null
  storage_class:     string | null
  archived_at:       string | null
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const tenantId = gate.tenantId
  const userId   = gate.userId

  const { id: productId } = await ctx.params
  if (!UUID_RE.test(productId)) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const templateRaw = typeof body.template === 'string' ? body.template : ''
  if (!(TEMPLATES as readonly string[]).includes(templateRaw)) {
    return NextResponse.json({ error: `Unknown template: ${templateRaw}` }, { status: 400 })
  }
  const template = templateRaw as LabelTemplate

  const sizeKey = typeof body.size === 'string' ? body.size : ''
  if (!LABEL_SIZES[template].some(s => s.key === sizeKey)) {
    return NextResponse.json({
      error: `Unknown size for ${template}: ${sizeKey}. ` +
             `Valid: ${LABEL_SIZES[template].map(s => s.key).join(', ')}`,
    }, { status: 400 })
  }

  const barcode = typeof body.barcode === 'string' && body.barcode.trim()
    ? body.barcode.trim().slice(0, 64)
    : null

  try {
    const admin = supabaseAdmin()

    const { data: product, error: pErr } = await admin
      .from('chemical_products')
      .select(`
        id, name, manufacturer, product_code,
        ghs_signal_word, ghs_pictograms,
        hazard_statements, ppe_required,
        nfpa_health, nfpa_flammability, nfpa_instability, nfpa_special,
        cas_numbers, storage_class, archived_at
      `)
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .maybeSingle<ProductRow>()
    if (pErr)     return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    if (product.archived_at) {
      return NextResponse.json({ error: 'Cannot print labels for an archived chemical.' }, { status: 409 })
    }

    const { data: tenantRow } = await admin
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle<{ name: string }>()

    // Build the absolute QR URL — /chemicals/[id] resolves to the
    // detail page where field workers can view the active SDS.
    const origin = req.headers.get('origin')
      ?? new URL(req.url).origin
    const qrUrl = `${origin.replace(/\/+$/, '')}/chemicals/${productId}`

    const signalWord: GhsSignalWord | null =
      product.ghs_signal_word
      && (GHS_SIGNAL_WORDS as readonly string[]).includes(product.ghs_signal_word)
        ? (product.ghs_signal_word as GhsSignalWord) : null

    const pictograms: GhsPictogram[] = (product.ghs_pictograms ?? [])
      .filter((p): p is GhsPictogram =>
        (GHS_PICTOGRAMS as readonly string[]).includes(p))

    const input: LabelInput = {
      product_id:        product.id,
      product_name:      product.name,
      manufacturer:      product.manufacturer,
      product_code:      product.product_code,
      ghs_signal_word:   signalWord,
      ghs_pictograms:    pictograms,
      hazard_statements: product.hazard_statements ?? [],
      ppe_required:      product.ppe_required ?? [],
      nfpa_health:       product.nfpa_health,
      nfpa_flammability: product.nfpa_flammability,
      nfpa_instability:  product.nfpa_instability,
      nfpa_special:      product.nfpa_special,
      cas_numbers:       product.cas_numbers ?? [],
      storage_class:     product.storage_class,
      qr_url:            qrUrl,
      barcode,
      tenant_name:       tenantRow?.name ?? 'Soteria Field',
    }

    const result = await renderChemicalLabel({ template, sizeKey, input })

    // Log the print. Don't block the PDF on the audit insert failing —
    // an auditor missing one row is recoverable; a failed label print
    // means an unlabeled chemical on the floor.
    try {
      await admin.from('chemical_label_prints').insert({
        tenant_id:      tenantId,
        product_id:     productId,
        template,
        size_key:       sizeKey,
        field_snapshot: input,
        filename:       result.filename,
        byte_size:      result.byteSize,
        printed_by:     userId,
      })
    } catch (logErr) {
      Sentry.captureException(logErr, { tags: { route: 'chemicals/labels', stage: 'audit' } })
    }

    // Stream the PDF back. Browser opens in a new tab; downstream UI
    // can drop it into a print frame.
    // NextResponse expects a BodyInit; wrap the Uint8Array in a Blob
    // (Web-standard) so it works in both Node and Edge runtimes.
    const pdfBlob = new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' })
    return new NextResponse(pdfBlob, {
      status: 200,
      headers: {
        'content-type':        'application/pdf',
        'content-disposition': `inline; filename="${result.filename}"`,
        'cache-control':       'no-store',
      },
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chemicals/labels' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// GET /api/chemicals/products/[id]/labels
// Recent label-print history for the audit drawer on the detail page.
export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id: productId } = await ctx.params
  if (!UUID_RE.test(productId)) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_label_prints')
      .select('id, template, size_key, filename, byte_size, printed_at, printed_by')
      .eq('product_id', productId)
      .eq('tenant_id', gate.tenantId)
      .order('printed_at', { ascending: false })
      .limit(50)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ prints: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
