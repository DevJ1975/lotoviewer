import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  renderHazardousWasteLabel,
  HW_LABEL_SIZES,
  type HwContainerLabelInput,
} from '@/lib/hazardousWasteLabels'
import {
  GHS_PICTOGRAMS,
  GHS_SIGNAL_WORDS,
  type GhsPictogram,
  type GhsSignalWord,
} from '@soteria/core/chemicals'

// POST /api/hazardous-waste/streams/[id]/labels
//   body: { template: 'hw_container', size: '4x6' | '8.5x11' }
//
// Streams back a hazardous-waste container label (40 CFR 262.32 marking)
// snapshotted from the stream row, and logs the print to
// hazardous_waste_label_prints so an EPA / CUPA inspector can answer
// "what did the label on this drum say when it was printed?".
//
// Only the container template is valid here; the accumulation-area placard
// is served by /api/hazardous-waste/areas/[id]/signage where the hazard
// rollup is aggregated across the area's streams.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The stream-scoped route only prints container labels.
const STREAM_TEMPLATE = 'hw_container' as const

interface Ctx { params: Promise<{ id: string }> }

interface StreamRow {
  id:                       string
  name:                     string
  generator_category:       string
  waste_codes:              string[] | null
  hazards:                  string[] | null
  ghs_signal_word:          string | null
  ghs_pictograms:           string[] | null
  nfpa_health:              number | null
  nfpa_flammability:        number | null
  nfpa_instability:         number | null
  nfpa_special:             string | null
  dot_un_number:            string | null
  dot_hazard_class:         string | null
  dot_packing_group:        string | null
  dot_proper_shipping_name: string | null
  archived_at:              string | null
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const tenantId = gate.tenantId
  const userId   = gate.userId

  const { id: streamId } = await ctx.params
  if (!UUID_RE.test(streamId)) {
    return NextResponse.json({ error: 'Invalid stream id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const templateRaw = typeof body.template === 'string' ? body.template : STREAM_TEMPLATE
  if (templateRaw !== STREAM_TEMPLATE) {
    return NextResponse.json({
      error: `Unknown template for a stream label: ${templateRaw}. Valid: ${STREAM_TEMPLATE}`,
    }, { status: 400 })
  }

  const sizeKey = typeof body.size === 'string' ? body.size : ''
  if (!HW_LABEL_SIZES[STREAM_TEMPLATE].some(s => s.key === sizeKey)) {
    return NextResponse.json({
      error: `Unknown size for ${STREAM_TEMPLATE}: ${sizeKey}. ` +
             `Valid: ${HW_LABEL_SIZES[STREAM_TEMPLATE].map(s => s.key).join(', ')}`,
    }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()

    const { data: stream, error: sErr } = await admin
      .from('hazardous_waste_streams')
      .select(`
        id, name, generator_category, waste_codes, hazards,
        ghs_signal_word, ghs_pictograms,
        nfpa_health, nfpa_flammability, nfpa_instability, nfpa_special,
        dot_un_number, dot_hazard_class, dot_packing_group, dot_proper_shipping_name,
        archived_at
      `)
      .eq('id', streamId)
      .eq('tenant_id', tenantId)
      .maybeSingle<StreamRow>()
    if (sErr)    return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!stream) return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
    if (stream.archived_at) {
      return NextResponse.json({ error: 'Cannot print labels for an archived waste stream.' }, { status: 409 })
    }

    const { data: tenantRow } = await admin
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle<{ name: string }>()
    const tenantName = tenantRow?.name ?? 'Soteria Field'

    const origin = req.headers.get('origin') ?? new URL(req.url).origin
    const qrUrl = `${origin.replace(/\/+$/, '')}/hazardous-waste/streams/${streamId}`

    const signalWord: GhsSignalWord | null =
      stream.ghs_signal_word
      && (GHS_SIGNAL_WORDS as readonly string[]).includes(stream.ghs_signal_word)
        ? (stream.ghs_signal_word as GhsSignalWord) : null

    const pictograms: GhsPictogram[] = (stream.ghs_pictograms ?? [])
      .filter((p): p is GhsPictogram => (GHS_PICTOGRAMS as readonly string[]).includes(p))

    const input: HwContainerLabelInput = {
      stream_id:               stream.id,
      stream_name:             stream.name,
      // The container's own accumulation start date isn't on the stream;
      // it's stamped per-container at fill time and left blank here so the
      // generator hand-writes it when the drum starts accumulating.
      accumulation_start_date: null,
      waste_codes:             stream.waste_codes ?? [],
      hazards:                 stream.hazards ?? [],
      ghs_signal_word:         signalWord,
      ghs_pictograms:          pictograms,
      nfpa_health:             stream.nfpa_health,
      nfpa_flammability:       stream.nfpa_flammability,
      nfpa_instability:        stream.nfpa_instability,
      nfpa_special:            stream.nfpa_special,
      dot: {
        un_number:            stream.dot_un_number,
        hazard_class:         stream.dot_hazard_class,
        packing_group:        stream.dot_packing_group,
        proper_shipping_name: stream.dot_proper_shipping_name,
      },
      // The tenant IS the RCRA generator; the manifest names the facility.
      generator_name:          tenantName,
      generator_category:      stream.generator_category,
      qr_url:                  qrUrl,
      tenant_name:             tenantName,
    }

    const result = await renderHazardousWasteLabel({ template: STREAM_TEMPLATE, sizeKey, input })

    // Log the print. Don't block the PDF on the audit insert failing — an
    // auditor missing one row is recoverable; a failed print means an
    // unlabeled drum on the floor.
    try {
      await admin.from('hazardous_waste_label_prints').insert({
        tenant_id:      tenantId,
        stream_id:      streamId,
        template:       STREAM_TEMPLATE,
        size_key:       sizeKey,
        field_snapshot: input,
        filename:       result.filename,
        byte_size:      result.byteSize,
        printed_by:     userId,
      })
    } catch (logErr) {
      Sentry.captureException(logErr, { tags: { route: 'hazardous-waste/streams/labels', stage: 'audit' } })
    }

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
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/streams/labels' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// GET /api/hazardous-waste/streams/[id]/labels
// Recent label-print history for the stream's audit drawer.
export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id: streamId } = await ctx.params
  if (!UUID_RE.test(streamId)) {
    return NextResponse.json({ error: 'Invalid stream id' }, { status: 400 })
  }

  try {
    const { data, error } = await gate.authedClient
      .from('hazardous_waste_label_prints')
      .select('id, template, size_key, filename, byte_size, area_id, container_id, printed_at, printed_by')
      .eq('stream_id', streamId)
      .eq('tenant_id', gate.tenantId)
      .order('printed_at', { ascending: false })
      .limit(50)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ prints: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
