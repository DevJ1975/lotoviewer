import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  validateProductInput,
  GHS_PICTOGRAMS,
  GHS_SIGNAL_WORDS,
  PHYSICAL_STATES,
  type ChemicalProductInput,
  type GhsPictogram,
  type GhsSignalWord,
  type PhysicalState,
} from '@soteria/core/chemicals'

// GET  /api/chemicals/products      List + search.
// POST /api/chemicals/products      Create a product (no SDS yet — caller
//                                   then POSTs /[id]/sds with the file).

const VALID_SORTS = ['name', 'manufacturer', 'sds_revision_date', 'created_at'] as const
const VALID_DIRS  = ['asc', 'desc'] as const

function pickArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim())
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const search = url.searchParams.get('search')?.trim() ?? ''
  const pictogram = url.searchParams.get('pictogram')?.trim() ?? ''
  const includeArchived = url.searchParams.get('include_archived') === 'true'

  const sortRaw = url.searchParams.get('sort')
  const sort = (VALID_SORTS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as typeof VALID_SORTS[number]) : 'name'
  const dirRaw = url.searchParams.get('dir')
  const dir = (VALID_DIRS as readonly string[]).includes(dirRaw ?? '')
    ? (dirRaw as typeof VALID_DIRS[number]) : 'asc'

  const limit  = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit')  ?? '100', 10) || 100))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)

  try {
    let q = gate.authedClient
      .from('chemical_products')
      .select('*', { count: 'exact' })
      .eq('tenant_id', gate.tenantId)

    if (!includeArchived) q = q.is('archived_at', null)

    if (search) {
      const safe = search.replace(/[,()]/g, ' ').trim()
      if (safe) {
        // ilike on name + manufacturer + product_code; CAS exact match
        // via array contains when the search term looks like a CAS.
        const escaped = safe.replace(/[%_]/g, m => `\\${m}`)
        q = q.or([
          `name.ilike.%${escaped}%`,
          `manufacturer.ilike.%${escaped}%`,
          `product_code.ilike.%${escaped}%`,
        ].join(','))
      }
    }

    if (pictogram && (GHS_PICTOGRAMS as readonly string[]).includes(pictogram)) {
      q = q.contains('ghs_pictograms', [pictogram])
    }

    q = q.order(sort, { ascending: dir === 'asc', nullsFirst: false })
         .range(offset, offset + limit - 1)

    const { data, count, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({
      products: data ?? [],
      total:    count ?? 0,
      limit,
      offset,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const physicalStateRaw = typeof body.physical_state === 'string' ? body.physical_state : null
  const physical_state: PhysicalState | null =
    physicalStateRaw && (PHYSICAL_STATES as readonly string[]).includes(physicalStateRaw)
      ? (physicalStateRaw as PhysicalState) : null

  const signalRaw = typeof body.ghs_signal_word === 'string' ? body.ghs_signal_word : null
  const ghs_signal_word: GhsSignalWord | null =
    signalRaw && (GHS_SIGNAL_WORDS as readonly string[]).includes(signalRaw)
      ? (signalRaw as GhsSignalWord) : null

  const ghs_pictograms = pickArray(body.ghs_pictograms)
    .filter((p): p is GhsPictogram => (GHS_PICTOGRAMS as readonly string[]).includes(p))

  const input: ChemicalProductInput = {
    name:             typeof body.name === 'string' ? body.name.trim() : '',
    manufacturer:     typeof body.manufacturer === 'string' && body.manufacturer.trim() ? body.manufacturer.trim() : null,
    product_code:     typeof body.product_code === 'string' && body.product_code.trim() ? body.product_code.trim() : null,
    cas_numbers:      pickArray(body.cas_numbers),
    synonyms:         pickArray(body.synonyms),
    physical_state,
    ghs_pictograms,
    ghs_signal_word,
    nfpa_health:        typeof body.nfpa_health === 'number' ? body.nfpa_health : null,
    nfpa_flammability:  typeof body.nfpa_flammability === 'number' ? body.nfpa_flammability : null,
    nfpa_instability:   typeof body.nfpa_instability === 'number' ? body.nfpa_instability : null,
    nfpa_special:       typeof body.nfpa_special === 'string' && body.nfpa_special.trim() ? body.nfpa_special.trim() : null,
    ppe_required:       pickArray(body.ppe_required),
    flash_point_c:      typeof body.flash_point_c === 'number' ? body.flash_point_c : null,
    boiling_point_c:    typeof body.boiling_point_c === 'number' ? body.boiling_point_c : null,
    storage_class:      typeof body.storage_class === 'string' && body.storage_class.trim() ? body.storage_class.trim() : null,
    incompatibilities:  pickArray(body.incompatibilities),
    sds_revision_date:  typeof body.sds_revision_date === 'string' && body.sds_revision_date.trim() ? body.sds_revision_date.trim() : null,
    sds_source_url:     typeof body.sds_source_url === 'string' && body.sds_source_url.trim() ? body.sds_source_url.trim() : null,
    notes:              typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
  }

  const errors = validateProductInput(input)
  if (errors.length > 0) {
    return NextResponse.json({
      error: errors.map(e => `${e.field}: ${e.message}`).join('; '),
    }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('chemical_products')
      .insert({
        tenant_id:  gate.tenantId,
        created_by: gate.userId,
        updated_by: gate.userId,
        ...input,
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ product: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
